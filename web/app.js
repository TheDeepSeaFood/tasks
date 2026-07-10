/* Task Manager PWA — SPA controller. Vanilla JS, hash-routed. */

const State = {
  me: null,          // { email, name, isAdmin, subtree: [] }
  boards: [],        // [{ department, taskType }]
  users: [],         // visible users for pickers [{email,name}]
  companies: [],     // sub-company names
  companyFilter: '', // '' = all
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

/* ---------------------------- boot ---------------------------- */
window.addEventListener('load', function () {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  initAuth(onSignedIn);
});

async function onSignedIn() {
  try {
    const b = await apiCall('bootstrap');   // identity + boards in one round-trip
    State.me = b.me;
    State.boards = b.boards;
    $('#signin-view').classList.add('hidden');
    $('#app-view').classList.remove('hidden');
    $('#user-chip').textContent = State.me.name + (State.me.isAdmin ? ' • admin' : '');
    window.addEventListener('hashchange', routeChanged);
    routeChanged();
  } catch (e) { toast('Sign-in failed: ' + e.message); }
}

/* --------------------------- routing --------------------------- */
function routeChanged() {
  const h = location.hash.replace(/^#/, '');
  const parts = h.split('/');
  if (parts[0] !== 'hierarchy') window.__H = null; // drop unsaved hierarchy edits on leave
  if (parts[0] !== 'companies') window.__C = null; // drop unsaved company edits on leave
  if (parts[0] === 'board' && parts[1]) return renderBoard(decodeURIComponent(parts[1]));
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
async function renderBoard(taskType) {
  $('#title').textContent = taskType;
  $('#back-btn').classList.remove('hidden');
  const main = $('#main'); main.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const data = await apiCall('boardData', { taskType: taskType }); // config+tasks+users+companies, one round-trip
    State.board = { taskType: taskType, fields: data.fields };
    State.tasks = data.tasks;
    State.users = data.users || [];
    State.companies = data.companies || [];
    State.companyFilter = '';
    drawKanban();
  } catch (e) { main.innerHTML = '<p class="error">' + esc(e.message) + '</p>'; }
}

function statusField() {
  return State.board.fields.filter(function (f) { return f.isStatus; })[0];
}
function summaryFields() {
  // fields shown on the card front (skip the status + long text)
  return State.board.fields.filter(function (f) {
    return !f.isStatus && f.fieldType !== 'longtext';
  }).slice(0, 4);
}

function drawKanban() {
  const main = $('#main'); main.innerHTML = '';

  const addBtn = el('button', 'fab', '+');
  addBtn.title = 'New task';
  addBtn.onclick = function () { openEditor(null); };
  main.appendChild(addBtn);

  // company filter
  if (State.companies.length) {
    const bar = el('div', 'filter-bar');
    bar.appendChild(el('span', 'muted small', 'Company'));
    const sel = el('select', 'filter-sel');
    const all = el('option'); all.value = ''; all.textContent = 'All companies'; sel.appendChild(all);
    State.companies.forEach(function (c) {
      const o = el('option'); o.value = c; o.textContent = c;
      if (c === State.companyFilter) o.selected = true; sel.appendChild(o);
    });
    sel.onchange = function () { State.companyFilter = sel.value; drawKanban(); };
    bar.appendChild(sel);
    main.appendChild(bar);
  }

  const sf = statusField();
  const lists = sf ? sf.options : ['All'];
  const board = el('div', 'kanban');
  const visibleTasks = State.tasks.filter(function (t) {
    return !State.companyFilter || String(t.Company || '') === State.companyFilter;
  });

  lists.forEach(function (status) {
    const col = el('div', 'kcol');
    const rows = visibleTasks.filter(function (t) {
      return sf ? String(t[sf.fieldKey] || '') === status : true;
    });
    col.appendChild(el('div', 'kcol-head', esc(status) + ' <span class="count">' + rows.length + '</span>'));
    const body = el('div', 'kcol-body');
    rows.forEach(function (t) { body.appendChild(taskCard(t)); });
    col.appendChild(body);
    board.appendChild(col);
  });
  main.appendChild(board);
}

function taskCard(t) {
  const card = el('div', 'card');
  const title = t.Task || t.Title || t.TaskID;
  let meta = '';
  summaryFields().forEach(function (f) {
    if (f.fieldKey === 'Task') return;
    if (f.fieldType === 'people') {
      String(t[f.fieldKey] || '').split('|').filter(Boolean).forEach(function (tok) {
        const nm = tok.indexOf('@') >= 0 ? userName(tok) : tok;
        meta += '<span class="pill people-pill">' + esc(nm) + '</span>';
      });
      return;
    }
    const v = t[f.fieldKey];
    if (v) meta += '<span class="pill">' + esc(f.fieldKey === 'DeadlineDate' ? '⏱ ' + fmtDate(v) : v) + '</span>';
  });
  const sub = t.SubStatus ? '<span class="badge">' + esc(t.SubStatus) + '</span>' : '';
  const company = t.Company ? '<span class="company-tag">' + esc(t.Company) + '</span>' : '';
  const prio = (t.Priority || '').toLowerCase().replace(/\s+/g, '-');
  card.innerHTML =
    '<div class="card-top"><strong>' + esc(title) + '</strong>' + sub + '</div>' +
    company +
    '<div class="card-meta">' + meta + '</div>';
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

  // Company — global definition field on every board
  if (State.companies.length) {
    const cwrap = el('label', 'fld');
    cwrap.appendChild(el('span', 'fld-label', 'Company •'));
    const csel = el('select');
    const blank = el('option'); blank.value = ''; blank.textContent = '—'; csel.appendChild(blank);
    const cur = task ? (task.Company || '') : '';
    State.companies.forEach(function (c) {
      const o = el('option'); o.value = c; o.textContent = c;
      if (String(cur) === c) o.selected = true; csel.appendChild(o);
    });
    csel.dataset.key = 'Company';
    csel.dataset.update = '0';
    if (!allowDefine) csel.setAttribute('disabled', 'disabled');
    cwrap.appendChild(csel); form.appendChild(cwrap);
  }

  fields.forEach(function (f) {
    const editable = f.isUpdate ? allowUpdate : allowDefine;

    if (f.fieldType === 'people') {
      form.appendChild(buildPeopleField(f, task, editable));
      return;
    }

    const wrap = el('label', 'fld');
    wrap.appendChild(el('span', 'fld-label', esc(f.label) + (f.isUpdate ? '' : ' •')));
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
    } else {
      input = el('input'); input.type = 'text'; input.value = val;
    }
    input.dataset.key = f.fieldKey;
    input.dataset.update = f.isUpdate ? '1' : '0';
    if (!editable) input.setAttribute('disabled', 'disabled');
    wrap.appendChild(input); form.appendChild(wrap);
  });

  const legend = el('p', 'muted small', '• = definition field (set by whoever assigned the task)');
  form.appendChild(legend);

  const actions = el('div', 'sheet-actions');
  const cancel = el('button', 'btn ghost', 'Cancel'); cancel.onclick = closeSheet;
  const save = el('button', 'btn primary', creating ? 'Create' : 'Save');
  save.onclick = function () { submitEditor(task, creating); };
  actions.appendChild(cancel); actions.appendChild(save);
  form.appendChild(actions);

  if (!creating) {
    const hist = el('div', 'history');
    hist.appendChild(el('h4', null, 'History'));
    hist.appendChild(el('p', 'muted small', 'Loading…'));
    form.appendChild(hist);
    loadHistory(task, hist);
  }

  showSheet(form);
}

function userName(email) {
  const u = State.users.filter(function (x) { return x.email === email; })[0];
  return u ? u.name : email;
}

/** Chip multi-picker: internal users (stored as email) + external names (raw text). */
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
    ext.placeholder = '+ external (agency, name)…';
    function addExt() { const val = ext.value.trim(); if (val && tokens.indexOf(val) < 0) { tokens.push(val); sync(); } ext.value = ''; }
    ext.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); addExt(); } };
    const addBtn = el('button', 'btn ghost people-add', 'Add'); addBtn.type = 'button'; addBtn.onclick = addExt;
    controls.appendChild(sel); controls.appendChild(ext); controls.appendChild(addBtn);
    wrap.appendChild(controls);
  }

  wrap.appendChild(hidden);
  hidden.value = tokens.join('|');
  render();
  return wrap;
}

