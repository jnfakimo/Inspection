# AGENTS.md — 臺北農產 巡檢/報修/派工系統

> Instructions for AI coding agents (OpenCode, etc.) working in this repo.
> Human setup lives in `README.md`; deeper context in `PROJECT_CONTEXT.md`.

## 協作角色與測試責任（2026-09-07 使用者指定）

- 以資訊工程師角色主動完成問題定位、修正、測試與結果驗證；可由代理執行的工作由代理自行完成。
- 不要反覆要求使用者執行測試、重試、貼截圖或確認檔案；先使用現有工具、檔案、日誌及可存取環境取得證據。
- 只有必須由使用者完成的登入／驗證碼、授權，或代理確實無法存取的設備操作，才請使用者協助；先說明已嘗試的方法與具體阻礙，並一次整理最少必要步驟。
- 未能驗證的項目明確標示「未驗證」及原因，不以推測宣稱成功；測試通過後直接回報結果，不再要求使用者重做相同測試。
- 本規範不授權繞過權限、變更安全設定或執行未經授權的破壞性操作。

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
supabase/templates/     # 認證信件的繁中範本（見該目錄 README；**不要**跑 config push）
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
→ `equipment_lifecycle.sql` → `patrol_shifts.sql` → `checkin_logs.sql` → `dashboard_layouts.sql` → `market_analytics.sql` → `system_access_seed.sql`
→ `audit_login_events.sql` → `meeting_rooms.sql` → `meeting_booking_change_requests.sql` → `meeting_booking_notifications.sql` → `vehicle_dispatch.sql` → `vehicle_tracking.sql`
→ `rls_hardening.sql` → `rls_hardening_login_fix.sql`
→ `supabase/migrations/20260806020000_full_commercial_hardening.sql`
→ `supabase/migrations/20260806023000_atomic_repair_completion.sql`
→ `supabase/migrations/20260806024000_query_performance.sql`
→ `supabase/migrations/20260806025000_disable_insecure_error_threshold_cron.sql`
→ `supabase/migrations/20260806026000_client_error_monitoring.sql`
→ `supabase/migrations/20260806027000_permission_fallback_alignment.sql`
→ `supabase/migrations/20260806028000_workorder_equipment_scope.sql`
→ `supabase/migrations/20260806029000_workorder_close_sign_scope.sql`
→ `supabase/migrations/20260806030000_floorplan_storage_scope.sql`
→ `supabase/migrations/20260806031000_notification_log_scope.sql`
→ `supabase/migrations/20260806032000_disable_email_lookup_rpc.sql`
→ `system/sql/pii_deidentify.sql` → `permanent_data_protection.sql`.
`permanent_data_protection.sql` must be applied last. Production data is append/update/
deactivate only: never reset the database, truncate tables, or physically delete personnel.
RLS is enforced in production. Bootstrap `allow_all_for_now` policies apply only to
`authenticated`; the commercial hardening migrations replace them with row-scoped
rules. Storage buckets: `floorplans`, `repair-files`, `handover-attachments`,
`vehicle-dispatch-files`, `inspection-photos` (all private; signed URL access
only for authenticated active users).

**Backups** (verified 2026-09-06): the cloud organization now shows Pro and the
Dashboard lists seven daily physical backups; PITR is not enabled. Platform
backups do not include Storage objects. `trg_prevent_removal` only stops
DELETE/TRUNCATE — it does not protect against a bad UPDATE.
`.github/workflows/database-backup.yml` dumps every `public` table plus Storage nightly
and uploads it AES256-encrypted, because this repo is public and artifacts are world-
readable. Restoring is manual, dry-run unless `--execute`, and never deletes rows.
Manifest v2 checks each Storage object's SHA-256 and size; encryption is verified
by decrypting and comparing the archive before upload. Restore requires an explicit
target project, preserves raw JSON numbers, and rejects nonempty tables without a
primary key before any writes. This is not a complete application restore drill.
**Auth accounts are deliberately out of scope** — after a full restore nobody can log in
until an admin recreates them. Full procedure: `docs/DATABASE_BACKUP_RECOVERY.md`.

## Conventions (follow these)
- **Match the surrounding style**: cyberpunk dark theme. Core vars: `--bg:#020b18`,
  `--cyan:#00d4ff`, `--green:#00ff9d`, `--amber:#ffb300`, `--red:#ff3b3b`; fonts
  Noto Sans TC + Rajdhani. UI text is Traditional Chinese.
