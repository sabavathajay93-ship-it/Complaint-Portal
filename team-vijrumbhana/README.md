# Team Vijrumbhana - Student Voice Portal (PostgreSQL edition)

A student complaint portal. Every complaint is stored in a **PostgreSQL** table named `complaints`.

| Part | Folder | Runs on |
|---|---|---|
| Student form | `frontend/` | Vercel (static) |
| REST API | `backend/` | Render (Node + Express) |
| Admin dashboard | `admin/` | GitHub Pages (static) |
| Database | - | PostgreSQL (local while testing, hosted in production) |

Flow: student form -> `POST /api/complaints` -> PostgreSQL. Admin dashboard -> sign in -> list complaints / change status.

---

## PART A - Run it on your laptop (localhost)

### A1. Install Node.js
1. Download the **LTS** version from https://nodejs.org and install it (keep the defaults).
2. Open a new terminal (Command Prompt / PowerShell) and check: `node --version` (should be 18 or higher).

### A2. Install PostgreSQL (Windows)
1. Download the installer from https://www.postgresql.org/download/windows/ (EDB installer).
2. Run it and keep the default components (PostgreSQL Server, pgAdmin 4, Command Line Tools).
3. When asked for the **password for the database superuser (postgres)**, choose one and **write it down**.
4. Keep the port as **5432**, finish the installation. (You can skip Stack Builder.)

macOS: `brew install postgresql@16 && brew services start postgresql@16`
Linux (Ubuntu): `sudo apt install postgresql` then `sudo systemctl start postgresql`

### A3. Create the database
Using pgAdmin 4 (easiest):
1. Open **pgAdmin 4**, enter the master password if asked.
2. Expand **Servers -> PostgreSQL**, enter your postgres password.
3. Right-click **Databases -> Create -> Database...**
4. Name it `complaints_db` and click **Save**.

Or with the command line:
```bash
psql -U postgres
CREATE DATABASE complaints_db;
\q
```
You do NOT need to create the table. The backend creates the `complaints` table automatically when it starts.

### A4. Configure the backend
```bash
cd backend
npm install
```
Copy `.env.example` to `.env` (Windows: `copy .env.example .env`) and edit it:

```
ADMIN_PASSWORD=choose-a-password
TOKEN_SECRET=<random text, 32+ characters>
DATABASE_URL=postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/complaints_db
DATABASE_SSL=false
ALLOWED_ORIGINS=http://localhost:5500,http://127.0.0.1:5500,http://localhost:5501,http://127.0.0.1:5501
```
Generate a token secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

If your postgres password contains special characters such as `@`, `#` or `/`, URL-encode them (`@` becomes `%40`).

### A5. Start the backend
```bash
npm run dev
```
You should see: `API running on port 3000 (storage: postgresql)`.
Open http://localhost:3000/api/health - it should show `{"status":"ok","storage":"postgresql"}`.

### A6. Start the student form and the admin page
Open two more terminals in the project root folder:
```bash
npx serve frontend -l 5500
npx serve admin -l 5501
```
- Student form: http://localhost:5500
- Admin dashboard: http://localhost:5501

(VS Code Live Server also works; keep its port in `ALLOWED_ORIGINS`.)

### A7. Test it
1. Submit a complaint on http://localhost:5500.
2. Sign in on http://localhost:5501 with your `ADMIN_PASSWORD`; the complaint appears. Change its status.
3. See the raw data: pgAdmin -> `complaints_db` -> Schemas -> public -> Tables -> complaints -> right-click -> **View/Edit Data -> All Rows**.
   Or: `psql -U postgres -d complaints_db -c "SELECT * FROM complaints;"`

---

## PART B - Deploy to the internet

Order matters: database -> backend -> frontend -> admin -> final CORS update.

### B1. Push the project to GitHub
1. Create a new repository on https://github.com (for example `student-voice-portal`).
2. Upload everything, keeping the folders `frontend`, `backend`, `admin` and `.github` at the top level.
   Do NOT upload `.env` (it is in `.gitignore`).
3. Commit to the `main` branch.

