/**
 * One-time setup. Run these from the Apps Script editor in order:
 *   1) setup_createTabs
 *   2) setup_seedCompanies
 *   3) setup_seedMarketingConfig
 *   4) (paste marketing rows into the Marketing tab starting at column E, row 2)
 *   5) setup_backfillMarketingSystemCols
 *   6) setup_seedAdminUser  (edit the email first)
 */

function setup_createTabs() {
  const ss = ss_();
  ensureSheet_(ss, 'Users',     ['email', 'name', 'designation', 'active', 'superDev', 'itManagerGroup']);
  ensureSheet_(ss, 'Hierarchy', ['parentEmail', 'childEmail']);
  ensureSheet_(ss, 'Companies', ['name', 'active']);
  ensureSheet_(ss, 'History',   ['HistoryID', 'taskType', 'TaskID', 'Timestamp', 'ActorEmail', 'Action', 'Field', 'OldValue', 'NewValue']);
  ensureSheet_(ss, 'Boards',    ['department', 'taskType', 'fieldKey', 'label', 'fieldType', 'options', 'isUpdate', 'isStatus', 'order']);
  // 'Company' is a global field on every board (kept last so pasted marketing rows still start at column E).
  ensureSheet_(ss, 'Marketing', ['TaskID', 'AssignerEmail', 'AssigneeEmail', 'CreatedAt',
    'Task', 'Status', 'Requirement', 'Category', 'Priority', 'AssignedTo',
    'AssignedDate', 'DeadlineDate', 'SubStatus', 'Remarks', 'LastUpdateDate', 'Company']);
}

/** Seed the sub-companies under the group. Add more rows in the Companies tab anytime. */
function setup_seedCompanies() {
  const rows = [
    ['The Deep Sea Food', true],
    ['Oceano', true],
    ['Gourmex', true],
    ['Royal Future', true]
  ];
  const sh = ss_().getSheetByName('Companies');
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
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
    ['Marketing', 'Marketing', 'AssignedTo',     'Assigned To',     'people',   '', false, false, 5],
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

/** Trim the empty padding rows/columns Google adds (default 1000x26) so every
 *  read scans only real data. Safe to run anytime; keeps a small buffer. */
function setup_trimBlanks() {
  const tabs = ['Users', 'Hierarchy', 'Companies', 'History', 'Boards', 'Marketing'];
  tabs.forEach(function (name) {
    const sh = ss_().getSheetByName(name);
    if (!sh) return;
    const lastRow = Math.max(sh.getLastRow(), 1);
    const lastCol = Math.max(sh.getLastColumn(), 1);
    const maxRows = sh.getMaxRows();
    const maxCols = sh.getMaxColumns();
    if (maxRows > lastRow + 1) sh.deleteRows(lastRow + 2, maxRows - (lastRow + 1));
    if (maxCols > lastCol) sh.deleteColumns(lastCol + 1, maxCols - lastCol);
  });
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
  sh.appendRow([ADMIN_EMAIL.toLowerCase(), 'Admin', 'Administrator', true, true, true]);
}

/**
 * Seeds the Deep Sea Food org: users + hierarchy. Run this INSTEAD of
 * setup_seedAdminUser (it overwrites the Users and Hierarchy tabs).
 *
 * !!! Set DOMAIN to your real Google Workspace domain and check every email
 *     matches the actual account — sign-in matches emails exactly.
 * seeAll: 'itmgr' = IT-manager group, 'dev' = super-developer, '' = normal.
 */
function setup_seedOrg() {
  const DOMAIN = 'thedeepseafood.com'; // <-- CHANGE to your real Workspace domain

  // [ emailLocalPart, name, designation, managerLocalPart, seeAll ]
  const people = [
    ['noufal',    'Noufal',    'IT Manager',                                                                              '',        'itmgr'],
    ['mujeeb',    'Mujeeb',    'IT Hardware/Software Procurement & Support',                                              'noufal',  ''],
    ['russel',    'Russel',    'Software Lead / Developer',                                                               'noufal',  'dev'],
    ['abhimanue', 'Abhimanue', 'Software Tickets Coordination, Mail Sender, Website Auditing, Small Development, Vendor Coordination', 'russel', ''],
    ['riyas',     'Riyas',     'IT Support, Hardware/Software Vendor Coordination, Integration, ERP/CRM & Software Support', 'russel', ''],
    ['shahid',    'Shahid',    'Marketing Manager',                                                                       'noufal',  ''],
    ['amar',      'Amar',      'Digital Marketing Coordinator',                                                           'shahid',  ''],
    ['amal',      'Amal',      'Creative Lead',                                                                           'amar',    ''],
    ['abdeb',     'Abdeb',     'SEO & Content Creation, Social Media Marketing',                                          'amar',    ''],
    ['navas',     'Navas',     'Designer',                                                                                'amal',    ''],
    ['vishnu',    'Vishnu',    'Designer',                                                                                'amal',    ''],
    ['sharich',   'Sharich',   'Video Editor',                                                                            'amal',    '']
  ];

  const email = function (local) { return local + '@' + DOMAIN; };

  const users = people.map(function (p) {
    return {
      email: email(p[0]), name: p[1], designation: p[2], active: true,
      superDev: p[4] === 'dev', itManagerGroup: p[4] === 'itmgr'
    };
  });
  const edges = people
    .filter(function (p) { return p[3]; })
    .map(function (p) { return { parentEmail: email(p[3]), childEmail: email(p[0]) }; });

  writeUsers(users);
  writeEdges(edges);
}
