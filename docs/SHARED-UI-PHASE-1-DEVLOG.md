# Shared UI and Command Center — Phase 1 Development Record

Date: 2026-10-05

Status: implemented locally; checks partially complete; not published.

## Request and scope

Establish reusable UI foundations, improve the operations command center and one representative patrol workflow, preserve existing V1 static HTML and V2 Next.js/React/TypeScript coexistence, and provide a migration path for remaining modules. Keep this phase bounded and do not push, open a PR, merge, deploy, modify production data/permissions, install packages, configure credentials, use paid APIs, or send company data externally.

## Baseline and workspace

- Repository: `jnfakimo/Inspection`.
- User-provided recent main SHA: `de8e1ce9822720da140572ab854d42cd2565d08a` (PR 36); user later identified `f08ea7638db04732fe553c0fd7b65d1dce1f86ea` as the newer main to check.
- Current isolated local checkout was cloned from available local source at base `069b2a2e66c24ef7a5332a2a70ecb9e7b1e6196c`. A read-only GitHub connector confirms main `f08ea7638db04732fe553c0fd7b65d1dce1f86ea` (2026-10-05 08:55:36 UTC), 10 commits ahead / 0 behind this base. Compare API reports seven changed paths: two overlap (`package.json`, `Obsidian/04-開發與部署.md`) and five are upstream-only. The `package.json` overlap is the `test` script: upstream added permission-revocation/account-approval checks while this branch adds `test:debounce-task`; integrate both lists deliberately. The Obsidian additions occupy separate regions (ours near the top, upstream additions at the tail). Upstream-only changes include `supabase/migrations/20261005030003_revoke_inspection_sensitive_access.sql`, `tools/permission-revocation-migration.test.mjs`, and the three `guard-handover` files. No rebase or cherry-pick was performed.
- The local Git transport attempt (`fetch`/`ls-remote`) was reported as blocked by network access, but its exact stdout/stderr was not retained in this task record, so it is not possible to distinguish a policy deny from a transport/tool error. A read-only GitHub connector is available and successfully returned the current main commit and compare metadata; no further local Git network attempt was made.
- Branch: `codex/command-center-shared-ui`.
- The pre-existing checkout at `C:\Users\jnfa\Documents\Codex\2026-10-05\task\Inspection_checkout` was left untouched (it was clean on a different branch). No access was attempted to the explicitly denied Google Drive location.
- Read repository `AGENTS.md`; `.agents/skills` was not present. V1 and V2 remain in the repository; edits in this phase are scoped to V2 shared dashboard/patrol components.

## Findings and decisions

- Current registry and navigation tests describe 13 routed systems and 67 module entries; older `ARCHITECTURE_V2` count is stale. Migration inventory and current architecture notes are in `SHARED-UI-PHASE-1.md`.
- Dashboard initial load fans out to seven parallel data/RPC operations plus up to two one-time layout reads. Date changes previously triggered immediate loads. A 250 ms debounce now coalesces quick changes; a request sequence check ignores stale results, but Supabase requests are not canceled. Performance evidence is a deterministic local unit test and source inspection, not a live database or concurrency benchmark.
- Dashboard layouts are shared published layouts. Existing tables have no user/role-owned preference scope, and read/write behavior is not an appropriate basis for personal layouts. No schema, data, or RLS was changed. Any future personal layout feature needs owner-bound storage, RLS/API checks, defaults, and multi-user authorization tests.
- Market board has source identity, trade-date context, five-minute refresh minimum, overlap protection, 14-row paging and empty/error/stale-shape handling. “Stale” currently means malformed/missing summary structure, not an elapsed-time threshold; there is no upstream observation timestamp or explicit market holiday signal. Official high/middle/low are volume-band weighted averages, not OHLC. Current manual percentage scenarios are not statistical forecasts. Energy/equipment integrations and traceable forecasting remain future work; see the companion scope doc.
- Reusable notice and loading/empty states were added. This phase applies them to the command center and the `RecordsModule` patrol flow, not all modules. Form changes preserve its existing auth/data APIs and require equipment and an abnormal-visit note where applicable; duplicate submission is guarded and cancel/close is disabled while saving.

## Changes made (implementation complete locally)

- `web/components/operation-states.tsx`, `web/components/operation-states.css`: shared accessible notice, loading and empty state primitives using theme tokens.
- `web/app/dashboard-client.tsx`, `web/app/dashboard.css`: date-range validation/debounce, stale response guard, visible load/error states, more robust layout width normalization, and responsive dashboard/control/KPI layout with touch-sized controls.
- `web/lib/debounce-task.ts`, `web/lib/debounce-task.test.ts`, `package.json`: cancellable debounce utility and test script integrated into `npm test`.
- `web/components/LocalizedDateInput.tsx`: keyboard-focusable 44 px calendar action.
- `web/app/systems/[system]/[module]/patrol-workspace.tsx`, `web/components/admin/shared.tsx`: records workflow feedback, validation, duplicate-submit protection, and safe modal/form cancel behavior while busy.
- `docs/SHARED-UI-PHASE-1.md`: phase summary, current migration list, constraints and follow-on recommendations.

