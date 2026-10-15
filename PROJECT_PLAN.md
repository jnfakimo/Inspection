# PROJECT_PLAN.md — 北農巡檢系統統一化計畫與進度

> 2026-10-15 重寫。這份只放「目標、決策、工作流與進度、驗證證據、待辦」。
> 標準本身在 [`AGENTS.md`](AGENTS.md)；交接快照在 [`handoff.md`](handoff.md)；
> 舊版 1652 行流水帳封存於 `docs/archive/2026-10-15-pre-unification/PROJECT_PLAN.md`（含 2026-10-09 之前所有驗證證據與 SHA-256）。

## 1. 目標

開發初期沒有先定義好主系統、各系統、子系統的版型與色彩規範，導致畫面不一致。本計畫把它們收斂成**單一標準**：

1. 範圍：1 個主入口、**13 個大系統、67 個子系統**，以及登入、手機操作、3 個全螢幕圖資工具頁。
2. 單一色彩正本 `web/app/tokens.css`，兩個主題（一般版／科技版）。
3. 單一品牌主色；系統之間不以顏色區分；綠／黃／紅只表示狀態。
4. 三層固定版型（主入口 → 系統入口 → 子系統頁），共用元件不另做第二套。
5. 文件可交接給任何 AI 工具，規範由自動檢查守門，不靠記憶。

## 2. 使用者決策（2026-10-15）

| 議題 | 決定 |
|---|---|
| 主題數量 | 保留一般版＋科技版，token 收斂為一份 |
| 13 個系統代表色 | 全站單一主色，系統只靠 Logo 與名稱區分 |
| 範圍 | 文件＋token＋共用元件＋全站硬編碼色碼，一次做完 |
| 舊文件 | 封存後重寫（不直接覆蓋） |
| 交接 | 文件必須讓其他 Agent 可直接接手（2026-10-15 追加） |

## 3. 證據分級

- **已驗證**：在 C 執行副本實際執行並通過（指令與結果寫在第 5 節）。
- **靜態驗證**：只由原始碼／守門腳本證明，沒有在瀏覽器實測。
- **未驗證**：尚未檢查，或受環境限制（瀏覽器啟動被政策阻擋、無登入帳號）。不得推測成功。

## 4. 工作流與進度

| 編號 | 工作 | 狀態 | 證據 |
|---|---|---|---|
| WS-0 | 封存舊 AGENTS／PROJECT_PLAN／handoff 至 `docs/archive/2026-10-15-pre-unification/`（雜湊與原檔一致） | 完成 | 靜態驗證 |
| WS-1 | 單一 token 層 `tokens.css`；移除 `globals.css`、`v1-layout.css` 內重複的主題定義；補上科技版缺的 `--cyan-text`／`--green-text` | 完成 | 已驗證 |
| WS-2 | CSS 硬編碼色碼遷移：UI 樣式 506 處改用 token（淺色值與原色碼逐一相同，一般版畫面不變；科技版改為正確深色對應） | 完成 | 已驗證（守門＋全測試） |
| WS-3 | 紙本／列印例外隔離：`.hs-report*`、`@media print` 保持固定白底，班別色在 `.hs-report` 內固定，不隨科技版主色變動 | 完成 | 已驗證（fixtures 測試） |
| WS-4 | 單一主色：移除 `.system-card`／`.maintenance-card`／`.quick-grid a` 的 amber／green／violet 變體；`modules.ts` 的 `tone` 欄位停用 | 完成（CSS）；`modules.ts` 與 `mobile/page.tsx` 的 `tone` 已於 §9 移除 | 靜態驗證 |
| WS-5 | 守門測試 `tools/color-token-check.mjs`（`npm run test:color-tokens`，已納入 `npm test`） | 完成 | 已驗證 |
| WS-6 | 重寫 AGENTS.md；業務／資料規則搬到 `docs/DOMAIN_RULES.md` | 完成 | 靜態驗證 |
| WS-7 | TSX 內聯色碼收斂：圖表色盤與 3D／圖面標記色在 `ALLOW_TSX` 白名單內；圖表色盤已集中到 `web/lib/chart-palette.ts`（§10），3D／圖面標記色尚未集中 | 圖表色盤完成；標記色**待辦** | `test:color-tokens` |
| WS-8 | 13 系統／67 子系統版型審查。已完成靜態審查：內容寬度統一為 `--content-width`（移除 `.operations-page` 1180px／640px 內縮、`.v1list-page` 1100px）；按鈕與頁首經查已符合標準。剩餘見第 8 節 | 進行中 | 靜態驗證 |
| WS-9 | 瀏覽器實測：一般版／科技版對比 ≥ 4.5:1、A4 列印、手機 375／320px 無水平溢出 | **未驗證** | — |

