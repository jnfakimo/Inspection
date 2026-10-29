# PROJECT_PLAN.md — 北農巡檢系統統一化計畫與進度

> 2026-10-15 重寫。這份只放「目標、決策、工作流與進度、驗證證據、待辦」。
> 標準本身在 [`AGENTS.md`](AGENTS.md)；交接快照在 [`handoff.md`](handoff.md)；
> 舊版 1652 行流水帳封存於 `docs/archive/2026-10-15-pre-unification/PROJECT_PLAN.md`（含 2026-10-09 之前所有驗證證據與 SHA-256）。

## 1. 目標

2026-10-24 追加目標：先建立巡檢系統的 ISO/IEC 27001 導入與證據基礎；使用者指定優先修正 Next.js、certifi、主分支／發布管制。
前三項的 GitHub 發布、測試與讀回證據見 [ISO27001_BASELINE.md](docs/ISO27001_BASELINE.md)。後續風險與候選控制見 [ISO27001_RISK_REGISTER.md](docs/ISO27001_RISK_REGISTER.md)；正式主機與組織制度仍需獨立驗證，不宣稱已符合 ISO。

開發初期沒有先定義好主系統、各系統、子系統的版型與色彩規範，導致畫面不一致。本計畫把它們收斂成**單一標準**：

1. 範圍：1 個主入口、**13 個大系統、68 個子系統**，以及登入、手機操作、3 個全螢幕圖資工具頁。
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

## 21. 公務車個人 LINE 派車通知重新上線（2026-10-16，PR #78）

- 背景：見 §20。使用者決定恢復上線，並說明正式站目前沒有這個功能。
- 整合方式：以 main 為基底，從快照只取車輛 LINE 相關檔案——新檔 26 個（Edge Function 相關 20、migration 5、規格文件 1）；既有檔中 `admin-api/index.ts`、
  `app-api/handlers/vehicle.ts`、`line-notify/index.ts`、`config.toml`、`tools/admin-line-test-check.mjs` 採快照版（逐段確認差異都屬此功能，main 自分岔點後未改這些檔）。
  `app-api/index.ts`、`system-access.ts`、`permission-fail-closed-check.mjs` 的快照差異屬另一批權限重構或較舊內容，刻意不帶入；假資料示意頁不帶入。
- 修正：`_shared/vehicle-line-webhook.ts` 的 `flatMap` 型別錯誤（`deno check line-notify` 原本失敗，部署前檢查會擋下）。
- 新做前端（快照中沒有可用介面）：`web/components/VehicleLineLinkSection.tsx`（個人設定綁定，僅公務車系統權限者）、
  `web/app/systems/admin/settings/vehicle-line-personal-panel.tsx`（後台開關與測試，真實訊息需二次確認）；`vehicle_line_*` 列入只走 Edge 的動作。
- 排程：`.github/workflows/vehicle-line-dispatch-worker.yml` 每 5 分鐘，沿用 repo secrets `CRON_SECRET`／`SUPABASE_ANON_KEY`，不使用 pg_cron／Vault。
- 測試：`npm run test:vehicle-line-notifications`（單元 46、前端 13、PGlite／路由 28，共 87 項）接入 `npm test`；gitleaks 兩筆測試 UUID 誤判以指紋白名單＋變數改名處理。
- 上線紀錄：PR CI run 38828543746 通過 → apply-database-migration run 38828829292、38828859064、38828892955、38828933713、38828963343 依序套用五支 migration（皆 HTTP 201）
  → 合併 `875b7215d`。自動部署 run 38829051295 因 `config.toml` 變更觸發全量部署，型別檢查在 `ipcam-proxy` 的 `npm:md5` 失敗（CI 無 node_modules），
  未部署任何 function；改以 workflow_dispatch run 38829266322 只部署 `admin-api app-api line-notify vehicle-line-dispatch-worker`，成功。
  手動觸發 worker 排程 run 38829377581 回傳 `{"ok":true,"data":{"claimed":0,...}}`，代表 `CRON_SECRET`、資料庫 RPC 皆正常；Pages 已含新介面。
