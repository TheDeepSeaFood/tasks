/** All spreadsheet access lives here. */

function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

/** Cached read for small, rarely-changing tables (Users/Hierarchy/Boards/Companies).
 *  Cuts repeated sheet I/O that made board loads slow. Invalidated on writes. */
function cachedObjects_(sheetName, ttl) {
  const cache = CacheService.getScriptCache();
  const key = 'tbl_' + sheetName;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const data = readObjects_(sheetName);
  try { cache.put(key, JSON.stringify(data), ttl || 90); } catch (e) { /* >100KB: skip cache */ }
  return data;
}
function clearTableCache_(sheetName) { CacheService.getScriptCache().remove('tbl_' + sheetName); }

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
  cachedObjects_('Users').forEach(function (u) {
    const email = String(u.email).toLowerCase();
    byId[email] = {
      email: email,
      name: u.name || email,
      designation: u.designation || '',
      active: !(u.active === false || u.active === 'FALSE'),
      superDev: toBool_(u.superDev),
      itManagerGroup: toBool_(u.itManagerGroup)
    };
  });
  return byId;
}

function getEdges() {
  return cachedObjects_('Hierarchy').map(function (e) {
    return {
      parentEmail: String(e.parentEmail).toLowerCase(),
      childEmail: String(e.childEmail).toLowerCase()
    };
  });
}

/** Distinct boards: [{department, taskType}] */
function getBoardList() {
  const seen = {}, out = [];
  cachedObjects_('Boards').forEach(function (r) {
    const key = r.department + '||' + r.taskType;
    if (!seen[key]) { seen[key] = true; out.push({ department: r.department, taskType: r.taskType }); }
  });
  return out;
}

/** Field definitions for one board, ordered. */
function getBoardConfig(taskType) {
  return cachedObjects_('Boards')
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

function getCompanies() {
  return cachedObjects_('Companies')
    .filter(function (c) { return !(c.active === false || c.active === 'FALSE'); })
    .map(function (c) { return String(c.name); });
}

/** All companies incl. inactive, for the admin manager. */
function getCompaniesAll() {
  return readObjects_('Companies').map(function (c) {
    return { name: String(c.name), active: !(c.active === false || c.active === 'FALSE') };
  });
}

function writeCompanies(list) {
  const sh = ss_().getSheetByName('Companies');
  sh.clearContents();
  sh.getRange(1, 1, 1, 2).setValues([['name', 'active']]);
  const rows = list
    .filter(function (c) { return c.name && String(c.name).trim() !== ''; })
    .map(function (c) { return [String(c.name).trim(), c.active !== false]; });
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
  clearTableCache_('Companies');
}

/** Append one audit-trail row. */
function appendHistory(taskType, taskId, actorEmail, action, field, oldVal, newVal) {
  ss_().getSheetByName('History').appendRow([
    Utilities.getUuid(), taskType, taskId, new Date(), actorEmail, action,
    field || '', oldVal == null ? '' : String(oldVal), newVal == null ? '' : String(newVal)
  ]);
}

/** History rows for one task, newest first. */
function getHistory(taskType, taskId) {
  return readObjects_('History')
    .filter(function (h) { return h.taskType === taskType && String(h.TaskID) === String(taskId); })
    .sort(function (a, b) { return new Date(b.Timestamp) - new Date(a.Timestamp); });
}

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
  const headers = ['email', 'name', 'designation', 'active', 'superDev', 'itManagerGroup'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  const rows = users
    .filter(function (u) { return u.email && String(u.email).trim() !== ''; })
    .map(function (u) {
      return [String(u.email).toLowerCase(), u.name || '', u.designation || '', u.active !== false, !!u.superDev, !!u.itManagerGroup];
    });
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  clearTableCache_('Users');
}

function writeEdges(edges) {
  const sh = ss_().getSheetByName('Hierarchy');
  sh.clearContents();
  sh.getRange(1, 1, 1, 2).setValues([['parentEmail', 'childEmail']]);
  const rows = edges.map(function (e) {
    return [String(e.parentEmail).toLowerCase(), String(e.childEmail).toLowerCase()];
  });
  if (rows.length) sh.getRange(2, 1, rows.length, 2).setValues(rows);
  clearTableCache_('Hierarchy');
}