## 5. 驗證紀錄

環境：`C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`（G 槽 `node_modules` 不完整，不能在 G 直接跑測試）。

- 2026-10-15 G→C robocopy（含 WS-4 單一主色變更與三份新文件）後：`npm run typecheck:v2` exit 0；
  `npm test` exit 0（含 `test:color-tokens`）。這是目前最新的完整驗證。
- 為配合 token 搬遷而調整的測試：`font-token-check`、`input-select-standard-check`、`metric-card-standard-check`
  改讀 `tokens.css`；`handover-style-check`、`handover-report-style-fixtures.test` 改斷言 token 參照。

## 5a. 合併 origin/main（2026-10-15）

- 合併 36 個 commit（PR #55–#61：業管組交接簿預覽分頁、列印、共用視窗鍵盤操作、行動端相依修補、重複模組說明）。
- 衝突檔取 main 版本後重新套用本批轉換；合併後再跑色彩守門、typecheck 與完整測試（結果見 handoff.md）。

## 6. 風險與已知限制

- 一般版畫面預期與遷移前一致（token 淺色值＝原色碼）；少數近似色合併（例如 `#eef2f7`→`--n-100`、`#dcfce7`→`--ok-soft`）
  有肉眼難辨的色差，**未做畫面比對**。
- 科技版是主要受益者：原本寫死的淺色底（slate 系）現在會跟著主題反轉；實際視覺需瀏覽器確認（WS-9）。
- `modules.ts` 的 `tone` 欄位已移除（§9）；新程式碼不得重新引入，也不得用它改卡片顏色。
- 本批已分 4 組本機 commit（token 層、色碼遷移、守門測試、文件），未 push、未部署；被觸及的檔案內含先前未提交的既存修改，一併進入這些 commit。
- `.git/packed-refs.lock` 為 2026-10-06 遺留的 0 位元組鎖檔，commit 時會印警告但不影響結果；確認沒有其他 git 程序後再清除。

## 7. 待辦（依優先序）

1. WS-8：逐系統版型審查，產出「不符三層標準的頁面清單」再分批修。
2. WS-9：取得可用瀏覽器與測試帳號後做兩主題＋手機＋A4 視覺驗收。
3. WS-7：圖表色盤已集中（`web/lib/chart-palette.ts`，§10）；剩 3D／圖面標記色（`structuremap-*`、`repair-map3d`、`patrol-map3d`、`modeler-client` 等）尚未集中，`ALLOW_TSX` 仍列這些檔。
4. （已完成，§9）移除 `modules.ts` 的 `tone` 欄位與相關型別、`mobile/page.tsx` 的 `tone` 類別。
5. 承接自舊計畫、尚未完成：全角色權限矩陣、資安 S1–S3 分階段驗證、Obsidian/04 的 179 節歷史索引人工審閱
   （細節在封存版 `PROJECT_PLAN.md`、`SECURITY_POSTURE.md`）。

## 8. WS-8 靜態版型審查結果（2026-10-15）

方法：掃描 94 個 tsx 檔的行內版面樣式、`<h1>`、原生日期欄位與非標準按鈕類別，並比對各 CSS 的頁面層寬度規則。

- **符合**：`<h1>` 只出現在主入口、`SystemPageHeader`、建模頁與列印視窗；原生 date/time 只在三個共用元件內；
  非標準按鈕類別 24 個，多數同時帶 `primary-btn`／`secondary-btn` 或為篩選／圖示按鈕。
- **已修**：內容寬度分歧（見 WS-8）。
- **已修**：`vehicle-workspace.tsx` 的行內版面樣式（流程卡、KPI 卡、頁籤、報表彈窗共 57 處）改為 class，
  並移除 `admin-workspace.css` 中為了覆蓋行內樣式而寫的 `!important`；派車報表與 KPI 在 ≤640px 改兩欄。
- **待處理（行內版面樣式過多，media query 蓋不過）**：`DashboardWidgetContent.tsx`（155 處，戰情元件動態版面，需評估）、
  `LayoutsAdmin.tsx`（107，每處樣式幾乎都是獨一份且依狀態變色，需要畫面比對才能安全轉換）、
  `business-handover.tsx`（11，多為表格欄寬）。