- 後續修正：部署流程型別檢查加上 `DENO_NO_PACKAGE_JSON=1`，本機重現失敗並驗證 18 支 function 全數通過（分支 `codex/deploy-check-and-handoff`）。
- 未驗證：登入後畫面、真實 LINE 綁定與送達（需司機本人）、`LINE_CHANNEL_SECRET` 與 LINE webhook 設定是否就緒（無正式環境讀取權限）。
- 2026-10-16 追加（PR #80，`06f027bb7`）：發現 Codex 於 10-08 寫好但未進 main 的前端（舊 C 副本 `Documents\Codex\2026-10-05\task-2\Inspection`：
  `vehicle-line-binding-panel.tsx`、`vehicle-line-personal-settings.tsx`、`web/lib/vehicle-line-binding.ts`）。使用者決定維持現行介面，整合 Codex 的
  回應驗證、代碼格式檢查、防連點動作鎖、錯誤分類與測試；修正分類規則漏判 app-api 實際訊息「駕駛名單」「駕駛綁定資格」，並以讀取伺服器原始碼的測試防止脫節。
  派車申請頁加入同一綁定元件（僅駕駛名冊人員顯示）。`test:vehicle-line-notifications` 共 100 項。
- 正式環境進度：LINE webhook Verify 成功、022443 已綁定；待管理員發送測試後逐項開啟個人通知。
- 2026-10-16 正式啟用：管理員於後台送出個人測試訊息（回應「測試通知已由 LINE API 接受」），022443 確認收到；隨後開啟「啟用個人通知」「指派通知」並儲存，
  伺服器讀回狀態一致。「取消指派通知」關閉、「測試模式」開啟（皆維持原狀）。未驗證：真實派車指派觸發的通知送達（需實際派車）。

## 22. 繁中 404 頁與非同步載入防呆（2026-10-16，PR #83、#84）

- 404：正式站不存在的網址原本顯示 GitHub 預設英文頁。帶入快照的 `web/app/not-found.tsx`，並讓 `build-hardened-pages.mjs` 在加上 CSP 與來源指紋之後、
  簽章之前把 `v2/404.html` 複製為網站根目錄 `404.html`（GitHub Pages 只讀根目錄），且確認內容為繁中頁。PR CI 的 Commercial readiness 建置紀錄
  「根目錄 404 頁：v2/404.html → 404.html」，產物驗證通過；合併後實測 `/Inspection/v2/<不存在>/` 與 `/Inspection/<不存在>` 皆回 HTTP 404 並顯示繁中頁。
- 載入防呆：自快照整合 Codex 10-10 的修正，共 11 個畫面——設備頁（#83）、戰情、會議室、公文、駐警打卡、維修分析、後台告警／通知（#84）以
  `request-sequence` 丟棄過期回應並於卸載時作廢；查詢失敗不顯示假的空清單；權限頁任一授權來源失敗即封鎖編輯；AuthGate 過期回應不得清除登入者。
  `dashboard-client`、`workorder-extras` 以三方合併保留 main 的後續修改。測試：`async-load-safety.test.ts`（Codex 完整版＋補充）、`request-sequence.test.ts`、`not-found-page.test.mjs`。
- 待決定：設備營運／能源面板（見 handoff 4a）。未驗證：登入後畫面。
- 2026-10-16 追加（PR #86）：使用者決定能源面板先上線。中央監控（`equipment_monitor_events`）頁上方顯示 Codex 的 `equipment-operations-energy`；
  已接上監控告警，其餘標示「待介接」。Codex 元件測試 9 項接入 `npm test`，並改對應色彩統一後的 token、以實體檔案載入取代 `new Function`（Semgrep 規則）。
  正式站已部署（Pages run 38878399649），未登入實測畫面。

## 23. 業管組批核四階與批核前預覽（2026-10-20，PR #88）

