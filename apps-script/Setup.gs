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
    ['Marketing', 'Marketing', 'Status',         'Status',          'select',   'New|Delayed|In Review|Concept Progress|In Progress|OnHold|Done', true, true, 8],
    ['Marketing', 'Marketing', 'SubStatus',      'Sub-status',      'select',   'In Progress|OnHold', true, false, 9],
    ['Marketing', 'Marketing', 'Remarks',        'Remarks',         'longtext', '', true, false, 10],
    ['Marketing', 'Marketing', 'LastUpdateDate', 'Last Update Date','date',     '', true, false, 11]
  ];
  const sh = ss_().getSheetByName('Boards');
  // Idempotent + self-healing: drop any existing Marketing config (old field
  // types, duplicates) before writing the canonical set.
  const vals = sh.getDataRange().getValues();
  const iType = vals[0].indexOf('taskType');
  for (var i = vals.length - 1; i >= 1; i--) {
    if (vals[i][iType] === 'Marketing') sh.deleteRow(i + 1);
  }
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  clearTableCache_('Boards');
}

/** Remove duplicate board-config rows, keeping the first of each
 *  department+taskType+fieldKey. Fixes doubled fields in the task editor caused
 *  by running setup_seedMarketingConfig more than once. Safe to run anytime. */
function setup_dedupeBoards() {
  const sh = ss_().getSheetByName('Boards');
  const vals = sh.getDataRange().getValues();
  if (vals.length < 2) return 0;
  const header = vals[0];
  const iDept = header.indexOf('department'), iType = header.indexOf('taskType'), iKey = header.indexOf('fieldKey');
  const seen = {}, keep = [];
  for (var i = 1; i < vals.length; i++) {
    const row = vals[i];
    if (row.join('') === '') continue;
    const k = row[iDept] + '||' + row[iType] + '||' + row[iKey];
    if (seen[k]) continue;
    seen[k] = true; keep.push(row);
  }
  sh.clearContents();
  sh.getRange(1, 1, 1, header.length).setValues([header]);
  if (keep.length) sh.getRange(2, 1, keep.length, header.length).setValues(keep);
  clearTableCache_('Boards');
  Logger.log('setup_dedupeBoards: kept ' + keep.length + ' config rows.');
  return keep.length;
}

/**
 * Keep-warm: pings this web app so the next real request doesn't cold-start.
 * Set up a time-based trigger to run this every 5 minutes:
 *   Apps Script editor → Triggers (clock icon) → Add Trigger →
 *   function: setup_keepWarm, event source: Time-driven, Minutes timer, Every 5 minutes.
 */
function setup_keepWarm() {
  try {
    const url = ScriptApp.getService().getUrl();
    if (!url) return;
    UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'text/plain',
      payload: '{"action":"ping"}', muteHttpExceptions: true
    });
  } catch (e) { /* best-effort */ }
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

/**
 * Seed the full marketing task list (from "digital marketing.xlsx" + the per-company
 * lists) authored by Amar (Digital Marketing Coordinator). Data is grouped by company.
 * For each task: kanban Status is normalised to the board's option set; the Excel's
 * detailed status (Oceano's 2nd status column) is kept in SubStatus; internal
 * assignees are stored as emails in AssignedTo (people field) with AssigneeEmail as
 * the internal subset used for permissions.
 *
 * Re-runnable: ensures the "New" column + any missing companies exist, then REPLACES
 * every row (and its history) for each company present below. Companies not listed
 * here are left untouched. Run once from the Apps Script editor.
 */