- **待處理（自有樣式的按鈕）**：`modeler-button*`（建模頁）、`business-check-btn`／`complete-btn`（點檢切換）；
  確認是否應收進 `button-standard.css` 或維持為切換元件。
- **未做**：逐頁實際畫面比對（需瀏覽器與登入）。

## 9. 統一化後續修正（2026-10-15，PR #62 合併後）

- 正式站登入頁實測（一般版／科技版、375px）：科技版「登入」按鈕亮青底白字只有 1.77:1。新增 `--primary-solid`／`--on-primary-solid`，兩主題皆 ≥ 4.5:1。
- 全站另有 9 處亮色實心底配白字（業管組時段標籤、當班徽章、簽名圖示、資安告警），科技版對比不足；新增 `--on-bright`（一般版白字不變、科技版深色字），並在 `test:color-tokens` 擋下同類寫法。
- 移除 `modules.ts` 已停用的 `tone` 欄位與主入口、手機頁的 tone 類別。
- 清除 `Obsidian/04-開發與部署.md` 殘留的 `- Dependabot 2 項高風險（`braces`、`node-forge`，皆在 `mobile/vehicle-tracker` 建置相依）目前沒有修補版本，列為已知風險。
- 交接簿表格欄寬的行內樣式（`business-handover.tsx`）屬列印表格且已有 PDF 分頁驗證，這輪不動。
- 仍未驗證：一般版當班徽章白字配 `#10b981` 約 2.5:1（改版前即如此）；需登入的頁面尚未在瀏覽器實測。

## 10. 第三輪（2026-10-15，分支 codex/unification-round3）

- 建模頁與業管組點檢切換按鈕改用共用 `.primary-btn`／`.secondary-btn`（點檢切換以 `aria-pressed` 呈現選取），移除各自的按鈕外觀。
- 當班徽章（業管組時段、即時文字、當班中）改為 `--live-solid` 深綠底白字，兩主題約 5.5:1。
- 新增 `web/lib/chart-palette.ts` 集中圖表系列色與備援色；6 個圖表檔移出 `color-token-check` 白名單。
- 刪除 G 槽遺留的 `.git/packed-refs.lock`（0 位元組，2026-10-06）。
- G 槽未提交修改唯讀盤點：見 `docs/G_WORKTREE_INVENTORY_20261015.md`（146 個與 main 相同、57 個不同、92 個 main 上沒有）。
- **待決策**：`DashboardWidgetContent.tsx` 顯示的是模擬數字（每 2.5 秒跳動），用在後台預覽與電視牆 `tv-dashboard`，畫面未標示「示意」。需決定接真實資料或標示示意，再處理其 255 處行內樣式。
- **待登入**：`LayoutsAdmin.tsx` 107 處行內樣式需在登入後邊看畫面邊改。

## 11. 戰情元件改接真實資料（2026-10-15，分支 codex/dashboard-live-data）

- 使用者決定：電視牆與後台版面預覽的 32 種元件改接真實資料，不再顯示模擬數字。
- 27 種接上真實資料：報修／工單（10）、巡邏（2）、設備妥善率（1）、天氣（3，中央氣象署）、市場行情（11，`dashboard_market_rotation` board）。
- 5 種目前沒有資料來源，改顯示「尚未介接資料來源」：攝影機畫面、卸貨場車流、拍賣場次進度、產地到貨排行、市場配置。
- 行情的「成交總額」是成交量 × 量加權均價的估算；「歷史價格曲線」畫看板資料的近一個月（約 24 個交易日），「每週交易趨勢」取最近 7 個、「成交總額」取最近 8 個交易日（2026-10-15 正式站實測後修正，原誤寫為只有 7 日）；跑馬燈是最新交易日漲跌，不是即時拍賣批次。畫面都照實標示。
- 新增 `web/lib/dashboard-widget-catalog.ts`（元件清單單一來源，取代後台與電視牆各自一份）、`web/lib/dashboard-metrics.ts`（與戰情儀表板同一統計口徑，戰情儀表板也改用它）、`web/lib/dashboard-live-data.ts`（同頁共用查詢、每 60 秒更新）。
- 驗證：`test:dashboard-metrics` 7 項、typecheck、完整 `npm test`。電視牆畫面需登入，尚未在瀏覽器實測。

## 12. 正式站驗收修正（2026-10-15，分支 codex/card-tone-cleanup）