- 需求：一市場主任之前多一關副主任；點選批核時先預覽報表再批核（比照機電課、駐警隊）。
- 決定：副主任身分依 `users.supervisor_id` 組織鏈判斷（不另設名單）；一市場啟用、二市場先維持三階（二市場副主任資料未備妥）。一市場人員：副主任莊宗坤、主任簡文財。
- 規則：已啟用的市場整體上移一層（副主任＝該市場主管 0 層、主任 1 層、副理 2 層、經理 3 層），未啟用的市場與原三階完全相同；
  主任須在同市場、同交接日的副主任批核之後才能批核（資料庫觸發器，回中文訊息）；關卡自 2026-10-21 起，歷史日期維持三階、不補批。
  系統管理員可批核任一階，但二市場沒有副主任階段。啟用日在 migration 與前端各一份，有測試逐市場比對。
- 實作：migration `20261020090000_business_handover_deputy_director_stage.sql`（`business_supervisor_within` 層數判斷、啟用日函式、關卡觸發器、階段檢查加入 `deputy_director`）、
  `app-api` `business_approve`、`web/lib/business-handover-approval.ts`、`business-handover.tsx`／`.css`（預覽內批核、四欄版面）；交接簿雜湊鎖檔同步三個檔案。
- 驗證：PGlite 測試涵蓋一市場四階矩陣、二市場原三階矩陣與無關卡；前端判斷與畫面契約 11 項；typecheck、完整 npm test、gitleaks、Semgrep、deno check、CI 與 Commercial readiness 皆通過。
- 上線：使用者先建好莊宗坤 → 簡文財的上下級並以唯讀查詢確認組織鏈 → apply-database-migration run 39371394023（HTTP 201）→ 合併 `31fbc3446` → `app-api` 與 Pages 部署成功。
- 未驗證：登入後實際畫面、A4 列印分頁、副主任階段的名單限制（目前該市場所有主管皆有資格）。


## 2026-10-28 GitHub 修正分支整合

Codex 依使用者要求準備發布本次資安及交接簿修正，以 origin/main 939227464 為基準，保留線上人數、巡檢市場與派車新增功能。行動相依修補、掃描器狀態、報修狀態 migration、主管簽核鏈與機電提示、主管選單排除本人納入；原帳號審核可讀性重構留在原工作樹。密碼政策不變。發布至 codex/inspection-security-handover-20261028，未合併 main、不觸發正式資料庫／前端／Edge 部署。既有隔離驗證及未驗證邊界見 docs/HANDOVER_CLOSEOUT_VERIFICATION_20261028.md 與 SECURITY_FOLLOWUP_20261028.md。整合版檢查結果另記於 docs/GITHUB_PUBLISH_20261028.md。


## 2026-10-29 主管選單補驗完成

pass：以獨立 Chromium 與真正隔離 Auth／API 完成主管選單 9 項核對，包含排除本人／跨單位／一般人員、儲存後重開、主管選填、一般人員必填、系統管理員欄位及 390px 手機操作。原主管鏈已還原，未發現需新增產品程式修正。解除先前選單 UI 待驗項目；密碼政策及正式資料不變，未新增正式部署。詳細證據見 docs/SUPERVISOR_SELECTOR_VERIFICATION_20261029.md。其他實機／正式環境與組織證據待辦不受影響。

## 2026-10-29 剩餘風險與隔離驗證（Codex）

已修正備份清單漏驗、generated／identity 還原，以及機電／水果／業管日報日期載入競態。備份 10/10、真實 PG17 還原 SQL、復原服務延伸 6/6、帳號匯入匯出 5/5、三日報防護 9/9、A4 六頁視覺與本機收信通過；型別、隔離 build、來源雜湊、版型及資安檢查通過。正式資料／密碼政策未動，本輪未 commit／push／deploy。

剩餘：deepmerge 7 low 維持補丁追蹤；實機、正式主機與代理、外部通知、正式備份 Auth／異機恢復及組織核准未驗證。測試證據與明確限制見 docs/ISOLATED_REMAINING_VERIFICATION_20261029.md。原始碼正本 G，執行副本 C:/projects/Inspection-publish-20261028；復原前端 127.0.0.1:8766。

### 2026-10-29 GitHub 修正分支交付

Codex 依使用者明確授權，將上述備份／還原、三日報競態修正及驗證報告一併提交至 codex/inspection-security-handover-20261028；僅包含本輪 16 個相關檔案，不納入私有測試帳密、session、資料庫或匯出檔。正式資料與密碼政策不變，未合併 main、未部署；推送結果以遠端提交紀錄為準。既有隔離驗證保留，雲端 CI／CodeQL 另以本次提交核對。


