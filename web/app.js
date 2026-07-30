/* Task Manager PWA — SPA controller. Vanilla JS, hash-routed. */

const State = {
  me: null,          // { email, name, isAdmin, subtree: [] }
  boards: [],        // [{ department, taskType }]
  users: [],         // visible users for pickers [{email,name}]
  companies: [],     // sub-company names
  companyFilter: '', // '' = all
  activeCompany: null, // company drilled into within a board (null = show company grid)
  statusFilter: '',  // '' = all
  personFilter: '',  // '' = all (email)
  search: '',        // text search
  view: null,        // 'list' | 'board' (null = auto by screen)
  board: null,       // { taskType, fields: [...] }
  tasks: []
};

const $ = function (sel, root) { return (root || document).querySelector(sel); };
const el = function (tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
};
const fmtDate = function (v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toISOString().slice(0, 10);
};

/* ---- permission mirrors (server is authoritative; this is for UX) ---- */
function inSub(email) { return State.me.subtree.indexOf(String(email).toLowerCase()) >= 0; }
function canDefine(t) { return State.me.isAdmin || inSub(t.AssignerEmail); }
function canUpdate(t) { return State.me.isAdmin || inSub(t.AssigneeEmail) || inSub(t.AssignerEmail); }
function canDelete(t) {
  return State.me.isAdmin ||
    String(t.AssignerEmail || '').toLowerCase() === String(State.me.email || '').toLowerCase();
}

/* ---------------------------- boot ---------------------------- */
window.addEventListener('load', function () {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  initAuth(onSignedIn);
});

function cacheSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* quota/private */ } }
function cacheGet(key) { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch (e) { return null; } }

