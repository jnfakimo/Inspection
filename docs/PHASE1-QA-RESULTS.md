# Phase 1 QA results

Date: 2026-10-05

Branch: `codex/command-center-shared-ui`

Source baseline: `069b2a2e66c24ef7a5332a2a70ecb9e7b1e6196c`

Verified upstream `main`: `f08ea7638db04732fe553c0fd7b65d1dce1f86ea`

## Safe test setup

- Browser: Codex In-app Browser (Chromium), local app at `http://127.0.0.1:3100/Inspection/v2/phase1-qa/`.
- Mock: local Node fixture at `127.0.0.1:55321`; Supabase and weather URLs were temporarily overridden to localhost. No real Supabase, production database, weather service, external API, or credential was contacted.
- Profile: fake `local-qa-user`, manager-shaped fixture used only by the temporary test page. It had broad test-only visibility and did not represent or test a real account's authorization.
- Fixture modes: `empty` returned empty rows and one QA equipment option; `error` returned 503; `loading` inserted a 1.8 s response delay. Create returned a local success response and did not persist a record; subsequent reads remained empty.
- The temporary route, mock server source, and `NEXT_PUBLIC_QA_MOCK` config override were removed/restored before the production build.

## Responsive visual QA

Touch emulation was enabled for the tablet and phone viewports. `clientWidth` is lower than `innerWidth` by 15 CSS px due to the vertical scrollbar; no final viewport had horizontal document overflow.

| Page | Viewport (CSS px) | `clientWidth` / `scrollWidth` | Result |
|---|---:|---:|---|
| Command center | 1280×800 desktop | 1265 / 1265 | Pass |
| Command center | 768×1024 tablet portrait | 753 / 753 | Pass |
| Command center | 1024×768 tablet landscape | 1009 / 1009 | Pass |
| Command center | 390×844 phone portrait, touch | 375 / 375 | Pass |
| Command center | 844×390 phone landscape, touch | 829 / 829 | Pass |
| Patrol Records | 1280×800 desktop | 1265 / 1265 | Pass |
| Patrol Records | 768×1024 tablet portrait, touch | 753 / 753 | Pass |
| Patrol Records | 1024×768 tablet landscape, touch | 1009 / 1009 | Pass |
| Patrol Records | 390×844 phone portrait, touch | 375 / 375 | Pass |
| Patrol Records | 844×390 phone landscape, touch | 829 / 829 | Pass |

Patrol create-dialog bounds were 720×412 desktop, 592×491 tablet portrait, 720×412 tablet landscape, 327×495 phone portrait, and 657×351 phone landscape. In phone landscape the dialog content is 409 px tall inside a 348 px scroll area; scrolling reached the footer and kept Cancel/Submit visible.

The first experimental date CSS edit briefly placed the native input outside its wrapper. It was reverted. The original touch overlay was then checked with `pointer: coarse`: both native date-input rectangles matched their wrappers and mobile document width stayed at 375 CSS px. No date CSS change remains in the final diff.

## Workflow and state checks

- Dashboard: empty metrics and cards render; weather service failure displays a visible 503 recovery message. Initial loading was observed while the delayed fixture was pending.
- Patrol Records: loading indicator, empty-state copy, and 503 error feedback were observed. Errors did not masquerade as empty data.
- Form validation: equipment is required; selecting abnormal status also requires an abnormal note.
- Cancel: Cancel closes and resets the draft while idle. During save, close/cancel/fields/submit are disabled.
- Duplicate submission: rapid double click produced exactly one `create_inspection` POST in Chromium Network events. The button displayed a pending label; the UI returned a success notice after the local fixture responded.
- Navigation: the temporary page's 上頁 link reached the protected app root and redirected to login; browser Back returned to the temporary page. This exercised routing behavior, not a real authenticated session.
- Not covered: real-device testing, real-user permission separation/two-account isolation, or production service behavior.

## Screenshot evidence

