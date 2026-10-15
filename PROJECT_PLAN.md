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
| WS-4 | 單一主色：移除 `.system-card`／`.maintenance-card`／`.quick-grid a` 的 amber／green／violet 變體；`modules.ts` 的 `tone` 欄位停用 | 完成（CSS）；`tone` 欄位尚未從資料與型別移除 | 靜態驗證 |
| WS-5 | 守門測試 `tools/color-token-check.mjs`（`npm run test:color-tokens`，已納入 `npm test`） | 完成 | 已驗證 |
| WS-6 | 重寫 AGENTS.md；業務／資料規則搬到 `docs/DOMAIN_RULES.md` | 完成 | 靜態驗證 |
| WS-7 | TSX 內聯色碼收斂：圖表色盤與 3D／圖面標記色在 `ALLOW_TSX` 白名單內，尚未集中成單一 palette 模組 | **待辦** | — |
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
- `modules.ts` 仍含 `tone` 欄位；任何仍讀取它的新程式碼會違反單一主色決策。
- 本批已分 4 組本機 commit（token 層、色碼遷移、守門測試、文件），未 push、未部署；被觸及的檔案內含先前未提交的既存修改，一併進入這些 commit。
- `.git/packed-refs.lock` 為 2026-10-06 遺留的 0 位元組鎖檔，commit 時會印警告但不影響結果；確認沒有其他 git 程序後再清除。

## 7. 待辦（依優先序）

1. WS-8：逐系統版型審查，產出「不符三層標準的頁面清單」再分批修。
2. WS-9：取得可用瀏覽器與測試帳號後做兩主題＋手機＋A4 視覺驗收。
3. WS-7：建立 `web/lib/chart-palette.ts`，把圖表系列色與標記色集中，縮小 `ALLOW_TSX`。
4. 移除 `modules.ts` 的 `tone` 欄位與相關型別、`mobile/page.tsx` 的 `tone` 類別。
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
- 清除 `Obsidian/04-開發與部署.md` 殘留的 `<<<<<<< HEAD`。
- Dependabot 2 項高風險（`braces`、`node-forge`，皆在 `mobile/vehicle-tracker` 建置相依）目前沒有修補版本，列為已知風險。
- 交接簿表格欄寬的行內樣式（`business-handover.tsx`）屬列印表格且已有 PDF 分頁驗證，這輪不動。
- 仍未驗證：一般版當班徽章白字配 `#10b981` 約 2.5:1（改版前即如此）；需登入的頁面尚未在瀏覽器實測。