- **Never hardcode a colour that carries text — there is no light-theme safety net.**
  V2 defaults to the **light** theme (`data-theme="light"`; the dark one is `"tech"`).
  `v1-layout.css` used to whitelist every class that needed flipping to a white
  background, but that list silently missed each new component, so on 2026-08-18 it
  was removed on the premise that components derive their colours from theme vars.
  **That premise is now load-bearing**: a hardcoded dark background added afterwards
  has nothing to catch it and renders dark-on-dark in the default theme.
  - Backgrounds: `var(--panel)` / `var(--panel2)` / `var(--bg)`. For a tint, use
    `color-mix(in srgb, var(--cyan) 8%, transparent)` — never a raw `rgba()` of the
    dark palette. Low-alpha accent tints (≤0.15) over a themed surface are fine.
  - Legitimate exceptions, all of which already exist: modal backdrops (a dark scrim
    is correct in both themes), blocks whose background **and** text colour are
    hardcoded together as a pair (e.g. the `<pre>` in `.admin-modal`), and viewer
    canvases that hold no text (`.plan-stage`, `.floor-canvas`).
  - Before pushing a style change, load the page with `data-theme="light"` and check
    text contrast is ≥ 4.5:1. This has already regressed once: `.dash-widget` was
    fixed on 08-18, had `rgba(2,11,24,0.7)` put back on 08-19 by a different agent,
    and shipped at 1.84:1 on the post-login landing page until it was caught.
- **Date inputs**: unified format is 西元 `YYYY-MM-DD` (datetime `YYYY-MM-DD HH:mm`);
  forms show a 填表日期 (today). Use the local `fmtDate()`/`todayISO()` helpers.
  **Always render date fields with `@/components/LocalizedDateInput`, never a bare
  `<input type="date">`** (and never hand-roll a text↔date type swap). An empty native
  date field is painted with the browser's own format hint, which in a Traditional Chinese
  environment comes out as the mixed 「yyyy/月/dd」. `LocalizedDateInput` shows 「年/月/日」
  while empty and only opens the native calendar on focus, so every date field looks the
  same on every machine. Date+time fields use `@/components/LocalizedDateTimeInput`
  (LocalizedDateInput + TimeSelect, emitting the same `YYYY-MM-DDTHH:mm` value), never
  `<input type="datetime-local">` — its `step="1800"` only constrained validation, so
  users could still type 08:17. `security:audit` now fails the build on native `date`,
  `datetime-local` and `time` inputs, including a dynamic `type={cond ? 'date' : 'text'}`
  swap, which is how one of these slipped through before.
- **Every user-facing string is Traditional Chinese.** Status codes, action codes and
  enum values are stored in English (`create`, `closed`, `pending`, …) but must never
  reach the screen raw — map them through a `Record<string, string>` label table next
  to the component, the way `ACTION_LABELS` in `AuditAdminV2.tsx` and
  `CASE_LOG_ACTION_LABELS` in `handover-workspace.tsx` do, and fall back to the raw
  value only so an unmapped code still shows something. This includes timeline entries,
  table cells, filter dropdowns and toast messages.
  Database column names must not appear in prose either — write 「已綁定場域位置」,
  not 「有填 location_id」. Identifiers belong in code and comments, not on screen.
- **The repair-request stat cards have one definition.** `repairRequestSummary()` in
  `supabase/functions/app-api/index.ts` feeds both the 報修案件 table page (`workorder_list`)
  and the 維修／派工／完工 system hub (`module_data`). Add or change a card there and both
  pages follow; never add one in a component. Before this, each side computed its own
  「top 3 statuses」 and the front end spliced in an extra card, so the two pages showed
  different cards from the same data — and the set silently changed as the data changed.
- **Shared V2 button standard (13 systems／63 modules)**: use `.primary-btn` for the main
  action, `.secondary-btn` for neutral or return actions, and `.danger-btn` for destructive
  or deactivation actions; append `.compact` when a dense table or toolbar needs the smaller
  variant. The aliases `.btn`, `.btn-primary`, and `.btn-danger` are kept aligned for legacy
  module code. Geometry, hover, disabled, focus, and light／tech theme colors are centralized
  in `web/app/button-standard.css` (loaded last by the root `layout.tsx`); do not create a new one-off
  button size or hardcoded text color for a matching action.
- **Time inputs**: always use `@/components/TimeSelect` (a 30-minute-step `<select>`),
  never `<input type="time">`. The native field's `step` only constrains validation,
  so users can still type 08:17, and its rendering (上午/下午 vs 24-hour) is decided by
  the browser locale, which made the same system look different on different machines.
  `TimeSelect` emits 24-hour `HH:mm`, matching the tables and the DB `time` columns, and
  keeps an off-step legacy value as an extra option so editing another field can't erase it.
