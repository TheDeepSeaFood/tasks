# Task Management PWA — Foundation (Phase 0–1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the verified Google-Sign-In → Apps Script → Sheet round-trip from a static site, then a backend data layer that returns tasks filtered by the org hierarchy.

**Architecture:** Static frontend (plain JS) calls a single Apps Script Web App over `fetch` with a Google ID token in the body. Apps Script verifies the token server-side, resolves the user in a `Users` tab, and enforces hierarchy-based visibility before returning data. The Sheet is the database.

**Tech Stack:** Google Apps Script (V8), `clasp` for deploy, Google Identity Services (GIS) for sign-in, vanilla HTML/CSS/JS frontend. Spec: `docs/superpowers/specs/2026-07-10-task-management-pwa-design.md`.

**Follow-up plans (not in this doc):** Phase 2 Kanban board UI, Phase 3 graphical hierarchy editor, Phase 4 additional boards + PWA packaging.

---

## Prerequisites (one-time, manual — do before Task 1)

These require human action in Google/GCP consoles and cannot be scripted here. Record the values; later tasks reference them.

- [ ] **P1: Create the backend spreadsheet.** In Google Drive create a spreadsheet named `TaskMgmt-Backend`. Copy its ID from the URL (`/spreadsheets/d/<ID>/edit`). Record as `SPREADSHEET_ID`.
- [ ] **P2: Create a Google Cloud OAuth Client ID (Web).** In Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → type **Web application**. Under *Authorized JavaScript origins* add your GitHub Pages origin (e.g. `https://<user>.github.io`) and `http://localhost:5500` for local testing. Record the **Client ID** as `CLIENT_ID`. Record your Workspace domain (e.g. `oceano.com`) as `ALLOWED_DOMAIN`.
- [ ] **P3: Install clasp and log in.** Run `npm i -g @google/clasp` then `clasp login`. Verify: `clasp --version` prints a version.

---

## File structure

```
apps-script/            # backend, deployed with clasp (executes as owner)
  appsscript.json       # manifest: web app config + oauth scopes
  Config.gs             # CLIENT_ID, ALLOWED_DOMAIN, SPREADSHEET_ID constants
  Code.gs               # doGet/doPost router
  Auth.gs               # verifyIdToken()
  Repo.gs               # sheet read helpers (Users, Hierarchy, Boards, task tabs)
  Permissions.gs        # visibleEmails(), canSeeTask() — pure logic
  Setup.gs              # one-time: create tabs, seed marketing data
  Tests.gs             # editor-run test functions for Permissions
web/                    # frontend, served by GitHub Pages / local static server
  index.html
  config.js             # CLIENT_ID, API_URL
  auth.js               # GIS sign-in, holds id token
  api.js                # apiCall(action, payload)
  app.js                # wires sign-in -> whoami -> board list
```

Responsibility split: `Auth.gs` only proves identity; `Permissions.gs` only decides visibility (pure, testable); `Repo.gs` only touches the sheet; `Code.gs` only routes. Frontend `api.js` is the single network chokepoint.

---

## Task 1: Backend skeleton + manifest

**Files:**
- Create: `apps-script/appsscript.json`
- Create: `apps-script/Config.gs`
- Create: `apps-script/.clasp.json`

- [ ] **Step 1: Write the manifest**

`apps-script/appsscript.json`:
```json
{
  "timeZone": "Asia/Dubai",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" },
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request"
  ]
}
```
`ANYONE_ANONYMOUS` is intentional: our token verification is the real gate, and it avoids the Google login redirect that breaks cross-origin `fetch`. `USER_DEPLOYING` lets the script read the owner's spreadsheet.

- [ ] **Step 2: Write config constants**

`apps-script/Config.gs`:
```javascript
const CLIENT_ID = 'REPLACE_WITH_CLIENT_ID';       // from P2
const ALLOWED_DOMAIN = 'REPLACE_WITH_DOMAIN';     // from P2, e.g. 'oceano.com'
const SPREADSHEET_ID = 'REPLACE_WITH_SPREADSHEET_ID'; // from P1
```

