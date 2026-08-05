# AGENTS.md — 臺北農產 巡檢/報修/派工系統

> Instructions for AI coding agents (OpenCode, etc.) working in this repo.
> Human setup lives in `README.md`; deeper context in `PROJECT_CONTEXT.md`.

## What this is
A web-based **equipment inspection / repair / dispatch / maintenance** system for
臺北農產運銷股份有限公司 第一果菜市場, plus floor-plan (2D) and stacked-floor (3D)
viewers with a marker layer. **No build step** — every page is a standalone
static HTML file that loads libraries from CDNs and talks directly to Supabase.

## Tech stack
- **Frontend**: plain multi-page HTML/CSS/JS (no framework, no bundler). Each
  `system/*.html` is self-contained.
- **Backend**: Supabase (PostgreSQL + PostgREST REST + Auth + Storage), accessed
  from the browser with the **anon key** (already embedded in each HTML file).
  Project ref: `qztffronusdhgxhjjubt`.
- **Libraries via CDN**: `@supabase/supabase-js@2`, OpenSeadragon 4.1 (2D deep-zoom),
  Three.js r128 (3D), SheetJS `xlsx@0.18.5` (XLSX/CSV), Chart.js, qrcodejs.
- **Hosting**: GitHub Pages, auto-deployed from the `main` branch.
  Base URL: `https://jnfakimo.github.io/word-cloud/system/<page>.html`

## Repo layout
```
index.html              # root: redirects to system/index.html
PROJECT_CONTEXT.md      # full architecture / onboarding notes
system/*.html           # the actual application pages (see table below)
system/sql/*.sql        # Supabase schema — idempotent, run in SQL Editor
system/plans/*          # LIVE floor-plan assets (DZI tiles + textures) — do NOT delete
supabase/functions/     # edge function (LINE notify)
```

### Key pages (`system/`)
`index.html` portal · `login.html` · `app.html` inspection · `admin.html` back-office
· `dashboard.html` · `workorder.html` repair/dispatch · `materials.html` Material
Master · `arealist.html` floor-space table · `b1_integrated_marker_system.html`
marker editor · `b1plan.html` 2D plan · `floor3d.html` 3D floors · `modeler.html`
DXF→plan/3D · `handover.html` shift handover · `analytics.html` · `rbac.html`.

## How to run / verify
- **Run**: it's static. Open any `system/*.html` in a browser, or serve the repo
  root (`python3 -m http.server`) and browse to `/system/...`. No install/build.
- **Verify JS**: this repo has no test suite. Sanity-check a page's inline script
  with Node before committing:
  ```
  node -e "const fs=require('fs');const h=fs.readFileSync('system/PAGE.html','utf8');const p=h.split('<script>');require('vm').compileFunction(p[p.length-1].split('</script>')[0])"
  ```
- **Deploy check**: pushing to `main` triggers the `pages build and deployment`
  workflow. The live site is CDN-cached — append `?v=<n>` to a URL to bypass cache.

## Database
All schema is in `system/sql/` and is **idempotent** (`create table if not exists`,
`add column if not exists`, `drop policy if exists` before create). To provision a
fresh Supabase project, run in the SQL Editor in this order:
`schema.sql` → `locations_schema.sql` → `work_order_schema.sql` → `floor_models.sql`
→ `handover_schema.sql` → `floor_spaces.sql` → `plan_markers.sql` → `material_master.sql`
→ `equipment_lifecycle.sql` → `patrol_shifts.sql` → `checkin_logs.sql` → `dashboard_layouts.sql` → `system_access_seed.sql`
→ `audit_login_events.sql` → `meeting_rooms.sql` → `meeting_booking_notifications.sql`
→ `rls_hardening.sql` → `rls_hardening_login_fix.sql` → `permanent_data_protection.sql`.
`permanent_data_protection.sql` must be applied last. Production data is append/update/
deactivate only: never reset the database, truncate tables, or physically delete personnel.
RLS is currently open (`allow_all_for_now`) for development. Storage buckets:
`floorplans`, `repair-files`.

## Conventions (follow these)
- **Match the surrounding style**: cyberpunk dark theme. Core vars: `--bg:#020b18`,
  `--cyan:#00d4ff`, `--green:#00ff9d`, `--amber:#ffb300`, `--red:#ff3b3b`; fonts
  Noto Sans TC + Rajdhani. UI text is Traditional Chinese.
- **Dates**: unified format is 西元 `YYYY-MM-DD` (datetime `YYYY-MM-DD HH:mm`);
  date inputs use a calendar picker; forms show a 填表日期 (today). Use the local
  `fmtDate()`/`todayISO()` helpers.
- **Floor naming differs between systems**: area/material data may use `B1F`,
  while plan/3D use `B1`. Reconcile with a `canonicalFloor()` (B1≈B1F, 1F≈1, RF≈頂樓).
