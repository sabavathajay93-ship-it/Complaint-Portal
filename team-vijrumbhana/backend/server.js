require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const TOKEN_SECRET = process.env.TOKEN_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const DATABASE_SSL = String(process.env.DATABASE_SSL || '').toLowerCase() === 'true';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const TOKEN_LIFETIME_MS = 8 * 60 * 60 * 1000; // 8 hours
const STATUSES = ['Pending', 'In Progress', 'Resolved'];
const INSTITUTION_TYPES = ['School', 'College', 'University', 'Other'];

function failStartup(message) {
  console.error('Startup error: ' + message);
  process.exit(1);
}

if (!ADMIN_PASSWORD) failStartup('ADMIN_PASSWORD is not set.');
if (!TOKEN_SECRET || TOKEN_SECRET.length < 32) {
  failStartup('TOKEN_SECRET must be set and at least 32 characters long.');
}
if (!DATABASE_URL) failStartup('DATABASE_URL is not set. This app stores complaints in PostgreSQL.');

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_SSL ? { rejectUnauthorized: false } : false,
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS complaints (
      id               SERIAL PRIMARY KEY,
      student_name     TEXT NOT NULL,
      institution_type TEXT NOT NULL,
      institution_name TEXT NOT NULL,
      class_name       TEXT NOT NULL,
      section          TEXT NOT NULL,
      roll_number      TEXT NOT NULL,
      phone            TEXT NOT NULL,
      details          TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'Pending'
                       CHECK (status IN ('Pending', 'In Progress', 'Resolved')),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_complaints_created_at ON complaints (created_at DESC)');
}

function toApi(row) {
  return {
    id: row.id,
    studentName: row.student_name,
    institutionType: row.institution_type,
    institutionName: row.institution_name,
    className: row.class_name,
    section: row.section,
    rollNumber: row.roll_number,
    phone: row.phone,
    details: row.details,
    status: row.status,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Small helpers: signed tokens and rate limiting (no extra packages needed)
// ---------------------------------------------------------------------------
function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
}

function createToken() {
  const payload = b64url(JSON.stringify({ role: 'admin', exp: Date.now() + TOKEN_LIFETIME_MS }));
  return payload + '.' + sign(payload);
}

function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.role === 'admin' && typeof data.exp === 'number' && data.exp > Date.now();
  } catch {
    return false;
  }
}

function passwordMatches(input) {
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, windowMs).unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Please sign in again.' });
  }
  next();
}

function clean(value, max) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy
app.disable('x-powered-by');

app.use(
  cors({
    origin(origin, callback) {
      // Allow tools like curl (no Origin header) and the configured websites.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json({ limit: '20kb' }));

app.get('/', (req, res) => {
  res.json({ service: 'Student Voice Portal API', health: '/api/health' });
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', storage: 'postgresql' });
  } catch (err) {
    console.error('Health check failed:', err.message);
    res.status(500).json({ status: 'error', storage: 'postgresql' });
  }
});

// Public: students submit a complaint
app.post(
  '/api/complaints',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many submissions. Please try again later.' }),
  async (req, res) => {
    const body = req.body || {};
    const c = {
      studentName: clean(body.studentName, 100),
      institutionType: clean(body.institutionType, 30),
      institutionName: clean(body.institutionName, 150),
      className: clean(body.className, 50),
      section: clean(body.section, 20),
      rollNumber: clean(body.rollNumber, 30),
      phone: clean(body.phone, 20),
      // keep line breaks inside the complaint text
      details: String(body.details || '').replace(/\r\n/g, '\n').trim().slice(0, 2000),
    };

    const errors = [];
    if (c.studentName.length < 2) errors.push('Student name is required.');
    if (!INSTITUTION_TYPES.includes(c.institutionType)) errors.push('Choose a valid institution type.');
    if (c.institutionName.length < 2) errors.push('Institution name is required.');
    if (!c.className) errors.push('Class is required.');
    if (!c.section) errors.push('Section is required.');
    if (!c.rollNumber) errors.push('Roll number is required.');
    if (!/^[0-9+\-\s]{7,20}$/.test(c.phone)) errors.push('Enter a valid phone number.');
    if (c.details.length < 10) errors.push('Please describe the complaint (at least 10 characters).');

    if (errors.length) return res.status(400).json({ error: errors[0], errors });

    try {
      const result = await pool.query(
        `INSERT INTO complaints
           (student_name, institution_type, institution_name, class_name, section, roll_number, phone, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [c.studentName, c.institutionType, c.institutionName, c.className, c.section, c.rollNumber, c.phone, c.details]
      );
      res.status(201).json({ message: 'Complaint submitted successfully.', id: result.rows[0].id });
    } catch (err) {
      console.error('Insert failed:', err.message);
      res.status(500).json({ error: 'Could not save the complaint. Please try again.' });
    }
  }
);

// Admin: sign in
app.post(
  '/api/admin/login',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts. Try again in 15 minutes.' }),
  (req, res) => {
    if (!passwordMatches(req.body && req.body.password)) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    res.json({ token: createToken(), expiresInHours: TOKEN_LIFETIME_MS / 3600000 });
  }
);

// Admin: list complaints
app.get('/api/admin/complaints', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM complaints ORDER BY created_at DESC');
    res.json({ complaints: result.rows.map(toApi) });
  } catch (err) {
    console.error('List failed:', err.message);
    res.status(500).json({ error: 'Could not load complaints.' });
  }
});

// Admin: change status
app.patch('/api/admin/complaints/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body && req.body.status;
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid complaint id.' });
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Status must be Pending, In Progress, or Resolved.' });
  }
  try {
    const result = await pool.query('UPDATE complaints SET status = $1 WHERE id = $2 RETURNING *', [status, id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Complaint not found.' });
    res.json({ complaint: toApi(result.rows[0]) });
  } catch (err) {
    console.error('Update failed:', err.message);
    res.status(500).json({ error: 'Could not update the complaint.' });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// Handles malformed JSON bodies and anything unexpected
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.' });
  console.error('Unexpected error:', err);
  res.status(500).json({ error: 'Server error.' });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
initDatabase()
  .then(() => {
    app.listen(PORT, () => console.log(`API running on port ${PORT} (storage: postgresql)`));
  })
  .catch((err) => {
    console.error('Could not connect to PostgreSQL or create the table:', err.message);
    console.error('Check DATABASE_URL and DATABASE_SSL in your .env file.');
    process.exit(1);
  });
