# tasks

Company task/ticket manager — a Trello-style, mobile-first **PWA** (GitHub Pages) backed by
**Google Sheets** via **Google Apps Script**. Visibility is driven by an org hierarchy; sign-in is
Google Workspace.

- Spec: [`docs/superpowers/specs/2026-07-10-task-management-pwa-design.md`](docs/superpowers/specs/2026-07-10-task-management-pwa-design.md)
- Plan: [`docs/superpowers/plans/2026-07-10-task-mgmt-foundation.md`](docs/superpowers/plans/2026-07-10-task-mgmt-foundation.md)

## Layout
- `apps-script/` — backend (Apps Script Web App). Deployed with [`clasp`](https://github.com/google/clasp).
- `web/` — static PWA frontend. Served by GitHub Pages (`/web`).

## Setup (do once)
1. **Backend sheet:** create a spreadsheet, copy its ID → `apps-script/Config.gs` `SPREADSHEET_ID`.
2. **OAuth client:** Google Cloud → Credentials → OAuth client ID (Web). Add your Pages origin +
   `http://localhost:5500` as authorized JS origins. Put the client ID in `apps-script/Config.gs`
   (`CLIENT_ID`) **and** `web/config.js` (`CLIENT_ID`). Set your Workspace domain as `ALLOWED_DOMAIN`.
3. **Deploy backend:** in `apps-script/`: `clasp push` → `clasp deploy`. Copy the `/exec` URL into
   `web/config.js` `API_URL`.
4. **Seed data:** in the Apps Script editor run `setup_createTabs`, `setup_seedMarketingConfig`,
   paste your marketing rows into the `Marketing` tab (from column E), then
   `setup_backfillMarketingSystemCols`, then `setup_seedAdminUser` (edit the email first).
5. **Frontend:** enable GitHub Pages on this repo (folder `/web`), or run locally with
   `npx serve web -l 5500`.

> Do not commit real `CLIENT_ID` / `SPREADSHEET_ID` / `API_URL` if this repo is public.

## Permission model
- **See:** your own tasks + everyone below you in the hierarchy. "See-all" flag = everything.
- **Definition fields** (marked `•`): editable only by the assigner and their managers.
- **Update fields** (status, remarks, dates): editable by the assignee. You can't change a task
  handed to you from above — only add your updates. All enforced server-side.
