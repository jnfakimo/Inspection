# Shared UI and operations workflow — Phase 1

> 2026-10-05 integration update: the draft PR candidate now starts from `main` at `f08ea7638db04732fe553c0fd7b65d1dce1f86ea`. The earlier checkout and publication notes below record the work's history; current verification and scope are summarized in the final sections of `PHASE1-QA-RESULTS.md` and `SHARED-UI-PHASE-1-DEVLOG.md`.

## Delivered scope

This first slice introduces a reusable, theme-token based status and data-state foundation and applies it to the V2 operations dashboard and SYS-03 patrol inspection records. It preserves the existing V1 static pages, V2 export architecture, authentication gates, permission checks, API actions, and data contracts.

The isolated checkout is based on `069b2a2e66c24ef7a5332a2a70ecb9e7b1e6196c`. A read-only GitHub connector confirms `main` is now `f08ea7638db04732fe553c0fd7b65d1dce1f86ea` (2026-10-05 08:55:36 UTC), 10 commits ahead and 0 behind the local base. GitHub's compare API reports seven changed paths since the base. Two overlap this patch: `package.json` (same `test` script line; upstream also added permission-revocation/account-approval checks) and `Obsidian/04-開發與部署.md` (our entry is near the top; upstream additions are at the end, so the hunks are separate). Upstream-only changes include a permission-revocation migration/test and three guard-handover files; this patch does not edit those files. The package script requires a deliberate merge preserving both test lists. No rebase or cherry-pick was performed; the current working tree remains based on the local snapshot pending dependency approval and integration review.

- `web/components/operation-states.tsx` and `.css` provide shared accessible notices and loading/empty states with `status` / `alert` announcements and theme-derived colors.
- `web/app/dashboard-client.tsx` uses the common notice for initial loading and recoverable errors, checks the selected date interval, exposes the active quick-range state, and labels the data time window.
- `web/app/dashboard.css` reflows the dashboard into a single full-width panel on tablet and phone sizes, makes quick ranges and dates touch-friendly, and wraps the refresh metadata.
- `web/lib/debounce-task.ts` coalesces bursty date changes; the dashboard uses it with a 250 ms wait and ignores stale responses from earlier ranges. Manual refresh cancels a pending debounce so it cannot issue a duplicate request.
- `web/lib/debounce-task.test.ts` exercises burst coalescing and cleanup without connecting to Supabase or using production data.
- `web/app/systems/[system]/[module]/patrol-workspace.tsx` clarifies initial loading and empty results, uses native required-field validation, prevents repeated saves, disables closing while a save is in progress, resets a canceled draft, and distinguishes a saved record from a failed list refresh.
- `web/components/admin/shared.tsx` adds an optional disabled close action to the shared dialog API. Existing dialogs retain their current behavior unless they opt in.

No database, authorization, integration endpoint, or server route changed. The Next.js app uses static export (`output: 'export'`); new integrations must continue through the existing approved API boundary and cannot depend on a Next server route running on Pages.

## Current source-of-truth inventory

`web/lib/modules.ts` is the current V2 system and module registry. It contains SYS-01 through SYS-13 and 66 routed modules, plus a permission-only handover approval entry. The domains include administration/personnel, repair/work orders, patrol, handover, equipment, maps, vehicles, meeting rooms, official documents, market analytics, the operations dashboard, market board, and vehicle tracking. Older statements in `ARCHITECTURE_V2.md` about only eight systems and 48 modules are stale and should be updated in a separately scoped documentation pass. V1 standalone pages remain active and must be included in migration planning.

The dashboard's existing `dashboard_layouts`/`dashboard_layout_versions`/`dashboard_layout_items` settings are shared published layouts. The parent layout uses a unique `layout_code` and published version; items are keyed by version and widget. There is no `user_id` or `role_id` scope in this schema, and its current read policy permits authenticated reads while write policies depend on `can_manage_dashboard_layout()`. V2 reads the published `operations_main` version. This phase only fixes how that shared layout renders across viewports; it does not save personal preferences or let one user overwrite a shared layout.