let _routeBound = false;
function applyBootstrap(b) {
  State.me = b.me;
  State.boards = b.boards;
  $('#user-chip').textContent = State.me.name + (State.me.isAdmin ? ' • admin' : '');
}
function showAppShell() {
  $('#signin-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  if (!_routeBound) { window.addEventListener('hashchange', routeChanged); _routeBound = true; }
}

async function onSignedIn() {
  // Instant boot from the last session, if we have it…
  const cached = cacheGet('bootstrap');
  if (cached) { applyBootstrap(cached); showAppShell(); routeChanged(); }

  // …then verify/refresh identity + boards in the background.
  try {
    const b = await apiCall('bootstrap');   // identity + boards in one round-trip
    cacheSet('bootstrap', b);
    applyBootstrap(b);
    if (!cached) { showAppShell(); routeChanged(); }
  } catch (e) {
    if (cached) return;   // token worked before; keep the cached app rather than bouncing out
    // A restored token was rejected (expired/invalid) — reset to a clean sign-in.
    clearAuth();
    $('#app-view').classList.add('hidden');
    $('#signin-view').classList.remove('hidden');
    google.accounts.id.prompt();
    toast('Please sign in again.');
  }
}

/* --------------------------- routing --------------------------- */
function routeChanged() {
  const h = location.hash.replace(/^#/, '');
  const parts = h.split('/');
  if (parts[0] !== 'hierarchy') window.__H = null; // drop unsaved hierarchy edits on leave
  if (parts[0] !== 'companies') window.__C = null; // drop unsaved company edits on leave
  if (parts[0] === 'board' && parts[1]) return renderBoard(decodeURIComponent(parts[1]), parts[2] != null ? decodeURIComponent(parts[2]) : null);
  if (parts[0] === 'hierarchy') return renderHierarchy();
  if (parts[0] === 'companies') return renderCompanies();
  return renderHome();
}

function nav(hash) { location.hash = hash; }

/* ---------------------------- home ---------------------------- */
function renderHome() {
  const main = $('#main'); main.innerHTML = '';
  $('#title').textContent = 'Boards';
  $('#back-btn').classList.add('hidden');

  const byDept = {};
  State.boards.forEach(function (b) { (byDept[b.department] = byDept[b.department] || []).push(b); });

  Object.keys(byDept).forEach(function (dept) {
    main.appendChild(el('h2', 'dept-head', esc(dept)));
    const grid = el('div', 'board-grid');
    byDept[dept].forEach(function (b) {
      const card = el('button', 'board-tile');
      card.innerHTML = '<span class="tile-type">' + esc(b.taskType) + '</span><span class="tile-go">Open →</span>';
      card.onclick = function () { nav('board/' + encodeURIComponent(b.taskType)); };
      grid.appendChild(card);
    });
    main.appendChild(grid);
  });

  if (State.me.isAdmin) {
    const admin = el('button', 'link-btn', '⚙ Manage user hierarchy');
    admin.onclick = function () { nav('hierarchy'); };
    main.appendChild(admin);
    const comp = el('button', 'link-btn', '🏢 Manage companies');
    comp.onclick = function () { nav('companies'); };
    main.appendChild(comp);
  }
}

/* --------------------------- board ---------------------------- */
function applyBoardData(taskType, data) {
  State.board = { taskType: taskType, fields: data.fields };
  State.tasks = data.tasks || [];
  State.users = data.users || [];
  State.companies = data.companies || [];
}
function saveBoardCache(taskType, data) {
  try { localStorage.setItem('board:' + taskType, JSON.stringify(data)); } catch (e) { /* quota/private */ }
}
function loadBoardCache(taskType) {
  try { const s = localStorage.getItem('board:' + taskType); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
/** Snapshot current board State into the cache (after local edits). */
function persistBoardCache() {
  if (!State.board) return;
  saveBoardCache(State.board.taskType, {
    fields: State.board.fields, tasks: State.tasks, users: State.users, companies: State.companies
  });
}

async function renderBoard(taskType, company) {
  State.activeCompany = company || null;
  State.companyFilter = company || '';
  State.statusFilter = ''; State.personFilter = ''; State.search = '';
  $('#title').textContent = company ? company : taskType;
  $('#back-btn').classList.remove('hidden');
  const main = $('#main');

  // Instant paint from the last-seen data, if we have it…
  const cached = loadBoardCache(taskType);
  if (cached) { applyBoardData(taskType, cached); drawView(); }
  else { main.innerHTML = '<p class="muted">Loading…</p>'; }

  // …then refresh from the network (foreground if no cache, background if cached).
  try {
    const data = await apiCall('boardData', { taskType: taskType });
    saveBoardCache(taskType, data);
    if (location.hash.indexOf(encodeURIComponent(taskType)) >= 0 || (State.board && State.board.taskType === taskType)) {
      applyBoardData(taskType, data);
      drawView();
    }
  } catch (e) {
    if (!cached) main.innerHTML = '<p class="error">' + esc(e.message) + '</p>';
    // If we had a cached view, keep showing it rather than replacing with an error.
  }
}

function statusField() {
  return State.board.fields.filter(function (f) { return f.isStatus; })[0];
}
function summaryFields() {
  // fields shown on the card front (skip the status + long text); de-dupe by
  // fieldKey so a duplicated board config can't push real fields off the card.
  const seen = {};
  return State.board.fields.filter(function (f) {
    if (f.isStatus || f.fieldType === 'longtext' || seen[f.fieldKey]) return false;
    seen[f.fieldKey] = true;
    return true;
  }).slice(0, 4);
}

function statusFieldKey() { const sf = statusField(); return sf ? sf.fieldKey : 'Status'; }

function statusColor(s) {
  switch (String(s)) {
    case 'Done': return 'var(--ok, #2a9d6b)';
    case 'In Progress': return 'var(--gold, #d99a2b)';
    case 'Delayed': return 'var(--danger, #d9534f)';
    case 'OnHold': return 'var(--danger, #d9534f)';
    case 'In Review': return 'var(--brand-2, #2b8a9d)';
    case 'Concept Progress': return 'var(--brand-3, #5aa9bd)';
    default: return 'var(--muted, #8aa)';
  }
}

/* ------------- view + filters ------------- */
function currentView() {
  if (State.view === 'list' || State.view === 'board') return State.view;
  const saved = cacheGet('view');
  State.view = (saved === 'list' || saved === 'board')
    ? saved
    : (window.matchMedia('(max-width: 760px)').matches ? 'list' : 'board');
  return State.view;
}
function setView(v) { State.view = v; cacheSet('view', v); drawKanban(); }

function filteredTasks() {
  const q = (State.search || '').toLowerCase();
  const pk = peopleKey();
  const sfk = statusFieldKey();
  return State.tasks.filter(function (t) {
    if (State.companyFilter && String(t.Company || '') !== State.companyFilter) return false;
    if (State.statusFilter && String(t[sfk] || '') !== State.statusFilter) return false;
    if (State.personFilter) {
      if (String(t[pk] || '').toLowerCase().indexOf(State.personFilter.toLowerCase()) < 0) return false;
    }
    if (q) {
      const hay = (String(t.Task || '') + ' ' + String(t.Requirement || '') + ' ' + String(t.Remarks || '')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  });
}

/* ------------- avatars ------------- */
const AV_COLORS = ['#0A6E7C', '#C8911A', '#2a9d6b', '#7c6bd6', '#d99a2b', '#d9534f', '#2b8a9d', '#5b6bd6'];
function avatarColor(name) {
  let h = 0; const s = String(name || '?');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AV_COLORS[h % AV_COLORS.length];
}
function initials(name) {
  const s = String(name || '?').replace(/[^A-Za-z0-9 ]/g, '').trim();
  return (s.slice(0, 2) || '?').toUpperCase();
}
function assigneeAvatars(t, max) {
  const pk = peopleKey();
  const toks = String(t[pk] || '').split('|').map(function (x) { return x.trim(); }).filter(Boolean);
  let html = toks.slice(0, max || 3).map(function (tok) {
    const nm = tok.indexOf('@') >= 0 ? userName(tok) : tok;
    return '<span class="av stack" title="' + esc(nm) + '" style="background:' + avatarColor(nm) + '">' + esc(initials(nm)) + '</span>';
  }).join('');
  if (toks.length > (max || 3)) html += '<span class="av stack more">+' + (toks.length - (max || 3)) + '</span>';
  return html;
}

/* ------------- controls + stats ------------- */
function buildControls() {
  const bar = el('div', 'controls');

  const search = el('input', 'ctl-search'); search.type = 'text';
  search.placeholder = 'Search tasks…'; search.value = State.search;
  search.oninput = function () { State.search = search.value; redrawBody(); };
  bar.appendChild(search);

  if (State.companies.length && !State.activeCompany) {
    const cs = el('select', 'ctl-sel');
    cs.appendChild(opt('', 'All companies', State.companyFilter));
    State.companies.forEach(function (c) { cs.appendChild(opt(c, c, State.companyFilter)); });
    cs.onchange = function () { State.companyFilter = cs.value; drawKanban(); };
    bar.appendChild(cs);
  }

  const sf = statusField();
  if (sf) {
    const ss = el('select', 'ctl-sel');
    ss.appendChild(opt('', 'All statuses', State.statusFilter));
    sf.options.forEach(function (o) { ss.appendChild(opt(o, o, State.statusFilter)); });
    ss.onchange = function () { State.statusFilter = ss.value; drawKanban(); };
    bar.appendChild(ss);
  }

  if (State.users.length) {
    const ps = el('select', 'ctl-sel');
    ps.appendChild(opt('', 'All people', State.personFilter));
    State.users.forEach(function (u) { ps.appendChild(opt(u.email, u.name, State.personFilter)); });
    ps.onchange = function () { State.personFilter = ps.value; drawKanban(); };
    bar.appendChild(ps);
  }

  const toggle = el('div', 'viewtoggle');
  const lb = el('button', 'vt' + (currentView() === 'list' ? ' active' : ''), 'List');
  const bb = el('button', 'vt' + (currentView() === 'board' ? ' active' : ''), 'Board');
  lb.onclick = function () { setView('list'); };
  bb.onclick = function () { setView('board'); };
  toggle.appendChild(lb); toggle.appendChild(bb);
  bar.appendChild(toggle);

  return bar;
}
function opt(value, label, current) {
  const o = el('option'); o.value = value; o.textContent = label;
  if (String(current) === String(value)) o.selected = true;
  return o;
}

function buildStats(tasks) {
  const sfk = statusFieldKey();
  const total = tasks.length;
  const done = tasks.filter(function (t) { return String(t[sfk]) === 'Done'; }).length;
  const prog = tasks.filter(function (t) { return String(t[sfk]) === 'In Progress'; }).length;
  const attn = tasks.filter(function (t) { return ['Delayed', 'OnHold'].indexOf(String(t[sfk])) >= 0; }).length;
  const avg = total ? Math.round(tasks.reduce(function (a, t) { return a + (parseInt(t.Progress, 10) || 0); }, 0) / total) : 0;
  const stats = el('div', 'stats');
  [['TOTAL', total], ['DONE', done], ['IN PROGRESS', prog], ['DELAYED / HOLD', attn], ['AVG PROGRESS', avg + '%']]
    .forEach(function (s) {
      stats.appendChild(el('div', 'stat', '<div class="stat-num">' + s[1] + '</div><div class="stat-label">' + s[0] + '</div>'));
    });
  return stats;
}

/* ------------- list rows ------------- */
function taskRow(t) {
  const sfk = statusFieldKey();
  const status = t[sfk] || '';
  const prog = parseInt(t.Progress, 10) || 0;
  const deadline = t.DeadlineDate ? fmtDate(t.DeadlineDate) : '';
  const row = el('div', 'trow');
  row.innerHTML =
    '<div class="trow-top">' +
      '<span class="trow-title">' + esc(t.Task || t.TaskID) + '</span>' +
      (t.Company ? '<span class="company-tag sm">' + esc(t.Company) + '</span>' : '') +
    '</div>' +
    '<div class="trow-meta">' +
      '<span class="avstack">' + assigneeAvatars(t, 3) + '</span>' +
      (status ? '<span class="pill status" style="background:' + statusColor(status) + '">' + esc(status) + '</span>' : '') +
      (t.SubStatus ? '<span class="badge sm">' + esc(t.SubStatus) + '</span>' : '') +
      (checklistSummary(t) ? '<span class="pill check">☑ ' + checklistSummary(t).done + '/' + checklistSummary(t).total + '</span>' : '') +
      (deadline ? '<span class="deadline">⏱ ' + esc(deadline) + '</span>' : '') +
      '<span class="pct">' + prog + '%</span>' +
    '</div>' +
    '<div class="trow-bar"><div class="trow-fill" style="width:' + prog + '%"></div></div>';
  row.onclick = function () { openEditor(t); };
  return row;
}

/* ------------- render dispatch ------------- */
function drawView() {
  if (State.activeCompany == null) drawCompanyGrid();
  else drawKanban();
}

function drawCompanyGrid() {
  const main = $('#main'); main.innerHTML = '';
  const counts = {};
  State.tasks.forEach(function (t) { const c = String(t.Company || ''); if (c) counts[c] = (counts[c] || 0) + 1; });

  const grid = el('div', 'board-grid');
  State.companies.forEach(function (c) {
    const n = counts[c] || 0;
    const card = el('button', 'board-tile');
    card.innerHTML = '<span class="tile-type">' + esc(c) + '</span>' +
      '<span class="tile-go">' + n + ' task' + (n === 1 ? '' : 's') + ' →</span>';
    card.onclick = function () { nav('board/' + encodeURIComponent(State.board.taskType) + '/' + encodeURIComponent(c)); };
    grid.appendChild(card);
  });
  if (State.me.isAdmin) {
    const add = el('button', 'board-tile tile-add', '<span class="tile-type">+ New company</span>');
    add.onclick = addCompanyPrompt;
    grid.appendChild(add);
  }
  main.appendChild(grid);
}

async function addCompanyPrompt() {
  const name = (window.prompt('New company name:') || '').trim();
  if (!name) return;
  try {
    const cur = (await apiCall('getCompaniesAdmin')).companies; // [{name, active}]
    if (cur.some(function (c) { return String(c.name).toLowerCase() === name.toLowerCase(); })) { toast('Company already exists'); return; }
    cur.push({ name: name, active: true });
    await apiCall('saveCompanies', { companies: cur });
    if (State.companies.indexOf(name) < 0) State.companies.push(name);
    persistBoardCache();
    toast('Company added');
    drawCompanyGrid();
  } catch (e) { toast(e.message); }
}

function drawKanban() {
  const main = $('#main'); main.innerHTML = '';

  const addBtn = el('button', 'fab', '+');
  addBtn.title = 'New task';
  addBtn.onclick = function () { openEditor(null); };
  main.appendChild(addBtn);

  main.appendChild(buildControls());
  const body = el('div', 'board-body'); body.id = 'board-body';
  main.appendChild(body);
  redrawBody();
}

/** Re-render only the stats + list/board (used by live search without losing focus). */
function redrawBody() {
  const body = $('#board-body'); if (!body) return drawKanban();
  body.innerHTML = '';
  const tasks = filteredTasks();
  body.appendChild(buildStats(tasks));
  if (currentView() === 'list') drawList(body, tasks);
  else drawBoard(body, tasks);
}

function drawList(container, tasks) {
  if (!tasks.length) { container.appendChild(el('div', 'empty', 'No tasks match these filters.')); return; }
  const list = el('div', 'tlist');
  tasks.forEach(function (t) { list.appendChild(taskRow(t)); });
  container.appendChild(list);
}

function drawBoard(container, tasks) {
  const sf = statusField();
  const lists = sf ? sf.options : ['All'];
  const board = el('div', 'kanban');
  lists.forEach(function (status) {
    const col = el('div', 'kcol');
    const rows = tasks.filter(function (t) { return sf ? String(t[sf.fieldKey] || '') === status : true; });
    col.appendChild(el('div', 'kcol-head', esc(status) + ' <span class="count">' + rows.length + '</span>'));
    const cbody = el('div', 'kcol-body');
    rows.forEach(function (t) { cbody.appendChild(taskCard(t)); });
    col.appendChild(cbody);
    board.appendChild(col);
  });
  container.appendChild(board);
}

function taskCard(t) {
  const card = el('div', 'card');
  const title = t.Task || t.Title || t.TaskID;
  const pk = peopleKey();
  let meta = '';
  summaryFields().forEach(function (f) {
    if (f.fieldKey === 'Task' || f.fieldKey === pk) return; // assignee shown as avatars below
    const v = t[f.fieldKey];
    if (v) meta += '<span class="pill">' + esc(f.fieldKey === 'DeadlineDate' ? '⏱ ' + fmtDate(v) : v) + '</span>';
  });
  const cs = checklistSummary(t);
  if (cs) meta = '<span class="pill check">☑ ' + cs.done + '/' + cs.total + '</span>' + meta;
  const sub = t.SubStatus ? '<span class="badge">' + esc(t.SubStatus) + '</span>' : '';
  const company = t.Company ? '<span class="company-tag">' + esc(t.Company) + '</span>' : '';
  const prio = (t.Priority || '').toLowerCase().replace(/\s+/g, '-');
  const prog = parseInt(t.Progress, 10) || 0;
  const avs = assigneeAvatars(t, 4);
  const bottom = (avs || prog)
    ? '<div class="card-bottom"><span class="avstack">' + avs + '</span>' +
      (prog ? '<span class="pct">' + prog + '%</span>' : '') + '</div>' +
      (prog ? '<div class="trow-bar"><div class="trow-fill" style="width:' + prog + '%"></div></div>' : '')
    : '';
  card.innerHTML =
    '<div class="card-top"><strong>' + esc(title) + '</strong></div>' +
    sub +
    company +
    (meta ? '<div class="card-meta">' + meta + '</div>' : '') +
    bottom;
  if (prio) card.classList.add('prio-' + prio);
  card.onclick = function () { openEditor(t); };
  return card;
}

/* ----------------------- task editor modal ----------------------- */
function openEditor(task) {
  const creating = !task;
  const fields = State.board.fields;
  const allowDefine = creating ? true : canDefine(task);
  const allowUpdate = creating ? true : canUpdate(task);

  const form = el('div', 'sheet');
  form.appendChild(el('div', 'sheet-grip'));
  form.appendChild(el('h3', null, creating ? 'New ' + State.board.taskType + ' task' : 'Edit task'));

  const editableFor = function (f) { return f.isUpdate ? allowUpdate : allowDefine; };
  const byKey = {}; fields.forEach(function (f) { byKey[f.fieldKey] = f; });
  const placed = {};

  function addField(body, key) {
    if (key === 'Company') {
      if (placed.Company) return;
      const c = renderCompanyEl(task, allowDefine);
      if (c) { body.appendChild(c); placed.Company = 1; }
      return;
    }
    const f = byKey[key];
    if (!f || placed[key]) return;
    placed[key] = 1;
    body.appendChild(renderFieldEl(f, task, editableFor(f)));
  }
  function buildSection(title, open, keys) {
    const body = el('div', 'ed-body');
    keys.forEach(function (k) { addField(body, k); });
    if (!body.children.length) return;
    const d = el('details', 'ed-section'); if (open) d.open = true;
    d.appendChild(el('summary', 'ed-sum', esc(title) + '<span class="ed-chev">▾</span>'));
    d.appendChild(body);
    form.appendChild(d);
  }

  buildSection('Overview', false, ['Task', 'Company', 'Requirement', 'AssignedTo']);
  buildSection('Status & Progress', false, ['Status', 'Progress', 'SubStatus', 'Remarks', 'DeadlineDate']);
  buildSection('Checklist', false, ['Checklist']);
  buildSection('Details', false, ['Category', 'Type', 'Priority', 'Weight', 'AssignedDate', 'LastUpdateDate']);
  const leftover = fields.filter(function (f) { return !placed[f.fieldKey]; }).map(function (f) { return f.fieldKey; });
  if (leftover.length) buildSection('More', false, leftover);

  form.appendChild(el('p', 'muted small', '• = definition field (set by whoever assigned the task)'));

  const actions = el('div', 'sheet-actions');
  const cancel = el('button', 'btn ghost', 'Cancel'); cancel.onclick = closeSheet;
  const save = el('button', 'btn primary', creating ? 'Create' : 'Save');
  save.onclick = function () { submitEditor(task, creating, save); };
  actions.appendChild(cancel); actions.appendChild(save);
  if (!creating && canDelete(task)) {
    const del = el('button', 'btn danger', 'Delete');
    del.onclick = function () { deleteTask(task, del); };
    actions.appendChild(del);
  }
  form.appendChild(actions);

  if (!creating) {
    const act = el('details', 'ed-section');
    act.appendChild(el('summary', 'ed-sum', 'Activity<span class="ed-chev">▾</span>'));
    const actBody = el('div', 'ed-body'); act.appendChild(actBody); form.appendChild(act);

    const upd = el('div', 'updates');
    upd.appendChild(el('h4', null, 'Daily Updates'));
    if (allowUpdate) {
      const row = el('div', 'upd-row');
      const inp = el('input'); inp.type = 'text'; inp.placeholder = "Add today's update…";
      const post = el('button', 'btn teal', 'Post'); post.type = 'button';
      const doPost = function () { postUpdate(task, inp, post, upd); };
      post.onclick = doPost;
      inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); doPost(); } };
      row.appendChild(inp); row.appendChild(post); upd.appendChild(row);
    }
    const uList = el('div', 'upd-list'); uList.appendChild(el('p', 'muted small', 'Loading…'));
    upd.appendChild(uList);
    actBody.appendChild(upd);

    const hist = el('div', 'history');
    hist.appendChild(el('h4', null, 'Change log'));
    hist.appendChild(el('p', 'muted small', 'Loading…'));
    actBody.appendChild(hist);

    loadActivity(task, uList, hist);
  }

  showSheet(form);
}

/** Company select (global definition field), or null if no companies. */
function renderCompanyEl(task, allowDefine) {
  if (!State.companies.length) return null;
  const cwrap = el('label', 'fld');
  cwrap.appendChild(el('span', 'fld-label', 'Company •'));
  const csel = el('select');
  const blank = el('option'); blank.value = ''; blank.textContent = '—'; csel.appendChild(blank);
  const cur = task ? (task.Company || '') : (State.activeCompany || '');
  State.companies.forEach(function (c) {
    const o = el('option'); o.value = c; o.textContent = c;
    if (String(cur) === c) o.selected = true; csel.appendChild(o);
  });
  csel.dataset.key = 'Company'; csel.dataset.update = '0';
  if (!allowDefine) csel.setAttribute('disabled', 'disabled');
  cwrap.appendChild(csel);
  return cwrap;
}

/** One board field as an editable form control element. */
function renderFieldEl(f, task, editable) {
  if (f.fieldType === 'people') return buildPeopleField(f, task, editable);
  if (f.fieldType === 'checklist') return buildChecklistField(f, task, editable);

  const wrap = el('label', 'fld');
  const lblSpan = el('span', 'fld-label', esc(f.label) + (f.isUpdate ? '' : ' •'));
  wrap.appendChild(lblSpan);
  const val = task ? (task[f.fieldKey] != null ? task[f.fieldKey] : '') : '';
  let input;
  if (f.fieldType === 'select') {
    input = el('select');
    const blank = el('option'); blank.value = ''; blank.textContent = '—'; input.appendChild(blank);
    f.options.forEach(function (opt) {
      const o = el('option'); o.value = opt; o.textContent = opt;
      if (String(val) === opt) o.selected = true; input.appendChild(o);
    });
  } else if (f.fieldType === 'longtext') {
    input = el('textarea'); input.value = val;
  } else if (f.fieldType === 'date') {
    input = el('input'); input.type = 'date'; input.value = fmtDate(val);
  } else if (f.fieldType === 'number') {
    input = el('input'); input.type = 'number'; input.value = val;
  } else if (f.fieldType === 'range') {
    const start = parseInt(val, 10) || 0;
    const pct = el('span', 'range-val', start + '%'); lblSpan.appendChild(pct);
    const track = el('div', 'progress-track', '<div class="progress-fill" style="width:' + start + '%"></div>');
    wrap.appendChild(track);
    input = el('input'); input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '5'; input.value = start;
    input.oninput = function () {
      pct.textContent = input.value + '%';
      track.firstChild.style.width = input.value + '%';
    };
  } else {
    input = el('input'); input.type = 'text'; input.value = val;
  }
  input.dataset.key = f.fieldKey;
  input.dataset.update = f.isUpdate ? '1' : '0';
  if (!editable) input.setAttribute('disabled', 'disabled');
  wrap.appendChild(input);
  return wrap;
}

function userName(email) {
  const u = State.users.filter(function (x) { return x.email === email; })[0];
  return u ? u.name : email;
}

/* ------------- checklist ------------- */
function parseChecklist(v) {
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function checklistSummary(t) {
  const items = parseChecklist(t.Checklist);
  if (!items.length) return null;
  return { done: items.filter(function (i) { return i.done; }).length, total: items.length };
}
function buildChecklistField(f, task, editable) {
  const wrap = el('label', 'fld');
  const lbl = el('span', 'fld-label', esc(f.label) + (f.isUpdate ? '' : ' •'));
  const count = el('span', 'range-val'); lbl.appendChild(count);
  wrap.appendChild(lbl);
  const bar = el('div', 'progress-track', '<div class="progress-fill"></div>'); wrap.appendChild(bar);

  let items = parseChecklist(task && task[f.fieldKey]);
  const hidden = el('input'); hidden.type = 'hidden';
  hidden.dataset.key = f.fieldKey; hidden.dataset.update = f.isUpdate ? '1' : '0';
  const list = el('div', 'check-list');

  function sync() { hidden.value = items.length ? JSON.stringify(items) : ''; }
  function render() {
    const done = items.filter(function (i) { return i.done; }).length;
    count.textContent = done + '/' + items.length;
    bar.firstChild.style.width = (items.length ? Math.round(done / items.length * 100) : 0) + '%';
    list.innerHTML = '';
    if (!items.length) { list.appendChild(el('p', 'muted small', 'No checklist items yet.')); return; }
    items.forEach(function (it, idx) {
      const row = el('div', 'check-item');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!it.done; cb.disabled = !editable;
      cb.onchange = function () { it.done = cb.checked; sync(); render(); };
      const txt = el('span', 'check-text' + (it.done ? ' done' : '')); txt.textContent = it.text;
      row.appendChild(cb); row.appendChild(txt);
      if (editable) {
        const x = el('button', 'upd-x', '×'); x.type = 'button';
        x.onclick = function () { items.splice(idx, 1); sync(); render(); };
        row.appendChild(x);
      }
      list.appendChild(row);
    });
  }
  wrap.appendChild(list);

  if (editable) {
    const addRow = el('div', 'upd-row');
    const inp = el('input'); inp.type = 'text'; inp.placeholder = 'Add an item…';
    const add = el('button', 'btn teal', 'Add'); add.type = 'button';
    const doAdd = function () { const v = inp.value.trim(); if (!v) return; items.push({ text: v, done: false }); inp.value = ''; sync(); render(); };
    add.onclick = doAdd;
    inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } };
    addRow.appendChild(inp); addRow.appendChild(add); wrap.appendChild(addRow);
  }
  wrap.appendChild(hidden);
  sync(); render();
  return wrap;
}

/** Chip multi-picker: internal users (stored as email) + external names (raw text). */
/** Distinct external partner names (tokens without '@') used in this people
 *  field across the currently loaded tasks — for the external autocomplete. */
function externalPartners(fieldKey) {
  const set = {};
  (State.tasks || []).forEach(function (t) {
    String(t[fieldKey] || '').split('|').forEach(function (tok) {
      tok = tok.trim();
      if (tok && tok.indexOf('@') < 0) set[tok] = true;
    });
  });
  return Object.keys(set).sort();
}

function buildPeopleField(f, task, editable) {
  const wrap = el('label', 'fld');
  wrap.appendChild(el('span', 'fld-label', esc(f.label) + (f.isUpdate ? '' : ' •')));

  let tokens = (task && task[f.fieldKey])
    ? String(task[f.fieldKey]).split('|').map(function (s) { return s.trim(); }).filter(Boolean)
    : [];

  const hidden = el('input'); hidden.type = 'hidden';
  hidden.dataset.key = f.fieldKey; hidden.dataset.update = f.isUpdate ? '1' : '0';
  hidden.disabled = !editable;

  const chips = el('div', 'chips');
  function sync() { hidden.value = tokens.join('|'); render(); }
  function render() {
    chips.innerHTML = '';
    if (!tokens.length) chips.appendChild(el('span', 'muted small', 'No one assigned yet'));
    tokens.forEach(function (tok, i) {
      const isInt = tok.indexOf('@') >= 0;
      const chip = el('span', 'chip-token ' + (isInt ? 'internal' : 'external'));
      chip.appendChild(document.createTextNode(isInt ? userName(tok) : tok));
      if (!isInt) chip.appendChild(el('span', 'chip-ext-tag', 'external'));
      if (editable) {
        const x = el('button', 'chip-x', '×'); x.type = 'button';
        x.onclick = function () { tokens.splice(i, 1); sync(); };
        chip.appendChild(x);
      }
      chips.appendChild(chip);
    });
  }
  wrap.appendChild(chips);

  if (editable) {
    const controls = el('div', 'people-controls');
    const sel = el('select', 'people-sel');
    const blank = el('option'); blank.value = ''; blank.textContent = '+ Add team member'; sel.appendChild(blank);
    State.users.forEach(function (u) {
      const o = el('option'); o.value = u.email;
      o.textContent = u.name + (u.email === State.me.email ? ' (me)' : '');
      sel.appendChild(o);
    });
    sel.onchange = function () {
      if (sel.value && tokens.indexOf(sel.value) < 0) { tokens.push(sel.value); sync(); }
      sel.value = '';
    };
    const ext = el('input', 'people-ext'); ext.type = 'text';
    ext.placeholder = '+ external partner (pick or type)…';
    // Autocomplete of external partners already used on other tasks — pick an
    // existing one or type a new name.
    const dl = el('datalist'); dl.id = 'ext-partners-' + f.fieldKey;
    externalPartners(f.fieldKey).forEach(function (name) {
      const o = el('option'); o.value = name; dl.appendChild(o);
    });
    ext.setAttribute('list', dl.id);
    function addExt() { const val = ext.value.trim(); if (val && tokens.indexOf(val) < 0) { tokens.push(val); sync(); } ext.value = ''; }
    ext.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); addExt(); } };
    const addBtn = el('button', 'btn ghost people-add', 'Add'); addBtn.type = 'button'; addBtn.onclick = addExt;
    controls.appendChild(sel); controls.appendChild(ext); controls.appendChild(addBtn); controls.appendChild(dl);
    wrap.appendChild(controls);
  }

  wrap.appendChild(hidden);
  hidden.value = tokens.join('|');
  render();
  return wrap;
}