- **Table Filters / Dropdowns**: Whenever creating a filter dropdown in a table header, use a combobox design (`<input list="..."><datalist>`) rather than a native `<select>`. This allows users to type to filter while providing a dropdown list. Ensure the `<option>` values in the datalist use the localized display labels (e.g. `緊急` instead of `urgent`), and update the filtering logic to match against labels so the UI shows Traditional Chinese properly.
- **可留白的資料下拉選單**：資料輸入欄位若允許空值，第一列必須是 `BlankSelectOption` 產生的真正空白值，不得自動代選第一筆，也不得用「請選擇」文字冒充空值。狀態切換、必要動作或表格篩選等本來就不允許空值的控制項不套用此規則。人員指派／排班／簽名清單一律先經 `selectableActiveUsers()`，不可只依 `status='active'`，以免已離職去識別化帳號重新出現。
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
- **Shared header actions**: V2 一般內容頁（共 13 大系統的 67 個子系統）頂列只保留三個
  帳號／入口動作：首頁、個人資料、登出；移除戰情儀表板、維修／派完工、駐衛警巡檢、
  電子交接簿與後台等跨系統按鈕，系統切換改由入口頁、系統頁與後台側欄承擔。
  首頁使用 `assets/system-icons/home-nav-icon.png`，個人資料使用
  `assets/system-icons/profile-nav-icon.png`，兩者為同一套生圖的藍／青色立體 ICON；
  登出維持文字按鈕。不可再以 emoji 或文字符號建立另一套。三個全螢幕圖資工具頁
  （3D 模型圖、平面／整合標記、立體巡檢雲臺）保留其必要的圖資工作連結，不加入
  一般頁的跨系統導覽列。此為使用者明確指定的新頂列標準；若未來要變更，需再次取得
  使用者明確要求。
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
  - **Exception, requested 2026-08-21**: V2 的 3D 模型圖
    (`/v2/systems/structuremap/floor3d/`) 的頂列**要**掛共用的六個動作，比照
    3D建模系統 (`/v2/systems/structuremap/modeler/`)。動作定義取自
    `web/lib/shared-actions.ts`（AppShell 用的是同一份）。這是使用者明確要求，
    不是誤把 V2 頁面當成 V1 的 `floor3d.html`——**請勿再以「全螢幕工具頁不掛導覽」
    為由還原**。V1 的 `floor3d.html` 不在此例外內，維持不掛。

## 駐警隊電子交接簿（SYS-04 `guard`，2026-09-11 訂）

- **巡檢排班是唯一來源**：班別、班別時段、預定巡檢時段（通報時段）與排定人員一律由
  `app-api` 的 `handover_guard_context` 解析，規則與 `web/lib/patrol-status.ts` 的
  `getPatrolShiftsForDate` 相同（班別名稱來自啟用中的 `patrol_shift_template`、每日時段來自
  `patrol_shifts`、夜班資料列存隔日、`patrol_shift_staff.workTimes` 優先於班別時段）。改一邊
  就要改另一邊。交接簿不能改排班，只能另記「實際值勤人員／代班說明」，兩者並列保留。
- 交接使用者不一定有 `sys_guardpatrol`，讀不到排班與打卡表，所以介接一律走伺服器端，
  前端不要直接查 `patrol_shifts`／`checkin_logs`／`patrol_shift_staff`。
- **寫入只走 app-api（service role）**：`guard_handover_logs` 對 authenticated 只開 SELECT。
  排班快照若允許前端權杖直寫，任何有交接權限的人都能偽造「排定人員」。
- 流程 `draft → submitted（交班簽名，快照當班巡邏打卡摘要）→ received（接班簽名，不得與交班人
  同一人）`；接班前交班人可撤回。狀態機同時由 `protect_guard_handover_log` trigger 把關。
- 主管每日簽核（`guard_handover_daily_approvals`）限隔日起、且當日已建立的交接全部完成接班；
  有班別未建立交接時必須填寫說明。簽核後當日全部鎖定。
- 主管簽核權限是子系統 `handover/guard-approve`，**必須在權限頁明確設為「允許」**：三層授權的子系統
  預設「沿用」大系統權限，但簽核是特權，`app-api` 的 `canGuardApprove` 只認明確允許（系統管理員自動具備）。
  頁面路由也要放行只有簽核權限的主管。駐警隊目前沒有任何 `unit_supervisor`，不可改回「依單位課長判斷」。
- **異常事件附件**（私有桶 `guard-handover-files`，2026-09-11）：格式不限、單檔 50 MB、每件事件 10 個；
  影片一律先在瀏覽器以 `web/lib/video-compress.ts`（canvas＋MediaRecorder，約 1 Mbps、長邊 1280px）
  壓縮再上傳，壓縮時間約等於影片長度。上傳只用 `guard_attach_prepare` 簽發的一次性上傳網址、讀取只用
  `guard_attachment_url` 的 10 分鐘限時網址，桶上**沒有**任何 authenticated 的 storage 政策；
  html／svg／xml／js 等可在瀏覽器執行的型別一律改存 `application/octet-stream`，預覽只開放圖片／影片／
  音訊／PDF。交班簽名或主管簽核後附件即鎖定；儲存交接時會把已移除事件的附件軟刪除。影片預覽依賴 CSP 的
  `media-src`（`tools/build-hardened-pages.mjs`）。畫面元件在 `guard-handover-view.tsx`，可單獨渲染檢查版面。