Personal card choice, order, size, and chart/table display require a scoped design and a database migration before implementation: add user-owned preference records (or an equivalent strictly scoped profile field), define default/fallback behavior, enforce owner access in RLS/API authorization, and keep admin-published defaults distinct from user overrides. Test two users and role boundaries before rollout. No live database was changed in this phase.

The current operations dashboard does not include fruit and vegetable prices. SYS-10 market analytics and SYS-12 market board are the existing pricing surfaces. `MarketExecutiveBoard` already shows a source name and latest market date, pages its table at 14 rows, limits automatic refresh to at least five minutes, suppresses overlapping refreshes, and renders API error, stale-shape, and no-row states. The feed includes source ID/code/name, latest/previous market date, refresh intervals, and summary/trend/table data. The UI does not expose a separate upstream observation timestamp or explicit market-closed/holiday state today; do not infer either from missing rows. It also does not contain a prediction model.

## Migration checklist for each later module

1. Keep the existing route, authentication, permission decision, and backend action intact.
2. Adopt shared page heading, action placement, primary/secondary button behavior, status badge, notice, form validation, loading/error/empty states, and cancellation rules.
3. Verify first-task completion at phone, tablet, and desktop widths in portrait and landscape; test touch targets and keyboard focus as well as appearance.
4. Exercise retry, back navigation, duplicate submission, cancel/close during pending work, empty data, and failed API responses with safe test data.
5. Record simulated-browser results separately from real-device verification.

## Integration boundary and follow-up priority

The platform is intended to grow beyond patrol and repair into personnel, equipment operating state, and energy management. This phase establishes UI patterns only; it does not claim those integrations exist or display fabricated live measurements. Later integrations should share a visible source label, source/device identifier, observation timestamp, freshness/expiry state, and disconnected/error state, while preserving the source system's authority and permission boundary.

For market data, retain the existing source identity and trade-date metadata, and add authoritative observation time and an explicit trading-calendar/status signal before labeling a feed stale, missing, or closed. Official Price1 upper/middle/lower prices are volume-band weighted averages, not OHLC or simple high/low prices; preserve unit exceptions such as box-priced items. Existing manual percentage scenarios are not statistical forecasts. Keep realized wholesale prices separate from any future forecast view, which must identify its model, source grain, and forecast horizon. A real forecast requires traceable market × crop/code/variety × unit observations; current same-name aggregations and 90-day raw code-level artifacts may not be adequate. If prices are promoted into the main operations dashboard, use a permission-checked, cached summary/feed boundary rather than having each dashboard card independently fetch full history.

Suggested order:

1. SYS-02 repair/work orders: standardize list, assignment, status change, validation, and feedback.
2. SYS-05 equipment: establish canonical equipment identity, operating-state source and freshness, then migrate maintenance/asset views.
3. SYS-01 personnel: align staff identity and visibility while preserving admin-only actions and record history.
4. Energy management: add a real module only after an approved authoritative source, access boundary, identifiers, and stale/offline semantics are defined.
5. Migrate remaining SYS-03 patrol, SYS-04 handover, SYS-06 structure maps, SYS-07/13 vehicles, SYS-08 meetings, SYS-09 official documents, SYS-10 analytics, SYS-12 public board, and the V1 static pages in bounded workflow slices.

## Final verification update — 2026-10-05

This section supersedes the earlier dependency-blocked and visual-QA-pending notes below. Upstream main `f08ea7638db04732fe553c0fd7b65d1dce1f86ea` has been reconciled file-by-file into this working tree: five files match the remote blobs, and `package.json` plus the Obsidian log contain both upstream and phase-one entries. The Git ref was not moved: HEAD remains `069b2a2e66c24ef7a5332a2a70ecb9e7b1e6196c`; no commit, push, PR, merge, or deploy was made.

