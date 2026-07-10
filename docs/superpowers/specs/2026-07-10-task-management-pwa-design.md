# Task Management PWA — Design Spec

**Date:** 2026-07-10
**Status:** Draft for review

## 1. Goal

A company-wide task/ticket management app — Trello-style, mobile-first, installable — where
every department (marketing, IT/software support, hardware support, vendor coordination, creative,
video, social, dev) manages its own tasks, and visibility is driven by a graphically-editable org
hierarchy. Backed by Google Sheets via Apps Script; frontend is a static PWA on GitHub Pages.

## 2. Users & roles

- **Regular members** — see their own tasks plus everyone below them in the org tree.
- **Department leads / coordinators** — sit above their branch, so they see and manage everything
  under it (e.g. the digital-marketing coordinator and social-media manager see all Marketing).
- **IT-manager group** — top of the tree: sees everything and can create/assign tasks to anyone in
  any department (global authority).
- **Super-dev** — like the IT-manager group: sees everything; also maintains config/boards.

Assignees are not always users. "Assigned To" may be a person (a user), an agency, or "Outsourcing".
Only people who log in exist in the hierarchy; non-user assignees are just labels on a task.

## 3. Architecture

- **Frontend:** plain HTML/CSS/JS, mobile-first, packaged as an installable **PWA**, hosted on
  **GitHub Pages** (HTTPS, no build step). One small vendored library for the org-tree editor.
- **Backend:** a single Google Apps Script **Web App** (`doGet`/`doPost`) bound to the backend
  spreadsheet. The Sheet is the database. `LockService` guards all writes.