async function loadActivity(task, uList, hist) {
  try {
    const res = await apiCall('getHistory', { taskType: State.board.taskType, taskId: task.TaskID });
    renderUpdates(task, uList, res.history.filter(function (h) { return h.Action === 'note'; }));
    renderChangeLog(hist, res.history.filter(function (h) { return h.Action !== 'note'; }));
  } catch (e) {
    uList.innerHTML = '<p class="error small">' + esc(e.message) + '</p>';
    hist.innerHTML = '<h4>Change log</h4>';
  }
}

function renderUpdates(task, uList, notes) {
  uList.innerHTML = '';
  if (!notes.length) { uList.appendChild(el('p', 'muted small', 'No updates yet.')); return; }
  notes.forEach(function (h) {
    const canDel = State.me.isAdmin || String(h.ActorEmail).toLowerCase() === String(State.me.email).toLowerCase();
    const item = el('div', 'upd');
    item.innerHTML = '<span class="d">' + esc(fmtDate(h.Timestamp)) + '</span>' +
      '<span class="t">' + esc(h.NewValue) + '</span>' +
      '<span class="who muted small">' + esc(userName(h.ActorEmail)) + '</span>';
    if (canDel) {
      const x = el('button', 'upd-x', '×'); x.type = 'button';
      x.onclick = function () { deleteUpdate(task, h, uList); };
      item.appendChild(x);
    }
    uList.appendChild(item);
  });
}