- `npm ci` succeeded from the approved npm registry and official SheetJS CDN, installing 181 packages with 0 audit findings. The `esbuild` lifecycle script was skipped by npm's install-script policy; the locked Windows binary package is present.
- `npm run typecheck:v2` and `npm run build:v2` passed after upstream source reconciliation; Next.js generated 96 static pages.
- `npm run test:permission-revocation` passed 3/3. `npm test` ran through many checks, then stopped at `test:admin-api` when esbuild was denied access to a path outside the workspace by filesystem sandboxing. Separate API checks that use the same esbuild path were blocked for the same reason; no escalation or path workaround was used. See `PHASE1-QA-RESULTS.md` for the final rerun table.
- A `lint` script is not defined in the root `package.json`.
- Local visual QA used the Codex In-app Browser at `127.0.0.1:3100` and a local fixture server at `127.0.0.1:55321`; the temporary `/phase1-qa/` route bypassed normal auth only while rendering a fake `local-qa-user` profile. The dashboard and Patrol Records page were checked at desktop 1280×800, tablet portrait 768×1024 and landscape 1024×768, and phone portrait 390×844 and landscape 844×390. Touch emulation was enabled for tablet/phone sizes. Every final document `scrollWidth` equalled its `clientWidth` (phone portrait: 375 CSS px content in a 390 px viewport with a 15 px scrollbar).
- Patrol checks covered loading, empty, 503 error, required equipment, required abnormal note, cancel/close, successful local fixture response, and a rapid double click. The double click emitted one `create_inspection` request; the in-flight form actions were disabled. The mock returns an empty list after create and stores no persistent data. Navigation from the temporary page to the app root correctly reached login; browser back restored the temporary page. Permission isolation across real accounts was not exercised.
- A first experimental CSS adjustment caused a mobile date-input overflow; it was reverted. The original touch overlay was rechecked at 390×844 with `scrollWidth=clientWidth=375` and aligned date-field bounds, so the final production diff contains no date CSS change.
- Captured browser screenshots for each responsive pass are present inline in the task's CUA output. This runtime did not expose a supported local binary-export path for those in-memory captures, so no screenshot path or Library ID is claimed. The viewport and state record is in `PHASE1-QA-RESULTS.md`.
- The QA-only route, local mock server source, and temporary config override are removed/restored before the final production build. No production database, credentials, external APIs, or user data were used.

## Verification status

- Passed: local debounce/cancel tests; security audit sanitization; fail-closed permission checks; auth consistency; app navigation; patrol session/check-in; shared button and input/select checks; page-heading consistency; market rotation, rollup-performance, stock-signal, command-center, and interactive-dashboard checks.
- Blocked by absent workspace dependencies: V2 typecheck (`tsc` unavailable), V2 build (`next` unavailable), and the admin API check (`esbuild` package missing). `node_modules` is absent. A lint script is not defined in the root package scripts. The full suite was not run past those dependency-blocked checks.
- Visual browser QA was not run because the V2 app cannot be built in this workspace. Phone/tablet/desktop layout rules were inspected in source; simulated-browser and real-device verification remain outstanding and are not claimed as passed.
- Safe performance baseline from source inspection: each dashboard refresh starts 7 parallel query/RPC operations; the initial mount also makes up to 2 queries to read the shared layout and its items. Before this change each date edit scheduled a refresh; a local synthetic test of 3 rapid edits inside 250 ms verified one scheduled load instead of 3 (at most 7 runtime operations instead of 21). Stale in-flight responses are ignored, but not canceled at the backend.
- One unmeasured follow-up candidate: `dashboard-client.tsx` statically imports Chart.js and `react-chartjs-2`, including when a user's layout hides its chart widgets. Splitting this bundle should be considered after dependencies are available so the bundle-size and first-render difference can be measured and its loading/error state reviewed.
- No production traffic, high-concurrency test, CPU/DB measurement, or upstream-market request was run.
- Typecheck/build: dependency directory is absent in the workspace; do not infer a successful build until dependencies are available.
- Visual review: desktop/tablet/phone viewport simulation is planned; physical-device coverage remains separate and cannot be claimed from browser simulation.
