// ------------------ CONFIG ------------------
const API = "http://localhost:4000"; // change as needed for deployment
const socket = io(API);

// Development helper: when true, the frontend will show mock notifications
// if the backend returns no notifications or an error. Turn off in production.
const DEV_MOCK_NOTIFS = true;
// Development helper for analytics mock updates when backend doesn't send real-time events
let DEV_MOCK_ANALYTICS = true;

let token = localStorage.getItem("token") || null;
let currentUser = JSON.parse(localStorage.getItem("user") || "null");

// cached data
let _bugsCache = [];
// loader auto-hide timer (protect against loader getting stuck)
let _loaderTimeout = null;
const LOADER_AUTOHIDE_MS = 12000; // 12s fallback
// users map for id->name lookup
let _usersMap = {};

// helper: safe headers
function headers() {
  const h = { "Content-Type": "application/json" };
  if (token) h.Authorization = "Bearer " + token;
  return h;
}

async function apiRequest(path, opts = {}) {
  const res = await fetch(API + path, Object.assign({ headers: headers() }, opts));
  try {
    return await res.json();
  } catch (e) {
    return { error: 'Invalid JSON response' };
  }
}

const apiGET = (p) => apiRequest(p);
const apiPOST = (p, body) => apiRequest(p, { method: 'POST', body: JSON.stringify(body) });
const apiPUT = (p, body) => apiRequest(p, { method: 'PUT', body: JSON.stringify(body) });
const apiDELETE = (p) => apiRequest(p, { method: 'DELETE' });

// UI helpers
function showModal(html) {
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modalBody');
  modalBody.innerHTML = html;
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.remove('hidden');
  modal.classList.add('show');
}
function hideModal() {
  const modal = document.getElementById('modal');
  modal.setAttribute('aria-hidden', 'true');
  modal.classList.add('hidden');
  modal.classList.remove('show');
}

// Page loader helpers
function showLoader() {
  const l = document.getElementById('pageLoader');
  if (!l) return;
  l.classList.remove('hidden');
  // start an auto-hide timer to ensure loader cannot stay forever
  try {
    if (_loaderTimeout) clearTimeout(_loaderTimeout);
    _loaderTimeout = setTimeout(() => {
      const el = document.getElementById('pageLoader');
      if (el && !el.classList.contains('hidden')) {
        console.warn('Auto-hiding page loader after timeout');
        hideLoader();
      }
    }, LOADER_AUTOHIDE_MS);
  } catch (e) { /* ignore */ }
}
function hideLoader() {
  const l = document.getElementById('pageLoader');
  if (!l) return;
  // clear any pending auto-hide timer
  try { if (_loaderTimeout) { clearTimeout(_loaderTimeout); _loaderTimeout = null; } } catch(e){}
  l.classList.add('hidden');
}

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'modalClose') hideModal();
});