function renderChangeLog(container, hist) {
  container.innerHTML = '<h4>Change log</h4>';
  if (!hist.length) { container.appendChild(el('p', 'muted small', 'No changes logged yet.')); return; }
  const ul = el('ul', 'timeline');
  hist.forEach(function (h) {
    const when = fmtDateTime(h.Timestamp);
    let what;
    if (h.Action === 'create') what = '<em>created</em> ' + esc(h.NewValue);
    else if (h.Action === 'delete') what = '<em>deleted</em>';
    else what = '<strong>' + esc(h.Field) + '</strong>: ' + esc(h.OldValue || '∅') + ' → ' + esc(h.NewValue || '∅');
    const li = el('li');
    li.innerHTML = '<span class="tl-when">' + esc(when) + '</span>' +
      '<span class="tl-what">' + what + '</span>' +
      '<span class="tl-who muted small">' + esc(userName(h.ActorEmail)) + '</span>';
    ul.appendChild(li);
  });
  container.appendChild(ul);
}

async function postUpdate(task, inp, btn, updContainer) {
  const text = inp.value.trim(); if (!text) return;
  btn.disabled = true;
  try {
    await apiCall('postUpdate', { taskType: State.board.taskType, taskId: task.TaskID, text: text });
    inp.value = '';
    const res = await apiCall('getHistory', { taskType: State.board.taskType, taskId: task.TaskID });
    renderUpdates(task, updContainer.querySelector('.upd-list'), res.history.filter(function (h) { return h.Action === 'note'; }));
    toast('Update posted');
  } catch (e) { toast(e.message); }
  finally { btn.disabled = false; }
}