- [ ] **Step 3: Create the clasp project**

Run in `apps-script/`:
```bash
clasp create --type webapp --title "TaskMgmt-Backend" --rootDir .
```
This writes `.clasp.json` with a `scriptId`. Expected: `Created new Google Apps Script`.

- [ ] **Step 4: Fill in the real constant values** in `Config.gs` (from P1/P2). Do not commit real values if the repo is public — see Task 8 note.

- [ ] **Step 5: Commit**
```bash
git add apps-script/appsscript.json apps-script/Config.gs apps-script/.clasp.json
git commit -m "chore: apps script skeleton and manifest"
```

---

## Task 2: Token verification (Auth.gs)

**Files:**
- Create: `apps-script/Auth.gs`
- Test: `apps-script/Tests.gs` (`test_verify_rejects_garbage`)

- [ ] **Step 1: Write the failing test**

`apps-script/Tests.gs`:
```javascript
function test_verify_rejects_garbage() {
  try {
    verifyIdToken('not-a-real-token');
    throw new Error('FAIL: expected rejection');
  } catch (e) {
    if (e.message.indexOf('FAIL') === 0) throw e;
    Logger.log('PASS: garbage token rejected (%s)', e.message);
  }
}
```

- [ ] **Step 2: Run it to confirm it fails**

In the Apps Script editor, run `test_verify_rejects_garbage`.
Expected: execution error `ReferenceError: verifyIdToken is not defined`.

- [ ] **Step 3: Implement verification**

`apps-script/Auth.gs`:
```javascript
/** Verifies a Google ID token via Google's tokeninfo endpoint.
 *  Returns {email, name} or throws. */
function verifyIdToken(idToken) {
  if (!idToken) throw new Error('Missing idToken');
  const url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Invalid token');
  const info = JSON.parse(resp.getContentText());
  if (info.aud !== CLIENT_ID) throw new Error('Wrong audience');
  if (ALLOWED_DOMAIN && info.hd !== ALLOWED_DOMAIN) throw new Error('Wrong domain');
  if (!info.email) throw new Error('No email in token');
  return { email: String(info.email).toLowerCase(), name: info.name || info.email };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run `test_verify_rejects_garbage` in the editor.
Expected: log line `PASS: garbage token rejected (Invalid token)` and no error.

- [ ] **Step 5: Commit**
```bash
git add apps-script/Auth.gs apps-script/Tests.gs
git commit -m "feat: server-side google id token verification"
```

---

## Task 3: Router with `whoami` (Code.gs)

**Files:**
- Create: `apps-script/Code.gs`

- [ ] **Step 1: Implement the router**

`apps-script/Code.gs`:
```javascript
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