### B2. Create the hosted PostgreSQL database
Option 1 - Render PostgreSQL:
1. Render dashboard -> **New -> PostgreSQL**. Name: `complaints-db`. Pick the region closest to you (e.g. Singapore).
2. Choose a plan and create it. Wait until the status is **Available**.
3. Copy the **Internal Database URL** (use it for a backend that is also on Render).

Important: a Render **free** PostgreSQL database expires 30 days after creation (14-day grace period, no backups). For a portal that must keep data, use a paid Render database, or a free hosted PostgreSQL from another provider (Neon, Supabase) and use its connection string as `DATABASE_URL` instead. Check each provider's current free-tier limits.

### B3. Deploy the backend on Render
1. Render -> **New -> Web Service** -> connect your GitHub repository.
2. Settings:

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |

3. Environment variables:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `ADMIN_PASSWORD` | strong password |
| `TOKEN_SECRET` | random text, 32+ characters |
| `DATABASE_URL` | the database URL from B2 |
| `DATABASE_SSL` | `true` |
| `ALLOWED_ORIGINS` | add after B4 and B5 (see B6) |

4. Click **Create Web Service**, wait for "Live".
5. Open `https://YOUR-SERVICE.onrender.com/api/health` - expect `{"status":"ok","storage":"postgresql"}`.

### B4. Deploy the student form on Vercel
1. First edit `frontend/config.js`: set `PRODUCTION_API_URL` to your Render URL (no trailing slash). Commit and push.
2. Vercel -> **Add New -> Project** -> import the same repository.
3. **Root Directory:** `frontend`. **Framework Preset:** Other. Leave Build Command empty. Output Directory: `.`
4. Deploy. Note your Vercel URL (for example `https://something.vercel.app`).

### B5. Deploy the admin dashboard on GitHub Pages
1. Edit `admin/config.js`: set `PRODUCTION_API_URL` to your Render URL. Commit and push.
2. Repository -> **Settings -> Pages** -> **Build and deployment -> Source: GitHub Actions**.
3. Repository -> **Actions** tab -> wait for "Deploy admin dashboard to GitHub Pages" to turn green
   (if it did not start, open the workflow and click **Run workflow**).
4. Admin URL: `https://YOUR-GITHUB-USERNAME.github.io/YOUR-REPOSITORY/`

### B6. Allow both websites to call the backend (CORS)
In Render -> your web service -> **Environment**, set:
```
ALLOWED_ORIGINS=https://YOUR-VERCEL-URL,https://YOUR-GITHUB-USERNAME.github.io
```
Origins only: no paths, no trailing slash. Save; Render redeploys.

### B7. Final test
1. Open the Vercel URL, submit a complaint (the first request can take about a minute if Render was asleep).
2. Open the admin URL, sign in, confirm the complaint is listed, change its status.

---

## API

| Method | Endpoint | Access |
|---|---|---|
| GET | `/api/health` | Public |
| POST | `/api/complaints` | Public (rate limited) |
| POST | `/api/admin/login` | Password (rate limited) |
| GET | `/api/admin/complaints` | Admin token |
| PATCH | `/api/admin/complaints/:id` | Admin token |

## Troubleshooting

- **`password authentication failed for user "postgres"`** - wrong password in `DATABASE_URL`.
- **`ECONNREFUSED 127.0.0.1:5432`** - PostgreSQL is not running (Windows: Services -> postgresql-x64-xx -> Start).
- **`database "complaints_db" does not exist`** - do step A3.
- **Hosted database: `SSL` / `no pg_hba.conf entry` error** - set `DATABASE_SSL=true`.
- **CORS error in the browser** - the website's origin is missing from `ALLOWED_ORIGINS`; fix it and redeploy the backend.
- **Form shows "Could not reach the server" on Vercel** - `PRODUCTION_API_URL` in `frontend/config.js` is still the placeholder.
- **Backend exits with "Startup error"** - a required variable (`ADMIN_PASSWORD`, `TOKEN_SECRET` of 32+ characters, `DATABASE_URL`) is missing.
- **Admin page 404** - GitHub Pages source must be "GitHub Actions"; check the Actions tab.

## Security notes

- Never commit `.env`, passwords or database URLs.
- Complaints contain names and phone numbers: share the admin password and database access with as few people as possible.
- GitHub Pages is public hosting, so the admin page source is visible; the data is protected by the backend password, not by hiding the URL.