- **Login / identity:** Google Identity Services on the frontend → user signs in with their
  Workspace account → the frontend sends the Google **ID token** with every request → Apps Script
  **verifies the token** (audience + signature via Google's tokeninfo endpoint), extracts the email,
  and looks the person up in the Users tab. Identity is established server-side and cannot be
  spoofed from the static site.
- **CORS (known risk):** calling Apps Script from another origin (GitHub Pages) has a well-known
  redirect/CORS quirk. Mitigation: `text/plain` request bodies (avoids preflight), token carried in
  the body, all traffic to the `/exec` URL. **This round-trip is proven first (Phase 0) before any
  feature is built on it.**

All permission logic is enforced **server-side**. The frontend only hides/greys things for UX.

## 4. Data model

Backend spreadsheet tabs:

### `Users`
| email | name | active | superDev | itManagerGroup |

### `Hierarchy`
| parentEmail | childEmail |
Adjacency list of the org tree. This is exactly what the graphical editor reads and writes.
The tree defines visibility (see §5).

### `Boards` (config — drives forms, columns, and Kanban lists)
| department | taskType | fieldKey | label | fieldType | options | isUpdate | isStatus | order |

- `fieldType`: text / longtext / date / select / person / number.
- `options`: for `select`/status fields (pipe-separated).
- `isUpdate`: TRUE = an update field (assignee-editable); FALSE = a definition field.
- `isStatus`: TRUE marks the single field whose options become the board's Kanban **lists**.
- A "board" = a `(department, taskType)` pair. A department may have several boards
  (e.g. IT → Software Tickets, Hardware Tickets).

### `Companies` (config)
| name | active |
Sub-companies under the group (The Deep Sea Food, Oceano, Gourmex, Royal Future, …). Editable anytime.

### `History` (append-only audit trail)
| HistoryID | taskType | TaskID | Timestamp | ActorEmail | Action | Field | OldValue | NewValue |
Every create and every field change appends a row; nothing is overwritten. Surfaced as a timeline
inside each ticket for full traceability.

### One tab per board (task storage)
Each board stores its tasks in its own tab with exactly the columns from its config, plus hidden
system columns: `TaskID` (UUID), `AssignerEmail`, `AssigneeEmail`, `CreatedAt`.
The existing marketing spreadsheet becomes the **Marketing** board tab, preserving all its columns.

## 5. Permission rules (server-enforced)

**Visibility (who can SEE a task):**
- You see tasks where you are the assignee or the assigner, plus all tasks belonging to anyone
  below you in the hierarchy tree.
- `itManagerGroup` and `superDev` see everything.

**Editing:**
- **Definition fields** (`isUpdate = FALSE`): editable only by the assigner and their managers
  (anyone at/above the assigner in the tree). The IT-manager group may create/assign anywhere.
- **Update fields** (`isUpdate = TRUE`): editable by the assignee (and anyone above). Dragging a
  card between lists = changing the status field = an update, so an assignee may do it even on a
  task handed down from above. An assignee can **never** edit the definition fields of a task
  assigned to them from above.

## 6. Marketing board fields

All columns from the current spreadsheet are preserved. Proposed definition/update split:

| Field | Type | isUpdate | Notes |
|---|---|---|---|
| Task | text | definition | card title |
| Requirement | longtext | definition | |
| Category | select | definition | Offline / New Brand / Packaging-RTC / … |
| Priority | select | definition | Low / Medium / High |
| Assigned To | person-or-label | definition | user, agency, or "Outsourcing" |
| Assigned Date | date | definition | |
| Deadline Date | date | definition | |
| Status | select (**isStatus**) | update | Kanban lists: Delayed / In Review / Concept Progress / In Progress / OnHold / Done |
| Sub-status | select | update | e.g. OnHold / In Progress — shown as a **badge** on the card |
| Remarks | longtext | update | |
| Last Update Date | date | update | |

> The spreadsheet has two "Status" columns; they are reconciled into one primary **Status** (the
> Kanban lists) plus a secondary **Sub-status** badge. Both are preserved and stored.

## 7. Screens

1. **Sign in** — Google Workspace account.
2. **Home** — the boards the user may see, grouped by department.
3. **Board (Kanban)** — mobile-first:
   - Phone: one status list at a time, swipe/tabs between lists; tap a card to open its detail sheet.
   - Changing status on mobile = tap → "Move to" status (drag also available on wider screens).
   - Desktop: full multi-list Trello layout.
   - Card front shows configured summary fields (task, priority, assignee, deadline) + sub-status badge.
   - "New task" available to those allowed to assign.
4. **Card detail** — all board fields; definition fields editable only per §5; update fields editable
   by the assignee.
5. **Hierarchy editor** (IT-manager group + super-dev) — graphical org tree: drag people to set who
   reports to whom, add/remove users, toggle `superDev` / `itManagerGroup` flags. Writes `Hierarchy`.
6. **Config** — for v1, admins edit the `Boards` config tab directly in the Sheet (config-driven, no
   in-app form builder). An in-app builder is a possible later addition.

## 8. PWA specifics

- `manifest.json` (name, icons, `standalone` display, theme colors) → "Add to Home Screen".
- **Service worker** caches the app shell for instant/offline load of the UI. Task **data** still
  requires a connection to Apps Script (Sheet is source of truth); no offline write queue in v1.
- Responsive: mobile-first, widening to the desktop Trello + tree layouts.

## 9. Build & verification plan (high level)

- **Phase 0 — prove the risky path:** GitHub Pages → Google Sign-In → Apps Script token verification;
  a logged-in user's verified email is returned. Nothing else until this works.
- **Phase 1 — backend + data:** create tabs, seed real marketing data, read API with server-side
  hierarchy filtering. Permission logic written as functions runnable in the Apps Script editor for
  quick checks (member sees only their subtree; IT-manager sees all).
- **Phase 2 — Kanban board:** config-driven lists/cards/detail; create + edit honoring the
  definition/update rules; status change via move/drag.
- **Phase 3 — graphical hierarchy editor:** tree read/write against `Hierarchy`.
- **Phase 4 — more boards + global assign:** Software/Hardware ticket board configs; IT-manager
  cross-department create/assign.
- **PWA packaging** (manifest + service worker + install) layered in once the shell is stable.

**Verification:** seed several users and tasks; sign in as different users and confirm each sees
exactly their subtree; confirm an assignee cannot edit definition fields of a task from above but can
move its status; confirm the IT-manager group can assign into any department; install the PWA on a
phone and run a board end-to-end.

## 10. Open items to confirm

1. **Marketing coordinator + social-media manager scope:** assumed "everything = all of Marketing"
   (they sit at the top of the Marketing branch). Global authority is the IT-manager group. Confirm
   this is the intent, or whether these two should also be global.
2. **Definition/update split** for the Marketing fields (§6) — confirm it matches how the team works.

## 11. Out of scope (v1 / YAGNI)

- In-app field/form builder (config edited in the Sheet for now).
- Offline write queue / full offline mode (offline app-shell only).
- Notifications, reporting/dashboards, file attachments, comments/activity feed.
- Real-time sync (Sheets is last-write-wins with a write lock).
- Non-Google (username/password) login.
