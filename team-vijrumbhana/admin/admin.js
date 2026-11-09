(function () {
  var API = window.APP_CONFIG.API_BASE_URL;
  var TOKEN_KEY = 'svp_admin_token';

  var loginView = document.getElementById('login-view');
  var dashView = document.getElementById('dashboard-view');
  var loginForm = document.getElementById('login-form');
  var loginBtn = document.getElementById('login-btn');
  var loginMsg = document.getElementById('login-message');
  var dashMsg = document.getElementById('dash-message');
  var rowsEl = document.getElementById('rows');
  var summaryEl = document.getElementById('summary');
  var filterEl = document.getElementById('filter');
  var searchEl = document.getElementById('search');

  var complaints = [];

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  function setToken(value) {
    try {
      if (value) sessionStorage.setItem(TOKEN_KEY, value);
      else sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* ignore */ }
  }

  function setMessage(el, text, type) {
    el.textContent = text || '';
    el.className = 'message ' + (type || '');
  }

  function showLogin() {
    dashView.hidden = true;
    loginView.hidden = false;
  }
  function showDashboard() {
    loginView.hidden = true;
    dashView.hidden = false;
  }

  async function api(path, options) {
    options = options || {};
    var headers = { 'Content-Type': 'application/json' };
    var token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;

    var response = await fetch(API + path, {
      method: options.method || 'GET',
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    var data = await response.json().catch(function () { return {}; });
    if (response.status === 401 && path !== '/api/admin/login') {
      setToken('');
      showLogin();
      setMessage(loginMsg, 'Your session ended. Please sign in again.', 'error');
    }
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  // ---------- Rendering ----------
  function cell(text, className) {
    var td = document.createElement('td');
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function visibleComplaints() {
    var status = filterEl.value;
    var query = searchEl.value.trim().toLowerCase();
    return complaints.filter(function (c) {
      if (status && c.status !== status) return false;
      if (!query) return true;
      return [c.studentName, c.institutionName, c.rollNumber, c.phone, c.details, c.className]
        .join(' ').toLowerCase().indexOf(query) !== -1;
    });
  }

  function render() {
    var list = visibleComplaints();
    rowsEl.textContent = '';

    var pending = complaints.filter(function (c) { return c.status === 'Pending'; }).length;
    summaryEl.textContent = complaints.length + ' total, ' + pending + ' pending';

    if (!list.length) {
      var tr = document.createElement('tr');
      var td = cell(complaints.length ? 'No complaints match your filter.' : 'No complaints yet.', 'empty');
      td.colSpan = 8;
      tr.appendChild(td);
      rowsEl.appendChild(tr);
      return;
    }

    list.forEach(function (c) {
      var tr = document.createElement('tr');
      tr.appendChild(cell(c.id));
      tr.appendChild(cell(formatDate(c.createdAt)));
      tr.appendChild(cell(c.studentName));
      tr.appendChild(cell(c.institutionName + ' (' + c.institutionType + ')'));
      tr.appendChild(cell(c.className + ' / ' + c.section + ' / ' + c.rollNumber));
      tr.appendChild(cell(c.phone));
      tr.appendChild(cell(c.details, 'details'));

      var statusTd = document.createElement('td');
      var select = document.createElement('select');
      select.className = 'status status-' + c.status.toLowerCase().replace(/\s+/g, '-');
      ['Pending', 'In Progress', 'Resolved'].forEach(function (s) {
        var opt = document.createElement('option');
        opt.textContent = s;
        opt.selected = s === c.status;
        select.appendChild(opt);
      });
      select.addEventListener('change', function () { changeStatus(c.id, select); });
      statusTd.appendChild(select);
      tr.appendChild(statusTd);

      rowsEl.appendChild(tr);
    });
  }

  // ---------- Actions ----------
  async function loadComplaints() {
    setMessage(dashMsg, 'Loading complaints...', 'info');
    try {
      var data = await api('/api/admin/complaints');
      complaints = data.complaints;
      setMessage(dashMsg, '');
      render();
    } catch (err) {
      setMessage(dashMsg, err.message, 'error');
    }
  }

  async function changeStatus(id, select) {
    var newStatus = select.value;
    select.disabled = true;
    try {
      var data = await api('/api/admin/complaints/' + id, { method: 'PATCH', body: { status: newStatus } });
      complaints = complaints.map(function (c) { return c.id === id ? data.complaint : c; });
      setMessage(dashMsg, 'Complaint #' + id + ' marked as ' + newStatus + '.', 'success');
      render();
    } catch (err) {
      setMessage(dashMsg, err.message, 'error');
      await loadComplaints();
    }
  }

  loginForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    loginBtn.disabled = true;
    setMessage(loginMsg, 'Signing in... (the server may take up to a minute to wake up)', 'info');
    try {
      var data = await api('/api/admin/login', {
        method: 'POST',
        body: { password: document.getElementById('password').value },
      });
      setToken(data.token);
      document.getElementById('password').value = '';
      setMessage(loginMsg, '');
      showDashboard();
      loadComplaints();
    } catch (err) {
      setMessage(loginMsg, err.message === 'Failed to fetch' ? 'Could not reach the server.' : err.message, 'error');
    } finally {
      loginBtn.disabled = false;
    }
  });

  document.getElementById('logout-btn').addEventListener('click', function () {
    setToken('');
    complaints = [];
    showLogin();
  });
  document.getElementById('refresh-btn').addEventListener('click', loadComplaints);
  filterEl.addEventListener('change', render);
  searchEl.addEventListener('input', render);

  // Resume an existing session in this tab
  if (getToken()) {
    showDashboard();
    loadComplaints();
  } else {
    showLogin();
  }
})();