- 1280px 實測維修／派工入口：6 張卡片尺寸皆為 269×200，但上緣與文字色分成兩種（原 cyan 卡為淺藍、原 amber／green 卡為主色）。原因是 PR #62 只刪除變體規則，沒刪掉預設規則裡的 `:not(.amber):not(.green)` 排除條件。
- 修正：卡片基礎規則直接使用 `--icon-sky`／`--icon-sky-text`，移除重複覆寫；`test:color-tokens` 新增規則，擋下依系統分色的卡片選擇器（含 `:not()` 寫法）。
- 主入口 13 張系統卡實測一致；電視牆 PR #65／#66 實測讀到真實資料。

## 13. 入口卡片位置分色清理（2026-10-15，分支 codex/portal-card-tone）

- 正式站 1280px 實測駐衛警入口：卡片上緣依位置分成 4 種顏色（`.operations-portal-card:nth-child(n)`），公務車、公文入口另有一套；「● 系統連線」11px 文字對比 3.77:1。
- 修正：入口卡片、公務車模組卡的上緣一律 `--icon-sky`，移除依位置分色的規則；系統連線文字改 `--green-text`。
- 守門：`test:color-tokens` 限制卡片（system-card、maintenance-card、operations-portal-card、module-grid、quick-grid）的上緣色只能用 `--icon-sky` 或邊線色。
- 收工時狀態：PR #62–#67 已合併並部署；本分支待開 PR。其餘頁面驗收待續。

## 14. 正式站全面驗收（2026-10-15，分支 codex/admin-hub-accent）

- 系統入口（1280px）：交接簿、設備、圖臺、會議室符合標準。修正三項：
  - 後台入口 11 張卡片寫死 6 種強調色，標籤與「▶ 開啟子系統」用淺藍當字色只有 1.67:1；改為統一淺藍，文字用 `--icon-sky-text`。守門的 tsx 關鍵字補上 `accent`。
  - 市場營運分析、市場公開看板、公務車定位追蹤入口仍走舊的 `module-hero` 版型；改用共用頁首，`.module-grid` 卡片上緣改為 `--icon-sky`。
- 子系統頁：報修案件、設備主檔、派車申請、業管組交接簿版型符合標準（頁首 26px／左緣 80px、欄位 42px、內容 85%、無溢出）。
- 列印預覽：科技版下 A4 預覽仍為白底黑字（紙本例外正確）。
- 科技版：報修案件 0 處對比不足；業管組交接簿第 3、4 班編號白字配亮底 1.79:1，改用 `--on-bright`。
- 手機：375／320px 派車申請、報修案件、交接簿皆無水平溢出，表格切換為卡片。
- **待決策（一般版色彩 token）**：主色 `#0284c7` 當小字約 4.1:1、綠 `#059669` 約 3.77:1、次要文字 `#64748b` 在斑馬列底約 4.35:1，皆略低於 4.5:1，影響多數子系統頁。需決定是否把一般版的這三個 token 調深一階。

## 15. 看板內部資訊外洩修正（2026-10-15，分支 codex/board-notice-allowlist）

- 使用者在正式站看到市場看板跑馬燈出現「API Gateway 流量突增」「synthetic probe 異常」（含告警編號）與派車提醒（含單號），並要求依 ISO/IEC 27001 處理。
- 原因：登入版跑馬燈沿用通知中心「全部通知」（event 為空或非停用公告），且以 service role 查詢、不分收件人，會帶出每位管理員收到的資安告警副本（含告警內容）與他人通知；公開版原本已限制為 `board_notice`。
- 修正：兩種檢視都只讀 `event='board_notice'` 且無收件人的公告（`market-board-notices.ts`）。`board-notices-check` 新增案例，確認資安告警、監控異常與個人通知在兩種檢視都不會出現，停用公告後不得退回顯示其他通知。
- 行為變更：登入版跑馬燈不再顯示一般通知；現場人員要看這些通知請用通知中心。需要在看板顯示的訊息，由具權限者在後台「看板公告」發布。
- 部署：此變更在 Edge Function（`app-api`），合併進 main 後由 `deploy-edge-functions.yml` 自動部署。
- 後續處理：見第 18 節。原先寫的「告警寫入 notifications 且沒有收件人」不正確：告警本體一直存在專用的 `security_alerts`（RLS 強制、僅管理員），通知中心的是每位管理員一份的副本（有收件人）。

## 16. 一般版色彩 token 對比調整（2026-10-15，分支 codex/token-contrast）