// wire UI once DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // elements
  const authBox = document.getElementById('authBox');
  const appUI = document.getElementById('appUI');
  const logoutBtn = document.getElementById('logoutBtn');
  const userName = document.getElementById('userName');
  const authMessage = document.getElementById('authMessage');
  // auth card elements
  const loginCard = document.getElementById('loginCard');
  const registerCard = document.getElementById('registerCard');
  const showRegister = document.getElementById('showRegister');
  const backToLogin = document.getElementById('backToLogin');

  const projectsList = document.getElementById('projectsList');
  const usersList = document.getElementById('usersList');
  const bugsTable = document.getElementById('bugsTable');
  const reportBox = document.getElementById('reportBox');
  const reportsList = document.getElementById('reportsList');
  const newReportBtn = document.getElementById('newReportBtn');
  const notifBadge = document.getElementById('notifBadge');

  const newProjectBtn = document.getElementById('newProjectBtn');
  const sidebarNewProject = document.getElementById('sidebarNewProject');
  const newBugBtn = document.getElementById('newBugBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const searchInput = document.getElementById('searchInput');
  const filterOpen = document.getElementById('filterOpen');
  const filterAll = document.getElementById('filterAll');

  // auth
  document.getElementById('loginBtn').addEventListener('click', async () => {
    authMessage.textContent = '';
    const email = document.getElementById('loginEmail').value.trim();
    const pass = document.getElementById('loginPassword').value;
    if (!email || !pass) return (authMessage.textContent = 'Please enter email and password');

    const res = await apiPOST('/api/auth/login', { email, password: pass });
    if (res.error) return (authMessage.textContent = res.error || 'Login failed');

    token = res.token; currentUser = res.user;
    localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(currentUser));
    startApp();
  });

  document.getElementById('registerBtn').addEventListener('click', async () => {
    authMessage.textContent = '';
    const email = document.getElementById('regEmail').value.trim();
    const pass = document.getElementById('regPassword').value;
    const name = document.getElementById('regName').value.trim();
    if (!email || !pass || !name) return (authMessage.textContent = 'Please fill name, email and password');

    const res = await apiPOST('/api/auth/register', { email, password: pass, name });
    if (res.error) return (authMessage.textContent = res.error || 'Registration failed');

    token = res.token; currentUser = res.user;
    localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(currentUser));
    startApp();
  });

  // Toggle between login and register cards
  if (showRegister) showRegister.addEventListener('click', (e) => { e.preventDefault(); if (loginCard) loginCard.classList.add('hidden'); if (registerCard) registerCard.classList.remove('hidden'); authMessage.textContent = ''; });
  if (backToLogin) backToLogin.addEventListener('click', (e) => { e.preventDefault(); if (registerCard) registerCard.classList.add('hidden'); if (loginCard) loginCard.classList.remove('hidden'); authMessage.textContent = ''; });

  // modal close
  document.getElementById('modalClose').addEventListener('click', hideModal);

  // new project & bug
  function openNewProject() {
    showModal(`<h3>Create Project</h3>
      <form id="createProjectForm" class="form">
        <label for="projName">Project name</label>
        <input id="projName" name="name" required />
        <label for="projDesc">Description</label>
        <textarea id="projDesc" name="description"></textarea>
        <div style="margin-top:12px"><button type="button" id="createProjectSubmit" class="btn">Create</button></div>
      </form>`);

    document.getElementById('createProjectSubmit').onclick = async () => {
      const name = document.getElementById('projName').value.trim();
      const description = document.getElementById('projDesc').value.trim();
      if (!name) return alert('Name required');
      const res = await apiPOST('/api/projects', { name, description });
      if (res.error) return alert(res.error || 'Failed to create');
      hideModal();
      // reload projects and animate the newly created entry
      await loadProjects();
      // find the created list item and animate
      try {
        const items = Array.from(document.querySelectorAll('#projectsList li'));
        const found = items.find(li => li.textContent.trim() === name || li.dataset.id === (res._id));
        if (found) { found.classList.add('anim-create'); setTimeout(() => found.classList.remove('anim-create'), 800); }
      } catch (e) {}
    };
  }

  function openNewBug() {
    // fetch users & projects for selects
    Promise.all([apiGET('/api/users'), apiGET('/api/projects')]).then(([users, projects]) => {
      const usersOptions = (users || []).map(u => `<option value="${u._id}">${u.name}</option>`).join('');
      const projOptions = (projects || []).map(p => `<option value="${p._id}">${p.name}</option>`).join('');

      showModal(`<h3>Report Bug</h3>
        <form id="createBugForm" class="form">
          <label for="bugTitle">Title</label>
          <input id="bugTitle" required />
          <label for="bugDesc">Description</label>
          <textarea id="bugDesc"></textarea>
          <label for="bugProject">Project</label>
          <select id="bugProject">${projOptions}</select>
          <label for="bugAssignee">Assign to</label>
          <select id="bugAssignee"><option value="">(none)</option>${usersOptions}</select>
          <label for="bugPriority">Priority</label>
          <select id="bugPriority"><option>low</option><option selected>medium</option><option>high</option></select>
          <div style="margin-top:12px"><button type="button" id="createBugSubmit" class="btn primary">Report</button></div>
        </form>`);

      document.getElementById('createBugSubmit').onclick = async () => {
        const title = document.getElementById('bugTitle').value.trim();
        const description = document.getElementById('bugDesc').value.trim();
        const project_id = document.getElementById('bugProject').value || null;
        const assignee_id = document.getElementById('bugAssignee').value || null;
        const priority = document.getElementById('bugPriority').value;
        if (!title) return alert('Title required');
        const res = await apiPOST('/api/bugs', { title, description, project_id, assignee_id, priority });
        if (res.error) return alert(res.error || 'Failed to create bug');
        hideModal();
        // reload bugs then animate the new row
        await loadBugs();
        await loadReports();
        await loadSolutions();
        try {
          const row = document.querySelector(`#bugsTable tr[data-id='${res._id}']`);
          if (row) { row.classList.add('anim-create'); setTimeout(()=>row.classList.remove('anim-create'), 900); }
        } catch (e) {}
      };
    });
  }

  newProjectBtn.addEventListener('click', openNewProject);
  if (sidebarNewProject) sidebarNewProject.addEventListener('click', openNewProject);
  newBugBtn.addEventListener('click', openNewBug);
  refreshBtn.addEventListener('click', () => loadAll());
  // Setup search + filters
  const debouncedRender = debounce(() => renderBugs(), 180);
  // Search is performed only for the Bugs section via an explicit Search button.
  const searchBtn = document.getElementById('searchBtn');
  if (searchBtn && searchInput) {
    // Clicking the button runs the search (filters bugs by title/description/id)
    searchBtn.addEventListener('click', () => {
      _bugFilter.q = (searchInput.value || '').trim();
      renderBugs();
    });
    // Allow Enter key inside the search input to trigger the same search
    searchInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        searchBtn.click();
      }
    });
  } else if (searchInput) {
    // Fallback: if the button is missing, keep a debounced live search
    searchInput.addEventListener('input', (e) => { _bugFilter.q = e.target.value; debouncedRender(); });
  }
  if (filterOpen) filterOpen.addEventListener('click', () => { _bugFilter.status = 'open'; filterOpen.classList.add('filter-active'); filterAll.classList.remove('filter-active'); renderBugs(); });
  if (filterAll) filterAll.addEventListener('click', () => { _bugFilter.status = 'all'; filterAll.classList.add('filter-active'); filterOpen.classList.remove('filter-active'); renderBugs(); });

  // Advanced filter dropdown (status/priority/assignee/project)
  const filterBtn = document.getElementById('filterBtn');
  const filterDropdown = document.getElementById('filterDropdown');
  async function populateFilterDropdown() {
    if (!filterDropdown) return;
    const assigneeSelect = filterDropdown.querySelector('#filterAssignee');
    const projectSelect = filterDropdown.querySelector('#filterProject');
    try {
      if (assigneeSelect && assigneeSelect.options.length <= 1) {
        const users = await apiGET('/api/users') || [];
        assigneeSelect.innerHTML = '<option value="">(any)</option>' + (users.map(u=>`<option value="${u._id}">${escapeHtml(u.name)}</option>`).join(''));
      }
    } catch(e) { console.debug('populate assignees failed', e); }
    try {
      if (projectSelect && projectSelect.options.length <= 1) {
        const projects = await apiGET('/api/projects') || [];
        projectSelect.innerHTML = '<option value="">(any)</option>' + (projects.map(p=>`<option value="${p._id}">${escapeHtml(p.name)}</option>`).join(''));
      }
    } catch(e) { console.debug('populate projects failed', e); }
  }

  if (filterBtn && filterDropdown) {
    // manage open/close with transition awareness
    let outsideClickHandler = null;
    function closeFilterDropdown() {
      if (!filterDropdown.classList.contains('show')) return;
      filterDropdown.classList.remove('show');
      filterBtn.setAttribute('aria-expanded','false');
      // after transition complete, mark hidden to keep DOM tidy
      const onEnd = (ev) => {
        if (ev && ev.target !== filterDropdown) return;
        filterDropdown.classList.add('hidden');
        filterDropdown.removeEventListener('transitionend', onEnd);
      };
      filterDropdown.addEventListener('transitionend', onEnd);
      // safety fallback in case transitionend doesn't fire
      setTimeout(() => { if (!filterDropdown.classList.contains('hidden')) filterDropdown.classList.add('hidden'); }, 260);
      if (outsideClickHandler) { document.removeEventListener('click', outsideClickHandler); outsideClickHandler = null; }
    }

    async function openFilterDropdown() {
      await populateFilterDropdown();
      filterDropdown.classList.remove('hidden');
      // allow a frame for the class removal to be painted before adding `show`
      requestAnimationFrame(() => requestAnimationFrame(() => filterDropdown.classList.add('show')));
      filterBtn.setAttribute('aria-expanded','true');
      outsideClickHandler = (ev) => { if (!filterDropdown.contains(ev.target) && ev.target !== filterBtn) { closeFilterDropdown(); } };
      setTimeout(() => document.addEventListener('click', outsideClickHandler), 0);
    }

    filterBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (filterDropdown.classList.contains('show')) { closeFilterDropdown(); return; }
      openFilterDropdown();
    });

    const applyBtn = filterDropdown.querySelector('#applyFilter');
    const clearBtn = filterDropdown.querySelector('#clearFilter');
    if (applyBtn) applyBtn.addEventListener('click', () => {
      const status = (filterDropdown.querySelector('#filterStatus') || {}).value || 'all';
      const priority = (filterDropdown.querySelector('#filterPriority') || {}).value || 'all';
      const assignee = (filterDropdown.querySelector('#filterAssignee') || {}).value || '';
      const project = (filterDropdown.querySelector('#filterProject') || {}).value || '';
      _bugFilter.status = status;
      _bugFilter.priority = (priority && priority !== 'all') ? priority : null;
      _bugFilter.assignee = assignee || null;
      _bugFilter.project = project || null;
      // update quick button states
      if (status === 'open') { filterOpen.classList.add('filter-active'); filterAll.classList.remove('filter-active'); } else { filterAll.classList.add('filter-active'); filterOpen.classList.remove('filter-active'); }
      closeFilterDropdown();
      renderBugs();
    });
    if (clearBtn) clearBtn.addEventListener('click', () => {
      _bugFilter.status = 'all'; delete _bugFilter.priority; delete _bugFilter.assignee; delete _bugFilter.project;
      closeFilterDropdown();
      filterAll.classList.add('filter-active'); filterOpen.classList.remove('filter-active');
      renderBugs();
    });
  }

  // start / logout
  async function startApp() {
    try {
      authBox.classList.add('hidden');
      appUI.classList.remove('hidden');
      logoutBtn.classList.remove('hidden');
      userName.textContent = currentUser?.name || '';
      socket.emit('identify', { userId: currentUser?._id });
      await loadAll();
      // initialize analysis graph after initial data is loaded
      try { initAnalysisGraph(); } catch(e){ console.warn('initAnalysisGraph failed', e); }
    } catch (err) {
      console.error('startApp error', err);
      // optionally show a small non-blocking message to the user
    } finally {
      // Always hide loader even if loadAll() failed
      hideLoader();
    }
  }

  logoutBtn.addEventListener('click', () => { token = null; currentUser = null; localStorage.clear(); location.reload(); });

  async function loadAll() {
    await Promise.all([loadProjects(), loadUsers(), loadBugs(), loadReports(), loadNotifications(), loadSolutions()]);
  }

  async function loadProjects() {
    const list = await apiGET('/api/projects');
    projectsList.innerHTML = '';
    (list || []).forEach(p => {
      const li = document.createElement('li'); li.textContent = p.name; li.dataset.id = p._id; projectsList.appendChild(li);
    });
  }

  async function loadUsers() {
    const list = await apiGET('/api/users');
    usersList.innerHTML = '';
    (list || []).forEach(u => { const li = document.createElement('li'); li.textContent = u.name; usersList.appendChild(li); _usersMap[u._id] = u.name; });
  }

  function getUserName(id) {
    if (!id) return '(none)';
    return _usersMap[id] || id;
  }

  async function loadBugs() {
    const list = await apiGET('/api/bugs');
    _bugsCache = list || [];
    renderBugs();
  }

  // Filtering and search state
  const _bugFilter = { status: 'all', q: '' };

  function debounce(fn, wait = 250) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  function renderBugs() {
    const q = (_bugFilter.q || '').toLowerCase().trim();
    const status = _bugFilter.status;
    const list = (_bugsCache || []).filter(b => {
      if (status === 'open' && b.status !== 'open') return false;
      if (status === 'closed' && b.status !== 'closed') return false;
      if (_bugFilter.priority && _bugFilter.priority !== 'all' && b.priority !== _bugFilter.priority) return false;
      if (_bugFilter.assignee && _bugFilter.assignee !== '' && b.assignee_id !== _bugFilter.assignee) return false;
      if (_bugFilter.project && _bugFilter.project !== '' && b.project_id !== _bugFilter.project) return false;
      if (!q) return true;
      const hay = (b.title + ' ' + (b.description||'') + ' ' + (b._id||'')).toLowerCase();
      return hay.includes(q);
    });

    bugsTable.innerHTML = '';
    list.forEach(b => {
      const tr = document.createElement('tr');
      tr.dataset.id = b._id;
      tr.classList.add('priority-' + ((b.priority || 'medium').toString().toLowerCase()));
      tr.innerHTML = `
        <td>${b._id.slice(-5)}</td>
        <td>${escapeHtml(b.title)}${b.status==='closed' && b.resolution ? `<div class="muted">Resolved by ${escapeHtml(getUserName(b.resolved_by))} on ${b.resolved_at? new Date(b.resolved_at).toLocaleString(): ''}</div>` : ''}</td>
        <td>${b.status}</td>
        <td><span class="priority-badge priority-${(b.priority||'medium').toString().toLowerCase()}">${escapeHtml(b.priority)}</span></td>
        <td>
          <button class="btn tiny" data-id="${b._id}" data-action="view">View</button>
          <button class="btn tiny ghost" data-id="${b._id}" data-action="edit">Edit</button>
          <button class="btn tiny ghost" data-id="${b._id}" data-action="delete">Delete</button>
        </td>
      `;
      tr.querySelector('[data-action="view"]').addEventListener('click', () => viewBug(b._id));
      tr.querySelector('[data-action="edit"]').addEventListener('click', () => editBug(b._id));
      tr.querySelector('[data-action="delete"]').addEventListener('click', () => deleteBug(b._id));
      // highlight if status changed since last cached version
      try { const prev = (_bugsCache||[]).find(x => x._id === b._id); if (prev && prev.status !== b.status) { tr.classList.add('row-flash'); tr.addEventListener('animationend', () => tr.classList.remove('row-flash'), { once: true }); } } catch(e){}
      bugsTable.appendChild(tr);
    });
  }

  async function deleteBug(id) {
    if (!confirm('Delete bug?')) return;
    const res = await apiDELETE('/api/bugs/' + id);
    if (res && res.error) return alert(res.error || 'Delete failed');
    await loadBugs();
  }

  function escapeHtml(s){ return (s||'').replace(/[&<>\"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]); }

  async function loadReports() {
    const r = await apiGET('/api/reports/summary');
    reportBox.innerHTML = `<p><b>Total Bugs:</b> ${r.total || 0}</p><p><b>Open:</b> ${r.open || 0}</p><p><b>Closed:</b> ${r.closed || 0}</p>`;
    // Attempt to fetch report list (backend may not support full CRUD for reports)
    let list = [];
    try { list = await apiGET('/api/reports') || []; } catch (e) { list = []; }
    renderReports(list || []);
  }

  function renderReports(list) {
    if (!reportsList) return;
    reportsList.innerHTML = '';
    // defensive: ensure list is actually an array (backend may return an object/error)
    if (!Array.isArray(list)) list = [];
    if (list.length === 0) {
      reportsList.innerHTML = '<div class="muted">No saved reports. Create one to get started.</div>';
      return;
    }
    list.forEach((rep, idx) => {
      const row = document.createElement('div');
      row.className = 'report-item';
      row.dataset.id = rep._id || ('r-'+idx);
      row.innerHTML = `
        <div style="flex:1">
          <div style="font-weight:700">${escapeHtml(rep.title || ('Report ' + (idx+1)))}</div>
          <div class="meta">${escapeHtml((rep.summary || rep.description || '').slice(0,140))}</div>
        </div>
        <div class="report-actions">
          <button class="btn tiny" data-action="edit" data-id="${rep._id}">Edit</button>
          <button class="btn tiny ghost" data-action="delete" data-id="${rep._id}">Delete</button>
        </div>
      `;
      reportsList.appendChild(row);
      // animate in
      requestAnimationFrame(() => setTimeout(() => row.classList.add('anim-in'), 30 + idx*50));
      // wire actions
      const editBtn = row.querySelector('[data-action="edit"]');
      const delBtn = row.querySelector('[data-action="delete"]');
      if (editBtn) editBtn.onclick = () => editReport(rep);
      if (delBtn) delBtn.onclick = () => deleteReport(rep._id);
    });
  }

  // Create new report modal
  if (newReportBtn) newReportBtn.addEventListener('click', () => createReport());

  function createReport() {
    showModal(`<h3>Create Report</h3>
      <div class="form">
        <label for="repTitle">Title</label>
        <input id="repTitle" />
        <label for="repDesc">Summary / Description</label>
        <textarea id="repDesc" rows="4"></textarea>
        <div style="margin-top:12px"><button id="saveReport" class="btn primary">Save Report</button></div>
      </div>`);
    document.getElementById('saveReport').onclick = async () => {
      const title = document.getElementById('repTitle').value.trim();
      const description = document.getElementById('repDesc').value.trim();
      if (!title) return alert('Title required');
      // optimistic UI: hide modal and show loader
      hideModal(); showLoader();
      const res = await apiPOST('/api/reports', { title, description }).catch(e=>({ error: 'Request failed' }));
      hideLoader();
      if (res && res.error) return alert(res.error || 'Failed to save report');
      // visual feedback on success
      if (reportsList) {
        // reload reports
        await loadReports();
        // pulse reports card
        const repCard = reportsList.closest('.card'); if (repCard) { repCard.classList.add('pulse'); setTimeout(()=>repCard.classList.remove('pulse'), 900); }
      }
    };
  }

  async function editReport(rep) {
    if (!rep) return;
    showModal(`<h3>Edit Report</h3>
      <div class="form">
        <label for="repTitleEdit">Title</label>
        <input id="repTitleEdit" value="${escapeHtml(rep.title || '')}" />
        <label for="repDescEdit">Summary / Description</label>
        <textarea id="repDescEdit" rows="4">${escapeHtml(rep.description || '')}</textarea>
        <div style="margin-top:12px"><button id="updateReport" class="btn primary">Update</button></div>
      </div>`);
    document.getElementById('updateReport').onclick = async () => {
      const title = document.getElementById('repTitleEdit').value.trim();
      const description = document.getElementById('repDescEdit').value.trim();
      if (!title) return alert('Title required');
      hideModal(); showLoader();
      const res = await apiPUT('/api/reports/' + rep._id, { title, description }).catch(e=>({ error: 'Request failed' }));
      hideLoader();
      if (res && res.error) return alert(res.error || 'Failed to update report');
      await loadReports();
      const repCard = reportsList.closest('.card'); if (repCard) { repCard.classList.add('pulse'); setTimeout(()=>repCard.classList.remove('pulse'), 900); }
    };
  }

  async function deleteReport(id) {
    if (!confirm('Delete report?')) return;
    showLoader();
    const res = await apiDELETE('/api/reports/' + id).catch(e=>({ error: 'Request failed' }));
    hideLoader();
    if (res && res.error) return alert(res.error || 'Delete failed');
    await loadReports();
  }

  async function loadNotifications() {
    console.debug('loadNotifications: calling API');
    const notes = await apiGET('/api/notifications');
    console.debug('loadNotifications: api result', notes);
      // handle API errors (eg. missing token / server error)
      if (!notes || notes.error) {
        console.warn('loadNotifications: API error', notes && notes.error);
        // If dev mock is enabled, create a few sample notifications so UI can be tested
        if (DEV_MOCK_NOTIFS) {
          const mock = [
            { message: 'Welcome! This is a mock notification (dev only).', created_at: new Date().toLocaleString() },
            { message: 'Reminder: Your first bug has been assigned.', created_at: new Date().toLocaleString() },
          ];
          _lastNotifications = mock;
          if (notifBadge) {
            const countEl = notifBadge.querySelector('.count');
            if (countEl) countEl.textContent = mock.length;
            else notifBadge.textContent = mock.length;
            notifBadge.classList.remove('hidden');
            notifBadge.setAttribute('aria-hidden', 'false');
          }
          return updateNotificationPanel(mock);
        }

        _lastNotifications = [];
        // update badge to 0 but keep visible
        if (notifBadge) {
          const countEl = notifBadge.querySelector('.count');
          if (countEl) countEl.textContent = 0;
          else notifBadge.textContent = 0;
          notifBadge.classList.remove('hidden');
          notifBadge.setAttribute('aria-hidden', 'false');
        }
        // show error message in panel if it's open
        return notes && notes.error ? updateNotificationPanel([{ message: notes.error }]) : updateNotificationPanel([]);
      }

      const unread = (notes || []).filter(n => !n.read).length;
      // update badge count (supports new structure with .count)
      if (notifBadge) {
        const countEl = notifBadge.querySelector('.count');
        if (countEl) countEl.textContent = unread;
        else notifBadge.textContent = unread;
        // Always show the notification control in navbar; show 0 when none
        notifBadge.classList.remove('hidden');
        notifBadge.setAttribute('aria-hidden', 'false');
      }

      // store last notifications for panel rendering
      _lastNotifications = notes || [];
      // If no notifications and dev mock is enabled, provide sample items to test UI
      if ((_lastNotifications.length === 0 || !_lastNotifications) && DEV_MOCK_NOTIFS) {
        const mock = [{ message: 'No real notifications — showing mock (dev).', created_at: new Date().toLocaleString() }];
        _lastNotifications = mock;
        if (notifBadge) {
          const countEl = notifBadge.querySelector('.count');
          if (countEl) countEl.textContent = mock.length;
          else notifBadge.textContent = mock.length;
        }
      }
  }

  // socket events
  socket.on('notification', data => { console.log('socket notif', data); loadNotifications(); });
  // realtime analysis updates from server
  socket.on('analysis', data => {
    try { window.updateAnalysis && window.updateAnalysis(data); } catch(e) { console.error('analysis socket handler', e); }
  });

  // Initialize a simple client-side analysis widget using SVG + pills.
  function initAnalysisGraph() {
    const chart = document.getElementById('analysisChart');
    const totalEl = document.getElementById('statTotalSolved');
    const avgEl = document.getElementById('statAvgTime');
    const activeEl = document.getElementById('statActive');
    const solverList = document.getElementById('solverList');
    if (!chart) return;

    // internal buffers
    const windowSize = 24; // points
    const times = [];
    const values = []; // solved per interval
    let totalSolved = 0;

    function render() {
      // compute extents
      const w = chart.clientWidth || 600; const h = chart.clientHeight || 180;
      const maxV = Math.max(1, ...values);
      const points = (values || []).map((v, i) => {
        const x = (i / Math.max(1, windowSize-1)) * w;
        const y = h - (v / maxV) * (h - 12);
        return `${x},${y}`;
      }).join(' ');
      // clear
      chart.innerHTML = '';
      // grid lines
      for (let g=0; g<4; g++){
        const y = (h/4)*g;
        const line = document.createElementNS('http://www.w3.org/2000/svg','line');
        line.setAttribute('x1','0'); line.setAttribute('y1',y); line.setAttribute('x2',w); line.setAttribute('y2',y);
        line.setAttribute('stroke','rgba(255,255,255,0.03)'); line.setAttribute('stroke-width','1'); chart.appendChild(line);
      }
      // polyline of solved values
      const poly = document.createElementNS('http://www.w3.org/2000/svg','polyline');
      poly.setAttribute('points', points);
      poly.setAttribute('fill','none'); poly.setAttribute('stroke','url(#gradLine)'); poly.setAttribute('stroke-width','3'); poly.setAttribute('stroke-linejoin','round'); poly.setAttribute('stroke-linecap','round');
      // gradient defs
      const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
      defs.innerHTML = `
        <linearGradient id="gradLine" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stop-color="${getComputedStyle(document.documentElement).getPropertyValue('--av-primary') || '#06b6d4'}" />
          <stop offset="100%" stop-color="${getComputedStyle(document.documentElement).getPropertyValue('--av-accent') || '#3b82f6'}" />
        </linearGradient>
      `;
      chart.appendChild(defs);
      chart.appendChild(poly);

      // area fill (subtle)
      if (points) {
        const area = document.createElementNS('http://www.w3.org/2000/svg','polyline');
        const areaPoints = points.split(' ').map(p=>p).join(' ');
        area.setAttribute('points', areaPoints + ` ${w},${h} 0,${h}`);
        area.setAttribute('fill','rgba(59,130,246,0.06)'); area.setAttribute('stroke','none'); chart.insertBefore(area, poly);
      }

      // draw priority bars if present in lastData
      if (lastPriority) {
        const pad = 8;
        const bw = 36; // bar width
        const startX = 12;
        const maxCount = Math.max(1, lastPriority.high, lastPriority.medium, lastPriority.low);
        const pY = h - 6;
        // red (high)
        const hx = startX;
        const hy = h - Math.round((lastPriority.high / maxCount) * (h - 24)) - pad;
        const hr = document.createElementNS('http://www.w3.org/2000/svg','rect');
        hr.setAttribute('x', hx); hr.setAttribute('y', hy); hr.setAttribute('width', bw); hr.setAttribute('height', Math.max(6, pY - hy)); hr.setAttribute('fill', 'rgba(255,82,82,0.92)'); chart.appendChild(hr);
        // yellow (medium)
        const mx = startX + bw + 12;
        const my = h - Math.round((lastPriority.medium / maxCount) * (h - 24)) - pad;
        const mr = document.createElementNS('http://www.w3.org/2000/svg','rect');
        mr.setAttribute('x', mx); mr.setAttribute('y', my); mr.setAttribute('width', bw); mr.setAttribute('height', Math.max(6, pY - my)); mr.setAttribute('fill', 'rgba(245,158,11,0.95)'); chart.appendChild(mr);
        // blue (low)
        const lx = startX + (bw + 12) * 2;
        const ly = h - Math.round((lastPriority.low / maxCount) * (h - 24)) - pad;
        const lr = document.createElementNS('http://www.w3.org/2000/svg','rect');
        lr.setAttribute('x', lx); lr.setAttribute('y', ly); lr.setAttribute('width', bw); lr.setAttribute('height', Math.max(6, pY - ly)); lr.setAttribute('fill', 'rgba(59,130,246,0.95)'); chart.appendChild(lr);

        // labels
        const lab = document.createElementNS('http://www.w3.org/2000/svg','g');
        const labels = [ ['High', hx + bw/2, hy - 10], ['Med', mx + bw/2, my - 10], ['Low', lx + bw/2, ly - 10] ];
        labels.forEach(l => { const t = document.createElementNS('http://www.w3.org/2000/svg','text'); t.setAttribute('x', l[1]); t.setAttribute('y', l[2]); t.setAttribute('text-anchor','middle'); t.setAttribute('font-size','11'); t.setAttribute('fill','rgba(255,255,255,0.8)'); t.textContent = l[0]; lab.appendChild(t); });
        chart.appendChild(lab);

        // sinusoidal overlay based on normalized counts (visual flourish)
        const amp = 18;
        const freq = 0.25;
        const sinPath = [];
        for (let i=0;i<Math.min(values.length, windowSize);i++){ const x = (i / Math.max(1, windowSize-1)) * w; const norm = ((values[i]||0)/Math.max(1, maxV)); const y = h/2 + Math.sin(i*freq + (Date.now()%1000)/400)*amp*(0.2+norm*0.8); sinPath.push(`${x},${y}`); }
        const sine = document.createElementNS('http://www.w3.org/2000/svg','polyline'); sine.setAttribute('points', sinPath.join(' ')); sine.setAttribute('fill','none'); sine.setAttribute('stroke','rgba(255,255,255,0.12)'); sine.setAttribute('stroke-width','2'); chart.appendChild(sine);
      }

      // small dots
      (values||[]).forEach((v,i)=>{
        const x = (i / Math.max(1, windowSize-1)) * w;
        const y = h - (v / Math.max(1, maxV)) * (h - 12);
        const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
        c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', 3);
        c.setAttribute('fill','rgba(255,255,255,0.9)'); c.setAttribute('opacity', 0.9);
        chart.appendChild(c);
      });
    }

    // store last priority snapshot for rendering
    let lastPriority = null;
    // public updater
    window.updateAnalysis = function (data) {
      try {
        // expected shape: { solved: number, avgResolutionMs: number, topSolvers: [{name,count}], timestamp }
        const solved = Number(data && data.solved) || 0;
        const avgMs = Number(data && data.avgResolutionMs) || 0;
        const top = (data && data.topSolvers) || [];
        const priorityCounts = (data && data.priorityCounts) || null;
        // Prefer authoritative totals from the server when provided. The server
        // may send `totalResolvedBy` (per-user) or `totalResolved` (global).
        if (data && (typeof data.totalResolvedBy !== 'undefined' || typeof data.totalResolved !== 'undefined')) {
          const provided = (typeof data.totalResolvedBy !== 'undefined' && data.totalResolvedBy !== null) ? Number(data.totalResolvedBy) : Number(data.totalResolved);
          if (!isNaN(provided)) {
            totalSolved = provided;
          } else {
            totalSolved += solved;
          }
        } else {
          totalSolved += solved;
        }
        // push to buffer
        values.push(solved);
        times.push(data && data.timestamp ? data.timestamp : Date.now());
        if (values.length > windowSize) { values.shift(); times.shift(); }
        // update stats
        document.getElementById('statTotalSolved').textContent = totalSolved;
        document.getElementById('statAvgTime').textContent = avgMs ? Math.round(avgMs/1000)+'s' : '—';
        document.getElementById('statActive').textContent = top.length;
        if (priorityCounts) lastPriority = priorityCounts;
        // update solver pills
        if (solverList) {
          solverList.innerHTML = '';
          top.slice(0,6).forEach(s => {
            const el = document.createElement('div'); el.className='solver-pill'; el.innerHTML = `<span>${escapeHtml(s.name||'Unknown')}</span><span class="count">${s.count}</span>`; solverList.appendChild(el);
          });
        }
        render();
      } catch (e) { console.error('updateAnalysis err', e); }
    };

    // mock updates when server doesn't emit analytics. We keep the interval id so
    // we can clear it when a real backend summary is available.
    let mockInterval = null;
    if (DEV_MOCK_ANALYTICS) {
      mockInterval = setInterval(()=>{
        const mock = { solved: Math.floor(Math.random()*3), avgResolutionMs: 20000 + Math.floor(Math.random()*60000), topSolvers: [{name:'Alice',count:Math.floor(Math.random()*5)},{name:'Bob',count:Math.floor(Math.random()*4)},{name:'CI Bot',count:Math.floor(Math.random()*3)}], priorityCounts: { high: Math.floor(Math.random()*6), medium: Math.floor(Math.random()*8), low: Math.floor(Math.random()*10) }, timestamp: Date.now() };
        window.updateAnalysis(mock);
      }, 3000 + Math.floor(Math.random()*2000));
    }

    // Try to seed the chart with a real backend summary. If the backend
    // responds, disable the mock generator so the UI reflects real data.
    (async () => {
      try {
        const sum = await apiGET('/api/analytics/summary');
        if (sum && !sum.error) {
          DEV_MOCK_ANALYTICS = false;
          if (mockInterval) clearInterval(mockInterval);

          // If the server provides a history series, prefer it. Supported shapes:
          // - sum.history = [{ timestamp, value }] OR
          // - sum.history = [v1, v2, ...] (values only)
          if (Array.isArray(sum.history) && sum.history.length > 0) {
            // normalize into values & times
            values.length = 0; times.length = 0;
            if (typeof sum.history[0] === 'object') {
              sum.history.slice(-windowSize).forEach(pt => {
                values.push(Number(pt.value || pt.solved || 0));
                times.push(pt.timestamp ? Number(pt.timestamp) : Date.now());
              });
            } else {
              sum.history.slice(-windowSize).forEach((v, i) => {
                values.push(Number(v || 0));
                times.push(Date.now() - ((sum.history.length - 1 - i) * 3600000));
              });
            }

            // set a reasonable total from server-provided totals if available
            if (typeof sum.totalResolvedBy !== 'undefined') totalSolved = Number(sum.totalResolvedBy) || 0;
            else if (typeof sum.totalResolved !== 'undefined') totalSolved = Number(sum.totalResolved) || 0;
            else totalSolved = values.reduce((a,b)=>a+Number(b||0), 0);

            // update stats and solver list from summary
            if (totalEl) totalEl.textContent = totalSolved;
            if (avgEl) avgEl.textContent = sum.avgResolutionMs ? Math.round(sum.avgResolutionMs/1000) + 's' : '—';
            if (activeEl) activeEl.textContent = (sum.topSolvers || []).length;
            if (sum.priorityCounts) lastPriority = sum.priorityCounts;
            if (solverList) {
              solverList.innerHTML = '';
              (sum.topSolvers || []).slice(0,6).forEach(s => {
                const el = document.createElement('div'); el.className='solver-pill'; el.innerHTML = `<span>${escapeHtml(s.name||'Unknown')}</span><span class="count">${s.count}</span>`; solverList.appendChild(el);
              });
            }

            render();
            return;
          }

          // If no history supplied, attempt to build hourly buckets from bug resolved timestamps
          try {
            const bugs = await apiGET('/api/bugs');
            if (Array.isArray(bugs)) {
              const now = Date.now();
              const bucketMs = 3600000; // 1 hour
              values.length = 0; times.length = 0;
              for (let i = windowSize - 1; i >= 0; i--) {
                const start = now - (i + 1) * bucketMs;
                const end = now - i * bucketMs;
                const count = bugs.filter(b => b.status === 'closed' && b.resolved_at && (() => { const t = new Date(b.resolved_at).getTime(); return t >= start && t < end; })()).length;
                values.push(count);
                times.push(start + Math.floor(bucketMs / 2));
              }

              totalSolved = bugs.filter(b => b.status === 'closed').length;
              if (totalEl) totalEl.textContent = totalSolved;
              if (avgEl) avgEl.textContent = sum.avgResolutionMs ? Math.round(sum.avgResolutionMs/1000) + 's' : '—';
              if (activeEl) activeEl.textContent = (sum.topSolvers || []).length;
              if (sum.priorityCounts) lastPriority = sum.priorityCounts;
              if (solverList) {
                solverList.innerHTML = '';
                (sum.topSolvers || []).slice(0,6).forEach(s => {
                  const el = document.createElement('div'); el.className='solver-pill'; el.innerHTML = `<span>${escapeHtml(s.name||'Unknown')}</span><span class="count">${s.count}</span>`; solverList.appendChild(el);
                });
              }

              render();
              return;
            }
          } catch (e) {
            console.debug('failed building history from bugs', e);
          }

          // Fallback: call updateAnalysis once to seed minimal stats
          try { window.updateAnalysis(sum); } catch (e) { console.debug('updateAnalysis seed failed', e); }
        }
      } catch (e) {
        // ignore - keep mock running
        console.debug('analytics summary fetch failed', e);
      }
    })();
  }

  // view bug
  async function viewBug(id) {
    const b = _bugsCache.find(x => x._id === id) || (await apiGET('/api/bugs')).find(x => x._id === id);
    if (!b) return alert('Bug not found');

    // Navigate to Solutions section for focused solving
    window.openSolutions && window.openSolutions();

    // Show a solve modal allowing the user to enter a resolution and mark closed
    const existingResolution = b.resolution || '';
    const canSolve = b.status !== 'closed';
    // fetch resolution history
    const history = await apiGET(`/api/bugs/${id}/resolutions`);
    const historyHtml = (history || []).map(h => `<div class="resolution-entry"><div class="res-meta">${escapeHtml(getUserName(h.resolved_by))} — ${new Date(h.created_at).toLocaleString()}</div><div class="res-text">${escapeHtml(h.resolution)}</div></div>`).join('') || '<div class="muted">No history</div>';

    showModal(`<h3>${escapeHtml(b.title)}</h3>
      <p><b>Status:</b> ${b.status}</p>
      <p><b>Priority:</b> ${b.priority}</p>
      <p>${escapeHtml(b.description || '')}</p>
      <hr>
      <label for="resolutionText">Resolution / Fix Notes</label>
      <textarea id="resolutionText" rows="6" style="width:100%;">${escapeHtml(existingResolution)}</textarea>
      <div style="margin-top:12px">
        ${canSolve ? '<button id="applyResolution" class="btn primary">Mark Closed & Save</button>' : '<button class="btn" disabled>Already Closed</button>'}
      </div>
      <hr>
      <h4>Resolution History</h4>
      <div class="resolution-history">${historyHtml}</div>
      `);

    if (canSolve) {
      document.getElementById('applyResolution').onclick = async () => {
        if (!token || !currentUser) return alert('You must be logged in to mark a bug closed.');
        const resolution = document.getElementById('resolutionText').value.trim();
        const payload = { status: 'closed', resolution, resolved_by: currentUser._id, resolved_at: new Date().toISOString() };
        const res = await apiPUT('/api/bugs/' + id, payload);
        if (res && res.error) return alert(res.error || 'Failed to save resolution');
        hideModal();
        // remove card with animation then refresh lists
        await removeSolutionCard(id);
        await Promise.all([loadBugs(), loadReports(), loadSolutions(), loadNotifications()]);
        alert('Bug marked closed and resolution saved.');
      };
    }
  }

  // edit bug
  async function editBug(id) {
    const b = _bugsCache.find(x => x._id === id) || (await apiGET('/api/bugs')).find(x => x._id === id);
    if (!b) return alert('Bug not found');
    const users = await apiGET('/api/users');
    const userOptions = (users||[]).map(u=>`<option value="${u._id}" ${b.assignee_id===u._id? 'selected':''}>${u.name}</option>`).join('');
    showModal(`<h3>Edit Bug</h3>
      <form id="editBugForm" class="form">
        <label>Title</label>
        <input id="editTitle" value="${escapeHtml(b.title)}" />
        <label>Description</label>
        <textarea id="editDesc">${escapeHtml(b.description||'')}</textarea>
        <label>Priority</label>
        <select id="editPriority"><option ${b.priority==='low'?'selected':''}>low</option><option ${b.priority==='medium'?'selected':''}>medium</option><option ${b.priority==='high'?'selected':''}>high</option></select>
        <label>Assignee</label>
        <select id="editAssignee"><option value="">(none)</option>${userOptions}</select>
        <div style="margin-top:12px"><button type="button" id="saveEdit" class="btn">Save</button></div>
      </form>`);

    document.getElementById('saveEdit').onclick = async () => {
      const title = document.getElementById('editTitle').value.trim();
      const description = document.getElementById('editDesc').value.trim();
      const priority = document.getElementById('editPriority').value;
      const assignee_id = document.getElementById('editAssignee').value || null;
      const res = await apiPUT('/api/bugs/' + id, { title, description, priority, assignee_id });
      if (res && res.error) return alert(res.error || 'Update failed');
      hideModal(); loadBugs(); loadReports();
      loadSolutions();
    };
  }

  // ------------------ SOLUTIONS / ANTIVIRUS-LIKE HELPERS --------------------
  // Return a simple suggested fix text based on bug properties (heuristic/demo)
  function suggestFix(b) {
    if (!b) return 'No suggested fix available.';
    const t = (b.title || '').toLowerCase();
    if (t.includes('crash') || t.includes('exception')) return 'Check stack trace, look for null pointer usage and ensure input validation; re-run tests under same input.';
    if (t.includes('memory') || t.includes('leak')) return 'Investigate resource allocation, review recent changes to caching or long-lived objects.';
    if (t.includes('slow') || t.includes('performance')) return 'Profile the request, identify hotspots, and consider caching heavy computations.';
    if (b.priority === 'high') return 'High priority: reproduce, capture logs, and isolate the module before applying a hotfix.';
    return 'General steps: reproduce the issue, collect logs, write a targeted fix, create tests, and deploy to staging.';
  }

  // Simulated antivirus scan: shows progress and marks bug as closed on success.
  async function runAntivirus(bugId, btn) {
    if (!confirm('Run simulated antivirus scan for this bug? This will attempt to mark it resolved.')) return;
    const origText = btn.textContent;
    btn.disabled = true;
    // show a small progress modal with steps
    const steps = ['Scanning', 'Analyzing', 'Quarantining', 'Cleaning', 'Finalizing'];
    showModal(`<h3>Automated Scan</h3>
      <div style="font-size:13px;color:var(--muted);">Running simulated antivirus for the selected issue.</div>
      <div class="scan-steps">
        ${steps.map((s,i)=>`<div class="scan-step" data-step="${i}"><div class="dot"></div><div style="flex:1">${s}</div></div>`).join('')}
      </div>
      <div class="scan-progress"><i style="width:0%"></i></div>
    `);

    try {
      const modal = document.getElementById('modal');
      const progressBar = modal.querySelector('.scan-progress > i');
      const stepNodes = Array.from(modal.querySelectorAll('.scan-step'));
      let pct = 0;
      for (let i = 0; i < steps.length; i++) {
        // activate step
        stepNodes.forEach(n => n.classList.remove('active'));
        const cur = stepNodes[i]; if (cur) cur.classList.add('active');
        // animate progress target
        pct = Math.min(100, Math.round(((i+1) / steps.length) * 100));
        if (progressBar) { progressBar.style.width = pct + '%'; }
        // wait a bit; longer for critical steps
        await new Promise(r => setTimeout(r, 700 + (i * 200)));
      }

      // finalize: mark bug closed
      const res = await apiPUT('/api/bugs/' + bugId, { status: 'closed' });
      hideModal();
      if (res && res.error) {
        alert(res.error || 'Scan failed to apply resolution');
        btn.textContent = origText; btn.disabled = false;
        return;
      }

      // success animation on button
      btn.classList.add('success');
      btn.textContent = 'Cleaned ✓';
      setTimeout(() => { btn.classList.remove('success'); btn.textContent = origText; btn.disabled = false; }, 1400);

      // small confetti burst inside the solutions card for visual feedback
      const container = document.getElementById('solutionsList');
      if (container) {
        const burst = document.createElement('div'); burst.className = 'confetti';
        for (let k = 0; k < 10; k++) {
          const sp = document.createElement('span'); sp.style.left = (20 + Math.random()*60) + '%'; sp.style.top = (60 + Math.random()*20) + '%'; sp.style.background = ['#06b6d4','#3b82f6','#8b5cf6','#f59e0b'][k%4]; sp.style.transform = `translateY(0) rotate(${Math.random()*360}deg)`; sp.style.animation = `confettiBurst ${600 + Math.random()*800}ms cubic-bezier(.2,.8,.2,1) both ${Math.random()*100}ms`; burst.appendChild(sp);
        }
        container.appendChild(burst);
        setTimeout(()=>{ if (burst && burst.parentNode) burst.parentNode.removeChild(burst); }, 2200);
      }

      // animate removal and refresh
      await removeSolutionCard(bugId);
      await Promise.all([loadBugs(), loadReports(), loadSolutions(), loadNotifications()]);
      alert('Simulated scan completed: bug marked as closed.');
    } catch (err) {
      console.error('runAntivirus err', err);
      hideModal();
      alert('Scan failed: ' + (err && err.message || 'unknown'));
      btn.textContent = origText; btn.disabled = false;
    }
  }

  async function loadSolutions() {
    // show open bugs with actions
    const list = await apiGET('/api/bugs');
    const container = document.getElementById('solutionsList');
    if (!container) return;
    container.innerHTML = '';
    // Only include bugs that are not closed
    const items = (list || []).filter(b => b.status !== 'closed');
    if (items.length === 0) {
      container.innerHTML = '<div class="muted">No open bugs available for Solutions.</div>';
      return;
    }

    items.forEach((b, idx) => {
      const card = document.createElement('div');
      card.className = 'solution-card';
      card.dataset.bug = b._id;
      card.innerHTML = `
        <h4>${escapeHtml(b.title || '')} <small style="color:var(--muted);font-weight:600">(${b._id.slice(-5)})</small></h4>
        <p class="muted">Status: <b>${b.status}</b> · Priority: <b>${b.priority}</b>${b.status==='closed' && b.resolution? ' · <span style="font-weight:600">Resolved by '+escapeHtml(getUserName(b.resolved_by))+'</span>':''}</p>
        <p>${escapeHtml((b.description||'').slice(0,280))}</p>
        <div class="solution-actions">
          <button class="btn tiny" data-id="${b._id}" data-action="suggest">Suggest Fix</button>
          <button class="btn tiny primary" data-id="${b._id}" data-action="scan">Run Antivirus</button>
        </div>
      `;
      container.appendChild(card);
      // Entrance animation (staggered)
      requestAnimationFrame(() => {
        setTimeout(() => card.classList.add('anim-in'), 30 + (idx * 40));
      });
      // attach actions
      card.querySelector('[data-action="suggest"]').onclick = async () => {
        showModal(`<h3>Suggested Fix</h3><p>${escapeHtml(suggestFix(b))}</p><div style="margin-top:12px"><button class="btn" id="applySuggest">Apply Suggestion (mark closed)</button></div>`);
        document.getElementById('applySuggest').onclick = async () => {
            const res = await apiPUT('/api/bugs/' + b._id, { status: 'closed', resolution: suggestFix(b), resolved_by: currentUser?._id, resolved_at: new Date().toISOString() });
            if (res && res.error) return alert(res.error || 'Failed to apply suggestion');
            hideModal();
            // animate removal then refresh
            await removeSolutionCard(b._id);
            await Promise.all([loadBugs(), loadReports(), loadSolutions(), loadNotifications()]);
            alert('Suggestion applied: bug marked closed.');
        };
      };
      card.querySelector('[data-action="scan"]').onclick = function () { runAntivirus(b._id, this); };
    });
  }

  // Animate removal of a solution card; returns a promise resolved after animation
  function removeSolutionCard(bugId) {
    return new Promise((resolve) => {
      const container = document.getElementById('solutionsList');
      if (!container) return resolve();
      const card = container.querySelector(`[data-bug="${bugId}"]`);
      if (!card) return resolve();
      // play out animation then remove
      card.classList.remove('anim-in');
      card.classList.add('anim-out');
      // wait for transitionend; fallback timeout
      const cleanup = () => { if (card && card.parentNode) card.parentNode.removeChild(card); resolve(); };
      card.addEventListener('transitionend', function te(e) {
        if (e.propertyName === 'opacity') {
          card.removeEventListener('transitionend', te);
          cleanup();
        }
      });
      // safety fallback
      setTimeout(cleanup, 600);
    });
  }

  // Navigation helper for Solutions
  window.openSolutions = () => { appUI.scrollIntoView({behavior:'smooth'}); document.getElementById('solutionsSection').scrollIntoView({behavior:'smooth'}); };

  // wire refreshSolutions button if present
  const refreshSolutionsBtn = document.getElementById('refreshSolutions');
  if (refreshSolutionsBtn) refreshSolutionsBtn.onclick = () => loadSolutions();

  // auto-login
  if (token && currentUser) {
    // show loader while we initialize
    showLoader();
    // don't block the DOM; start app and ensure loader is hidden on error
    startApp();
  } else {
    // hide loader if not auto-logging in
    hideLoader();
  }

});
// global handlers to ensure loader is hidden on unexpected errors
window.addEventListener && window.addEventListener('unhandledrejection', (ev) => {
  console.error('Unhandled promise rejection', ev.reason || ev);
  try { hideLoader(); } catch(e){}
});
window.onerror = function (msg, url, lineNo, columnNo, error) {
  console.error('Global error', msg, url, lineNo, columnNo, error);
  try { hideLoader(); } catch(e){}
};
  // ------------------ DARK/LIGHT THEME --------------------
  const themeToggle = document.getElementById("themeToggle");

  if (!localStorage.getItem("theme")) {
    localStorage.setItem("theme", "dark"); // default neon theme
  }

  document.body.classList.toggle("light", localStorage.getItem("theme") === "light");

  if (themeToggle) {
    themeToggle.onclick = () => {
      const mode = document.body.classList.contains("light") ? "dark" : "light";
      document.body.classList.toggle("light");
      localStorage.setItem("theme", mode);
    };
  }

  // ------------------ SIDEBAR --------------------
  const sidebar = document.getElementById("sidebar");
  const sidebarBtn = document.getElementById("sidebarBtn");
  const closeSidebar = document.getElementById("closeSidebar");

  if (sidebarBtn && sidebar) sidebarBtn.onclick = () => sidebar.classList.add("show");
  if (closeSidebar && sidebar) closeSidebar.onclick = () => sidebar.classList.remove("show");

  // Also add delegated click handlers so controls work regardless of element insertion order
  document.addEventListener('click', (e) => {
    const clicked = e.target;

    // Sidebar open/close (floating sidebar button still supported if present)
    if (clicked.closest && clicked.closest('#sidebarBtn')) {
      if (sidebar) sidebar.classList.add('show');
    }
    if (clicked.closest && clicked.closest('#closeSidebar')) {
      if (sidebar) sidebar.classList.remove('show');
    }

    // Theme toggle
    if (clicked.closest && clicked.closest('#themeToggle')) {
      const themeToggleEl = document.getElementById('themeToggle');
      const isLight = document.body.classList.contains('light');
      document.body.classList.toggle('light');
      const mode = isLight ? 'dark' : 'light';
      localStorage.setItem('theme', mode);
      // small visual log to help debug
      console.debug('Theme toggled ->', mode);
    }
  });

  // Mobile nav toggle (hamburger)
  const navToggle = document.getElementById('navToggle');
  const mobileNav = document.getElementById('mobileNav');
  const mobileNavClose = document.getElementById('mobileNavClose');
  if (navToggle && mobileNav) {
    navToggle.addEventListener('click', (ev) => {
      const isOpen = mobileNav.classList.contains('show');
      if (isOpen) {
        mobileNav.classList.remove('show'); mobileNav.classList.add('hidden'); navToggle.setAttribute('aria-expanded','false'); mobileNav.setAttribute('aria-hidden','true');
      } else {
        mobileNav.classList.remove('hidden'); mobileNav.classList.add('show'); navToggle.setAttribute('aria-expanded','true'); mobileNav.setAttribute('aria-hidden','false');
      }
    });
    // close on escape
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { if (mobileNav && mobileNav.classList.contains('show')) { mobileNav.classList.remove('show'); mobileNav.classList.add('hidden'); navToggle.setAttribute('aria-expanded','false'); mobileNav.setAttribute('aria-hidden','true'); } } });
    // one-time outside click closing when menu open
    document.addEventListener('click', (ev) => {
      if (!mobileNav.classList.contains('show')) return;
      if (ev.target === navToggle || mobileNav.contains(ev.target)) return;
      mobileNav.classList.remove('show'); mobileNav.classList.add('hidden'); navToggle.setAttribute('aria-expanded','false'); mobileNav.setAttribute('aria-hidden','true');
    });
  }
  if (mobileNavClose && mobileNav) mobileNavClose.onclick = () => { mobileNav.classList.remove('show'); mobileNav.classList.add('hidden'); navToggle.setAttribute('aria-expanded','false'); mobileNav.setAttribute('aria-hidden','true'); };

  // ------------------ NOTIFICATION PANEL --------------------
  const notifPanel = document.getElementById("notifPanel");
  const closeNotif = document.getElementById("closeNotif");

  if (notifBadge && notifPanel) {
    // Toggle popup anchored to the badge and position it under the button
    notifBadge.onclick = async (e) => {
      console.debug('notifBadge clicked');
      const isOpen = notifPanel.classList.contains('show');
      if (isOpen) {
        notifPanel.classList.remove('show');
        notifPanel.setAttribute('aria-hidden', 'true');
        notifBadge.setAttribute('aria-expanded', 'false');
        return;
      }

      // Fetch notifications before showing. Show a quick loading state in the panel.
      const notifContentEl = document.getElementById('notifContent');
      if (notifContentEl) notifContentEl.innerHTML = '<div class="muted">Loading…</div>';
      try {
        await loadNotifications();
        updateNotificationPanel(_lastNotifications || []);
      } catch (err) {
        console.error('loadNotifications err', err);
        if (notifContentEl) notifContentEl.innerHTML = '<div class="muted">Failed to load notifications</div>';
        else updateNotificationPanel([]);
      }

      // Position the popup under the badge
      const rect = notifBadge.getBoundingClientRect();
      const panelWidth = Math.min(320, Math.max(260, window.innerWidth * 0.28));
      // align right edge of panel with badge right edge if possible
      let left = rect.right - panelWidth;
      if (left < 8) left = 8;
      const top = rect.bottom + 8 + window.scrollY;
      notifPanel.style.width = panelWidth + 'px';
      notifPanel.style.left = left + 'px';
      notifPanel.style.top = top + 'px';

      notifPanel.classList.add('show');
      notifPanel.setAttribute('aria-hidden', 'false');
      notifBadge.setAttribute('aria-expanded', 'true');

      // attach a one-time outside click to close popup
      const onDocClick = (ev) => {
        if (ev.target === notifBadge || notifPanel.contains(ev.target)) return;
        notifPanel.classList.remove('show');
        notifPanel.setAttribute('aria-hidden', 'true');
        notifBadge.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onDocClick);
      };
      // Use capture to ensure we observe clicks outside
      setTimeout(() => document.addEventListener('click', onDocClick), 0);
    };

    // keyboard: Enter / Space should toggle too
    notifBadge.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        notifBadge.click();
      }
    });
  }

  if (closeNotif && notifPanel) closeNotif.onclick = () => notifPanel.classList.remove("show");

  // when closing notif panel, update aria-expanded
  if (closeNotif && notifBadge) closeNotif.addEventListener('click', () => notifBadge.setAttribute('aria-expanded', 'false'));

  /* Push notifications to panel */
  let _lastNotifications = [];
  function updateNotificationPanel(list) {
    _lastNotifications = list || [];
    const notifContent = document.getElementById("notifContent");
    if (!notifContent) return;
    notifContent.innerHTML = "";

    const items = list || [];
    if (items.length === 0) {
      notifContent.innerHTML = `<div class="notif-item">No notifications</div>`;
      return;
    }

    items.forEach(n => {
      notifContent.innerHTML += `
        <div class="notif-item">
          ${escapeHtml(n.message)}
          <br><small>${n.created_at || ""}</small>
        </div>
      `;
    });
  }

  // Simple navigation placeholders to avoid undefined onclick errors
  window.openDashboard = () => { showModal('<h3>Dashboard</h3><p>Dashboard is under construction.</p>'); };
  window.openProjects = () => { appUI.scrollIntoView({behavior:'smooth'}); document.getElementById('projectsList').scrollIntoView({behavior:'smooth'}); };
  window.openBugs = () => { appUI.scrollIntoView({behavior:'smooth'}); document.getElementById('bugsTable').scrollIntoView({behavior:'smooth'}); };
  window.openReports = () => { appUI.scrollIntoView({behavior:'smooth'}); document.getElementById('reportBox').scrollIntoView({behavior:'smooth'}); };