async function loadHistory(task, container) {
  try {
    const res = await apiCall('getHistory', { taskType: State.board.taskType, taskId: task.TaskID });
    container.innerHTML = '<h4>History</h4>';
    if (!res.history.length) { container.appendChild(el('p', 'muted small', 'No changes logged yet.')); return; }
    const ul = el('ul', 'timeline');
    res.history.forEach(function (h) {
      const who = h.ActorEmail;
      const when = fmtDateTime(h.Timestamp);
      let what;
      if (h.Action === 'create') what = '<em>created</em> ' + esc(h.NewValue);
      else what = '<strong>' + esc(h.Field) + '</strong>: ' + esc(h.OldValue || '∅') + ' → ' + esc(h.NewValue || '∅');
      const li = el('li');
      li.innerHTML = '<span class="tl-when">' + esc(when) + '</span>' +
        '<span class="tl-what">' + what + '</span>' +
        '<span class="tl-who muted small">' + esc(who) + '</span>';
      ul.appendChild(li);
    });
    container.appendChild(ul);
  } catch (e) { container.innerHTML = '<h4>History</h4><p class="error small">' + esc(e.message) + '</p>'; }
}

function fmtDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toISOString().slice(0, 16).replace('T', ' ');
}

async function submitEditor(task, creating) {
  const inputs = $$('.sheet [data-key]');
  const values = {};
  inputs.forEach(function (i) { if (!i.disabled) values[i.dataset.key] = i.value; });
  try {
    if (creating) {
      await apiCall('createTask', { taskType: State.board.taskType, fields: values });
    } else {
      // only send changed fields
      const changes = {};
      inputs.forEach(function (i) {
        if (i.disabled) return;
        const orig = task[i.dataset.key] != null ? String(task[i.dataset.key]) : '';
        const now = i.type === 'date' ? i.value : i.value;
        if (i.type === 'date' ? fmtDate(orig) !== now : orig !== now) changes[i.dataset.key] = i.value;
      });
      if (Object.keys(changes).length === 0) { closeSheet(); return; }
      await apiCall('updateTask', { taskType: State.board.taskType, taskId: task.TaskID, changes: changes });
    }
    closeSheet();
    renderBoard(State.board.taskType);
  } catch (e) { toast(e.message); }
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