- **下拉選單**（`guard_handover_options`，2026-09-11）：異常事件類別、物品狀態、物品名稱、事件地點、通報對象
  都用 `guard-handover-controls.tsx` 的 `GuardCombo`：展開後第一列是空白輸入框，可填清單以外的內容，所以
  後端不再以固定清單驗證類別與狀態（類別 ≤40 字、狀態 ≤20 字）；數量可直接輸入 0–999。清單由主管簽核權限者
  （同 `canGuardApprove`，須明確允許）與系統管理員在「管理下拉選單」增修刪與排序，刪除為停用，改名與刪除都
  不回頭改已存檔的交接紀錄。主管簽核與清單維護的 app-api 動作**不經過** `handover/guard` 子系統檢查，
  各自檢查 `canGuardApprove`——否則只有簽核權限的主管會在門口被擋掉。
- **權限四層與系統清單的唯一正本**：授權順序是「角色×大系統 → 角色×子系統（`role_module_access`）→ 個人×大系統
  → 個人×子系統」，個人設定優先於角色範本，`inherit` 表示沿用上一層。大系統與子系統清單的正本只有
  `web/lib/modules.ts`：`m()` 是有頁面的子系統，`mp()` 是只有權限沒有頁面的項目（例如駐警隊主管簽核，
  放在 `permissionExtras`，不會長進選單與路由）。後台權限頁的欄位由它推導，兩支 Edge Function 的白名單、
  `system_access_seed.sql` 與存取資料表的 `system_key` 檢查條件則由 `npm run test:schema-contract` 比對，
  漏改任何一份都會在測試擋下來。新增大系統時：改 `modules.ts` → 補兩支 Edge Function 的清單 → 補 seed →
  補一支放寬 `system_key` 檢查條件的 migration。
- **三本電子交接簿同一種版型**：機電課、業管組、駐警隊內容不同，但外觀必須一致。共同版型只放在
  `handover-sheet.css`（`hs-*`：工具列、表頭、今日指標、班別卡片、內容區塊、簽名、主管簽核、當班標示、
  A4 紙張）與 `handover-sheet.tsx`（`HandoverIcon`、`HandoverSheetHeader`）。各本只在自己的 css 放本簿
  特有的區塊（駐警隊的巡邏打卡與附件、業管組的三級批核與點檢表、機電課的工作卡片與續辦），
  不得重新定義 `hs-*` 本身的外觀，也不得自備一份圖示表——`@media print` 內的紙本排版才可各自覆寫。
  `npm run test:handover-style` 會把這些規則擋下來。新增第四本交接簿時照同一套骨架接上即可。
- **app-api 依業務拆檔（2026-09-13 起，分階段進行）**：`supabase/functions/app-api/index.ts` 只負責驗證身分、
  計算權限與依序分派；業務 API 放 `handlers/<業務>.ts`，匯出 `handle<業務>Action(action, ctx)`，不屬於本業務時
  回傳 `null`。每個請求共用的內容用 `context.ts` 的 `AppApiContext` 傳入（不要再依賴 index.ts 的閉包變數），
  輸入清理放 `validate.ts`、稽核寫入用 `audit.ts`。每支 handler 附 `*.test.ts`，由
  `npm run test:app-api-handlers` 以假資料庫連線單獨測試。**新增的 API 一律寫進 handlers，不要再加進 index.ts。**
  搬移只能原樣剪貼，行為變更要另開 commit；新增 handler 檔時同步把它加入
  `tools/sync-local-edge-functions.ps1` 的必要檔案清單。已拆：公務車。
- **圖面標記大小**：立體巡檢雲臺與平面圖都提供「打卡點大小」拉桿，刻度一律是 0.5〜3 倍、預設 1 倍，
  兩張圖改一邊就要改另一邊，避免像 V1 的 floor3d.html 與 guardpatrol3d.html 那樣分岔。3D 走
  `FloorStack3D` 的 `markerScale`（以 ref＋獨立 effect 調整既有圓點的 scale，不重建場景）；
  平面圖走 CSS 變數 `--pin-scale`（OSD 會自行增刪覆蓋層節點，交給 CSS 才不必逐顆重算）。
- **授權畫面只有一種版型**：「人員精細授權」與「角色系統範本」都用 `permission-access-list.tsx` 的
  `GranularAccessList` 渲染（大系統卡片＋子系統下鑽），差別只有傳進去的資料。要調整版面請改那一支，
  不要在任一分頁另外做一套。
- **當班標示**：與業管組交接簿一致，綠色 `#10b981` 專指「目前當班」（外框、光暈、「當班中」脈動標籤；白字底用
  `#047857` 以維持對比），因此班別配色不使用綠色。當班與「巡檢進行中」由前端每 30 秒依 `work_from/work_to`、
  `patrol_from/patrol_to`（app-api 提供的絕對時間）判斷，班別交替時不必重新載入。

## V2 系統子頁標題規範（2026-08-27 訂）