async function deleteUpdate(task, note, uList) {
  if (!confirm('Delete this update?')) return;
  try {
    await apiCall('deleteUpdate', { historyId: note.HistoryID });
    const res = await apiCall('getHistory', { taskType: State.board.taskType, taskId: task.TaskID });
    renderUpdates(task, uList, res.history.filter(function (h) { return h.Action === 'note'; }));
  } catch (e) { toast(e.message); }
}

function fmtDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toISOString().slice(0, 16).replace('T', ' ');
}

/** fieldKey of this board's people field, or null. */
function peopleKey() {
  const f = (State.board.fields || []).filter(function (x) { return x.fieldType === 'people'; })[0];
  return f ? f.fieldKey : null;
}
/** Internal-assignee emails (tokens with '@') from a people-field value, joined by '|'. */
function internalAssignees(obj) {
  const pk = peopleKey();
  if (!pk || obj[pk] == null) return '';
  return String(obj[pk]).split('|')
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(function (s) { return s.indexOf('@') >= 0; }).join('|');
}

async function deleteTask(task, btn) {
  if (!confirm('Delete this task? This cannot be undone.')) return;
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting…'; }
  try {
    await apiCall('deleteTask', { taskType: State.board.taskType, taskId: task.TaskID });
    State.tasks = State.tasks.filter(function (t) { return t.TaskID !== task.TaskID; });
    closeSheet(); persistBoardCache(); drawKanban();
  } catch (e) {
    toast(e.message);
    if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
  }
}