## 2026-10-29 CodeQL 8 筆已排除告警複核

Codex 完成逐筆排除理由與基準 SARIF 複核：修正 HTML 稽核漏檢、V1/V2 永久橋接權杖、兩支排程錯誤外洩，並補強建置字串序列化。原 #4/#5 排除註解無效，但固定 namespace/hash 未證實可利用。完整 npm test、型別、隔離建置、12 項回歸、真實隔離 Auth 瀏覽器 6 項、Gitleaks、Semgrep 均通過；security:audit 0 錯誤、4 警告（3 既有＋1 本機測試 fixture）。詳見 docs/CODEQL_DISMISSED_REVIEW_20261029.md。

同一修正分支交付；CI／CodeQL 以新提交結果另行確認，不以全域 dismissed 狀態判定修正。正式資料及密碼政策不變，未部署／合併。巡檢新分頁需有仍開啟的同來源登入分頁；全關閉時重新登入。實機掃碼與同來源 XSS 殘餘風險界線保留。

CodeQL 複驗補充：程式 f4d9e09cf，執行 40797879167 success；SARIF 原 8 筆消失，新 1 筆 #59 為舊紀錄 user_id／valid_until 遷移的資料流告警，白名單輸出無 bearer token，已附證據判讀並保留 open，未隱藏。新增競態回歸後共 13 項，巡檢 10 項及隔離瀏覽器 6 項通過。CI 40797876205 另以執行結果為準；正式與密碼政策不變。
CI 40797876205 已完成：六項工作全部 success；報告補記提交只更新文件。

## 2026-10-29 CodeQL #59 再複核

使用者授權確認誤報後排除。重新讀取 SARIF 四條資料流，永久輸出僅 version/user_id/valid_until；新增白名單與中繼資料不可登入／借用身分測試，回歸 16/16、隔離真實 Auth 瀏覽器 7/7 通過。決策採 false positive 排除 #59，理由與重新開啟條件見 docs/CODEQL_DISMISSED_REVIEW_20261029.md；GitHub 操作以回讀結果為準。本輪只改測試／文件，正式資料、密碼政策不變。


## 2026-10-29 剩餘低風險及隔離補驗續報

修正 Storage 備份根目錄 junction 漏驗與 LINE 未取消回應串流；反例修正前失敗、修正後通過。新增 SQL→worker→本機 HTTP 故障／重試 5 情境，瀏覽器能力故障共 9 項、派車輸出注入、啟用信分支、獨立 PG17 叢集／角色還原與重啟驗證通過。deepmerge 仍 7 low，上游無修補版，補丁有效；正式／實機／外部服務／組織證據仍保留待辦。詳見 docs/ISOLATED_FOLLOWUP_20261029.md。正式資料與密碼政策不變，同一修正分支交付，未部署。

## 2026-10-29 行動故障與獨立服務續驗

Codex 本輪唯一寫入者。修正行動分段失敗殘留、損壞索引阻止登出、登出與先前寫入競態；13 項行動故障／補傳／背景定位／BLE 測試通過。全新隔離 Auth／REST／Storage／Edge／Mailpit 接上獨立 PG17 後，發現並補還原 storage_vectors 附屬庫，9 項服務驗證與整組重啟通過。完整實機／正式主機／外部供應商／異機復原待驗清單見 docs/ISOLATED_FAULT_VERIFICATION_20261029.md。數字密碼政策與正式資料不變，交付同一修正分支，未部署／合併。CI／CodeQL 以本輪提交實際執行回讀為準。

## 2026-10-29 Android 模擬器原生補驗