- 13 大系統、67 個子系統的一般內容頁一律由 `AppShell` 自動插入
  `components/SystemPageHeader.tsx`，不得在工作區再手寫另一個系統級 `<h1>`。
- 標題頂端距共用頂列底部固定 **22px**；桌面版由 `.content.v1-content` 的 20px
  上內距加標題元件 2px 上內距構成，手機版則為 14px + 8px。不要用負 margin 或頁面
  專用覆蓋改變這個距離。
- 系統標題固定 **26px**、`var(--cyan)`；Logo 固定 **42×42px**，來源必須是
  `web/lib/modules.ts` 該系統的 `icon`，不可用 emoji、臨時圖示或子系統自行指定的替代圖。
- 桌面內容區左右內距固定 **24px**，標題元件不得再加水平 padding；因此未觸發
  `max-width` 置中時，Logo 左緣距視窗 24px，標題文字左緣為 **80px**（24 + 42 + 14px
  gap）。手機內容區左右內距 14px，標題文字左緣為 70px。日後新增一般內容頁沿用
  `.content.v1-content` 與 `SystemPageHeader`，不得以頁面專用 margin 改變此對齊。
- 標題結構固定為：系統名稱、系統代碼／子系統名稱、子系統說明。子系統自己的功能區
  標題只能使用 `<h2>` 以下，不得再與共用系統標題競爭。
- 三個全螢幕圖資工具頁是版型例外：`structuremap/floor2d`、`structuremap/floor3d`、
  `guardpatrol/map3d`。它們不套 AppShell，使用 `data-system-page-heading="compact"` 的
  緊湊頂列標題，但仍必須顯示對應系統 Logo、主題色與模組名稱。
- **交接紀錄首頁例外（2026-08-27 使用者指定）**：`/v2/systems/handover/` 直接呈現
  `records` 模組，大標題使用「交接紀錄」，識別行顯示「SYS-04 · 電子交接簿」；距離、
  字級、顏色與 Logo 尺寸仍完全沿用 `SystemPageHeader`，不可另寫一套樣式。
- **駐衛警系統入口（2026-08-27 使用者指定）**：`/v2/systems/guardpatrol/` 使用共用
  標題，說明固定取系統定義「巡邏點、打卡、排班、逾時通知與立體巡檢。」；四張功能
  縮放時四張桌面功能圖卡固定為 **269px × 200px** 並置中。瀏覽器縮放造成可用 CSS
  寬度改變時必須自動響應：寬版 4 欄、1100px 以下 2 欄並恢復滿寬、600px 以下 1 欄，
  禁止水平溢出。
- 新增／修改系統子頁後必須執行 `npm run test:page-headings`；此檢查固定盤點 13／67、
  正式 Logo、標題 token，以及 62 個一般頁首與 4 個全螢幕頁首的覆蓋關係。

- **67 個子系統圖卡（2026-09-11 更新）**：一般 `.module-grid` 與交接／駐衛警入口
  的子系統圖卡，桌面瀏覽器 100% 統一為 **269×200px**；標題沿用共用頁首規格（距頂列
  22px、26px、淺藍 `rgb(2, 132, 199)`、Logo 左側 24px、標題左側 80px、Logo 42×42px）。
  1100px 以下改兩欄、600px 以下改單欄，並恢復彈性寬度避免水平溢出。
- 維修／派工入口另有 7 張統計小卡，桌面維持單列並依主圖卡 80% 比例縮放；3 張流程
  主圖卡同樣固定為 269×200px，窄版依 900px／600px 斷點改為兩欄／單欄。

## 樓層平面圖的圖檔與效能（2026-08-28 訂）

- `floorplans` 儲存桶的原圖是 **4096×4015（約 1～2.3MB）**，但畫面最大只用到視窗寬度。
  客戶端目前會「下載原圖 → `getImageData` → 逐像素重畫 → `toBlob` 重新編碼 PNG」，
  實測桌機 Chrome 這段 **250～450ms**，手機約 3～6 倍。
- 已做的緩解：**手機／觸控裝置改讀 `mobile/`（1024px）**（比照 V1 `b1plan.html` 的
  `matchMedia('(max-width:768px),(pointer:coarse)')`）；**重畫後的 blob 依「路徑＋主題」
  LRU 快取 4 張**，切回看過的樓層不再重跑。
- 治本作法：用 `tools/build-floorplan-variants.py` 在**上傳時**就產生
  `light/`、`tech/`（已重畫完成）與 `desktop/`（2048px）、`mobile/`（1024px）四組衍生圖，
  客戶端直接下載對應主題的成品，零像素處理。腳本的 `to_light()`／`to_tech()`
  **必須與 `floor-stack-3d.tsx` 的 `preparePlanCanvas` 演算法一致**（light：alpha=0 略過、
  luma>232 轉透明、其餘塗黑；tech：alpha<64 轉透明），改其中一邊就要同步改另一邊。