async function submitEditor(task, creating, btn) {
  if (btn && btn.disabled) return;              // guard against double-submit
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = 'Saving…'; }
  const inputs = $$('.sheet [data-key]');
  const values = {};
  inputs.forEach(function (i) { if (!i.disabled) values[i.dataset.key] = i.value; });
  try {
    if (creating) {
      const res = await apiCall('createTask', { taskType: State.board.taskType, fields: values });
      // Update the board locally instead of re-fetching everything.
      const t = Object.assign({}, values);
      t.TaskID = res.taskId;
      t.AssignerEmail = State.me.email;
      t.AssigneeEmail = internalAssignees(values);
      State.tasks.push(t);
    } else {
      // only send changed fields
      const changes = {};
      inputs.forEach(function (i) {
        if (i.disabled) return;
        const orig = task[i.dataset.key] != null ? String(task[i.dataset.key]) : '';
        if (i.type === 'date' ? fmtDate(orig) !== i.value : orig !== i.value) changes[i.dataset.key] = i.value;
      });
      if (Object.keys(changes).length === 0) { closeSheet(); return; }
      await apiCall('updateTask', { taskType: State.board.taskType, taskId: task.TaskID, changes: changes });
      Object.assign(task, changes);
      const pk = peopleKey();
      if (pk && changes[pk] != null) task.AssigneeEmail = internalAssignees(changes);
    }
    closeSheet();
    persistBoardCache();
    drawKanban();
  } catch (e) {
    toast(e.message);
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label || 'Save'; }
  }
}