- **New/changed DB columns**: `create table if not exists` won't alter an existing
  table — always add a matching `alter table … add column if not exists`.
- **Adding a page**: give it the shared navbar/topbar, the Supabase init block, and
  cross-links consistent with sibling pages. Every page must load `system/theme.js`;
  its shared system-meta component must be visible at the top and show connectivity,
  the signed-in user's `department unit | name`, and Asia/Taipei time in
  `YYYY-MM-DD HH:mm:ss` format. Use the shared component and session profile fields;
  do not create a second, page-specific user/status/clock format. The component must
  sit at the far right of the page header in this exact order: user, connectivity,
  clock.
- **Shared header actions**: `system/theme.js` owns the global action group. Every
  application page must use the same six actions in this order: 首頁 → 戰情儀表板 →
  維修/派完工 → 駐衛警巡檢 → 電子交接簿 → 後台. Use `assets/system-icons/home-icon.svg` for 首頁,
  `assets/system-icons/admin-icon.png` for 戰情儀表板 and 後台,
  `assets/system-icons/maintenance-icon.png` for 維修/派完工, and
  `assets/system-icons/handover-icon.png` for 電子交接簿. The 維修/派完工 action
  must link to `https://jnfakimo.github.io/word-cloud/system/admin.html?v=8f9d41c#repairs`.
  Do not show a separate 完工回報 action. Do not use the `system/icons/nav-*`
  set for these shared actions.
  Do not add page-specific emoji or text-symbol versions. Page-specific actions
  may remain immediately to the left.
  This icon style, order, and shared-component implementation are locked; do not
  change them unless the user explicitly requests that specific standard to change.
  Never regenerate, redraw, edit, or replace the referenced PNG assets for this
  shared header without an explicit user request.
  Each action beyond 首頁/戰情儀表板 carries a `sysKey` (matching a `role_permissions`
  `sys_*` row — see the RBAC section) so `installSharedHeaderActions` in theme.js can
  hide it for roles without that system's access via `SystemAccess.allowedSystems()`;
  sysadmin always sees every action. Adding a new sub-system's shared-nav shortcut
  means adding one `defs` entry with its `sysKey` — no other page needs editing.
- **Shared brand bar** (added 2026-08-04, unified per owner request): the far-left
  of the header must read `■ TAIPEC-MKT-1 <頁面名稱> 臺北農產公司／第一果菜市場`. This is
  built automatically by `installBrandBar()`/`applyBrandNames()` in `theme.js` — do
  **not** hand-write it into new pages. To get the page name right:
  - If the page already has `<div class="nav-title">頁面名稱</div>` inside its
    `.navbar`/`.topbar` (the existing convention on most pages), theme.js reuses that
    text automatically — nothing else to do.
  - Pages without a `.nav-title` (currently only `admin.html`) fall back to a
    hardcoded `'後台'` in `pageBrandLabel()`; any other page without `.nav-title` falls
    back to the text before the first `—`/`-` in `<title>`.
  - `admin.html`/`handover.html` still ship their own literal `.topbar-left` markup
    from before this change — theme.js finds and overwrites it at runtime, so the two
    versions can look out of sync only if you read the HTML source, not in the browser.
  - Org/site name (`臺北農產公司`／`第一果菜市場`) comes from `system_settings`
    (`org_name`/`site_name`) via `applyBrandNames()`, applied to every
    `[data-sysname="org"]`/`[data-sysname="site"]` element on the page — reuse those
    same `data-sysname` attributes if a page needs to show the org/site name elsewhere.
  - Pages using a fixed `#topbar` icon-only toolbar (`b1plan.html`, `floor3d.html`,
    `b1_integrated_marker_system.html`, `guardpatrol3d.html`) and the entry pages
    (`index.html`, `login.html`, `app.html`, `materials.html`) intentionally do **not**
    get the brand bar — the toolbar is too narrow and the entry pages have their own
    branding. Don't force it onto these without an explicit request.

## Do NOT
- Do **not** delete `system/plans/*` — those textures/DZI tiles are used live by
  `floor3d.html` and `b1plan.html`.
- Do **not** drop or truncate DB tables casually — `equipment`, `locations`,
  `floor_spaces`, inspection data are shared across dashboard/repair/materials.
- Do **not** delete rows from `users` or other protected master/history tables. Set
  `status='inactive'`; the permanent-data trigger intentionally rejects DELETE/TRUNCATE.
- Do **not** disable TLS or hardcode secrets beyond the already-public anon key.

## Git workflow
- Default branch `main` is what GitHub Pages deploys. Commit/push only what you
  intend to ship.
- After completing and verifying a requested fix, commit only the files related
  to that fix and push them to `origin/main` without waiting for a separate push
  instruction. Preserve unrelated working-tree changes and never include them.
- Multiple agents may push concurrently; if a push is rejected, do
  `git fetch origin main && git rebase origin/main` then push again.
- Don't open a PR unless asked.