- 使用者決定調深一般版的主色、綠與次要文字，使小字在白底、斑馬列底與淡色底都 ≥ 4.5:1。
- 調整：`--cyan` #0284c7→#0369a1、`--green` #059669→#047857、`--muted`／`--n-500` #64748b→#5a6a80、`--dim` #5f6f85→#5a6a80。
- 一併調整（同類問題）：`--amber` #b45309→#a04607（淡色底上 4.1–4.4:1）、`--red` #dc2626→#c81e1e（斑馬列 4.44:1）。
- 一般版 `--on-primary` 改為白字（深藍底配深字只有 3.6:1）；科技版不變。紙本報表與列印版使用固定色，不受影響。
- 外觀影響：一般版主色、按鈕、連結與狀態色整體略深；科技版不變。

## 17. 一般版主色調整幅度（2026-10-15，分支 codex/primary-70）

- 使用者覺得 PR #70 的主色略重，要求「調整 70%」。解讀為：主色採原值 `#0284c7` 到 `#0369a1` 的 70% 位置。
- `--cyan`、`--primary-solid`：`#0369a1` → `#0371ac`。對比：白底 5.3、斑馬列底 4.9、淡藍底 4.6，仍全數 ≥ 4.5:1。
- 小字用的 `--info-text`（#0369a1）維持不變。若要更淺，淺於 `#0377b4` 就會在淡色底低於 4.5:1。

## 18. 資安告警存放與保存期限（2026-10-15，分支 codex/security-alert-store）

- 調查結果：告警本體已在專用資料表 `security_alerts`（RLS 強制、僅管理員可讀、寫入只走 service role）；證據資料表有防刪除 trigger。真正的缺口是：(1) 通知中心副本複製了完整告警內容；(2) 副本沒有保存期限。
- 修正：副本改為只放提示與告警編號；新增 `redact_expired_security_notices()`（90 天後清除內容、不實體刪除，僅 service role），由 `platform-log-alert` 每日（臺灣時間 03 點）呼叫。
- 刻意不做：證據資料表的自動刪除。這需要解除既有防刪除保護，屬政策決定，已列在 `docs/SECURITY_RECORD_RETENTION.md` 待決定項目。
- 部署順序：migration 需先經 `apply-database-migration.yml` 套用；在套用前，`platform-log-alert` 呼叫清除函式只會記錄錯誤，不影響告警流程。
- 守門：`npm run test:security-notice-minimal`。

## 19. 隱藏測試資料不計入統計（2026-10-16，分支 codex/ui-followup-20261016）

- 起因：正式庫有 3 筆 2026-08-25 的 E2E 測試工單，對應報修案件已 `hidden = true`，工單仍 `hidden = false`（`docs/runbooks/hide-test-records.sql` 的步驟 1 預覽結果）。
- 讀取端盤點（靜態，未查正式資料）：
  - **已略過 hidden**：戰情儀表板（`dashboard-client.tsx`、`dashboard-live-data.ts`）、交接簿工作區報修查詢、`repair_monthly_counts` RPC。
  - **本批補上**：`workorder-extras.tsx` 的維修分析（報修與工單）、`LocationAnalysisAdmin.tsx` 的位置分析，改用 `.or('hidden.is.null,hidden.eq.false')`（NULL 視同未隱藏）。守門：`npm run test:hidden-record-filter`，含反例斷言。
  - **刻意未動**：`app-api` 的報修案件列表（`select('*')`）與 `structuremap-markerboard.tsx` 的報修挑選清單。前者是管理端列表，是否顯示隱藏列屬產品決定，且動到 `supabase/functions/**` 合併後會自動部署 Edge Function。
- 注意：維修分析原本註明「逐項沿用 V1 analytics.html，確保兩邊數字一致」；V1 沒有過濾 hidden，所以 V2 與 V1 在測試資料上會有差異，V1 為維護模式，不再同步。
- 處置：runbook 步驟 2 在 SQL Editor 會被 `trg_protect_technician_order_columns`／`trg_protect_repair_request_columns` 擋下（postgres 身分沒有登入者，`can_manage_workorder()` 為 false），這也解釋了為何報修案件已隱藏而工單沒有。改用 migration `20261016090000_hide_e2e_test_workorders.sql`：只動以 `request_id` 核對過的 3 組、交易內暫停並恢復兩個保護觸發器、只改 `hidden`、事後驗證；空資料庫略過、資料不符整筆回滾。守門 `npm run test:hide-e2e-migration`（PGlite，含根因重現與「不暫停觸發器就失敗」的反例）。套用走 `apply-database-migration.yml`。
- 套用結果（2026-10-16）：分支 CI run 38820146953（5 個 job）通過後，apply-database-migration run 38820368083 套用到正式專案 `qztffronusdhgxhjjubt`，HTTP 201。目標工單確實存在於該專案（使用者截圖），migration 不會走「略過」路徑；事後驗證未通過會回滾，所以 201 代表 6 筆皆已隱藏、觸發器已恢復。Management API 不回傳 NOTICE，筆數未直接讀回。
- 本批沒有改：`LayoutsAdmin.tsx` 行內樣式（§11 已標示需登入後邊看畫面邊改）、`business-handover.tsx` 欄寬行內樣式（§9 已決定不動）。這兩項沒有帳號與瀏覽器就不應盲改。