function route(action, payload, user) {
  switch (action) {
    case 'whoami': return { email: user.email, name: user.name };
    default: throw new Error('Unknown action: ' + action);
  }
}
```

- [ ] **Step 2: Deploy the web app**
```bash
clasp push
clasp deploy --description "phase0"
```
Then in the Apps Script editor: Deploy → Manage deployments → copy the **Web app URL** (ends in `/exec`). Record as `API_URL`.
Expected: `clasp push` reports files pushed; a deployment URL exists.

- [ ] **Step 3: Smoke-test the endpoint rejects anonymous calls**
```bash
curl -s -L -X POST "$API_URL" -H "Content-Type: text/plain" -d '{"action":"whoami"}'
```
Expected: `{"ok":false,"error":"Missing idToken"}` (proves routing works and the gate is closed).

- [ ] **Step 4: Commit**
```bash
git add apps-script/Code.gs
git commit -m "feat: request router with whoami action"
```

---

## Task 4: Frontend sign-in shell (Phase 0 end-to-end)

**Files:**
- Create: `web/index.html`, `web/config.js`, `web/auth.js`, `web/api.js`, `web/app.js`

- [ ] **Step 1: Config**

`web/config.js`:
```javascript
window.APP_CONFIG = {
  CLIENT_ID: 'REPLACE_WITH_CLIENT_ID',   // from P2
  API_URL: 'REPLACE_WITH_API_URL'        // from Task 3 Step 2
};
```

- [ ] **Step 2: Auth (GIS)**

`web/auth.js`:
```javascript
let _idToken = null;
function initAuth(onSignIn) {
  google.accounts.id.initialize({
    client_id: window.APP_CONFIG.CLIENT_ID,
    callback: (resp) => { _idToken = resp.credential; onSignIn(); }
  });
  google.accounts.id.renderButton(
    document.getElementById('signin'),
    { theme: 'outline', size: 'large' }
  );
}
function getIdToken() { return _idToken; }
```

- [ ] **Step 3: API chokepoint**

`web/api.js`:
```javascript
async function apiCall(action, payload) {
  const resp = await fetch(window.APP_CONFIG.API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain avoids CORS preflight
    body: JSON.stringify({ idToken: getIdToken(), action, payload: payload || {} }),
    redirect: 'follow'
  });
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error);
  return json.data;
}
```

- [ ] **Step 4: App wiring**

`web/app.js`:
```javascript
window.addEventListener('load', () => {
  initAuth(async () => {
    const status = document.getElementById('status');
    try {
      const me = await apiCall('whoami');
      status.textContent = 'Signed in as ' + me.name + ' (' + me.email + ')';
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
    }
  });
});
```

- [ ] **Step 5: Page**

`web/index.html`:
```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Task Manager</title>
  <script src="https://accounts.google.com/gsi/client" async></script>
</head>
<body>
  <h1>Task Manager</h1>
  <div id="signin"></div>
  <p id="status">Not signed in.</p>
  <script src="config.js"></script>
  <script src="auth.js"></script>
  <script src="api.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 6: Verify end-to-end locally**

Serve `web/` over http (GIS needs an authorized origin, not `file://`):
```bash
npx serve web -l 5500
```
Open `http://localhost:5500`, click the Google button, sign in with a Workspace account.
Expected: page shows `Signed in as <name> (<email>)`. This proves the full risky path: GIS token → cross-origin fetch → server verification → response.

- [ ] **Step 7: Commit**
```bash
git add web/
git commit -m "feat: phase 0 sign-in round-trip working end to end"
```

> **Phase 0 gate:** do not proceed to Task 5 until Step 6 shows a verified email.

---

## Task 5: Backend tabs + seed marketing data (Setup.gs)

**Files:**
- Create: `apps-script/Setup.gs`

Import the real marketing rows from `digital marketing.xlsx` (sheet `Oceano`). Columns in order:
Task, Status, Requirement, Category, Priority, Assigned To, Assigned Date, Deadline Date, Sub-status, Remarks, Last Update Date.

- [ ] **Step 1: Implement tab creation**

`apps-script/Setup.gs`:
```javascript
function ss_() { return SpreadsheetApp.openById(SPREADSHEET_ID); }

function setup_createTabs() {
  const ss = ss_();
  ensureSheet_(ss, 'Users',      ['email','name','active','superDev','itManagerGroup']);
  ensureSheet_(ss, 'Hierarchy',  ['parentEmail','childEmail']);
  ensureSheet_(ss, 'Boards',     ['department','taskType','fieldKey','label','fieldType','options','isUpdate','isStatus','order']);
  ensureSheet_(ss, 'Marketing',  ['TaskID','AssignerEmail','AssigneeEmail','CreatedAt',
    'Task','Status','Requirement','Category','Priority','AssignedTo','AssignedDate','DeadlineDate','SubStatus','Remarks','LastUpdateDate']);
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sh;
}
```

- [ ] **Step 2: Implement the Boards config seed for Marketing**