function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

/* -------------------- hierarchy editor (admin) -------------------- */
async function renderHierarchy() {
  $('#title').textContent = 'User hierarchy';
  $('#back-btn').classList.remove('hidden');
  const main = $('#main'); main.innerHTML = '<p class="muted">Loading…</p>';
  let H;
  if (window.__H) {
    H = window.__H;               // reuse unsaved edits (e.g. after Add user)
  } else {
    try {
      const data = await apiCall('getHierarchy');
      H = { users: data.users, edges: data.edges };
    } catch (e) { main.innerHTML = '<p class="error">' + esc(e.message) + '</p>'; return; }
  }
  main.innerHTML = '';
  main.appendChild(el('p', 'muted', 'Set each person’s manager to shape who sees what. Top-level people (no manager) plus “see-all” see everything.'));

  const tree = el('div', 'tree');
  function parentOf(email) {
    const e = H.edges.filter(function (x) { return x.childEmail === email; })[0];
    return e ? e.parentEmail : '';
  }
  H.users.forEach(function (u) {
    const row = el('div', 'tree-row');

    const idcol = el('div', 'u-idcol');
    const nameIn = el('input', 'u-name'); nameIn.type = 'text'; nameIn.value = u.name || '';
    nameIn.placeholder = 'name'; nameIn.oninput = function () { u.name = nameIn.value; };
    const desigIn = el('input', 'u-desig'); desigIn.type = 'text'; desigIn.value = u.designation || '';
    desigIn.placeholder = 'designation'; desigIn.oninput = function () { u.designation = desigIn.value; };
    idcol.appendChild(nameIn);
    idcol.appendChild(desigIn);
    idcol.appendChild(el('span', 'muted small', esc(u.email)));
    row.appendChild(idcol);

    const sel = el('select', 'mgr-sel');
    const none = el('option'); none.value = ''; none.textContent = '— top level —'; sel.appendChild(none);
    H.users.forEach(function (o) {
      if (o.email === u.email) return;
      const opt = el('option'); opt.value = o.email; opt.textContent = 'reports to ' + o.name;
      if (parentOf(u.email) === o.email) opt.selected = true; sel.appendChild(opt);
    });
    sel.onchange = function () {
      H.edges = H.edges.filter(function (x) { return x.childEmail !== u.email; });
      if (sel.value) H.edges.push({ parentEmail: sel.value, childEmail: u.email });
    };
    row.appendChild(sel);

    const seeAll = el('label', 'chk');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!(u.itManagerGroup || u.superDev);
    cb.onchange = function () { u.itManagerGroup = cb.checked; };
    seeAll.appendChild(cb); seeAll.appendChild(document.createTextNode(' see all'));
    row.appendChild(seeAll);

    const del = el('button', 'icon-btn danger', '🗑');
    del.title = 'Remove user';
    del.onclick = function () {
      H.users = H.users.filter(function (x) { return x.email !== u.email; });
      H.edges = H.edges.filter(function (x) { return x.childEmail !== u.email && x.parentEmail !== u.email; });
      renderHierarchyFrom(H);
    };
    row.appendChild(del);

    tree.appendChild(row);
  });
  main.appendChild(tree);

  // add user
  const add = el('div', 'add-user');
  add.innerHTML =
    '<input id="nu_email" type="email" placeholder="new user email">' +
    '<input id="nu_name" type="text" placeholder="name">' +
    '<input id="nu_desig" type="text" placeholder="designation">';
  const addBtn = el('button', 'btn', 'Add user');
  addBtn.onclick = function () {
    const em = $('#nu_email').value.trim().toLowerCase(),
          nm = $('#nu_name').value.trim(),
          dg = $('#nu_desig').value.trim();
    if (!em) return;
    if (H.users.some(function (x) { return x.email === em; })) { toast('That email already exists'); return; }
    H.users.push({ email: em, name: nm || em, designation: dg, active: true, superDev: false, itManagerGroup: false });
    renderHierarchyFrom(H);
  };
  add.appendChild(addBtn); main.appendChild(add);

  const save = el('button', 'btn primary wide', 'Save hierarchy');
  save.onclick = async function () {
    try { await apiCall('saveHierarchy', { users: H.users, edges: H.edges }); window.__H = null; toast('Saved'); }
    catch (e) { toast(e.message); }
  };
  main.appendChild(save);

  // keep a redraw path when adding users
  window.__H = H;
}
function renderHierarchyFrom(H) { window.__H = H; renderHierarchy(); }

