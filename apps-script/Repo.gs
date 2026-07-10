/** All spreadsheet access lives here. */

function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

function readObjects_(sheetName) {
  const sh = ss_().getSheetByName(sheetName);
  if (!sh) throw new Error('Missing tab: ' + sheetName);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(function (r) { return r.join('') !== ''; })
    .map(function (row) {
      const o = {};
      headers.forEach(function (h, i) { o[h] = row[i]; });
      return o;
    });
}

function toBool_(v) { return v === true || v === 'TRUE' || v === 'true'; }

function getUsers() {
  const byId = {};
  readObjects_('Users').forEach(function (u) {
    const email = String(u.email).toLowerCase();
    byId[email] = {
      email: email,
      name: u.name || email,
      active: !(u.active === false || u.active === 'FALSE'),
      superDev: toBool_(u.superDev),
      itManagerGroup: toBool_(u.itManagerGroup)
    };
  });
  return byId;
}

function getEdges() {
  return readObjects_('Hierarchy').map(function (e) {
    return {
      parentEmail: String(e.parentEmail).toLowerCase(),
      childEmail: String(e.childEmail).toLowerCase()
    };
  });
}

/** Distinct boards: [{department, taskType}] */
function getBoardList() {
  const seen = {}, out = [];
  readObjects_('Boards').forEach(function (r) {
    const key = r.department + '||' + r.taskType;
    if (!seen[key]) { seen[key] = true; out.push({ department: r.department, taskType: r.taskType }); }
  });
  return out;
}

/** Field definitions for one board, ordered. */
function getBoardConfig(taskType) {
  return readObjects_('Boards')
    .filter(function (r) { return r.taskType === taskType; })
    .map(function (r) {
      return {
        fieldKey: r.fieldKey,
        label: r.label,
        fieldType: r.fieldType,
        options: r.options ? String(r.options).split('|') : [],
        isUpdate: toBool_(r.isUpdate),
        isStatus: toBool_(r.isStatus),
        order: Number(r.order) || 0
      };
    })
    .sort(function (a, b) { return a.order - b.order; });
}

function getBoardTasks(taskType) { return readObjects_(taskType); }

function getTaskById(taskType, taskId) {
  return getBoardTasks(taskType).filter(function (t) {
    return String(t.TaskID) === String(taskId);
  })[0];
}

function appendTask(taskType, obj) {
  const sh = ss_().getSheetByName(taskType);
  if (!sh) throw new Error('Missing board tab: ' + taskType);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = headers.map(function (h) { return obj.hasOwnProperty(h) ? obj[h] : ''; });
  sh.appendRow(row);
}

function findTaskRowIndex_(sh, headers, taskId) {
  const idCol = headers.indexOf('TaskID');
  const values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === String(taskId)) return i + 1;
  }
  return -1;
}

function updateTaskFields(taskType, taskId, changes) {
  const sh = ss_().getSheetByName(taskType);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const rowIdx = findTaskRowIndex_(sh, headers, taskId);
  if (rowIdx < 0) throw new Error('Task not found');
  Object.keys(changes).forEach(function (k) {
    const c = headers.indexOf(k);
    if (c >= 0) sh.getRange(rowIdx, c + 1).setValue(changes[k]);
  });
  const luc = headers.indexOf('LastUpdateDate');
  if (luc >= 0) sh.getRange(rowIdx, luc + 1).setValue(new Date());
}

function writeUsers(users) {
  const sh = ss_().getSheetByName('Users');
  sh.clearContents();
  const headers = ['email', 'name', 'active', 'superDev', 'itManagerGroup'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  const rows = users.map(function (u) {
    return [String(u.email).toLowerCase(), u.name || '', u.active !== false, !!u.superDev, !!u.itManagerGroup];
  });
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function writeEdges(edges) {
  const sh = ss_().getSheetByName('Hierarchy');
  sh.clearContents();
  sh.getRange(1, 1, 1, 2).setValues([['parentEmail', 'childEmail']]);
  const rows = edges.map(function (e) {
    return [String(e.parentEmail).toLowerCase(), String(e.childEmail).toLowerCase()];
  });
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
}
