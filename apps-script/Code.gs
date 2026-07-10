function doGet(e)  { return handle(e); }
function doPost(e) { return handle(e); }

function handle(e) {
  let out;
  try {
    const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const req = JSON.parse(raw);
    const user = verifyIdToken(req.idToken);
    out = { ok: true, data: route(req.action, req.payload || {}, user) };
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
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
      const assignee = String(payload.assigneeEmail || user.email).toLowerCase();
      if (!v.isAdmin && !v.set[assignee]) throw new Error('You can only assign to yourself or your team');
      const lock = LockService.getScriptLock(); lock.waitLock(10000);
      try {
        const obj = Object.assign({}, payload.fields || {});
        obj.TaskID = Utilities.getUuid();
        obj.AssignerEmail = user.email;
        obj.AssigneeEmail = assignee;
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
      const assignee = String(task.AssigneeEmail).toLowerCase();
      const canDefine = v.isAdmin || !!v.set[assigner];
      const canUpdate = v.isAdmin || !!v.set[assignee] || !!v.set[assigner];
      if (!canDefine && !canUpdate) throw new Error('Not allowed to edit this task');

      const cfg = getBoardConfig(payload.taskType);
      const isUpdateField = { Company: false };  // Company is a global definition field
      cfg.forEach(function (f) { isUpdateField[f.fieldKey] = f.isUpdate; });

      const changes = payload.changes || {};
      Object.keys(changes).forEach(function (k) {
        const flag = isUpdateField[k];
        if (flag === undefined) throw new Error('Unknown field: ' + k);
        if (flag && !canUpdate) throw new Error('No permission for update field: ' + k);
        if (!flag && !canDefine) throw new Error('You cannot change a task assigned to you from above: ' + k);
      });

      const lock = LockService.getScriptLock(); lock.waitLock(10000);
      try {
        updateTaskFields(payload.taskType, payload.taskId, changes);
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
        return { email: em, name: u.name, active: u.active, superDev: u.superDev, itManagerGroup: u.itManagerGroup };
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