- 兩個已驗證無效、不要再試的方向：`toBlob` 改 WebP **更慢**（PNG 116ms vs WebP 無損 293ms）；
  canvas 開 `willReadFrequently:true` 的 `getImageData` 沒有比較快（106ms vs 90ms）。
- `RF.png` 目前在儲存桶**沒有 `mobile/` 版本**，選圖邏輯取不到時必須退回原圖。

## V2 手機版版型規範（2026-08-28 訂）

- **頁首操作按鈕一律靠右**。`components/admin/shared.tsx` 的 `AdminHeader`（`.admin-page-actions`）
  在 **≤800px** 時，右側按鈕組為 `width:100%; justify-content:flex-end`。規則寫在
  `web/app/admin-workspace.css` 的 800px 斷點，**涵蓋所有使用 AdminHeader 的子系統**；
  新頁面不需要、也不應該再逐頁加同樣的宣告（`tools/system-page-heading-check.mjs`
  會擋下 `.admin-page-actions:has(...)` 這類重複的分頁規則）。
  另一種頁首 `.operations-panel-title` 本身就是 `justify-content:space-between`，按鈕已在右側。
- **不要用行內樣式排版**。`style={{...}}` 的優先序高於任何選擇器，media query 蓋不過去，
  頁面就再也無法只調整手機版。2026-08-28 一天內就被擋住三次（`LocalizedDateInput` 的
  原生日期欄位、會議室管理彈窗的按鈕列、巡檢排班的 `maxWidth:85%` 外框），全部改成 class。
- **手機版排版靠 flex-basis，不是靠 flex-wrap**。控制項「明明空間夠卻換行」時，先查
  `flex-basis`：`flex:1 1 auto` 會取內容寬度當基準，先佔滿一整行把後面的項目擠下去。
  巡檢排班的日期欄位就是這樣（basis 190px → 收到 72px 才排得進同一列）。
- **`display:contents` 的容器要先解掉才能分列**。`.operations-tool-row` 在寬版面用
  `display:contents` 把日期列與篩選列攤平成同一列；手機版要分成上下兩列，必須先把子容器
  改回 `display:flex`，否則所有控制項都是同一個 flex 容器的直接子項。
- **圖示一律收在 320px 以內**。系統 Logo 最大顯示尺寸是入口圖卡的 88px，Sprite 依格數換算
  （`equipment-structure-icons-ai.png` 4×4→512px、`topbar-nav-icons-ai.png` 2×2→256px）。
  用 `draw` 技能產生的圖多半是 1024～1254px、單檔 1MB 以上，**進版控前務必縮圖**；
  2026-08-28 就是因為沒縮，`/v2/systems/` 入口頁光圖示要載 2.6MB，全站 24 個圖示共 13.6MB。
  `tools/system-page-heading-check.mjs` 會擋下超過 200KB 的系統 Logo。
  縮圖用 Pillow 的 LANCZOS 重取樣即可；**不要用 256 色量化**——實測這批 3D 光澤圖示量化後
  在 88px 顯示時色差 RMS 達 5～17（可見的色帶），省下的容量不值得。
- **手機版驗證方式**：本專案的 V2 頁面多半要登入才看得到內容，改版型後請用
  `npm run build:v2` 產出的**實際 CSS chunk** 建立靜態重現頁，以 375px／320px／1280px
  量測元素座標與 `document.scrollWidth`（確認無水平溢出），不要只靠目視。
  重現頁務必把**基礎樣式 chunk 一起載入**——只載含新規則的那一個，會因為缺少
  `display:flex` 之類的基礎宣告而量到錯誤結果。

## V2 登入頁版型規範（2026-08-27 訂）

- `/v2/login/` 的白色登入圖卡在桌面以共用 `.login-card` 的 430px 基準做 **80%**
  整體縮放（實際視覺寬度 344px），Logo、文字、欄位、驗證碼與按鈕必須跟著同倍率
  縮放，不可只縮外框。
- 桌面登入頁固定使用 `100svh` 並禁止頁面水平／垂直溢出；瀏覽器 100% 縮放時，完整
  登入卡與頁尾必須同時位於可視區內且不得出現捲軸。短螢幕仍沿用既有高度斷點收斂間距。
- 80% 縮放僅適用登入、忘記密碼與重設密碼白色圖卡；`.account-apply-card` 是資料較多的
  帳號申請表，必須排除，維持自身的響應式寬度與捲動行為。

## 讀取存取稽核與資安告警（2026-08-21 訂）

- **資安告警不是資料庫觸發器產生的**。`security_alerts` 由 `audit-event` edge function
  在 5 分鐘視窗內判定「非互動高頻讀取」後建立（門檻：同一人同 IP ≥40 次非互動讀取、
  且跨 ≥8 個不同資源），而該函式**必須由前端主動呼叫**。
- **V2 的呼叫端是 `web/lib/access-audit.ts`**，掛在根版面（`ErrorTrackerMount`），
  以包裝 `window.fetch` 的方式攔截所有 GET／HEAD 的 `/rest/v1/*` 與
  `/storage/v1/object/*`。**新增頁面或查詢不必、也不該自己補呼叫**；在呼叫端各自加
  只會重複計數並破壞去重。
