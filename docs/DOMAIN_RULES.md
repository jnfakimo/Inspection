# DOMAIN_RULES.md — 業務領域與資料規則

> 2026-10-15 自舊版 `AGENTS.md` 原文搬移（未改寫語意），供改動對應領域前查閱。
> 版型、色彩、共用元件標準在 [`AGENTS.md`](../AGENTS.md)；這裡只放業務、資料、權限與圖資規則。
> 舊版全文保留在 `docs/archive/2026-10-15-pre-unification/AGENTS.md`。

## 資料庫、備份與儲存桶

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

## 駐警隊電子交接簿、權限、app-api 與行情匯入


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
  `tools/sync-local-edge-functions.ps1` 的必要檔案清單。已拆：公務車、會議室。
- **權限判斷失敗即拒絕（2026-09-13 訂）**：任何權限表查詢失敗時一律不放行，不得「沿用上一層」或回傳
  錯誤物件當真值。錯誤寫入函式日誌即可；使用者重新整理就能在資料庫恢復後取回權限。
  `npm run test:permission-fail-closed` 會擋住降級放行的寫法被加回來。
- **行情匯入批次（2026-09-13 起）**：批次共用的來源資訊（網址、抓取時間、匯入方式、資料分類）存
  `market_import_batches` 一筆，`market_data_points.metadata` 只留 `import_batch_id` 與逐筆才有意義的欄位；
  不要再把批次共用資訊逐筆塞進 metadata（45 萬筆行情有一半空間就是這樣吃掉的）。批次紀錄只增不改，
  必須與行情資料寫在同一個交易內。2026-09-13 以前的既有資料維持原樣，不回頭改寫。
- **行情備援來源（2026-09-18 起）**：北農官網對 GitHub runner 常整段時間連線逾時，`fetch_scope`
  重試約 10 分鐘後改抓農業部開放資料 `AgriProductsTransType`（`--no-backup` 可關閉）。作物代號與官網
  品名代號相同，但 `CropName` 是「品名-品種」合併字串，切法與官網不同，因此品名一律以既有行情資料
  建立的「市場×品類×代號 → 品名」對照為準；出現對照裡沒有的新代號就整批失敗，不要自行猜切法，
  否則同一天會出現兩種品名而重複計量。備援批次的 `import_method` 記為 `moa_open_data_backup`，
  官網恢復後同一穩定鍵會被官網數值覆寫（實測 258 個品項的品名與代號集合完全一致，僅少數價格有
  0.1 元級距差異）。
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