Codex 本輪唯一寫入者。已建立 WSL／KVM Android API 35 隔離模擬器與原生 debug APK，限制測試帳號對外網路。修正跨帳號勤務恢復、登出與延遲回應競態、原生加密介面差異及中斷遷移遺留明文；保留舊 Android 密文可讀及原有金鑰。25 項儲存／生命週期、3 項畫面流程、8 項 BLE、6 項安全相容性、原生登入／更新／重開機／金鑰遺失與清理補驗通過；iOS bundle 通過，原生 iOS 未驗。audit 仍 7 low、0 moderate/high/critical；Gitleaks／Semgrep 通過。見 docs/ANDROID_EMULATOR_VERIFICATION_20261029.md，內列真正需要使用者配合的設備、唯讀權限、測試供應商及異機備份條件。正式資料與密碼政策不變，同一修正分支提交推送，未部署／合併；CI／CodeQL 以本輪提交回讀為準。

## 2026-10-29 低風險依賴逐項複核

Codex 本輪唯一寫入者。7 low 均由 deepmerge 同一公告傳遞至 Expo 工具鏈，上游仍無修補版；同主版與最新跨主版 SDK 仍引用受影響依賴，audit 建議退回 SDK 51 不安全，未套用。已將補丁檢查內嵌於六個啟動／建置／型別指令，防止忽略 lifecycle scripts 後使用未修補依賴，CI 雙平台 bundle 同步使用守門指令。乾淨 npm ci、9 項安全回歸、25 項儲存／生命週期、typecheck、Android／iOS bundle、Gitleaks 通過；audit 仍 7 low、0 moderate/high/critical。逐項原因、補償控制、反例與待上游條件見 docs/LOW_DEPENDENCY_REVIEW_20261029.md。R-11 不結案；正式資料、密碼政策不變，推送同一修正分支，未部署或合併。CI／CodeQL 以本次提交回讀結果為準。
## 2026-10-29 背景定位與離線勤務補驗

Codex 本輪唯一寫入者。修正不同駕駛離線點混批阻塞、補傳失敗仍關閉勤務，以及 Android 真實定位回呼因缺 RECEIVE_BOOT_COMPLETED 而閃退。新增身分過濾／批次核對／補傳共用、結束前補傳與實際更新列確認、Android manifest 權限與生成檢查。32 項儲存／生命週期／補傳回歸、10 項安全／manifest 回歸、8 項 BLE、2 項 App 畫面、6 項真實隔離 API、型別與雙平台 bundle 通過；重建 APK 後 Google API 35 模擬器實際收到位置，鎖屏／Doze／停止與清理五項補驗通過。見 docs/TRACKING_FOLLOWUP_VERIFICATION_20261029.md，內列真正需要實機、Mac、正式主機唯讀權限、外部通知授權、異機及組織核准的項目。密碼政策、正式資料與 R-11 列管不變，提交推送同一修正分支，未合併／部署；CI／CodeQL 依提交回讀。
## 2026-10-29 背景停止競態補驗

Codex 為本輪唯一寫入者。複核剩餘驗證時，以受控延遲重現停止定位早於磁碟寫入、舊回呼與 BLE 回應在停止後繼續處理的問題。修正收集世代與待完成本機讀寫等待，保留伺服器 RLS；新增 11 項時序／勤務完成回歸，整組儲存／生命週期 43/43、安全與 manifest 10/10、型別及 Android／iOS bundle 通過。原生補驗與必要配合條件以 docs/BACKGROUND_STOP_VERIFICATION_20261029.md 的最終結果為準。依使用者授權交付同一修正分支，正式資料與密碼政策維持不變，未合併／部署；既有依賴與 ISO 管理風險不因本輪技術測試自動結案。
## 2026-10-29 原生儲存空間與重裝補驗

Codex 本輪唯一寫入者。依既有未完成清單補驗 Android 原生 SQLite 空間不足及卸載重裝：實際 code 13／SQLITE_FULL 後舊加密值與登入保留、失敗分段殘留 0；重裝後舊 session、定位、勤務、測試標記與儲存金鑰均清除，原數字密碼重新登入成功，已登出並關閉本輪專用測試服務。未發現需新增修正的程式問題，本輪只提交文件，程式基準 5fa667ec0 的 CI／CodeQL 已讀回 success，不把既有結果冒稱為新文件提交的 CI。最少配合步驟見 docs/NATIVE_STORAGE_CLOSEOUT_20261029.md；正式資料、密碼政策、依賴風險列管與部署狀態不變。
## 2026-10-29 未完成驗證清單再複核