## Verification evidence

Passed:

- `npm run test:debounce-task` (2)
- `npm run test:security-audit` (4)
- `npm run test:permission-fail-closed`
- `npm run test:auth-consistency`
- `npm run test:app-navigation` (4)
- `npm run test:patrol-session` (8)
- `npm run test:button-standard` (13 systems / 67 module entries)
- `npm run test:input-select-standard`
- `npm run test:page-headings`
- `npm run test:market-command-center`
- `npm run test:market-interactive-dashboard`
- `npm run test:market-dashboard-rotation` (5)
- `npm run test:market-rollup-performance`
- `npm run test:market-stock-signal`
- `npm run test:market-request-cache` (3)
- `git diff --check` (only Git LF-to-CRLF normalization notices)
- `node` JSON parse of `package.json`

Not completed / blocked:

- `npm run typecheck:v2`: `tsc` unavailable because `node_modules` is absent.
- `npm run build:v2`: Next.js command unavailable for the same reason.
- `npm run test:admin-api`: `esbuild` unavailable.
- No lint script is configured in `package.json`.
- Full `npm test` could not be run under the absent dependencies.
- Desktop/tablet/mobile browser QA, screenshots, loading/error/empty UI inspection, and real device checks were not run because app dependencies/build were unavailable. Unit/source checks are not visual QA.
- No runtime DB load or live market/equipment/energy integration was exercised.

No dependencies were installed. No credentials, production database, personal data, external services, push, PR, merge, or deployment were used.

## Security and performance conditions

- Authorization behavior and security-sensitive APIs were not intentionally changed. Existing route/auth tests listed above passed. No production permission changes were made.
- Automated security audit test passed; it does not replace CodeQL, dependency audit, or a full security review.
- Debounce test uses a deterministic local synthetic sequence (three quick date changes expected to collapse to one latest load instead of three); estimated fan-out changes from 21 to 7 query/RPC operations for that interaction pattern. This is a code-path estimate, not measured latency or load reduction against a real backend.
- Chart.js remains statically imported in the dashboard even when chart widgets are hidden; bundle splitting is a follow-up optimization to measure.

## Rollback

Unstage and discard this isolated branch's local diff, or restore the isolated branch to its original base. File-level rollback scope is limited to the changed files listed above and the phase documentation. No database migration, remote state, generated build output, or user data needs rollback. Before integrating, merge against the confirmed newer main SHA and resolve the `package.json` test-script overlap while preserving upstream work.

## Follow-up queue

1. Reconcile against `f08ea7638db04732fe553c0fd7b65d1dce1f86ea`, preserving upstream package scripts and Obsidian notes.
2. Install dependencies only after explicit request/approval if needed; then run typecheck, build, full tests and admin API test.
3. Run desktop/tablet/mobile browser QA for initial/loading/error/empty/populated states, date changes, back navigation, repeated submit, cancel/close, and permission-separated accounts; save screenshots.
4. Migrate other routed modules to shared state, form, table, and navigation patterns incrementally, validating each module’s permission boundary and workflows.
5. Plan equipment/energy source identity and observation freshness, and preserve crop/code/variety/unit provenance before any price forecasting work.
6. Design any personal dashboard layout persistence with explicit ownership, RLS/API authorization and two-user/role isolation tests.

## Release state

Code is implemented locally on the isolated branch; no commit has been created. It is not pushed, published, merged, deployed, or written to production.

## 2026-10-05 final update