/* -------------------- companies editor (admin) -------------------- */
async function renderCompanies() {
  $('#title').textContent = 'Companies';
  $('#back-btn').classList.remove('hidden');
  const main = $('#main'); main.innerHTML = '<p class="muted">Loading…</p>';

  let C;
  if (window.__C) {
    C = window.__C;
  } else {
    try { C = (await apiCall('getCompaniesAdmin')).companies; }
    catch (e) { main.innerHTML = '<p class="error">' + esc(e.message) + '</p>'; return; }
  }
  window.__C = C;

  main.innerHTML = '';
  main.appendChild(el('p', 'muted', 'Sub-companies under the group. Inactive ones stay on old tickets but disappear from the picker.'));

  const list = el('div', 'tree');
  C.forEach(function (co, idx) {
    const row = el('div', 'tree-row');
    const nameIn = el('input', 'co-name'); nameIn.type = 'text'; nameIn.value = co.name;
    nameIn.oninput = function () { C[idx].name = nameIn.value; };
    row.appendChild(nameIn);

    const act = el('label', 'chk');
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = co.active !== false;
    cb.onchange = function () { C[idx].active = cb.checked; };
    act.appendChild(cb); act.appendChild(document.createTextNode(' active'));
    row.appendChild(act);

    const del = el('button', 'icon-btn danger', '🗑');
    del.onclick = function () { C.splice(idx, 1); renderCompanies(); };
    row.appendChild(del);

    list.appendChild(row);
  });
  main.appendChild(list);

  const add = el('button', 'btn', '+ Add company');
  add.onclick = function () { C.push({ name: '', active: true }); renderCompanies(); };
  main.appendChild(add);

  const save = el('button', 'btn primary wide', 'Save companies');
  save.onclick = async function () {
    try { await apiCall('saveCompanies', { companies: C }); window.__C = null; toast('Saved'); nav(''); }
    catch (e) { toast(e.message); }
  };
  main.appendChild(save);
}

/* --------------------------- chrome --------------------------- */
function showSheet(node) {
  const back = $('#sheet-backdrop');
  back.innerHTML = ''; back.appendChild(node);
  back.classList.remove('hidden');
  back.onclick = function (e) { if (e.target === back) closeSheet(); };
}
function closeSheet() { $('#sheet-backdrop').classList.add('hidden'); }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  setTimeout(function () { t.classList.remove('show'); }, 3200);
}

function applyTheme(mode) {
  if (mode === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  const btn = $('#theme-btn');
  if (btn) btn.textContent = mode === 'dark' ? '☀' : '☾';
}

// pointer-following spotlight on interactive surfaces
document.addEventListener('pointermove', function (e) {
  const t = e.target.closest && e.target.closest('.board-tile, .card');
  if (!t) return;
  const r = t.getBoundingClientRect();
  t.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
  t.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
}, { passive: true });

document.addEventListener('DOMContentLoaded', function () {
  applyTheme(localStorage.getItem('theme') || 'light'); // default light
  $('#back-btn').onclick = function () { history.length > 1 ? history.back() : nav(''); };
  $('#signout-btn').onclick = signOut;
  $('#theme-btn').onclick = function () {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    applyTheme(next);
  };
});