Desktop, tablet, phone portrait/landscape, and the patrol dialog screenshots were captured from the live local browser during this task and appear inline in its CUA tool outputs. The browser capture API returned in-memory images but did not expose a local file exporter; Library upload therefore had no local image path to accept. No Library ID or local JPG path is claimed. The measurements and workflow results above are the retained, reviewable local QA record.

## Final code checks and independent review regressions

- Dashboard requests now receive a sequence token when they begin. Changed date values and quick ranges invalidate the active token synchronously, before the 250 ms debounce; identical range values leave it current so an in-flight request can complete and clear busy. Effect cleanup both cancels a pending timer and invalidates in-flight work, including unmount and StrictMode cleanup. Offline tests resolve an old request during the debounce window, resolve a request after unmount, exercise rapid A-to-B-to-A generations and same-valued repeated ranges, and check empty/reversed range validation.
- Patrol create and list refresh are now separate outcomes. After `create_inspection` succeeds, a failed inspections GET leaves a success-first message explaining that the list failed to refresh and can be reloaded. The create form is cleared/closed, and the reload handler calls only the list GET. Offline tests cover POST success/GET failure, a later GET-only retry, and POST failure.
- `test:request-sequence`: 6/6 passed. `test:create-refresh`: 3/3 passed. Existing `test:debounce-task`: 2/2 passed; `test:patrol-offline` passed; upstream `test:permission-revocation`: 3/3 passed.
- `npm run typecheck:v2` and `npm run build:v2` passed after these changes (96 static pages). No local mock route or app configuration was needed for these boundary tests.
- The full aggregate `npm test` remains incomplete: its prior run stopped at `test:admin-api` when esbuild attempted to enumerate a directory above the workspace and the filesystem sandbox denied access. That blocked step was not retried or bypassed. Lint has no configured script.

## Independent review checkpoint

- The independent reviewer accepted patch SHA-256 `151A13336961CF43E87FB2A24513CB2C7FEAB673A0A50C49D5285C7A812200F0` and closed both reported P2 findings.
- The reviewer ran the request-sequence (6), create-refresh (3), debounce (2), patrol offline, permission-revocation (3), and diff checks. The StrictMode case exercises the sequence helper's setup/cleanup/restart flow and the React effect cleanup wiring was inspected; it is not a mounted React lifecycle test.

## Publication preflight status

- GitHub connector confirmed public repository `jnfakimo/Inspection`, authenticated login `jnfakimo` with admin/push permission, and current `main` at `f08ea7638db04732fe553c0fd7b65d1dce1f86ea` (unchanged from the reviewed base). The local `origin` URL points to a local checkout path, so no Git CLI network push was attempted.
- A new remote branch `codex/command-center-shared-ui` was created from that `main` SHA. No commit, pull request, or workflow run exists on it.
- PR workflows inspected: CI, CodeQL, and commercial-readiness static audit. Pages and Edge deployments are limited to pushes to `main`; the database migration workflow is manual (`workflow_dispatch`). A PR will not trigger those production deploy or database workflows.
- GitHub connector blob creation for `package.json` was rejected twice by automatic review, which said it did not recognize the quoted approval transcript as trusted authorization for uploading repository source. No source blob or commit was created, and no alternate publication path was used.

## Main-based draft PR candidate (2026-10-05)

Following direct user authorization, the reviewed first-phase changes were integrated into a separate worktree based on `main` at `f08ea7638`. The local patch SHA-256 was confirmed as `06E302BF2B6075AAF7403302ECE516B0CB8A68A3EE5633BA4B8DB729D4444CF4`; only the 16 first-phase paths were applied, with upstream migration and guard-report changes preserved. The three new package test scripts were merged into the existing aggregate script.

Fresh checks in the integrated worktree passed: debounce 2/2, request-sequence 6/6, create-refresh 3/3, patrol-offline, permission-revocation 3/3, button-standard, V2 typecheck, Next.js 96-page build, and `git diff --check`. The earlier blocked aggregate `npm test` and real-account production behavior were not rerun. The publication-preflight section above records the earlier stopped attempt, not the state of the draft PR candidate.