## 20. G 槽快照分類與正式環境落差（2026-10-16，分支 codex/handoff-snapshot-triage）

- 快照 commit `9363fb870`（151 檔）以分岔點 `05c99c619`、目前 main 與 main 歷史上所有版本做三方比對，並忽略 CRLF／行尾空白：
  - 已在 main 或只是舊版本：12 檔（5 檔只差換行、7 檔是 main 歷史上的舊版）。
  - **新檔 91**：天氣地圖 Blender 原始檔 48（11.8 MiB，含 `.blend`／`.glb`）、`supabase/functions` 22、migration 5、`web/app` 7、`tools` 4、`web/lib` 3、`docs` 2。
  - **實質修改 48**：多數是 Edge Function（`app-api`、`admin-api`、`line-notify`）、後台元件與文件。
- 主要的未發布功能群：(1) 車輛 LINE 個人通知（migration 5 支、`vehicle-line-dispatch-worker`、`_shared/vehicle-*`、`admin-api` 個人 LINE 管理、`/systems/vehicle/notification-preview`）；
  (2) 繁中 404 頁（`web/app/not-found.tsx`，10-15 曾離線驗證）；(3) 設備營運／能源元件 `equipment-operations-energy.tsx`；(4) `async-load-safety`、`request-sequence` 測試；(5) 天氣地圖設計原始檔。
- **正式環境落差**：(1) 的 Edge Functions 與 migration 於 10-08 從 G 直接部署（`app-api` v118、`admin-api` v53／v54、`line-notify` v31、worker v1），原始碼從未進 main。
  10-15 `deploy-edge-functions` run 38748430358（PR #71 改 `app-api`）與 run 38771047188（PR #73 改 `_shared`）以 main 版重新部署
  `admin-api, app-api, audit-event, error-threshold-check, patrol-checkin, patrol-timeout-check, platform-log-alert, username-login`，
  因此正式環境的 `app-api`／`admin-api` 已不含 LINE 個人通知；`line-notify`、worker 未被重新部署，6 張相關資料表仍在。
  10-08 紀錄為功能開關全關、outbox／cron 為 0；開關現況需要正式庫讀取權限才能重查，本批未查。
- 處置：146 個未發布檔案匯出到 `G:\我的雲端硬碟\AI\Codex\_backups\g-snapshot-20261015-unpublished\`（zip、`manifest.tsv` 分類清單、bundle、G 槽 Obsidian 本機修改 patch），
  之後 G 槽以 `checkout -f -B main origin/main` 切回 main（未提交的 143 項與 main 位元組相同）。快照分支保留在本機，不推到公開 repo。
- 同批清理：移除 17 個 `AppData\Local\Temp` 暫存 worktree（檔案已被系統清空，只剩刪除狀態，無修改或新增檔；分支全部保留）、
  移除 `wt-followup-20261016` 與舊日常副本 `wt-merge-main-20261015`（皆先拆 `node_modules` junction，執行副本 `node_modules` 前後皆 140 項），
  刪除已合併的 `codex/ui-followup-20261016`、`codex/handoff-after-pr75`、`codex/handoff-security-store`（遠端與本機）。
  其餘 worktree 保留：`C:\projects\Inspection`、`.codex` 與 `Documents\Codex\2026-10-10`／`2026-10-13` 的 Codex 工作目錄（可能仍由 Codex 使用）。
- **待決定**：車輛 LINE 個人通知要 (a) 恢復上線——以 main 為基底重新整合 (1)，補測試後經 PR 部署；還是 (b) 放棄——至少把 5 支已套用的 migration 補進 main 作為 schema 紀錄。
  (2)～(5) 可在決定後逐項以獨立 PR 帶回。