Append to `Setup.gs`:
```javascript
function setup_seedMarketingConfig() {
  const rows = [
    // department, taskType, fieldKey, label, fieldType, options, isUpdate, isStatus, order
    ['Marketing','Marketing','Task','Task','text','',false,false,1],
    ['Marketing','Marketing','Requirement','Requirement','longtext','',false,false,2],
    ['Marketing','Marketing','Category','Category','select','Offline|New Brand|Packaging-RTC',false,false,3],
    ['Marketing','Marketing','Priority','Priority','select','Low|Medium|High',false,false,4],
    ['Marketing','Marketing','AssignedTo','Assigned To','person','',false,false,5],
    ['Marketing','Marketing','AssignedDate','Assigned Date','date','',false,false,6],
    ['Marketing','Marketing','DeadlineDate','Deadline Date','date','',false,false,7],
    ['Marketing','Marketing','Status','Status','select','Delayed|In Review|Concept Progress|In Progress|OnHold|Done',true,true,8],
    ['Marketing','Marketing','SubStatus','Sub-status','select','In Progress|OnHold',true,false,9],
    ['Marketing','Marketing','Remarks','Remarks','longtext','',true,false,10],
    ['Marketing','Marketing','LastUpdateDate','Last Update Date','date','',true,false,11]
  ];
  const sh = ss_().getSheetByName('Boards');
  sh.getRange(sh.getLastRow()+1, 1, rows.length, rows[0].length).setValues(rows);
}
```

- [ ] **Step 3: Import marketing rows from the xlsx into the Marketing tab.**

Manual (once): open `digital marketing.xlsx` in Google Sheets, copy rows 2..N of the `Oceano` sheet, and paste into the `Marketing` tab starting at column **E** (`Task`) row 2, leaving A–D (`TaskID`…`CreatedAt`) blank for now. Then run the backfill:
```javascript
function setup_backfillMarketingSystemCols() {
  const sh = ss_().getSheetByName('Marketing');
  const last = sh.getLastRow();
  if (last < 2) return;
  const n = last - 1;
  const ids = [], created = [];
  const now = new Date();
  for (let i = 0; i < n; i++) { ids.push([Utilities.getUuid()]); created.push([now]); }
  sh.getRange(2, 1, n, 1).setValues(ids);        // TaskID
  sh.getRange(2, 4, n, 1).setValues(created);    // CreatedAt
}
```

- [ ] **Step 4: Run setup and verify**

In the editor run, in order: `setup_createTabs`, `setup_seedMarketingConfig`, (paste data), `setup_backfillMarketingSystemCols`.
Expected: `Boards` tab has 11 Marketing rows; `Marketing` tab has every task with a filled `TaskID` and `CreatedAt`.

- [ ] **Step 5: Commit**
```bash
git add apps-script/Setup.gs
git commit -m "feat: backend tabs and marketing seed"
```

---

## Task 6: Permission logic (Permissions.gs) — pure and tested

**Files:**
- Create: `apps-script/Permissions.gs`
- Modify: `apps-script/Tests.gs`

- [ ] **Step 1: Write the failing test**

Append to `apps-script/Tests.gs`:
```javascript
function test_visibleEmails_subtree() {
  // tree: boss -> coord -> amal ; boss -> it (unrelated branch head)
  const edges = [
    { parentEmail: 'boss@x', childEmail: 'coord@x' },
    { parentEmail: 'coord@x', childEmail: 'amal@x' },
    { parentEmail: 'boss@x', childEmail: 'it@x' }
  ];
  const usersById = {
    'boss@x': { email:'boss@x', itManagerGroup:false, superDev:false },
    'coord@x': { email:'coord@x' }, 'amal@x': { email:'amal@x' }, 'it@x': { email:'it@x' }
  };
  const seen = visibleEmails('coord@x', edges, usersById).sort();
  const expect = ['amal@x','coord@x'].sort();
  if (JSON.stringify(seen) !== JSON.stringify(expect)) throw new Error('FAIL got ' + JSON.stringify(seen));

  const all = visibleEmails('boss@x', edges, usersById);
  if (all.indexOf('it@x') < 0 || all.indexOf('amal@x') < 0) throw new Error('FAIL boss missing reports');
  Logger.log('PASS: visibleEmails subtree');
}

function test_visibleEmails_admin_sees_all() {
  const edges = [{ parentEmail:'boss@x', childEmail:'coord@x' }];
  const usersById = {
    'boss@x': { email:'boss@x' }, 'coord@x': { email:'coord@x' },
    'root@x': { email:'root@x', itManagerGroup:true }
  };
  const all = visibleEmails('root@x', edges, usersById).sort();
  if (all.length !== 3) throw new Error('FAIL admin should see all 3, got ' + all.length);
  Logger.log('PASS: admin sees all');
}
```

