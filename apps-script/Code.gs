function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  let out;
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const req = JSON.parse(raw);
    const identity = verifyIdToken(req.idToken);
    // Authorization = membership. Any domain is fine (incl. external users); you
    // must be a known, active user. Admins add people in the hierarchy editor.
    const record = getUsers()[identity.email];
    if (!record || record.active === false) {
      throw new Error('Not authorized — ask an admin to add your account (' + identity.email + ').');
    }
    const user = { email: identity.email, name: record.name || identity.name };
    out = { ok: true, data: route(req.action, req.payload || {}, user) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Internal assignee emails parsed from a people-field value (external names skipped). */
function parseAssignees_(peopleValue) {
  return String(peopleValue || '').split('|')
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(function (s) { return s.indexOf('@') >= 0; });
}

/** The fieldKey of the board's people (multi-assignee) field, or null. */
function peopleFieldKey_(cfg) {
  const f = cfg.filter(function (x) { return x.fieldType === 'people'; })[0];
  return f ? f.fieldKey : null;
}

/** Builds the viewer's visible-email set + admin flag once per request. */
function visibleContext_(user) {
  const users = getUsers();
  const edges = getEdges();
  const set = {};
  visibleEmails(user.email, edges, users).forEach(function (em) { set[em] = true; });
  const me = users[user.email] || {};
  return { set: set, users: users, isAdmin: !!(me.itManagerGroup || me.superDev) };
}

function route(action, payload, user) {
  switch (action) {

    case 'whoami': {
      const v = visibleContext_(user);
      return { email: user.email, name: user.name, isAdmin: v.isAdmin, subtree: Object.keys(v.set) };
    }

    case 'listBoards':
      return { boards: getBoardList() };

    // One-shot for sign-in: identity + boards together.
    case 'bootstrap': {
      const v = visibleContext_(user);
      return {
        me: { email: user.email, name: user.name, isAdmin: v.isAdmin, subtree: Object.keys(v.set) },
        boards: getBoardList()
      };
    }

    // One-shot for opening a board: config + visible tasks + pickers + companies.
    case 'boardData': {
      const v = visibleContext_(user);
      const tasks = getBoardTasks(payload.taskType).filter(function (t) {
        return canSeeTask({
          AssignerEmail: String(t.AssignerEmail).toLowerCase(),
          AssigneeEmail: String(t.AssigneeEmail).toLowerCase()
        }, v.set);
      });
      const users = Object.keys(v.set).map(function (em) {
        return { email: em, name: (v.users[em] && v.users[em].name) || em };
      });
      return {
        fields: getBoardConfig(payload.taskType),
        tasks: tasks,
        users: users,
        companies: getCompanies()
      };
    }

    case 'getBoardConfig':
      return { fields: getBoardConfig(payload.taskType) };

    case 'listCompanies':
      return { companies: getCompanies() };

    case 'getHistory':
      return { history: getHistory(payload.taskType, payload.taskId) };

    case 'getCompaniesAdmin': {
      const v = visibleContext_(user);
      if (!v.isAdmin) throw new Error('Admins only');
      return { companies: getCompaniesAll() };
    }

    case 'saveCompanies': {
      const v = visibleContext_(user);
      if (!v.isAdmin) throw new Error('Admins only');
      const lock = LockService.getScriptLock(); lock.waitLock(10000);
      try { writeCompanies(payload.companies || []); return { ok: true }; }
      finally { lock.releaseLock(); }
    }

    case 'listTasks': {
      const v = visibleContext_(user);
      const tasks = getBoardTasks(payload.taskType).filter(function (t) {
        return canSeeTask({
          AssignerEmail: String(t.AssignerEmail).toLowerCase(),
          AssigneeEmail: String(t.AssigneeEmail).toLowerCase()
        }, v.set);
      });
      return { tasks: tasks };
    }

    case 'listUsers': {
      const v = visibleContext_(user);
      const out = Object.keys(v.set).map(function (em) {
        return { email: em, name: (v.users[em] && v.users[em].name) || em };
      });
      return { users: out };
    }

    case 'createTask': {
      const v = visibleContext_(user);
      const cfg = getBoardConfig(payload.taskType);
      const pKey = peopleFieldKey_(cfg);
      let assignees = pKey ? parseAssignees_((payload.fields || {})[pKey]) : [user.email];
      if (!v.isAdmin) assignees.forEach(function (a) {
        if (!v.set[a]) throw new Error('You can only assign internal people in your team: ' + a);
      });
      const lock = LockService.getScriptLock(); lock.waitLock(10000);
      try {
        const obj = Object.assign({}, payload.fields || {});
        obj.TaskID = Utilities.getUuid();
        obj.AssignerEmail = user.email;
        obj.AssigneeEmail = assignees.join('|');
        obj.CreatedAt = new Date();
        appendTask(payload.taskType, obj);
        appendHistory(payload.taskType, obj.TaskID, user.email, 'create', '', '',
          (obj.Task || '') + (obj.Company ? ' [' + obj.Company + ']' : ''));
        return { taskId: obj.TaskID };
      } finally { lock.releaseLock(); }
    }

    case 'updateTask': {
      const v = visibleContext_(user);
      const task = getTaskById(payload.taskType, payload.taskId);
      if (!task) throw new Error('Task not found');
      const assigner = String(task.AssignerEmail).toLowerCase();
      const assignees = String(task.AssigneeEmail || '').toLowerCase().split('|');
      const anyAssigneeVisible = assignees.some(function (a) { return a && v.set[a]; });
      const canDefine = v.isAdmin || !!v.set[assigner];
      const canUpdate = v.isAdmin || anyAssigneeVisible || !!v.set[assigner];
      if (!canDefine && !canUpdate) throw new Error('Not allowed to edit this task');

      const cfg = getBoardConfig(payload.taskType);
      const pKey = peopleFieldKey_(cfg);
      const isUpdateField = { Company: false };  // Company is a global definition field
      cfg.forEach(function (f) { isUpdateField[f.fieldKey] = f.isUpdate; });

      const changes = payload.changes || {};
      Object.keys(changes).forEach(function (k) {
        const flag = isUpdateField[k];
        if (flag === undefined) throw new Error('Unknown field: ' + k);
        if (flag && !canUpdate) throw new Error('No permission for update field: ' + k);
        if (!flag && !canDefine) throw new Error('You cannot change a task assigned to you from above: ' + k);
      });

      // If the people field changed, recompute the internal-assignee column.
      let newAssigneeCol = null;
      if (pKey && changes.hasOwnProperty(pKey)) {
        const na = parseAssignees_(changes[pKey]);
        if (!v.isAdmin) na.forEach(function (a) {
          if (!v.set[a]) throw new Error('You can only assign internal people in your team: ' + a);
        });
        newAssigneeCol = na.join('|');
      }

      const lock = LockService.getScriptLock(); lock.waitLock(10000);
      try {
        updateTaskFields(payload.taskType, payload.taskId, changes);
        if (newAssigneeCol !== null) updateTaskFields(payload.taskType, payload.taskId, { AssigneeEmail: newAssigneeCol });
        Object.keys(changes).forEach(function (k) {
          appendHistory(payload.taskType, payload.taskId, user.email, 'update', k, task[k], changes[k]);
        });
        return { ok: true };
      } finally { lock.releaseLock(); }
    }

    case 'getHierarchy': {
      const v = visibleContext_(user);
      if (!v.isAdmin) throw new Error('Admins only');
      const users = Object.keys(v.users).map(function (em) {
        const u = v.users[em];
        return { email: em, name: u.name, designation: u.designation, active: u.active, superDev: u.superDev, itManagerGroup: u.itManagerGroup };
      });
      return { users: users, edges: getEdges() };
    }

    case 'saveHierarchy': {
      const v = visibleContext_(user);
      if (!v.isAdmin) throw new Error('Admins only');
      const lock = LockService.getScriptLock(); lock.waitLock(10000);
      try {
        writeUsers(payload.users || []);
        writeEdges(payload.edges || []);
        return { ok: true };
      } finally { lock.releaseLock(); }
    }

    default:
      throw new Error('Unknown action: ' + action);
  }
}