Codex 本輪唯一寫入者。重新確認遠端 52db201b9 與程式基準差異僅文件、工作樹乾淨；新行動 audit 仍 7 low／0 中高危，deepmerge 最新 4.3.1 與公告未修補狀態已重新查證，本機補丁雜湊通過。當前手機／ADB 清單為空、無 Xcode，專用模擬器服務已關閉；未發現新增可由現有隔離資源完成的待驗項目或產品缺陷。本輪只更新 docs/NATIVE_STORAGE_CLOSEOUT_20261029.md 的複核證據，維持六類設備／授權／治理待驗，不重跑未變動的通過測試。正式資料與密碼政策不變，未部署。
## 2026-10-29 原生離線資料鏈整合補驗

Codex 本輪唯一寫入者。重新檢視發現原生 GPS／加密佇列與 API 補傳先前分段驗證，已串接真實 Android 原生模組及隔離 Auth／PostgREST／RLS 完成 6/6 整合檢查：正常上傳 1 筆，核心層阻斷後本機保留 1 筆且禁止提前結束，恢復後全部 client_event_id 讀回、伺服器共 2 筆無重複並結束勤務。測後原生清空／登出，伺服器勤務 ended、車輛設備 inactive 均讀回，未刪資料，測試阻斷規則已移除。沒有新增產品缺陷，本輪只提交 docs/NATIVE_OFFLINE_PIPELINE_20261029.md 及更正先前盤點範圍；正式資料、密碼政策、依賴風險列管與未部署狀態不變。實體 BLE、iOS、正式主機、外部通知、異機復原與治理仍依報告所列最少步驟等待必要條件。
## 2026-10-29 原生回應遺失與重送補驗

Codex 本輪唯一寫入者。以固定隔離代理在後端成功寫入後丟棄回應，補驗實際原生加密佇列、force-stop 重開及冪等補傳，6/6 通過：原待傳事件跨程序保留，重開新增不同事件後共 2 筆；5 次成功回應遺失及後續確認重送均未增生重複資料，最後勤務 ended、佇列清空。伺服器 fixture 停用、手機登出與專用服務停止已讀回，原有隔離環境與防火牆保留。未發現新增產品缺陷，本輪只提交 docs/NATIVE_ACK_REPLAY_20261029.md 與交接紀錄，未重跑不受影響的既有 CI／CodeQL；正式資料、密碼政策、7 low 列管及未部署狀態不變。報告列明實機、iOS、正式唯讀、外部通知、異機與治理六類必要配合步驟。

## 2026-10-29 勤務結束確認與恢復修正

Codex 本輪唯一寫入者。重現結束回應遺失後重開仍恢復定位，修正伺服器勤務核對、加密 completionPending、無畫面回呼停止及登出序列；同一程序重試改為只更新 active 勤務並讀回 ended，保留原結束時間。53 項儲存／生命週期回歸、10 項安全、8 項 BLE、型別、原生 7 項隔離整合判定通過；原生測試環境兩次失敗與修復過程已如實留證。見 docs/DUTY_RECOVERY_VERIFICATION_20261029.md；最終程式提交 CI／CodeQL 依相同 SHA 回執，未以舊結果替代。本輪 fixture 停用、手機登出與專用服務停止另讀回；正式資料、密碼政策、7 low 列管及未部署狀態不變，六類實機／權限／治理必要條件仍列於報告。

## 2026-10-29 同帳號勤務查詢交錯修正

Codex 本輪唯一寫入者。以受控非同步回應重現同帳號舊查詢在結束／新勤務之後抵達，造成重新啟動定位、清除或停止新勤務的三個反例。新增本機勤務版本核對與完成清除序列，舊回應失效時重新讀取當前狀態；補 7 項回歸，合計 60 項通過，型別與本次程式 Semgrep 通過。見 docs/SESSION_RACE_VERIFICATION_20261029.md；本輪為隔離時序測試，未新增原生／正式操作驗收，未啟動模擬器或寫入任何 Supabase。最終 CI／CodeQL 以本輪程式提交回讀，不沿用舊結果。正式資料、密碼政策、7 low 列管與未部署狀態不變；需要實機、唯讀權限、通知授權、異機及管理核准的最少步驟見報告。