function setup_seedMarketingTasks() {
  var ASSIGNER = 'amar@thedeepseafood.com';
  setup_ensureStatusOption_('New'); // backlog column for not-started tasks

  var DATA = {
      "Oceano": [
        {
          "Task": "Vehicle Branding",
          "Status": "Delayed",
          "Requirement": "Hiace vehicle sticker has faded and they need a revised version that includes all the newly added SKUs.",
          "Category": "Offline",
          "Priority": "Medium",
          "AssignedTo": "Outsourcing",
          "AssigneeEmail": "",
          "AssignedDate": "2026-04-16",
          "DeadlineDate": "",
          "SubStatus": "OnHold",
          "Remarks": "Taken quotation from agencies & submitted, It's currently on hold. Upto next renewal time (2027 Jan)",
          "LastUpdateDate": "2026-07-04"
        },
        {
          "Task": "Second Branding Name",
          "Status": "In Review",
          "Requirement": "They required a 2nd brand name that will have 'N' numbers of product category",
          "Category": "New Brand",
          "Priority": "Medium",
          "AssignedTo": "Agency (Innox future)",
          "AssigneeEmail": "",
          "AssignedDate": "2026-05-13",
          "DeadlineDate": "",
          "SubStatus": "In Progress",
          "Remarks": "Initially we given 9 options derived by Abedhad, that was not ok\nfor oceano. We outsouced it. Parallelly i takenotes from agencies\nfor complete branding.",
          "LastUpdateDate": "2026-07-07"
        },
        {
          "Task": "Burger Sleeve",
          "Status": "Concept Progress",
          "Requirement": "Oceano require a burger sleeve design with the same shape and dimensions as the Cooked Shrimp 300g sleeve.",
          "Category": "Packaging\nRTC",
          "Priority": "Medium",
          "AssignedTo": "amal@thedeepseafood.com",
          "AssigneeEmail": "amal@thedeepseafood.com",
          "AssignedDate": "2026-06-06",
          "DeadlineDate": "2026-07-13",
          "SubStatus": "Oceano will update the\nPrint format & revert.",
          "Remarks": "Last option shared with oceano",
          "LastUpdateDate": "2026-07-07"
        },
        {
          "Task": "Hamour Sleeve",
          "Status": "OnHold",
          "Requirement": "Adaptation of Hamour Fillet -  product img to be changed rest all the contents remain same",
          "Category": "Packaging\nRTC",
          "Priority": "High",
          "AssignedTo": "navas@thedeepseafood.com",
          "AssigneeEmail": "navas@thedeepseafood.com",
          "AssignedDate": "2026-06-13",
          "DeadlineDate": "2026-07-13",
          "SubStatus": "Oceano will update the\nPrint format & revert.",
          "Remarks": "We shared the options as per the oceano requirement",
          "LastUpdateDate": "2026-07-02"
        },
        {
          "Task": "Bus Ads",
          "Status": "In Progress",
          "Requirement": "Marketing Team suggested the campaign to oceano.\n1 (One) Ajman to Dubai Bus and 5 Taxi's Branding slot for the month of September on the Ajman–Dubai route. \n Digital Screens  - 3 screens total - 2 screen @ lulu junction, 1 Screen at Univeristy street @ Ajman for one month (30 days).",
          "Category": "Offline",
          "Priority": "Medium",
          "AssignedTo": "Agency  (Bangalore team)|amal@thedeepseafood.com",
          "AssigneeEmail": "amal@thedeepseafood.com",
          "AssignedDate": "2026-05-19",
          "DeadlineDate": "2026-07-27",
          "SubStatus": "In Progress",
          "Remarks": "We outsourced initially with an agency called Elevage. That didn't work well. \nAfter we associate with a bangalore base agency, they submit options and oceano was ok to proceed this options.\nBut edits were there.Now the Bus Ad time extends, we are waiting for bangalore agency to share new option, \nThat will be submitted before July 15th.",
          "LastUpdateDate": "2026-07-03"
        },
        {
          "Task": "1+1 Smoked Salmon",
          "Status": "OnHold",
          "Requirement": "Oceano 1+1 Smoked Salmon is not attention-grabbing, due to which comparatively we have lesser sales. \nThe attention does not go to Oceano 1+1, so kindly, keeping the premium factor in mind, update/Redesign on how we can make the Oceano 1+1 Smoked Salmon more eye-catching.",
          "Category": "Print",
          "Priority": "Medium",
          "AssignedTo": "amal@thedeepseafood.com",
          "AssigneeEmail": "amal@thedeepseafood.com",
          "AssignedDate": "2026-06-17",
          "DeadlineDate": "",
          "SubStatus": "Waiting from Oceano end",
          "Remarks": "",
          "LastUpdateDate": ""
        },
        {
          "Task": "Website Content Validation",
          "Status": "In Review",
          "Requirement": "Oceano required to change the currect content to better fluentcy.",
          "Category": "Website",
          "Priority": "High",
          "AssignedTo": "abdeb@thedeepseafood.com|Agency in kochi",
          "AssigneeEmail": "abdeb@thedeepseafood.com",
          "AssignedDate": "",
          "DeadlineDate": "2026-07-07",
          "SubStatus": "Content Shared",
          "Remarks": "We have done multiple options taken through agency and internally. Last agency option\nis approved by Mr. Noufal. The revised option shared.",
          "LastUpdateDate": "2026-07-07"
        },
        {
          "Task": "Social Media (Posters)",
          "Status": "New",
          "Requirement": "",
          "Category": "Social Media",
          "Priority": "Daily Task",
          "AssignedTo": "",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        },
        {
          "Task": "Grandiose Smoked Salmon",
          "Status": "OnHold",
          "Requirement": "Oceano will be proceeding with the private labeling of Grandiose Smoked Salmon products. Accordingly, we require the back side content for the smoked salmon pouches",
          "Category": "Print",
          "Priority": "",
          "AssignedTo": "navas@thedeepseafood.com",
          "AssigneeEmail": "navas@thedeepseafood.com",
          "AssignedDate": "2026-06-27",
          "DeadlineDate": "2026-07-08",
          "SubStatus": "Waiting from Oceano end",
          "Remarks": "We have done the requirement. Edits given. Need to share ASAP",
          "LastUpdateDate": "2026-07-07"
        },
        {
          "Task": "Keeta Launch",
          "Status": "New",
          "Requirement": "They didn't mention any requirement, only update to us that,  \nwill be launching our online restaurant delivery service on the Keeta platform on Friday, 17th July.",
          "Category": "",
          "Priority": "Medium",
          "AssignedTo": "",
          "AssigneeEmail": "",
          "AssignedDate": "2026-07-01",
          "DeadlineDate": "2026-07-17",
          "SubStatus": "",
          "Remarks": "They give us the permission to do activities, but inform the before conducting anything.",
          "LastUpdateDate": "2026-07-07"
        },
        {
          "Task": "New Product Launch - Photos & Videos",
          "Status": "New",
          "Requirement": "Their  marination items and cleaned and cut items are all set and will be pushed to the market shortly\nThey required the same is reflected in social media as launching video like how they have been doing for our launching video for other products.",
          "Category": "Launch",
          "Priority": "High",
          "AssignedTo": "sharich@thedeepseafood.com",
          "AssigneeEmail": "sharich@thedeepseafood.com",
          "AssignedDate": "2026-06-26",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "This we need to take product shoot & website photos to proceed. Sharikh is helpless to \nedit with stock footages.",
          "LastUpdateDate": "2026-07-06"
        },
        {
          "Task": "Tobiko sticker",
          "Status": "OnHold",
          "Requirement": "They design is over, issue facing while printing. \nNeed to rework this.",
          "Category": "Packaging",
          "Priority": "Medium",
          "AssignedTo": "amal@thedeepseafood.com",
          "AssigneeEmail": "amal@thedeepseafood.com",
          "AssignedDate": "2026-01-01",
          "DeadlineDate": "",
          "SubStatus": "Hold",
          "Remarks": "Need to consult with agency.",
          "LastUpdateDate": ""
        },
        {
          "Task": "ONLINE Platforms - Careem, Noon & Amazon",
          "Status": "In Progress",
          "Requirement": "Currently we are not doing any promotions",
          "Category": "Digital",
          "Priority": "High",
          "AssignedTo": "abdeb@thedeepseafood.com",
          "AssigneeEmail": "abdeb@thedeepseafood.com",
          "AssignedDate": "2026-01-01",
          "DeadlineDate": "",
          "SubStatus": "In Progress",
          "Remarks": "Because off season, campaigns hold for amazon. Noon we are following up. Craeem need to take decision.",
          "LastUpdateDate": "2026-07-06"
        },
        {
          "Task": "Ai Images - for Kibsons",
          "Status": "New",
          "Requirement": "Remaining products",
          "Category": "Digital",
          "Priority": "High",
          "AssignedTo": "amal@thedeepseafood.com",
          "AssigneeEmail": "amal@thedeepseafood.com",
          "AssignedDate": "",
          "DeadlineDate": "2026-07-10",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        },
        {
          "Task": "1. OceanoXDeep - PPT\n2. Oceano PPT\nImage changes",
          "Status": "New",
          "Requirement": "All products (other than sushi range)- img to be changed\nMarination items corrections which is marked in the group \nto be corrected",
          "Category": "Digital",
          "Priority": "Medium",
          "AssignedTo": "amal@thedeepseafood.com",
          "AssigneeEmail": "amal@thedeepseafood.com",
          "AssignedDate": "2026-07-09",
          "DeadlineDate": "2026-07-14",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        },
        {
          "Task": "Sushi img with bg from website",
          "Status": "Done",
          "Requirement": "Incase if we have any other images with the bg like this from \nthe shoot kindly share that as well",
          "Category": "",
          "Priority": "High",
          "AssignedTo": "amar@thedeepseafood.com",
          "AssigneeEmail": "amar@thedeepseafood.com",
          "AssignedDate": "2026-07-09",
          "DeadlineDate": "2026-07-09",
          "SubStatus": "Finish",
          "Remarks": "Shared the file.",
          "LastUpdateDate": "2026-07-09"
        },
        {
          "Task": "C4 Marinated Sleeves:",
          "Status": "In Progress",
          "Requirement": "1. barcode below the netweight\n2. address to be changed to: THE DEEP SEAFOOD \nFACTORY LLC - in english and in arabic\n3. Net weight - weight variation to be added +- 20gm",
          "Category": "",
          "Priority": "High",
          "AssignedTo": "amal@thedeepseafood.com",
          "AssigneeEmail": "amal@thedeepseafood.com",
          "AssignedDate": "2026-07-09",
          "DeadlineDate": "2026-07-09",
          "SubStatus": "In Progress",
          "Remarks": "",
          "LastUpdateDate": ""
        },
        {
          "Task": "Wet wipes",
          "Status": "New",
          "Requirement": "Regarding the wet wipes\nthis is what purchasing team as provided us kindly suggest \nus the closest/similar shade for to proceed with bulk printing\nwe can mix and match green and golden from the options provided",
          "Category": "",
          "Priority": "High",
          "AssignedTo": "amal@thedeepseafood.com",
          "AssigneeEmail": "amal@thedeepseafood.com",
          "AssignedDate": "2026-07-09",
          "DeadlineDate": "2026-07-10",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        }
      ],
      "The Deep Sea Food": [
        {
          "Task": "Tuna Video",
          "Status": "Done",
          "Requirement": "Tunaria video + Hotel festival",
          "Category": "Video Production",
          "Priority": "High",
          "AssignedTo": "amar@thedeepseafood.com|Agency - Elevage",
          "AssigneeEmail": "amar@thedeepseafood.com",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "Reel published in social media",
          "LastUpdateDate": ""
        },
        {
          "Task": "Coorporate Video",
          "Status": "In Progress",
          "Requirement": "Need a video to publish how the process from sea to table",
          "Category": "Digital",
          "Priority": "Medium",
          "AssignedTo": "Agency - Elevage",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        },
        {
          "Task": "Brand Guidelines",
          "Status": "New",
          "Requirement": "Suggested by Marketing team",
          "Category": "Digital",
          "Priority": "High",
          "AssignedTo": "",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        }
      ],
      "Gourmex": [
        {
          "Task": "Product - Sweet Corn",
          "Status": "OnHold",
          "Requirement": "",
          "Category": "Package",
          "Priority": "Low",
          "AssignedTo": "Agency - Accolades",
          "AssigneeEmail": "",
          "AssignedDate": "2026-03-01",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        },
        {
          "Task": "Product - Green peas",
          "Status": "OnHold",
          "Requirement": "",
          "Category": "Package design",
          "Priority": "Low",
          "AssignedTo": "Agency - Accolades",
          "AssigneeEmail": "",
          "AssignedDate": "2026-03-01",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        },
        {
          "Task": "ABALONE - Inaguration",
          "Status": "In Progress",
          "Requirement": "Request you to develop posters for Gourmex Food Processing.",
          "Category": "Print",
          "Priority": "High",
          "AssignedTo": "amal@thedeepseafood.com",
          "AssigneeEmail": "amal@thedeepseafood.com",
          "AssignedDate": "2026-07-08",
          "DeadlineDate": "2026-07-09",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        },
        {
          "Task": "ABALONE - Inaguration Shoot",
          "Status": "In Progress",
          "Requirement": "Suggested from Marketing Team",
          "Category": "Offline",
          "Priority": "High",
          "AssignedTo": "Agency",
          "AssigneeEmail": "",
          "AssignedDate": "2026-07-09",
          "DeadlineDate": "2026-07-10",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        },
        {
          "Task": "Brand Guidelines",
          "Status": "New",
          "Requirement": "Suggested by Marketing team",
          "Category": "Digital",
          "Priority": "High",
          "AssignedTo": "",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        }
      ],
      "Atlantico": [
        {
          "Task": "Cooked shrimp packaging",
          "Status": "Done",
          "Requirement": "Product packaging needed",
          "Category": "Package design",
          "Priority": "High",
          "AssignedTo": "Freelance",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        },
        {
          "Task": "Smoked salmon packaging",
          "Status": "Done",
          "Requirement": "",
          "Category": "Package design",
          "Priority": "High",
          "AssignedTo": "Freelance",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        },
        {
          "Task": "Sticker for carebenero shrimps",
          "Status": "Done",
          "Requirement": "",
          "Category": "Package design",
          "Priority": "High",
          "AssignedTo": "Freelance",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        },
        {
          "Task": "Smoked mackerel fillet pepper",
          "Status": "In Progress",
          "Requirement": "",
          "Category": "Package design",
          "Priority": "High",
          "AssignedTo": "Freelance",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "Design Confirmed, Revising the content",
          "LastUpdateDate": ""
        },
        {
          "Task": "Smoked tuna Packaging",
          "Status": "In Progress",
          "Requirement": "",
          "Category": "Package design",
          "Priority": "",
          "AssignedTo": "Freelance",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "Design Confirmed, Waiting for content",
          "LastUpdateDate": ""
        },
        {
          "Task": "Smoked cod fillet Packaging",
          "Status": "In Progress",
          "Requirement": "",
          "Category": "Package design",
          "Priority": "",
          "AssignedTo": "Freelance",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "Design Confirmed, colour Combinations given, waiting for confirmation",
          "LastUpdateDate": ""
        },
        {
          "Task": "Smoked Hamachi fillet Packaging",
          "Status": "In Progress",
          "Requirement": "",
          "Category": "Package design",
          "Priority": "",
          "AssignedTo": "Freelance",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "Design done, Revising the content",
          "LastUpdateDate": ""
        },
        {
          "Task": "Smoked seabass  Packaging",
          "Status": "In Progress",
          "Requirement": "",
          "Category": "Package design",
          "Priority": "",
          "AssignedTo": "Freelance",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "Design done, waiting for approval",
          "LastUpdateDate": ""
        },
        {
          "Task": "Fresh cod fillet Packaging",
          "Status": "In Progress",
          "Requirement": "",
          "Category": "Package design",
          "Priority": "",
          "AssignedTo": "Freelance",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "Design confirmed, working on font & opening",
          "LastUpdateDate": ""
        },
        {
          "Task": "Black cod fillet frozen  Packaging",
          "Status": "In Progress",
          "Requirement": "",
          "Category": "Package design",
          "Priority": "",
          "AssignedTo": "Freelance",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "Working on the design",
          "LastUpdateDate": ""
        },
        {
          "Task": "Squid Ring",
          "Status": "In Progress",
          "Requirement": "",
          "Category": "Package design",
          "Priority": "",
          "AssignedTo": "Freelance",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "Design Confirmed.",
          "LastUpdateDate": ""
        },
        {
          "Task": "Brand Guidelines",
          "Status": "New",
          "Requirement": "Suggested by Marketing team",
          "Category": "Digital",
          "Priority": "High",
          "AssignedTo": "",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        }
      ],
      "Royal Future": [
        {
          "Task": "Website Designing",
          "Status": "In Progress",
          "Requirement": "Royal Future website is revamping",
          "Category": "Digital",
          "Priority": "High",
          "AssignedTo": "Agency - Esight Business Solution",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        },
        {
          "Task": "Brand Guidelines",
          "Status": "New",
          "Requirement": "Suggested by Marketing team",
          "Category": "Digital",
          "Priority": "High",
          "AssignedTo": "",
          "AssigneeEmail": "",
          "AssignedDate": "",
          "DeadlineDate": "",
          "SubStatus": "",
          "Remarks": "",
          "LastUpdateDate": ""
        }
      ]
    };

  Object.keys(DATA).forEach(function (company) { setup_ensureCompany_(company); });

  var total = 0;
  Object.keys(DATA).forEach(function (company) {
    var rows = DATA[company];

    // Replace existing rows for this company (+ their history) so re-runs stay clean.
    var mk = ss_().getSheetByName('Marketing');
    var mvals = mk.getDataRange().getValues();
    var mh = mvals[0];
    var cCompany = mh.indexOf('Company'), cId = mh.indexOf('TaskID');
    var oldIds = {};
    for (var i = mvals.length - 1; i >= 1; i--) {
      if (String(mvals[i][cCompany]).trim() === company) {
        oldIds[String(mvals[i][cId])] = true;
        mk.deleteRow(i + 1);
      }
    }
    var hs = ss_().getSheetByName('History');
    var hvals = hs.getDataRange().getValues();
    var cHid = hvals[0].indexOf('TaskID');
    for (var j = hvals.length - 1; j >= 1; j--) {
      if (oldIds[String(hvals[j][cHid])]) hs.deleteRow(j + 1);
    }

    rows.forEach(function (r) {
      var obj = {
        TaskID: Utilities.getUuid(),
        AssignerEmail: ASSIGNER,
        AssigneeEmail: r.AssigneeEmail || '',
        CreatedAt: new Date(),
        Task: r.Task, Status: r.Status, Requirement: r.Requirement, Category: r.Category,
        Priority: r.Priority, AssignedTo: r.AssignedTo, AssignedDate: r.AssignedDate,
        DeadlineDate: r.DeadlineDate, SubStatus: r.SubStatus, Remarks: r.Remarks,
        LastUpdateDate: r.LastUpdateDate, Company: company
      };
      appendTask('Marketing', obj);
      appendHistory('Marketing', obj.TaskID, ASSIGNER, 'create', '', '', obj.Task + ' [' + company + ']');
      total++;
    });
  });
  clearBoardTasksCache_('Marketing');
  Logger.log('setup_seedMarketingTasks: seeded ' + total + ' tasks across ' + Object.keys(DATA).length + ' companies.');
  return total;
}

/** Ensure the Marketing board's Status field includes an option (prepended). */
function setup_ensureStatusOption_(opt) {
  var sh = ss_().getSheetByName('Boards');
  var vals = sh.getDataRange().getValues();
  var h = vals[0];
  var cType = h.indexOf('taskType'), cKey = h.indexOf('fieldKey'), cOpts = h.indexOf('options');
  for (var i = 1; i < vals.length; i++) {
    if (vals[i][cType] === 'Marketing' && vals[i][cKey] === 'Status') {
      var opts = String(vals[i][cOpts]).split('|').map(function (s) { return s.trim(); }).filter(Boolean);
      if (opts.indexOf(opt) < 0) {
        opts.unshift(opt);
        sh.getRange(i + 1, cOpts + 1).setValue(opts.join('|'));
        clearTableCache_('Boards');
      }
      return;
    }
  }
}

/** Ensure a company exists (active) in the Companies tab. */
function setup_ensureCompany_(name) {
  var sh = ss_().getSheetByName('Companies');
  var vals = sh.getDataRange().getValues();
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === name) return;
  }
  sh.appendRow([name, true]);
  clearTableCache_('Companies');
}