- [ ] **Step 2: Run to confirm failure**

Run both tests in the editor. Expected: `ReferenceError: visibleEmails is not defined`.

- [ ] **Step 3: Implement**

`apps-script/Permissions.gs`:
```javascript
/** Returns the list of emails a viewer may see: self + all descendants,
 *  or everyone if the viewer is itManagerGroup/superDev. */
function visibleEmails(viewerEmail, edges, usersById) {
  const viewer = usersById[viewerEmail] || {};
  if (viewer.itManagerGroup || viewer.superDev) return Object.keys(usersById);

  const childrenOf = {};
  edges.forEach(function(e) {
    (childrenOf[e.parentEmail] = childrenOf[e.parentEmail] || []).push(e.childEmail);
  });
  const seen = {};
  const stack = [viewerEmail];
  while (stack.length) {
    const cur = stack.pop();
    if (seen[cur]) continue;
    seen[cur] = true;
    (childrenOf[cur] || []).forEach(function(c) { stack.push(c); });
  }
  return Object.keys(seen);
}

/** A task is visible if its assigner or assignee is in the viewer's visible set. */
function canSeeTask(task, visibleSet) {
  return !!(visibleSet[task.AssignerEmail] || visibleSet[task.AssigneeEmail]);
}
```

- [ ] **Step 4: Run to confirm pass**

Run both tests. Expected: `PASS: visibleEmails subtree` and `PASS: admin sees all`.

- [ ] **Step 5: Commit**
```bash
git add apps-script/Permissions.gs apps-script/Tests.gs
git commit -m "feat: hierarchy visibility logic with tests"
```

---

## Task 7: Read API — `listBoards` and `listTasks` (Repo.gs + route)

**Files:**
- Create: `apps-script/Repo.gs`
- Modify: `apps-script/Code.gs` (route)

- [ ] **Step 1: Implement sheet readers**

`apps-script/Repo.gs`:
```javascript
function readObjects_(sheetName) {
  const sh = ss_().getSheetByName(sheetName);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(function(r){ return r.join('') !== ''; }).map(function(row) {
    const o = {};
    headers.forEach(function(h, i){ o[h] = row[i]; });
    return o;
  });
}

function getUsers() {
  const list = readObjects_('Users');
  const byId = {};
  list.forEach(function(u) {
    u.email = String(u.email).toLowerCase();
    u.superDev = u.superDev === true || u.superDev === 'TRUE';
    u.itManagerGroup = u.itManagerGroup === true || u.itManagerGroup === 'TRUE';
    byId[u.email] = u;
  });
  return byId;
}

function getEdges() {
  return readObjects_('Hierarchy').map(function(e){
    return { parentEmail: String(e.parentEmail).toLowerCase(),
             childEmail: String(e.childEmail).toLowerCase() };
  });
}

/** Distinct boards from the config: [{department, taskType}] */
function getBoardList() {
  const seen = {}, out = [];
  readObjects_('Boards').forEach(function(r) {
    const key = r.department + '||' + r.taskType;
    if (!seen[key]) { seen[key] = true; out.push({ department: r.department, taskType: r.taskType }); }
  });
  return out;
}

/** Tasks from a board tab (tab name == taskType). */
function getBoardTasks(taskType) {
  return readObjects_(taskType);
}
```

- [ ] **Step 2: Wire routes**