- **`details.user_initiated` 必須是布林**。偵測用嚴格比較 `=== false` 篩選自動化讀取，
  送成字串 `"false"` 會讓該筆永遠不列入判定——這種錯誤不會有任何徵兆，只會讓告警
  再也不觸發。`access_origin` 同理只認 `page_load` / `user_action`。
- 稽核自身的資料表（`audit_logs`、`security_alerts`）不列入記錄，否則開稽核頁會不斷
  自我產生紀錄。
- 回應中的 `security_action` 是**實際的資安控制**（大量讀取切斷），收到就要強制登出，
  不可以只當提示忽略。
- V1 的對應實作在 `system/theme.js` 的 `installReadAccessAudit`，payload 格式相同；
  兩邊改動要一起看，否則同一張表會混入兩種格式。

## 介面風格切換（一般版／科技版，2026-08-21 訂）

- **切換入口是右下角的浮動圖示，不是頂列的文字按鈕**。一般版顯示 🌙（點了切到科技
  版）、科技版顯示 ☀️，版位與外觀比照 V1 `theme.js` 的 `#themeToggleBtn`
  （右下 16px、44×44 圓鈕）。
- **V2 的實作掛在根版面** `web/app/layout.tsx`（`components/ThemeToggle.tsx`），所以
  **每一頁都自動有**，含登入頁與不套 AppShell 的全螢幕工具頁。
  **新增頁面不必、也不該再自己做一顆**，頂列不要再放主題按鈕。
- 兩版共用同一個 localStorage 鍵 `siteTheme`，V1 與 V2 互通。主題屬性由
  `layout.tsx` 的行內腳本在算繪前設好，元件只負責切換。
- **新增固定在右下角的元件時要讓出這顆鈕的位置**（`bottom: 70px` 起跳）。目前已讓位
  的有 `.f3-bottomright`（模型圖）與 `.mb-bottomright`（整合標記系統）。
- 這顆鈕的顏色**刻意不走主題 token**：它會疊在圖面與 3D 場景之上，需要自己有足夠
  對比，跟著 token 走會在深色圖面上消失。

## 圖資頁面的共同規範（模型圖／標記圖臺／雲台，2026-08-21 訂）

適用於任何呈現樓層平面或立體模型並在上面放標記的頁面：3D 模型圖、平面模型圖、
整合標記系統，以及日後任何用到同一批圖資的功能（雲台、巡檢圖臺等）。
**這些是共用資產，不要各自再抄一份**——V1 的 `floor3d.html` 與 `guardpatrol3d.html`
就是各寫一份之後逐漸分岔的前例。

- **全螢幕外殼**：`structuremap-floor3d.css` 的 `.f3-*`（頂列、`.f3-stage`、三個可收合
  浮動面板、底部右側的操作說明與 HUD）。頂列的六個共用動作取自 `lib/shared-actions`。
- **圖釘**：`structuremap-pin.css` 的 `.mb-pin` / `.mb-pdot` / `.mb-plab` / `.mb-lead`。
- **標籤一定要做防重疊排版**。密集樓層直接疊上去會糊成一片（B1 有 30 個標記）。
  規則：標籤可往上、也可往左右錯開，一律以引線指回圓點；`--lx`／`--ly` 決定位置，
  `--llen`／`--lang` 決定引線長度與角度；候選位置由近而遠嘗試，**真的排不下才拿掉該
  圖釘的 `show-lab`**（落回預設隱藏，滑過仍會浮現）。實作見
  `structuremap-viewers.tsx` 的 `layoutLabels`；3D 側是等效的螢幕空間剔除。
  平移、縮放、視窗改變都要重排，用 rAF 收斂成一幀一次。
- **兩種主題都要先預處理貼圖**，用 `preparePlanCanvas`／`preparePlanObjectUrl`
  （`floor-stack-3d.tsx`）：
  - `light`：近白視為背景轉透明、其餘塗黑。青色是烘在 PNG 裡的，
    **不要用 material.color 相乘或 CSS filter**——圖檔若是不透明白底，整片平面會變黑。
  - `tech`：保留原色，但濾掉 alpha < 64 的光暈。`renderNeon` 的發光是三道疊出來的，
    不濾掉會讓科技版的線比一般版粗一截（實測光暈像素是核心線的兩倍多）。
  兩邊用同一支函式，粗細才會一致；只處理其中一種主題就會再度不對稱。
- **OpenSeadragon 的縮圖顏色只能由選項給**（`navigatorBackground` 等），OSD 在建構時
  寫成行內樣式，CSS 蓋不掉。值一律讀主題 token，不要寫死。切換主題時要自己補寫一次
  行內樣式，選項只在建構當下生效。