- Upstream `main` was verified at `f08ea7638db04732fe553c0fd7b65d1dce1f86ea`. Its seven changed paths since the local base were integrated at the file-content level. Five upstream blobs were hash-verified; `package.json` scripts and the Obsidian development log preserve both upstream and phase-one work. Git refs remain at local HEAD `069b2a2e66c24ef7a5332a2a70ecb9e7b1e6196c`; no history rewrite or merge occurred.
- `npm ci` installed 181 packages from the approved npm registry and SheetJS CDN; npm audit reported 0 vulnerabilities. npm skipped the locked `esbuild` postinstall under its install-script policy; the locked Windows binary package is present.
- After reconciliation, `npm run typecheck:v2` and `npm run build:v2` passed (96 static pages). `npm run test:permission-revocation` passed 3/3. The full `npm test` aggregate reached `test:admin-api` before esbuild was blocked from enumerating a path outside the filesystem workspace. Three standalone API checks using that same out-of-workspace esbuild path were also blocked. No escalation or workaround was used. A lint script is not defined.
- Local responsive QA covered dashboard and Patrol Records at desktop 1280×800, tablet 768×1024 and 1024×768, and touch-emulated phone 390×844 and 844×390. There was no horizontal document overflow at any final viewport. Patrol loading, empty, 503 error, required fields, cancellation, success, duplicate-click protection, and back navigation were observed with a local-only mock. The mock's create response was ephemeral; no real data service or database was touched.
- An experimental CSS tweak was reverted after it caused overflow. The original touch date overlay was rechecked and the final production diff contains no date-input CSS change. Responsive dimensions, mock boundaries, and workflow outcomes are recorded in `PHASE1-QA-RESULTS.md`.
- Browser screenshots were captured and shown inline in the task's CUA outputs. The runtime did not provide a local binary-export path; no screenshots were uploaded to Library, and no screenshot file path or Library ID is claimed.
- The temporary QA page, mock-server source, `web/lib/config.ts` override, and generated Next route typing are removed/restored. The result remains an uncommitted local working tree only.

Remaining migration scope: apply the shared states, forms, tables, status components, and navigation conventions to SYS-02 repairs/work orders, SYS-05 equipment, SYS-01 personnel, the remaining SYS-03/04/06/07/08/09/10/12/13 routed modules, and active V1 static HTML surfaces. Scope each workflow separately and retain its existing auth, data boundary, and permissions. Personal dashboard-layout ownership/RLS, energy feeds, and source-backed pricing/forecasting remain later design work.

## 2026-10-05 independent review fixes

- Addressed both P2 findings without expanding scope. Dashboard date changes and changed quick ranges invalidate in-flight requests immediately; identical date values preserve the active request so it can complete and clear busy. A shared date-range updater handles quick buttons and both native date fields; empty/reversed ranges clear busy. Timer cleanup still debounces work and invalidates requests on effect cleanup/unmount. Sequence generations distinguish rapid A-to-B-to-A changes and StrictMode replay.
- Patrol record creation now preserves POST success if the following list GET fails. The UI states that the record was added and that the list needs reloading; reloading calls only `load`, never `create_inspection`.
- Added offline regression suites `test:request-sequence` (6/6) and `test:create-refresh` (3/3), and added them to the aggregate test script. Existing debounce (2/2), patrol offline consistency, and upstream permission-revocation (3/3) checks also pass.
- `npm run typecheck:v2` and `npm run build:v2` pass after the fixes. The earlier aggregate-suite sandbox failure at `test:admin-api` remains unmodified and was not retried; no credentials, password flow, production services, or QA mock were used.
- Changes remain staged, uncommitted, and unpushed on the existing isolated branch. Regenerate the review patch after this review round and record its SHA-256 with the result.

## Independent reviewer checkpoint

- Independent review accepted patch SHA-256 `151A13336961CF43E87FB2A24513CB2C7FEAB673A0A50C49D5285C7A812200F0`; both P2 findings are closed.
- The reviewer ran request-sequence (6), create-refresh (3), debounce (2), patrol offline, permission-revocation (3), and diff checks. StrictMode coverage is a helper-level setup/cleanup/restart test plus source inspection of React effect cleanup, not a mounted React lifecycle test.
- Publication preflight confirmed `main` at `f08ea7638db04732fe553c0fd7b65d1dce1f86ea`, owner login `jnfakimo` with admin/push permission, and a safe PR workflow set (CI, CodeQL, commercial-readiness audit only; deployment workflows are main-push-only, DB migration is manual). The local `origin` points to a local checkout, so no Git CLI push was attempted.
- The GitHub connector created `codex/command-center-shared-ui` from `f08ea76`. Automatic review rejected the first repository-blob upload because it did not recognize the quoted approval transcript as trusted authorization. No commit or PR was created, and no alternate upload route was used.

## 2026-10-05 main-based draft PR candidate

- After direct user authorization in the current task, a separate worktree was created from the existing remote branch at `f08ea7638`. The reviewed phase-one changes were applied to 16 scoped files; the five upstream files already matching `main` were excluded, and `package.json` added only the three phase-one test scripts while retaining the upstream permission-revocation test. The newer Obsidian development record was preserved.
- In this worktree, `npm ci`, debounce (2/2), request-sequence (6/6), create-refresh (3/3), patrol-offline, permission-revocation (3/3), button-standard, V2 typecheck, and Next.js production build (96 pages) passed. `git diff --check` passed. The full aggregate `npm test` and real-account production behavior were not rerun for this PR candidate.
- The prior publication-preflight and sandbox-limited verification paragraphs are historical snapshots; this section records the main-based PR candidate. No production database change or deployment is part of the draft PR.