In `apps-script/Code.gs`, replace the `route` function body's switch with:
```javascript
function route(action, payload, user) {
  switch (action) {
    case 'whoami':
      return { email: user.email, name: user.name };

    case 'listBoards':
      return { boards: getBoardList() };

    case 'listTasks': {
      const users = getUsers();
      const edges = getEdges();
      const visible = {};
      visibleEmails(user.email, edges, users).forEach(function(em){ visible[em] = true; });
      const tasks = getBoardTasks(payload.taskType).filter(function(t) {
        return canSeeTask(
          { AssignerEmail: String(t.AssignerEmail).toLowerCase(),
            AssigneeEmail: String(t.AssigneeEmail).toLowerCase() },
          visible
        );
      });
      return { tasks: tasks };
    }

    default:
      throw new Error('Unknown action: ' + action);
  }
}
```

- [ ] **Step 3: Seed two test users + hierarchy for a live check**

In the `Users` tab add (headers already present):
```
boss@<domain>   | Boss  | TRUE | FALSE | TRUE
coord@<domain>  | Coord | TRUE | FALSE | FALSE
```
In `Hierarchy` add: `boss@<domain> | coord@<domain>`.
In the `Marketing` tab, set `AssignerEmail`=`coord@<domain>` and `AssigneeEmail`=`coord@<domain>` on a couple of rows so there is data owned by coord.

- [ ] **Step 4: Deploy and verify filtering**
```bash
clasp push && clasp deploy --description "phase1"
```
From the signed-in web page console (Task 4 running), run:
```javascript
await apiCall('listBoards');                       // -> { boards: [{department:'Marketing',taskType:'Marketing'}] }
await apiCall('listTasks', { taskType: 'Marketing' }); // coord sees only coord-owned rows; sign in as boss -> sees all
```
Expected: `coord` sees only the rows they own/are assigned; `boss` (itManagerGroup) sees every Marketing row.

- [ ] **Step 5: Commit**
```bash
git add apps-script/Repo.gs apps-script/Code.gs
git commit -m "feat: listBoards and hierarchy-filtered listTasks"
```

---

## Task 8: Repo hygiene

**Files:**
- Create: `.gitignore`, `README.md`

- [ ] **Step 1: Init git if needed**
```bash
git init && git add -A && git commit -m "chore: initial import"
```
(Skip `git init` if already a repo.)

- [ ] **Step 2: `.gitignore`**
```
node_modules/
.DS_Store
```

- [ ] **Step 3: README note on secrets.** Add to `README.md`: if the GitHub repo is public, do not commit real `CLIENT_ID`/`SPREADSHEET_ID`/`API_URL` in `Config.gs`/`config.js`; keep a `*.example` and fill locals. (Client IDs and the exec URL are low-sensitivity but keep them out of public history by preference.)

- [ ] **Step 4: Commit**
```bash
git add .gitignore README.md
git commit -m "chore: gitignore and readme"
```

---

## Self-review notes

- **Spec coverage (Phase 0–1 slice):** Google Sign-In (T2,T4) ✓; server-side identity (T2) ✓; Sheet-as-DB tabs incl. per-board task tab + Boards config (T5) ✓; hierarchy = visibility incl. admin-sees-all (T6,T7) ✓; all marketing columns preserved (T5) ✓; CORS mitigation (T4) ✓. Deferred to later plans (correctly out of this slice): Kanban UI, card edit + definition/update enforcement, graphical hierarchy editor, PWA manifest/service worker, extra boards. **Write enforcement (definition vs update) lands in the Phase 2 plan alongside the edit UI — no read-path task needs it.**
- **Naming consistency:** `visibleEmails`, `canSeeTask`, `getUsers/getEdges/getBoardList/getBoardTasks`, `readObjects_` used identically across T6–T7. Task tab name == `taskType` (Marketing) — consistent in T5 and T7.
- **Open items carried from spec §10:** marketing-people-scope and exact field split are represented as config/data (Boards rows + Users flags), so changing them is a data edit, not a code change.