## 2026-10-29 剩餘驗收條件與依賴再複核

Codex 本輪唯一寫入者。重新盤點剩餘驗收與現有隔離證據，未發現新增需修改的產品問題。新 npm audit 為 7 low、0 中高危（退出碼 1，並非零告警）；官方 registry 最新 deepmerge 4.3.1，GitHub 公告仍無修補版，補丁雜湊通過，未採用 audit 提議的 Expo 51 降版。ADB 清單空白、PnP 未比對到手機、本機無 Xcode，專用模擬器相關連接埠無監聽；程式基準 c51d687c8 的既有 CI／CodeQL success 已回讀。只提交 docs/REMAINING_VERIFICATION_STATUS_20261029.md 與交接，未重跑未變動的通過測試；六類實機／現場／外部供應商／異機／治理驗收仍等待必要條件，最少操作已逐項列明。正式資料、密碼政策、依賴補償控制與未部署狀態維持不變。

## 2026-10-29 程序中斷替代補驗

Codex 本輪唯一寫入者。將突然中斷區分為可隔離的程序終止與仍需原生／硬體的斷電；新增持久化測試介面、獨立子程序強制終止及新程序讀回，6/6 通過，接入 test:storage 後完整集合為 66 項。覆蓋未發布分段、已發布索引、短值替換、明文遷移、登出移除、金鑰保存六個中斷點；未修改產品執行程式。已實測未引用密文分段可能殘留，因缺乏跨執行個體協調，不新增可能誤刪在途資料的自動回收，限制持續列管。見 docs/PROCESS_CRASH_VERIFICATION_20261029.md；不是原生 SQLite／Keystore 或硬體斷電驗收。正式資料、密碼政策、依賴控制與未部署狀態不變；同提交 CI／CodeQL 依後續回讀。

## 2026-10-29 未引用加密片段安全清理複核

Codex 為本輪唯一寫入者。以獨立模組鎖與共享儲存的受控時序證明單次掃描、雙重索引檢查、TTL 與檢查後刪除皆會誤刪仍可發布的分段，未啟用不安全自動回收。另重現正常替換／登出清理與另一讀取者交錯，修正為缺段且索引已變時最多三次整組重讀；索引不變、原生讀取錯誤、非法索引、驗證標籤竄改仍拒絕。第一批 10 項修正前 6 pass／4 fail、修正後完整 76 pass，另補安全邊界 3 pass；最終完整 79 項與同 SHA CI／CodeQL 依報告附錄回讀。見 docs/ENCRYPTED_FRAGMENT_CLEANUP_REVIEW_20261029.md。未引用片段清理仍需所有讀寫者共用的原生協調／交易與遷移，殘片空間及保存期限風險未結案；無需使用者手動刪資料。正式資料、密碼政策、依賴控制及未部署狀態不變。
## 2026-10-29 Android 原生儲存協調及殘片回收

Codex 本輪唯一寫入者。新增 Android Expo 本地模組，單程序單 channel 加 OS FileLock，所有加密儲存入口取得同一鎖後才讀寫、建金鑰、發布索引及回收精確命名的未引用片段；等待逾時不搶鎖，錯誤 owner/token 拒絕，runtime 單獨銷毀保持鎖直到程序重啟。86 項完整回歸及另 2 項邊界、實際 JVM 3 項、Android APK 編譯／真正加密儲存／獨立 Android 程序互斥／force-stop 後讀回與回收通過，8 個有效分段保留且未引用片段 0；測試清理已讀回。另補 Android 空索引轉 null 防護，真實原生確認不回退舊明文、不刪 8 個有效分段；最終 89 項整組 CI／CodeQL 依 docs/NATIVE_STORAGE_COORDINATION_20261029.md 附錄回讀。需重建 Android APK 並冷啟動；iOS／web 不啟用回收，未觸及的歷史鍵、未知格式、實體抹除及斷電未結案。正式資料、密碼政策與 7 low 列管不變，未部署或合併。