- **凡是在「建場景／開圖當下」讀 `data-theme` 決定顏色的，都必須監看該屬性並重建**。
  three.js 的 `scene.background`、樓層板與邊線顏色、貼圖黑線重畫，OSD 的線稿重畫都屬
  此類：只讀一次的話，切換主題後畫面會停在舊主題直到重新整理。作法見
  `floor-stack-3d.tsx` 與 `structuremap-viewers.tsx` 的 `MutationObserver`，並把
  theme 列入該 effect 的相依。
  這個缺口 2026-08-21 之前一直存在，只是全螢幕工具頁沒有主題切換入口、切不了也就
  看不出來；切換鈕改為全站之後才顯現。
- **不可以用 `window.OpenSeadragon`**。它是 UMD 包裝，在打包環境走 `module.exports`
  分支、不會掛上全域，取 `.Point` 會丟 TypeError。請用 import 進來的命名空間。
- **覆蓋層的錯誤不可以用空 catch 吞掉**。平面模型圖曾因此從上線起一顆標記都沒畫出來，
  畫面只是「空的」，現場不會回報成故障。至少記到 console，整批失敗要顯示在畫面上。

### 上下游關係：3D建模系統是唯一的圖資來源

```
3D建模系統（modeler，DXF → renderNeon → floor_models.image_path）
        │
        ├─ 3D 模型圖      /v2/systems/structuremap/floor3d/
        ├─ 平面模型圖     /v2/systems/structuremap/floor2d/
        └─ 立體巡檢雲臺   /v2/systems/guardpatrol/map3d/
```

- **建模系統只有一個、檢視器有三個。上游改了，三頁都要一起確認**，反之新增檢視器
  也要回頭確認上游的產出符合下列假設。
- 檢視器對 `renderNeon` 產出的兩個硬性假設：**底是透明的**（該函式只 `clearRect`、
  從不填色），以及**線條顏色烘在圖檔裡**、無法在檢視器端用 CSS 或材質相乘改掉。
  淺色主題的黑線重畫（`recolourPlanCanvas`）就是建立在這兩點上。
- 改 `renderNeon` 的顏色、底色或 `TEXTURE_LONG_SIDE` 之前，請先讀該函式上方的註解。
  `recolourPlanCanvas` 已加保險絲：底圖若不透明會放棄重畫並在 console 留訊息，
  但畫面會退回青線，不是預期的黑線——**保險絲只防止畫面全黑，不會幫你同步**。
- 3D建模系統本身是**上傳與管理頁**，不是檢視器，因此維持 AppShell 版型，不套上面的
  全螢幕外殼；它的圖面只是匯入後的預覽。

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
- **Edge functions deploy themselves now.** `.github/workflows/deploy-edge-functions.yml`
  deploys only the functions changed by the push (type-checked with `deno check` first).
  Before it existed, `supabase/functions/**` changes shipped only when someone remembered
  to run `supabase functions deploy` by hand, and twice on 2026-08-20 the front end went
  live calling actions the deployed function did not have yet. Don't reintroduce a manual
  step; if a deploy must be rerun, use the workflow's `workflow_dispatch` input.
- Don't open a PR unless asked.

## Obsidian 開發紀錄

- 本專案的 Obsidian vault 是 repository 內的 `Obsidian/`；主要文件為 `04-開發與部署.md`、`05-待辦清單.md`、`06-發布前驗收表.md`、`07-資料庫備份與復原流程.md` 與 `08-資安告警原因與修正報告.md`。
- 每次完成程式、資料庫、資安或部署工作並取得驗證結果後，應在 `Obsidian/04-開發與部署.md` 追加一筆日期、變更摘要、驗證結果與 commit／workflow 證據；若待辦狀態有改變，同步更新 `Obsidian/05-待辦清單.md`。
- 資安事件與告警原因另同步至 `Obsidian/08-資安告警原因與修正報告.md`；備份／復原流程另同步至 `Obsidian/07-資料庫備份與復原流程.md`。
- Obsidian 只保存可公開於 repository 的開發紀錄，不得寫入 `SUPABASE_ACCESS_TOKEN`、service-role key、使用者密碼、Session、Cookie、私有 signed URL 或其他 Secret；必要時只記錄「已設定／已驗證」及遮蔽後的識別資訊。
- 若本工作階段沒有 Obsidian connector／技能，仍以 repository 內 Markdown 檔案完成同步；不要因技能未載入而跳過紀錄，也不要把 Secret 寫入 vault。
- `antigravity-obsidian` 技能的用途是連接／設定 Obsidian MCP，觸發詞是「連接 Obsidian」或「設定 Obsidian」；它不是每次開工都會自動寫入紀錄的 hook。一般開發任務完成後，代理仍必須直接更新上述 Markdown 檔案。
- MCP 註冊屬於本機 Codex 使用者設定，不放進公開 repository；本專案的公開同步來源固定是 `Obsidian/` 目錄。若 MCP 暫時不可用，直接以 Markdown 同步仍視為完成。
