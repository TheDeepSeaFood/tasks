/**
 * One-time setup. Run these from the Apps Script editor in order:
 *   1) setup_createTabs
 *   2) setup_seedMarketingConfig
 *   3) (paste marketing rows into the Marketing tab starting at column E, row 2)
 *   4) setup_backfillMarketingSystemCols
 *   5) setup_seedAdminUser  (edit the email first)
 */

function setup_createTabs() {
  const ss = ss_();
  ensureSheet_(ss, 'Users',     ['email', 'name', 'active', 'superDev', 'itManagerGroup']);
  ensureSheet_(ss, 'Hierarchy', ['parentEmail', 'childEmail']);
  ensureSheet_(ss, 'Boards',    ['department', 'taskType', 'fieldKey', 'label', 'fieldType', 'options', 'isUpdate', 'isStatus', 'order']);
  ensureSheet_(ss, 'Marketing', ['TaskID', 'AssignerEmail', 'AssigneeEmail', 'CreatedAt',
    'Task', 'Status', 'Requirement', 'Category', 'Priority', 'AssignedTo',
    'AssignedDate', 'DeadlineDate', 'SubStatus', 'Remarks', 'LastUpdateDate']);
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sh;
}

function setup_seedMarketingConfig() {
  const rows = [
    // department, taskType, fieldKey, label, fieldType, options, isUpdate, isStatus, order
    ['Marketing', 'Marketing', 'Task',           'Task',            'text',     '', false, false, 1],
    ['Marketing', 'Marketing', 'Requirement',    'Requirement',     'longtext', '', false, false, 2],
    ['Marketing', 'Marketing', 'Category',       'Category',        'select',   'Offline|New Brand|Packaging-RTC', false, false, 3],
    ['Marketing', 'Marketing', 'Priority',       'Priority',        'select',   'Low|Medium|High', false, false, 4],
    ['Marketing', 'Marketing', 'AssignedTo',     'Assigned To',     'text',     '', false, false, 5],
    ['Marketing', 'Marketing', 'AssignedDate',   'Assigned Date',   'date',     '', false, false, 6],
    ['Marketing', 'Marketing', 'DeadlineDate',   'Deadline Date',   'date',     '', false, false, 7],
    ['Marketing', 'Marketing', 'Status',         'Status',          'select',   'Delayed|In Review|Concept Progress|In Progress|OnHold|Done', true, true, 8],
    ['Marketing', 'Marketing', 'SubStatus',      'Sub-status',      'select',   'In Progress|OnHold', true, false, 9],
    ['Marketing', 'Marketing', 'Remarks',        'Remarks',         'longtext', '', true, false, 10],
    ['Marketing', 'Marketing', 'LastUpdateDate', 'Last Update Date','date',     '', true, false, 11]
  ];
  const sh = ss_().getSheetByName('Boards');
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/** Fill TaskID + CreatedAt for any marketing rows pasted without them. */
function setup_backfillMarketingSystemCols() {
  const sh = ss_().getSheetByName('Marketing');
  const last = sh.getLastRow();
  if (last < 2) return;
  const n = last - 1;
  const idCol = sh.getRange(2, 1, n, 1).getValues();
  const now = new Date();
  const ids = [], created = [];
  for (var i = 0; i < n; i++) {
    ids.push([idCol[i][0] || Utilities.getUuid()]);
    created.push([now]);
  }
  sh.getRange(2, 1, n, 1).setValues(ids);
  sh.getRange(2, 4, n, 1).setValues(created);
}

/** Edit the email, then run once to create the first see-everything admin. */
function setup_seedAdminUser() {
  const ADMIN_EMAIL = 'REPLACE_WITH_YOUR_EMAIL'; // e.g. developer / IT manager
  const sh = ss_().getSheetByName('Users');
  sh.appendRow([ADMIN_EMAIL.toLowerCase(), 'Admin', true, true, true]);
}
