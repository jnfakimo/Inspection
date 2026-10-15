# 北農巡檢系統｜開發計畫、共用 UI 基準與交接規格

> 更新：2026-10-09。本文依 G 正本、核准的 C 執行副本及本輪可重現驗證更新。本文不授權正式資料操作或發布；部署仍須依當次指示。

## 如何讀本文件

本文用三種標籤避免把目標誤寫成現況：

- **已核准規範**：來自使用者指示或根目錄 `AGENTS.md` 的要求，實作若不符應列為差異。
- **目前實作**：依 G 正本與核准 C runtime 的檔案及命令結果可直接確認的內容；宣稱僅限所列檔案。
- **待驗／待定**：需要瀏覽器、完整測試、使用者選擇或進一步程式盤點才可下結論。本文不替未知值猜測。

規格優先序：使用者當次明確指示 → `AGENTS.md` → 目標目錄的 `AGENTS.md`／工具 skill → 實際程式與資料契約 → 本文件及 `PROJECT_CONTEXT.md` → Obsidian 歷史紀錄。歷史紀錄可保留踩雷脈絡，但不得覆蓋現行指示。

## 專案範圍與執行邊界

- 專案含 V1 靜態多頁 HTML/JS 與 V2 Next.js/React 系統；V1 與 V2 的 CSS、路由和元件不可因名稱相近就視為同一版型。
- **正本與執行副本分工**：G 槽 `G:\我的雲端硬碟\AI\Codex\北農巡檢系統` 是唯一原始碼、文件、工作日誌與編輯位置。使用者另核准本機執行副本 `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`；只允許從 G 單向複製／更新到該 C 路徑，在 C 執行依賴安裝、驗證與本機服務，不可在 C 編輯後回寫 G。原 `2026-10-05\task-2\Inspection` 備份保持原樣。
- Drive 分享連結／分享碼代表檔案存取授權，不提供 Node 執行主機、服務、連接埠或網站 hosting。開發電腦、正式主機和 Drive 共用路徑是不同角色。不可未經使用者選擇就更改同步、掛載、依賴存放或其他儲存方式。
- 除使用者當次明確授權外，不讀取金鑰、token、service-role key、密碼、session、cookie 或正式資料；不寫 Supabase、不簽核正式案件、不停止其他使用者服務、不部署、不 reset、不 commit／push。允許的 C 執行副本工作僅限核准的安裝、型別檢查、build、本機預覽及靜態驗證。
- 細節依 `README.md`、`PROJECT_CONTEXT.md`、`Obsidian/03-資料庫與建置.md` 與 `Obsidian/10-地端移轉與驗收.md`。本文件及 Drive 上的檔案存在都不代表正式站已部署。

## 實際專案目錄圖（G 工作區，2026-10-09 盤點）

以下依 G 磁碟目前實際存在的目錄整理，供找程式入口與判斷檔案用途；不是新增一份理想化架構。未展開 `node_modules/`、`.next/` 等大型目錄，也未讀取 `.env`、金鑰或本機備份內容。

```text
Inspection/
├─ web/                              # V2 Next.js/React 應用程式來源
│  ├─ app/                           # 路由、頁面與 AppShell；一般模組共用動態路由在 systems/[system]/[module]/
│  ├─ components/                    # 共用 UI 元件（AppShell、登入閘門、系統頁首、日期／時間輸入等）
│  ├─ lib/                           # 共用邏輯；modules.ts 是系統／子系統清單唯一正本，測試與 helper 同區
│  ├─ public/、types/                # V2 靜態資源與 TypeScript 型別
│  └─ app/systems/[system]/[module]/ # 共用 module route 與各業務模組元件、樣式
├─ system/                           # V1 多頁 HTML/JS；與 V2 分開維護
│  ├─ *.html                         # V1 頁面（本次盤點 37 個頂層 HTML）
│  ├─ plans/                         # 現場樓層圖、DZI tiles、textures；屬正式圖資，不是 build 輸出
│  ├─ sql/                           # 基礎 schema／SQL 腳本（本次盤點 42 個頂層 SQL）
│  └─ assets/、icons/、vendor/       # V1 靜態資源、圖示與第三方檔案
├─ supabase/                         # functions/、migrations/、templates/；.temp/ 為 CLI 暫存
│  ├─ functions/                     # Edge Functions；app-api/index.ts 分派，業務 action 放 handlers/
│  └─ migrations/                    # 時間戳增量 SQL（本次盤點 179 個頂層 SQL）
├─ backend/                          # node-api、analytics_engine、signal-service 等後端服務
├─ mobile/vehicle-tracker/           # 車輛追蹤行動端來源
├─ tools/                            # 測試、契約／安全檢查、同步、資料與資產維護腳本
├─ docs/、Obsidian/                  # 操作／復原文件、知識與開發紀錄
├─ assets/、.github/workflows/       # 共用來源素材、CI／排程／受控部署工作流程
├─ Clipping/、知識庫/、創作庫/       # 原始剪輯資料、整理後知識、創作原稿；依 README.md 規則維護
├─ outputs/、dist_floorplans/        # .gitignore 排除的輸出／衍生資料區
├─ scratch/、.tmp/、.codex_tmp/      # 臨時下載、試驗或診斷工作區
├─ _pgbackup/、_pginfo/              # 本機備份／資料庫資訊目錄；本次只確認目錄存在，未讀內容
├─ security/、rdq/                   # 輔助目錄；核心說明未定義用途，不臆測為主要程式入口
├─ index.html                        # 根入口導向 V2 登入頁 v2/login/
├─ package.json / package-lock.json  # 根 npm scripts 與相依版本鎖定
└─ README.md、PROJECT_CONTEXT.md、ARCHITECTURE_V2.md、PROJECT_PLAN.md、handoff.md、AGENTS.md、CLAUDE.md、ANTIGRAVITY.md
```

### 從需求找到正確的程式入口

- **V2 頁面與模組**：`web/app/layout.tsx`、`web/app/page.tsx` 是共用殼層／入口；一般模組由 `web/app/systems/[system]/[module]/page.tsx` 與同目錄的 workspace router 載入。模組清單只改 `web/lib/modules.ts`；共用元件放 `web/components/`，跨頁 helper 放 `web/lib/`，共用樣式放 `web/app/`，單一模組樣式留在該模組旁。交接簿共用骨架為同路徑的 `handover-sheet.tsx`、`handover-sheet.css`，各簿只留業務特有區塊與列印覆寫。
- **V1 頁面**：修改對應 `system/*.html` 或其資源目錄；V1 與 V2 不共用路由或樣式入口。`system/plans/` 是線上樓層圖資，不能當成可清除產物。
- **Edge Function／資料庫**：新 app-api action 放 `supabase/functions/app-api/handlers/<業務>.ts`，補相鄰 `*.test.ts`，並更新 `tools/sync-local-edge-functions.ps1` 必要檔案清單；`index.ts` 維持驗證、權限與分派。增量 schema 放 `supabase/migrations/`；`system/sql/` 是基礎 SQL。
- **測試位置**：沒有根 `tests/` 或 `web/tests/`；測試分布於 `tools/`、`web/lib/*.test.ts`、app-api handlers 相鄰測試，以及 `backend/signal-service/tests/`。從根 `package.json` 選對應 npm script。
- **根設定**：`package.json` 提供 `dev:v2`、`typecheck:v2`、`build:v2`、`build:pages` 與定向檢查；`web/next.config.ts` 設定靜態匯出，`build:pages` 會產生 hardened site。

### 來源、輸出、暫存與備份

- **正式來源**：`web/`、`system/`、`supabase/`、`backend/`、`mobile/`、`tools/`、`docs/`、`assets/` 與專案文件。`system/plans/` 雖是圖檔，仍是正式使用中的來源資料。
- **可重建輸出**：根 `.next/`、`web/.next/`、`web/out/`、`_site/` 是 Next.js/build 或 hardened export 產物，`.gitignore` 已排除。`node_modules/` 是可重裝套件，不是架構來源；不以目前有損壞疑慮的相依樹推導目錄用途。
- **忽略的衍生區**：`outputs/`、`dist_floorplans/` 被 `.gitignore` 排除；本次未確認 `dist_floorplans/` 完整重建程序，不把它當唯一圖資正本。
- **暫存／診斷**：`scratch/`、`.tmp/`、`.codex_tmp/`、`supabase/.temp/`、`__pycache__/`、`.ruff_cache/`、`web/tsconfig.tsbuildinfo` 及服務快取不是主要維護入口；不要因整理文件而批次刪除。
- **備份**：`_pgbackup/`、`_pginfo/` 僅依目錄名標註，內容未讀。G 磁碟專案外另有回復快照 `G:/我的雲端硬碟/AI/Codex/_backups/Inspection-C-G-merge-2026-10-09-01/`（含 `originals/`、`incoming/` 與分階段快照）；它是回復／比對材料，不是目前工作來源。

### Codex／Claude 工作階段開啟與收尾

- **開始前**：先讀根 `AGENTS.md`、`PROJECT_PLAN.md`、`handoff.md`、`docs/AGENT_COLLABORATION_WORKFLOW.md`；依範圍再讀 `PROJECT_CONTEXT.md`、相關 Obsidian 文件與最近紀錄。進入 `web/` 時也讀 `web/AGENTS.md`。`CLAUDE.md`、`ANTIGRAVITY.md` 是相應代理工具的補充指示。
- **進行中**：同一檔案維持單一寫入者；記錄命令、結束碼、範圍與證據；長工作每 2–3 小時留檢查點。不得自行啟動服務；沒有明確授權時不 reset、不 commit/push、不部署。
- **收尾時**：在 `handoff.md` 更新完成／未完成項目、檔案、驗證與阻礙；把已確認開發紀錄追加到 `Obsidian/04-開發與部署.md`，並向使用者回報交付及未驗證事項。未執行的 build、瀏覽器驗收、資料庫操作或部署不得寫成已完成。

## V2 共用視覺規格：已核准與目前 CSS 的差異

### 主題、色彩、字體

| 項目 | 已核准規範 | 目前實作／證據 | 狀態 |
| --- | --- | --- | --- |
| 一般主題 | V2 預設 light；tech 為另一主題。顏色應走 tokens，light 文字對比至少 4.5:1。 | `layout.tsx` 將 `data-theme` 設為 localStorage 值或 `light`；`v1-layout.css` 定義 light token。預設暗色 token 在 `globals.css`。 | 主題機制可確認；全頁對比尚未重驗。 |
| Tech 背景 | 使用暗色 token，不以零散硬寫深色背景取代主題面板。 | `globals.css` 暗色 token：`--bg #020b18`、`--panel #071526`、`--panel2 #0a1d31`、`--line #173952`、`--text #e7f4ff`、`--dim #7893aa`。 | 目前 CSS 值。 |
| Light 色彩 | 依 light token，不用單頁固定色破壞可讀性。 | `v1-layout.css`：背景 `#f4f6fa`、panel/panel2 `#fff`、line `#dbe4ee`、text `#1e293b`、dim `#64748b`、cyan `#0284c7`、green `#059669`、amber `#b45309`、red `#dc2626`、violet `#7c3aed`。 | 目前 CSS 值。 |
| 字體 | 根目錄 `AGENTS.md` 指定 Noto Sans TC 與 Rajdhani 作共用字體。 | `globals.css` 先設定 Noto Sans TC/Rajdhani，後面又覆寫成 `--font: 'Microsoft JhengHei UI','Microsoft JhengHei',sans-serif`、`--head:'Segoe UI','Microsoft JhengHei UI',sans-serif`。本次主 layout/global 檔未見 webfont 載入。 | **規範與最後生效 token 有差異**；不要在未決定前說已統一為 Noto/Rajdhani。下一輪應確認並只留一份正式字體 token，再驗 Windows 與無字體環境 fallback。 |

上表只描述已檢視的 V2 共用 CSS，不代表所有頁面都沒有固定色。合法的紙張、圖面、標籤或 icon 特例需同時檢視背景與文字；新增文字色不可直接複製 tech 深色配色到 light。

### 頁首與內容寬度

- **已核准規範**：一般 V2 頁使用 `AppShell` 自動插入 `SystemPageHeader`；不得再寫第二個系統級 H1。標題與頂列間距 22px，標題 26px／`var(--cyan)`，系統 logo 42×42px 並取自系統定義；桌面內容水平內距 24px，手機 14px。普通頁首顯示系統名稱、`系統代碼 · 子系統名稱`、子系統說明。
- **目前實作**：`SystemPageHeader.tsx` 常數是 22px、26px、`var(--cyan)`、42px；`v1-layout.css` 的內容上內距 20px，加 header 上 padding 2px；手機 content 上內距 14px，加 heading 上 padding 8px。header logo/title gap 14px；識別行 11px、說明 13px。
- `v1-layout.css` 桌面 `.content.v1-content` 最大寬度 1480px、內距 `20px 24px 44px`；除共用頁首外，直接子內容桌面寬度 85%，760px 以下為 100%。這是本次 CSS 檢視值，不應把其他工具頁套用成一般內容頁。
- 頂列帳號／入口動作已核准為首頁、個人資料、登出；使用共用 system meta，順序為使用者、連線、台北時間。不要另造各頁不同格式。全螢幕圖資工具頁與交接紀錄入口等例外依 `AGENTS.md`。

### 按鈕、卡片、表單與表格

**共用按鈕（目前 `button-standard.css`）**

- 業務主操作 `.primary-btn`，中性／返回 `.secondary-btn`，刪除／停用 `.danger-btn`；密集區加 `.compact`。舊 alias `.btn`、`.btn-primary`、`.btn-danger` 仍對齊共用幾何。
- 桌面一般按鈕最小高度 36px、padding 8×13px、圓角 8px、字級 12px／行高 1.25／700。`compact` 高 32px、padding 6×10px、11px 字級；640px 以下一般高 40px、compact 高 36px。
- disabled 使用 opacity `.45`、`not-allowed`、取消位移。hover/focus/active 走集中樣式；需要操作的焦點仍要以鍵盤與瀏覽器畫面驗收。
- CSS 標頭註解仍寫「十大系統／54 個子系統」。`AGENTS.md` 的按鈕標準章列 13／63，頁首／子系統章則列 13／67；計數要依測試清單校正，不能把 CSS 舊註解當成目前系統數。此差異不改變共用按鈕 class 的實作事實。

**圖卡與模組入口**

- **已核准規範**：一般系統子頁卡桌面 269×200px；1100px 以下兩欄，600px 以下單欄，窄版恢復彈性寬度；新頁不可另設一套 logo／標題尺寸。
- **目前來源差異**：`modules.css` 有 269×200px 與 1100px 斷點規則，註解仍稱 54 個子系統；`v1-layout.css` 也宣告 `.module-grid a` 寬 300px、最小高 180px，並在 760px 以下設單欄。`globals.css` 先 import `modules.css` 再 import `v1-layout.css`，相同權重規則可能互相覆蓋。**未做 computed-style/browser 驗證前，269×200 與實際欄數都列為待驗，不宣稱所有頁已符合。**
- 首頁、系統入口、統計小卡各自規格不同，依 `AGENTS.md` 與目標元件核實，不將模組卡數值套給其他卡片。

**表單與日期時間**

- 跨頁日期欄位使用 `LocalizedDateInput`：畫面空值提示「年/月/日」，欄位輸出 `YYYY-MM-DD`；有 `showPicker()` 時欄位唯讀並叫原生日曆，不支援時才退回可輸入文字模式。元件內隱藏 native date input 是 picker 載體，不是頁面直接使用原生日期欄位。
- 日期時間使用 `LocalizedDateTimeInput`：輸出 `YYYY-MM-DDTHH:mm`，日期清空即整體清空；先選日期未選時間時值會明示 `00:00`。時間使用 `TimeSelect`，預設每 30 分鐘一格、24 小時 `HH:mm`，預設包含「未設定」空值；不落在級距的舊值仍保留為選項。
- 已核准：不直接建立 `<input type="date">`、`datetime-local`、`time` 或手工切換 type；欄位允許留白時首項是真正空值；人員清單先過 `selectableActiveUsers()`。只有本來不允許空值的狀態操作、必做動作或 filter 例外。
- 表單欄位外觀目前由多個頁面／模組 CSS 分擔，未確認一套完整共用 label、hint、error、disabled 尺寸；新表單先沿用相鄰共用元件，不自行宣稱所有欄位已統一。

**表格與小螢幕**

- 全域一般 table CSS 是 legacy 基線；640px 以下 `.responsive-table` 將 table/row/cell 改為卡片，隱藏 thead，依 `data-label` 顯示欄名；欄名由 `ResponsiveTableLabels` 從 thead 同步，MutationObserver 追蹤換頁／篩選後的列。跨欄小計／空狀態跳過欄位標籤。
- 桌面表格本身常見 `overflow:auto` 或明確 `min-width`，是否水平捲動、是否手機卡片化要依目標 table 確認；不可假設所有 tables 共用同一視覺。

### 載入、空值、錯誤、停用與焦點狀態

- Global CSS 有 `.loading-panel`（最小高 160px）、32px `.loader`、`.empty`（上下空間 30px）、`.notice`／`.inline-message` 和 `.danger` 色彩類別，但不代表每個模組的 async 流程都已一致。
- **天氣元件現況**：初次讀取顯示「正在載入天氣資訊」；更新失敗保留既有摘要並提供重新取得按鈕；地圖載入錯誤顯示縣市地圖不可用；鄉鎮資料有載入、錯誤、空清單三種狀態。不同請求以 sequence token 忽略過期回應。
- 共用按鈕有 disabled 樣式；表單 input/select/textarea 的 disabled 與 readonly 呈現仍需逐元件核查。操作控制應有中文錯誤／空值文案、`role=status` 或適當 accessible name，鍵盤焦點樣式需覆蓋。
- 驗收時分別看：首次載入、無資料、請求失敗、重試中、表單唯讀、角色不足、正在送出、已完成及鍵盤焦點；不能用單張成功畫面代替。

## 核心元件與主要系統

### 天氣與縣市地圖

- 使用者已指定：台灣縣市地圖在左，縣市摘要與鄉鎮下鑽在右；鄉鎮列表預設不展開。
- **目前實作**：`weather-widget-layout.css` 桌面兩欄為 `1.08fr / .92fr`、gap 16px；`.weather-map-panel` 第 1 欄、`.weather-info-container` 第 2 欄。900px 以下改單欄且地圖在上、資訊在下；地圖高度 `min(54vh,480px)`、最低 300px。640px 以下地圖高度 `42vh`、最低 260px。
- `weather-widget.tsx` 初始縣市為「臺北市」；縣市選單、麵包屑、SVG 縣市標記可互動。鄉鎮清單是未帶 `open` 的 `<details>`，初始收合；從表格點選鄉鎮可進一步顯示摘要並返回縣市。更新/切縣市要保留 request sequence 的過期回應防護。
- 待驗：桌機、900/640px 斷點、極窄螢幕、地圖錯誤／無標記、觸控與鍵盤操作；截圖看起來舊時先 reload 核實，不能只據舊截圖說目前 CSS 未生效。

### 三本電子交接簿：機電課、業管組、駐警隊

- **已核准共同骨架**：三本外觀共用 `handover-sheet.css` 的 `hs-*` 與 `handover-sheet.tsx` 的 icon、交接簿標題／日報元件；每本只在自己的 CSS 保留業務內容。不得複製另一份 `hs-*` 樣式或 icon map。
- 共用班別色 tokens：早／第一班 `#0284c7`，中／第二班 `#047857`，晚／第三班 `#b45309`；另有第四班 `#db2777`。當班以 `#10b981` 綠框／光暈和「當班」標示，不覆蓋班別本色。列印灰階仍顯示班別名稱、時段、序號。
- 工具列主要 gap 12px、padding 12×16px；日報標題框圓角 18px，標題 28px、emblem 58px，date chip 16px。KPI 桌面四欄、1100px 以下兩欄；班卡內容兩欄，1000px 以下單欄；800px 以下工具列、簽核和簽名改窄版配置，報表摘要兩欄，標題 22px、emblem 48px。
- 螢幕日報使用共享 heading、overview、shift card、表格、approval footer；列印以白紙黑字與 A4 尺寸為固定紙張呈現。共享 CSS `@media print` 預設把一般主管簽核輸入／readonly hint 隱藏，保留報表核閱 footer；各簿可以調整紙面分頁，但不可改共享 hs 外觀語意。
- 目前 `.hs-approval` 螢幕簽核摘要使用成對的淺灰底／深字固定色（底 `#F1F5F9`、文字 `#334155`、邊線 `#CBD5E1`）；日報紙面也使用固定紙張 palette（主標 `#12314d`、青綠線 `#0f7890`、表格線 `#d9e2e9`），列印版轉黑白。這些屬實際 CSS，不等於整頁主題已做對比驗收；切換 tech 主題時仍須檢查簽核摘要。
- 核閱 footer 有簽核者、簽核時間／待簽提示、簽核說明、簽核表單、唯讀理由與產製時間。機電／駐警報表目前各自提供簽核欄位，但字數上限、簽核角色、條件依本簿流程，不得互相套用。

**機電課**

- 保留其業務欄位：工作項目／工作內容、人員、結果、備註、費用；續辦／刪除／修正歷程和既有交接簽認亦屬本簿資料，不可為視覺一致而移除。
- 日報使用共用 `HandoverReportHeading`、Overview、ShiftCard、ApprovalFooter、ApprovalForm。紙面沿用共享格線與班卡，另有機電專有列、費用合計和原紀錄修正資訊。
- 簽核需在隔日起、三個班別交接都完成且具機電課課長權限；前端提示不等於授權，`approveDaily` 仍需重新驗權限與條件。未簽核時依角色只讀或顯示可填寫說明，簽核後鎖定當日。
- 列印 A4 portrait。G 原始碼已接入 `calculateMechanicalPrintFit()`：縮放低於 0.82 時改用 `.is-multipage` 原尺寸排版；列印節點實際套用 class，CSS 釋放固定高度與 overflow 限制、允許長班卡跨頁、重複表頭並避免拆開簽核 footer 與交接勾稽區。定向 fit 測試 4/4 通過。
- 待驗收僅剩瀏覽器實際列印：短／長報表 A4 分頁、重複表頭、長列及簽核 footer；此項未完成前不宣稱紙本列印驗收。

**駐警隊**

- 班別、工作時段、預定巡檢時段與排班人員唯一來源是 app-api `handover_guard_context`；交接頁不能改排班，只另記實際值勤人員與代班說明。交接使用者不一定有巡邏系統權限，前端不得直接查 patrol/checkin 資料。
- 寫入走 app-api；流程 `draft → submitted → received`，交班簽名帶排班／打卡摘要，接班者不得與交班者相同；主管簽核隔日起，全部已建立交接都完成接班，未建立班別要填說明，簽核後當日鎖定。
- 主管簽核只認 `handover/guard-approve` 明確 allow 或系統管理員；權限查詢失敗拒絕。異常附件需遵守 private bucket、限時網址、檔案型別限制、影片先壓縮等 `AGENTS.md` 規範。

**業管組**

- 共用交接簿骨架，保留三級核准、點檢表與本簿資料；不使用機電欄位或駐警排班規則。這份計畫只盤點共享元件和主要檔案，業管組各業務欄位與審核條件尚未逐欄完整審查。

## 權限、資料與安全不變條件

- 權限優先序是角色×大系統、角色×子系統、個人×大系統、個人×子系統；個人明確設定優先，`inherit` 才往上沿用。子系統清單以 `web/lib/modules.ts` 為正本；只有權限、沒有頁面的項目不得自動出現在選單／路由。
- 權限查詢失敗一律 fail closed。守衛也要檢查頁面路由、server handler、個人資料範圍；隱藏按鈕不是授權。
- app-api 新業務 handler 按 `AGENTS.md` 放在 `supabase/functions/app-api/handlers/<業務>.ts`，配套 `context.ts`、`validate.ts`、`audit.ts` 和單測；不得為新 API 回塞 `index.ts`。
- RLS、Storage private bucket、服務端唯一寫入、資料去識別化、備份復原和不可刪正式資料規則依 `AGENTS.md`、`Obsidian/07-資料庫備份與復原流程.md` 與 `Obsidian/08-資安告警原因與修正報告.md`。本文不保存任何 credential 或客戶資料。

## 開發流程與驗證標準

1. **開工**：讀使用者當次指示、`AGENTS.md`、目標子目錄 instructions、`PROJECT_PLAN.md`、`handoff.md` 和目標程式；只檢查必要路徑，先辨明目前工作樹、資料來源與服務狀態。
2. **切片**：先做共用元件／權限與資料契約，再做關鍵模組流程，再做視覺細修。依 `AGENTS.md` 的頁首清單目前目標為 13 大系統／67 子系統，但其按鈕章仍記 13／63；此計數差異在盤點前要以 checker 清單確認。一次不假設全部審完；每輪明列實際覆蓋的系統與未覆蓋範圍。
3. **協作**：同一工作批次只允許一個 writer。用 `handoff.md` 傳遞目前狀態，不向外部 Claude agent 傳訊，不假設不同工具能讀到私人聊天。Codex、Claude Code、AntiGravity 各依 repo 入口和自身 skill；工具專屬規則不要複製成全工具硬規範。
4. **修改**：保護既有未提交改動；修改前確認目標與差異；不因方便 reset、覆蓋整目錄、清理備份或改外部設定。每 2–3 小時 checkpoint 為既有規劃，避免重複建立排程。
5. **測試**：依變更範圍跑定向測試；V2 子頁變更含 `npm run test:page-headings`；共享樣式用對應 style checker；app-api handler 用 `npm run test:app-api-handlers`。只列出實際執行的命令與範圍，不能把 transpile/CSS parse 當成型別檢查、build、browser 或上線驗收。
6. **UI 驗收**：light／tech、桌面／窄版、無水平溢出、主要角色、loading/empty/error/disabled/focus 和主流程分別驗。報表列印另看 A4 多頁、長資料、表頭重複、簽核 footer、灰階與不同 browser；預覽畫面不能代替列印驗收。
7. **交接／發布**：更新 `handoff.md` 作最新快照；已完成並有證據的項目追加至 `Obsidian/04-開發與部署.md`，待辦狀態改變才更新 05。Commit、push、deploy 僅在使用者當次明確授權且驗收證據具體時執行。

## 本次盤點覆蓋、已知風險與未完成範圍（2026-10-09）

### 已直接檢視

- 共用 V2：`web/app/globals.css`、`v1-layout.css`、`button-standard.css`、`modules.css`、`weather-widget-layout.css`、`layout.tsx`、`SystemPageHeader.tsx`。
- 輸入／表格：`LocalizedDateInput.tsx`、`LocalizedDateTimeInput.tsx`、`TimeSelect.tsx`、`ResponsiveTableLabels.tsx`。
- 天氣：`weather-widget.tsx` 及對應 CSS。
- 交接簿：`handover-sheet.css/.tsx`、`mechanical-handover.css/.tsx`、`guard-handover.css/.tsx`、`business-handover.css/.tsx` 的共用骨架、關鍵流程／簽核和列印規則。
- 本次是文件規格盤點，沒有改 UI，也沒有執行 browser、Supabase、build 或部署。

### 具體踩雷清單

| 觸發條件 | 影響 | 已證實原因／未知 | 修正／處理原則 | 預防與驗收 |
| --- | --- | --- | --- | --- |
| G Drive 上 npm tar 解包失敗 | G 的 `node_modules` 不完整，無法在 G 直接啟動 Next | 兩次完整安裝與單套件同步／非同步解包均曾失敗；根因未明，不歸咎磁碟容量或 Drive | 使用者已核准全新 C 執行副本；依 `package-lock.json` 在 C 執行 `npm ci`，G 保留唯一原始碼與文件正本 | 不在 G 重試安裝、不改 Windows／Drive 設定；C 僅作 runtime，套用 G→C 單向更新並核對 SHA-256 |
| 目標路徑或實際工作樹不一致 | 可能修改錯 repo、漏掉現有未提交改動 | 曾有執行環境指向 task-2、指定 workspace 為 task-3 的不一致；task-2 `git status` 遭 dubious ownership 阻擋，未設 `safe.directory`。目前使用者指定的正式共用工作區為 G | 每次先 `Get-Location`／確認目標檔案；不依猜測路徑操作、不添加 safe.directory 規避 | 盤點輸出要顯示實際絕對路徑；跨 repo 對照先只讀 |
| 把 Drive 分享碼當成可執行環境或部署服務 | 無法啟動網站，或誤認為已上線 | 分享碼只證明檔案分享，不能提供 Node 主機／服務／hosting | 執行主機與正式 server 需由使用者指定；Drive 留作共用檔案路徑 | 開始測試前先驗證指定電腦、runtime 和使用者授權，不建立替代 C QA 目錄 |
| 共用標準與 CSS 舊註解／重疊 selector 不一致 | 不同頁尺寸、圖卡規格或字體未如規範生效 | 字體 token 有後置覆寫；模組卡 269×200 vs 300×180 declarations 與斷點不同；按鈕 CSS 註解數量舊 | 先核對規範正本，再確認 CSS cascade/computed style，集中修共用來源而非疊更多局部 override | 先用 checker，再用 browser 做 light/tech 與 1100/760/640/600 關鍵斷點回歸；沒有實測時標待驗 |
| 天氣摘要切換縣市或快速連續查詢 | 舊請求可能覆蓋新縣市資料 | 元件使用 request-sequence token；機制可由程式確認，實際競態瀏覽器行為未在本次測 | 保留過期回應忽略邏輯，錯誤要能重試 | 模擬快速切換縣市、慢回應與失敗；檢查地圖和摘要一致 |
| 機電長報表強制固定 A4 高度或縮放到不可讀 | 長資料被裁切、跨頁斷行或簽核區分離 | 已補 0.82 最低縮放與 `.is-multipage` 多頁原尺寸排版；定向 fit 測試 4/4 通過。瀏覽器實際列印尚未驗證 | 保留單頁／多頁判斷、長列跨頁及重複表頭 | `test:mechanical-print-fit` 4/4 通過；後續仍需在授權瀏覽器驗證長短報表、黑白與實際 A4 分頁；沒有驗證前不宣稱列印驗收 |
| 把 UI 隱藏當成授權，或把查權限失敗視為 inherit | 未授權讀寫、越權簽核 | repo 明定權限 fail closed；駐警主管簽核須明確 allow，服務端重驗 | 前端只呈現操作狀態，服務端 handler／RLS 才是安全邊界 | 測正常、無權、查詢失敗、跨單位與已簽核鎖定；任何權限讀取錯誤都拒絕 |
| 移除舊紀錄或把歷史摘要當成現行規則 | 失去可復原背景、重犯已知錯誤 | Obsidian 04 是 append-only 歷史，跨日期混合；其中含仍有效踩雷與規則 | 不整檔刪除；先逐條分出現行規則、已解問題和純歷史，收到明確範圍後再整理 | 移動／摘要前列原標題與 event date，保留可追溯來源及 manifest；本次只讀盤點，沒有刪除 |

### 執行副本與驗證狀態（2026-10-09）

- **正本**：G 槽 `G:\我的雲端硬碟\AI\Codex\北農巡檢系統` 只保存原始碼、文件與工作日誌。Google Drive 同步狀態依使用者指示不檢查，也不列為驗收阻擋。
- **核准的 runtime**：`C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`。從 G 複製 6,922 個檔案、965 個目錄（約 204.57 MB），未複製 `.git`、`node_modules`、`.next`、憑證／env/key、診斷備份及文件庫；原 `C:\Users\jnfa\Documents\Codex\2026-10-05\task-2\Inspection` 未變更。`web/out` 靜態匯出目錄在初次複製時意外包含，之後由 C build 重新產生；它不是 G 的正本。
- **版本與依賴**：Node `v24.18.0`、npm `11.16.0`、Next `16.3.8`、React `19.2.8`；lockfile v3，G/C `package-lock.json` SHA-256 相同：`FE3750F60F2EB9A5E0C2E262B3D5BB33E9B824BB54A5447B90258E13893C6ADD`。C `npm ci --no-audit --no-fund` 安裝 181 個套件並 exit 0，`npm ls --depth=0` exit 0。npm 顯示 `esbuild@0.25.12` postinstall 尚待核准；未批准或執行該腳本，但 typecheck/build 均通過。
- **G 正本程式修正**：`web/app/systems/[system]/[module]/mechanical-handover.tsx` 將未定義的 `openDailyReport` 按鈕 handler 改為既有 `setPreviewOpen(true)`，並單檔 G→C 更新、SHA-256 核對一致。
- **已完成驗證**：`npm run typecheck:v2`、`npm run build:v2` 通過（Next 產生 97 個靜態頁）；`test:mechanical-print-fit` 4/4、`test:handover-style`、`test:page-headings`（13 systems／67 modules，62 standard／4 compact headers）、`test:css-source-balance` 通過。C 本機服務目前綁定 `127.0.0.1:3001`；`/Inspection/v2/login/` 回 HTTP 200，build 前 guard／handover 路由亦回 200。
- **本機預覽**：C runtime 啟動器 `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\start-local-preview.ps1` 已接入使用者 Startup 捷徑，採可見 PowerShell 視窗（WindowStyle 1），登入 Windows 時啟動；不改執行政策、不隱藏程序。舊啟動器因 UTF-8 無 BOM 導致 Windows PowerShell 5.1 解析錯誤，已改 UTF-8 BOM 並通過 5.1 parser。當前 launcher PID `152388`、Node PID `84780`，Windows session 1，僅監聽 `127.0.0.1:3000`；HTTP 200：`http://127.0.0.1:3000/Inspection/v2/login/`、`http://127.0.0.1:3000/Inspection/v2/systems/handover/`、`http://127.0.0.1:3000/Inspection/v2/systems/handover/guard/`、`http://127.0.0.1:3000/Inspection/v2/systems/handover/mechanical/`。埠若已占用只報 PID，不停止程序。
- **未完成／未驗證**：瀏覽器截圖命令遭執行環境政策在啟動前拒絕，沒有啟動瀏覽器；未驗證登入後資料畫面、responsive 視覺與實際 A4 瀏覽器／紙本列印。未登入正式系統、未連 Supabase、未簽核案件。此輪不部署，正式部署狀態不因本機 build 改變。
- **開工／換電腦流程**：只以 G 為來源；新電腦須另建使用者核准的執行副本，排除 `.git`、既有 `node_modules`／`.next`、`.env*`、key／憑證、日誌、診斷與備份，再依 G 的 `package-lock.json` 執行 `npm ci`。更新時由 G 對 C 單向複製必要檔案並核 SHA-256；不從 runtime 回寫 G、不覆蓋 task-2 備份、不搬移 secrets。

## 下一步優先順序

1. **瀏覽器／列印驗收**：需在政策允許且授權的瀏覽器檢查登入後交接簿、桌面／窄版與 light/tech，並實測機電長短報表及 A4 分頁；靜態測試不能代替實際列印驗收。
2. **其他系統工作**：依本計畫優先序逐項驗證 weather、駐警、業管及其他子系統；未做的項目仍列待辦，不由本次 build 推定通過。
3. **部署**：使用者已指示「先不要部署」。不得因 build 通過而發布；部署須等新的明確指示及完整發布前驗收。
## 文件與證據索引

| 主題 | 正本／證據 |
| --- | --- |
| 工程、安全、視覺、日期、權限、交接簿共同規則 | [`AGENTS.md`](AGENTS.md)、[`web/AGENTS.md`](web/AGENTS.md) |
| 架構與長期產品脈絡 | [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md)、[`ARCHITECTURE_V2.md`](ARCHITECTURE_V2.md)、[`Obsidian/01-系統架構.md`](Obsidian/01-%E7%B3%BB%E7%B5%B1%E6%9E%B6%E6%A7%8B.md) |
| 系統清單／欄位 | [`web/lib/modules.ts`](web/lib/modules.ts)、[`Obsidian/02-功能模組.md`](Obsidian/02-%E5%8A%9F%E8%83%BD%E6%A8%A1%E7%B5%84.md)、目標 route/component |
| 系統頁首 | [`web/components/SystemPageHeader.tsx`](web/components/SystemPageHeader.tsx)、[`web/app/v1-layout.css`](web/app/v1-layout.css) |
| 主題、按鈕、入口卡、表格 | [`web/app/globals.css`](web/app/globals.css)、[`web/app/button-standard.css`](web/app/button-standard.css)、[`web/app/modules.css`](web/app/modules.css)、[`web/components/ResponsiveTableLabels.tsx`](web/components/ResponsiveTableLabels.tsx) |
| 日期與時間 | [`web/components/LocalizedDateInput.tsx`](web/components/LocalizedDateInput.tsx)、[`web/components/LocalizedDateTimeInput.tsx`](web/components/LocalizedDateTimeInput.tsx)、[`web/components/TimeSelect.tsx`](web/components/TimeSelect.tsx) |
| Weather | [`web/app/weather-widget.tsx`](web/app/weather-widget.tsx)、[`web/app/weather-widget-layout.css`](web/app/weather-widget-layout.css) |
| 電子交接簿 | `web/app/systems/[system]/[module]/handover-sheet.css/.tsx` 及各簿同目錄 `mechanical-`／`guard-`／`business-handover` 檔案 |
| 目前工作交接 | [`handoff.md`](handoff.md) |
| 開發歷史（append-only） | [`Obsidian/04-開發與部署.md`](Obsidian/04-%E9%96%8B%E7%99%BC%E8%88%87%E9%83%A8%E7%BD%B2.md) |
| 待辦／發布／資安／復原 | [`Obsidian/05-待辦清單.md`](Obsidian/05-%E5%BE%85%E8%BE%A6%E6%B8%85%E5%96%AE.md)、[`Obsidian/06-發布前驗收表.md`](Obsidian/06-%E7%99%BC%E5%B8%83%E5%89%8D%E9%A9%97%E6%94%B6%E8%A1%A8.md)、[`Obsidian/07-資料庫備份與復原流程.md`](Obsidian/07-%E8%B3%87%E6%96%99%E5%BA%AB%E5%82%99%E4%BB%BD%E8%88%87%E5%BE%A9%E5%8E%9F%E6%B5%81%E7%A8%8B.md)、[`Obsidian/08-資安告警原因與修正報告.md`](Obsidian/08-%E8%B3%87%E5%AE%89%E5%91%8A%E8%AD%A6%E5%8E%9F%E5%9B%A0%E8%88%87%E4%BF%AE%E6%AD%A3%E5%A0%B1%E5%91%8A.md) |
| 正式主機邊界 | [`Obsidian/10-地端移轉與驗收.md`](Obsidian/10-%E5%9C%B0%E7%AB%AF%E7%A7%BB%E8%BD%89%E8%88%87%E9%A9%97%E6%94%B6.md)、[`docs/ONPREM_SETUP_AND_SYNC_SOP.md`](docs/ONPREM_SETUP_AND_SYNC_SOP.md) |

## 備份與恢復

- 第一階段原始文件與雜湊：`G:\我的雲端硬碟\AI\Codex\_backups\Inspection-C-G-merge-2026-10-09-01\documentation-phase-2026-10-09-01\`，manifest 為 `documents-originals-manifest.json` 與 `documents-final-manifest.json`。
- G 主工作區規則更新前的 6 份原始文件與 SHA-256：`G:\我的雲端硬碟\AI\Codex\_backups\Inspection-C-G-merge-2026-10-09-01\drive-primary-phase-2026-10-09-01\originals-manifest.json`。
- 程式整合的備份依批次 `RESTORE.md` 與 `integrated-manifest.json` 選擇性恢復。若本檔引用被更新，只還原指定檔前需先比較雜湊與差異，不覆蓋整個 repo。
- 開發歷史不可用 mtime 當刪除依據。任何舊紀錄整理要按內文事件日期逐節審核，保留有效規範與踩雷知識；沒有明確確認前不刪檔。

本文只記錄能由 G 工作區檔案、repo 規範和可存取證據核實的事項。狀態改變時更新本節與 `handoff.md`，把未驗證項目明確留在待辦。

### 2026-10-09 最新實作狀態：字體、子系統卡片與機電列印

此節更新本次已落地的程式碼，並取代前文尚待確認字體 token、入口卡尺寸與機電列印接線的待辦描述。

- **字體**：`globals.css` 僅保留一組有效的 `--font`／`--head` token，依序採 Noto Sans TC、Rajdhani 與在地字型 fallback。交接簿、管理授權頁、設定樹狀清單與機電報表改用共用 token；獨立列印視窗聲明相同 fallback。已確認 `web/public` 沒有字型檔、程式沒有外部字型載入或 `next/font` 引用，因此只確認 token/fallback 正確，不宣稱 Noto Sans TC 或 Rajdhani 已實際載入。
- **入口卡片**：所有系統 hub 共用 `modules.css` 的 `.module-grid` 幾何；桌面三欄、269×200px，1100px 以下兩欄彈性寬度，600px 以下單欄。移除 V1 與車輛、會議室等系統的尺寸覆寫，保留各系統色彩、圖示、間距與文字樣式。
- **機電列印**：新增可單測的 fit helper。可用高度足以維持 0.82 縮放時仍列印單頁；低於 0.82 改用既有多頁樣式並以原尺寸排版。多頁延續重複表頭，簽核 footer 與交接勾稽區避免拆頁。未做瀏覽器實際列印驗收。
- **備份**：本次修改前的目標檔及 SHA-256 清單位於 `G:\我的雲端硬碟\AI\Codex\_backups\Inspection-C-G-merge-2026-10-09-01\ui-print-fix-phase-2026-10-09-01\source-backup-manifest.json`。
- **已通過**：列印 fit 單元測試 4/4、機電列印整合檢查、模組卡標準檢查、字體 token 檢查、8 份 CSS 括號平衡檢查、交接簿共用樣式檢查、工具 JavaScript 語法、`package.json` JSON 解析、`git diff --check`。
- **驗證更新（C runtime，2026-10-09）**：`npm test` 全套通過；`npm run typecheck:v2` 通過。`tools/admin-line-test-check.mjs` 測試 fixture 已改為符合現行 system_settings 查詢及 LINE Push API 請求形狀，全程以假 fetch 攔截，沒有送出 LINE 訊息。G 上損壞的 node_modules 未重裝。

#### 尚待驗證

1. 瀏覽器登入後頁面、桌面／1100／600 斷點、light／tech 主題與角色權限視覺驗收仍待完成；本次執行環境政策拒絕啟動瀏覽器，HTTP 200 不代表畫面驗收。
2. 實際 A4 列印短／長報表，確認單頁／多頁、重複表頭、長列及簽核 footer／交接勾稽區分頁。
3. 確認實際執行裝置的 Noto Sans TC／Rajdhani 是否已安裝；若未安裝，檢查在地 fallback 字形。
4. 遠端 CAPTCHA 挑戰未測；該 action 會新增 challenge 記錄，本輪未呼叫，CAPTCHA_SECRET 設定狀態也未查。
5. G 槽 node_modules 的 tar 解包寫入問題仍未修復；本次 typecheck 與全套測試在核准的 C runtime 執行，前次 C build 成功產生 97 靜態頁。


### 2026-10-09 G 槽小型檔案探針 checkpoint

- G 依賴狀態已直接複核：根 package.json、lockfile 可解析；TypeScript 與 PGlite 套件資訊是截斷 JSON；Next 套件目錄、shim 與 node_modules lockfile 缺失。兩份既有脫敏安裝日誌記錄解壓階段 TAR_ENTRY_ERROR UNKNOWN / EBADF 寫入錯誤，跨多套件，根因未證實。
- 小型 G 檔案探針通過：循序 16 KiB write/read/hash/rename/re-read，加上兩檔併發 write/read/hash，總 fixture 49,152 bytes；證據保存在 .codex_tmp/npm-fs-probe-20261009-1791532652011-7cf5d5c028。此結果不驗證 npm tar 解壓。
- 不安全的修復仍未做：未重試 npm 安裝、未手動修補依賴、未改同步或掛載、未啟停服務。不能把單次小檔案通過當作大型套件解壓可用。
- 待辦仍有：依賴恢復後做 TSX transpile/typecheck 與 Mechanical data regression；瀏覽器檢查桌面／1100px／600px、light／tech；實際印短／長 A4。正式網站切換／部署依使用者明確指示暫停。
- 需要使用者決定的唯一環境變更：是否允許生成的 node_modules 移至 G 以外的本機磁碟（原始碼仍以 G 為主），或選擇授權的 Drive sync/mount 變更方案；未選前不變更。


### 2026-10-09 G 槽 npm 離線修復嘗試（失敗，保留證據）

- 在確認 G 槽舊 node_modules 多個套件 manifest 為 0 bytes 後，從 G 專案根目錄執行一次：`npm ci --offline --maxsockets=1 --no-audit --no-fund --loglevel=warn --logs-dir .codex_tmp/npm-repair-20261009-689e94c414/npm-logs`；僅為此子程序設定 `UV_THREADPOOL_SIZE=1`。Node v24.18.0、npm 11.16.0。
- 離線解包期間仍出現 5,622 筆 tar 寫入錯誤：`UNKNOWN/-4094/write` 4,077 筆、`EBADF/write` 1,544 筆、`EBADF/close` 1 筆。這次不涉及 registry 網路請求；降低 socket 數與 Node thread pool 均未阻止錯誤。出錯項目分布於多個套件，例如 `node_modules/zip-stream/LICENSE`、`node_modules/xmlchars/LICENSE`、`node_modules/wrappy/package.json`、`node_modules/undici-types/LICENSE`、`node_modules/tslib/tslib.es6.html`。
- 完整 npm debug log（20,725,298 bytes）：`.codex_tmp/npm-repair-20261009-689e94c414/npm-logs/2026-10-09T08_24_31_450Z-debug-0.log`；主控台輸出及執行摘要在同目錄。錯誤持續後中止本次命令，未再重試。
- 中止後確認 `node_modules/next/package.json` 不存在；`node_modules/next/dist/bin/next` 與 `node_modules/typescript/package.json` 均為 0 bytes；PGlite manifest 仍缺失。簡單 G 槽小檔 write/read/hash/rename 探針通過，但它不能證明大量 npm tar 解包可用，根因尚未確認。
- 因 Next 套件不完整，本輪無法從 G 啟動 Next、驗證 G 槽頁面或做瀏覽器／列印驗收。既有 3000 埠服務未觸碰，且其執行路徑未能證明屬於 G，不能視為 G 驗收。未更動同步設定、未連 Supabase、未部署、未 commit/push。
- 尚待完成：先找到能解釋或修復 G 槽大量 tar entry 寫入失敗的依據；在依賴完整前，不啟動 G 服務。依賴恢復後再跑 Mechanical handover TSX transpile/typecheck 與資料回歸、桌面／窄版及 light/tech 瀏覽器檢查、目標設備字型確認，以及實際 A4 列印版面驗收。

### 2026-10-09 G 槽 npm 單套件解包診斷（單包亦失敗，停止擴大測試）

- 既有 npm log 第一筆錯誤在第 197 行：`TAR_ENTRY_ERROR UNKNOWN: unknown error, write`；`errno=-4094`、`syscall=write`、tar entry `LICENSE`、大小 1,074 bytes，目標為 `node_modules/zip-stream/LICENSE`。後續有 tar `Fs` entry 物件與絕對路徑，但 log 沒有 JavaScript 呼叫堆疊。
- 確認原先 `npm ci` 已退出。探針前沒有 `npm-cli.js ci/install` 程序；探針結束檢查時曾看到本次離線 `npm pack wrappy@1.0.2` 程序（PID 129320），立即重新查詢已為 0，沒有殘留安裝程序。未中止任何其他 Node/npm 程序。
- 在 `.codex_tmp/npm-unpack-probe-20261009` 只測試 G 槽暫存路徑：`node .codex_tmp/npm-unpack-probe-20261009/probe.cjs single-write` 寫入並讀回 16,384 bytes 成功，SHA-256 為 `7f7d7f621694cdc133548e9a3eb50d7f1dfdf6abd00bef37d46d18bc7967a433`。這是同步 `fs.writeFileSync` 測試。
- 離線 `npm pack wrappy@1.0.2 --offline --ignore-scripts --no-audit --no-fund --pack-destination G:\我的雲端硬碟\AI\Codex\北農巡檢系統\.codex_tmp\npm-unpack-probe-20261009 --logs-dir G:\我的雲端硬碟\AI\Codex\北農巡檢系統\.codex_tmp\npm-unpack-probe-20261009\npm-logs` 因快取缺少 registry metadata 回 `ENOTCACHED`，沒有發出網路請求。透過 npm 隨附 cacache 對既有 tarball key 做唯讀查找，將 1,676-byte、integrity `sha512-l4Sp/DRseor9wL6EvV2+TuQn63dMkPjZ/sp9XkghTEbV9KlPS1xUsZ3u7/IQO4wxtcFB4bgpQPRcR3QCvezPcQ==` 的 `wrappy@1.0.2` tarball 寫入 G 槽探針目錄；`tar -tzf` 列出 package.json、README.md、LICENSE、wrappy.js 四個項目。
- `node .codex_tmp/npm-unpack-probe-20261009/single-observed.cjs` 以 Node v24.18.0 隨附的 npm `tar@7.5.15` 執行單套件解包。四個檔案全部是 0 bytes，四筆警告均為 `TAR_ENTRY_ERROR UNKNOWN: unknown error, write`；探針以 exit 2 標記失敗。結果與執行輸出保存在 `.codex_tmp/npm-unpack-probe-20261009/single-observed-result.json`、`single-observed.log`，完整摘要在 `diagnostic-summary.json`。
- 因單一小套件已重現串流解包寫入失敗，依指示未再做 64 路併發解包。沒有安裝、修補或覆寫 `node_modules`；沒有碰 3000 埠服務、Drive 同步設定或其他磁碟副本。結果只確認 G 探針上的同步單檔寫入可用、npm tar 串流解包失敗；根因仍未知，不推定為 Drive 同步問題。
- 阻擋仍在：不能安全恢復依賴或啟動 G 槽 Next。需要先找到能讓 Node/npm tar 串流對 G 路徑正確寫入的可驗證方法；並未以降低併發的方式重試全量安裝。
### 2026-10-09 G 槽官方 tar sync 解包對照（失敗，停止）

- 讀取 npm 隨附 `tar@7.5.15` 原始碼確認官方 API 有同步檔案解包：`options.js` 的 `isSyncFile = !!o.sync && !!o.file`，`make-command.js` 將該模式派送到 `extractFileSync`。因此使用 `tar.x({ file, cwd, strip: 1, sync: true })` 對同一個快取 `wrappy-1.0.2.tgz` 進行對照，目標是全新的 `.codex_tmp/npm-unpack-probe-20261009/sync-extract`。
- 同步解包仍失敗：entry `package.json`／`README.md`／`LICENSE`／`wrappy.js` 預期分別為 606／685／765／905 bytes，G 槽輸出均為 0 bytes；壓縮檔 entry SHA-256 與輸出 SHA-256 不符（輸出皆為空檔雜湊 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`）。探針 exit 2。逐檔證據在 `.codex_tmp/npm-unpack-probe-20261009/sync-extract-result.json`，摘要已更新至 `diagnostic-summary.json`。
- 因 npm tar 的同步與非同步解包都不能在 G 槽寫出單一小套件內容，未再測併發、未自製套件安裝器、未改第三方套件或 `node_modules`。這不構成可維護的安裝方案；目前根因仍未知，也不推定為同步問題。
- 仍無法恢復依賴、啟動 G 槽 Next 或做瀏覽器／列印驗收。探針只在 G 專案 `.codex_tmp` 操作；C／其他磁碟、Drive 設定與 3000 埠服務均未觸碰。
### 2026-10-09 G 槽安裝錯誤外部對照與截圖證據限制

- 主端已實際查看使用者提供的截圖，轉述其中顯示一般 PowerShell 也出現大量 `TAR_ENTRY_ERROR UNKNOWN: unknown error, write` 與 `EBADF: bad file descriptor, write`，並已請使用者 Ctrl+C。此代理沒有直接讀取該圖片像素；截圖未顯示完整命令列與 `Get-Location`，因此不能單靠截圖確認執行命令或 cwd。證據 ID：`Sentinel_0fc6ec0793388191b888e6993f3f4776` / `libfile_ba593329abb0819188b043525f79faca`。
- 本端唯讀確認工作目錄是 G 專案根目錄；Node `v24.18.0`、npm `11.16.0`、npm 隨附 `tar@7.5.15`。本端當時沒有 `npm ci`／`npm install` 執行程序。單檔同步寫入成功，但 npm tar 的同步及非同步單套件解包均失敗；完整探針與雜湊見 `.codex_tmp/npm-unpack-probe-20261009/diagnostic-summary.json` 及 `sync-extract-result.json`。
- 依 `docs/AGENT_COLLABORATION_WORKFLOW.md`／`PROJECT_PLAN.md` 的開收工規則，先讀 repo instructions、限制每份檔案單一 writer、記錄命令/結果/範圍/證據路徑、handoff 每輪更新，`Obsidian/04` 只追加已確認事項。本次 agent 清單僅有 `/root`；程序掃描未見其他命令列引用這三份文件；寫入前同時取得三份文件的 Windows exclusive file handles，確認沒有同檔開啟寫入者後才追加，追加後逐檔驗證 SHA-256。

#### 上游官方來源查核（截至 2026-10-09）

- npm/cli issue [#8445](https://github.com/npm/cli/issues/8445) 是高度相近的使用者報告：Windows 10、Node `22.17.1`、npm `10.9.2`，專案在 `G:\My Drive\...`，出現 `TAR_ENTRY_ERROR EBADF: bad file descriptor, write` 與清理 `EPERM`。該議題沒有確認根因或程式修正；作者後續表示再次重現時又能正常工作。後續留言提出 IDE/防毒掃描可能干擾新檔案，屬未驗證假說，不是 npm 官方定論。
- npm/cli issue [#4140](https://github.com/npm/cli/issues/4140) 報告 Windows 虛擬桌面／掛載網路磁碟的 npm 7/8 解包失敗，作者說同機 npm 6 曾可用；議題沒有提供適用所有環境的確認修正。Node 官方版本頁將 Node 14 標為 EOL，因此不採用 Node 14/npm 6 作為建議方案：[Node.js Releases](https://nodejs.org/en/about/previous-releases)。
- `node-tar` 官方錯誤碼文件說 `TAR_ENTRY_ERROR` 表示有效 archive entry 解包時遇到阻止解包的檔案系統錯誤；此分類符合本端結果，但不指出是哪個作業系統或檔案服務環節造成：[node-tar error codes](https://github.com/isaacs/node-tar)。在查到的官方來源中，未找到能確認本案為 Node Windows `writev` 核心缺陷的修正公告；npm issue 報告和本端錯誤只證明解包寫入失敗，不能精確歸因到 writev。
- 本機 npm source 的 `pacote/lib/fetcher.js` 以 `tar.x(this.#tarxOptions({ cwd: dest }))` 串流解包，沒有設定 `sync: true`；`tar.x({ sync: true })` 雖是 tar 套件支援的 API，本端同一小套件測試仍四檔全為 0 bytes。npm 沒有已查證的正式設定可切換到這條同步 API；自行寫 installer 或修改 npm/tar 都不是可維護的 lockfile 安裝方案。

#### 結論與邊界

- 使用者一般 PowerShell 的截圖佐證問題不只出現在本端工具執行中，但缺少完整 cwd/命令；本端 G 路徑單包對照另已重現。官方 npm 議題呈現相似的 G Drive/Windows 現象，但沒有一致且確認的上游修復。IDE/防毒干擾是可查的社群假說，不能據此停用安全工具或宣稱根因。
- 不建議因舊 issue 提到 npm 6 而降到 Node 14/npm 6：Node 14 已 EOL，且該報告是舊版虛擬網路磁碟案例，與目前 G 路徑及單套件 `tar.x` 失敗不等價。任何 runtime/套件管理器切換需先由主端審核影響並確認後才做；本輪沒有更動版本、系統設定、Drive 設定或安全工具，沒有重跑安裝，也沒有碰 3000 埠。
- 目前沒有證據支持可在原 G 路徑、維持 npm `package-lock` 完整性且不改 npm/tar 的安裝修復方案。依賴、G 服務啟動、瀏覽器與列印驗收仍受阻；不部署。
### 2026-10-09 Login CAPTCHA and Logo diagnosis/fix

- G remains the source of truth and C remains the runtime copy. Launcher PID 152388 and Node PID 84780 still listen on 127.0.0.1:3000 in Windows session 1; this work did not restart the service.
- CAPTCHA previously targeted http://127.0.0.1:3000/functions/v1/username-login from localhost. Next has no matching route or rewrite; local HEAD and POST returned 404. The client treated 4xx as a deliberate rejection and did not use the configured Supabase Functions client. No response body was recorded and no remote CAPTCHA action was sent.
- Updated web/lib/username-login.ts so only non-loopback IPv4 self-hosted proxies use same-origin routing; localhost and loopback use the existing configured Supabase Functions client. CAPTCHA, JWT, backend selection, and Supabase function settings were not changed. Added a routing helper and unit test; synced G to C.
- Fixed login and account-apply logo src to /Inspection/v2/system/assets/logo-title.png. Copied only the existing public PNG from G system/assets to G/C web/public/system/assets; SHA-256 1BC728A040C8B2ED49E593F08B5D7D533AF44FDD7B109745BC0145EF18957BD2.
- Verification: routing tests 4/4, test:local-api-routing, typecheck:v2, and git diff --check passed. The corrected logo URL returns HTTP 200 image/png; login and account-apply HTML return 200 with the corrected src. Remote CAPTCHA response and browser-rendered login remain unverified because the action creates a CAPTCHA challenge.
- Config presence only was checked; no dotenv or key values were read. G/C have no root or web dotenv files; NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are absent from process/user/machine environment, while V2 source retains its existing defaults. Of 15 non-dotenv config files, only G _site/system/supabase-config.js is absent from C; V2 does not reference it, so it was not read or copied. The Edge Function CAPTCHA_SECRET status was not checked.
- No Supabase request/write, deploy, push, commit, JWT/CAPTCHA change, or task-2 backup modification. If CAPTCHA still fails after the browser refreshes, the user should verify that the username-login Edge Function has CAPTCHA_SECRET configured in the Supabase Dashboard; do not share or copy its value.


### 2026-10-09 本機驗證與部署狀態更新

- G 是唯一程式碼與文件正本；測試 fixture 僅由 G 單檔同步至 C runtime，SHA-256 一致。`npm test` 與 `npm run typecheck:v2` 在 C 全數通過。
- `npm run build:v2` 曾於 C 成功產生 97 個靜態頁。本輪不在使用中的 `web/.next` 重跑建置：Node PID 84780 仍提供 `127.0.0.1:3000`，Next 開發伺服器與 build 共用輸出目錄，且 Next CLI 沒有 `--dist-dir` 隔離參數。登入與機電交接路由查回 HTTP 200。
- 瀏覽器登入後畫面、響應式版面、A4 實際列印及遠端 CAPTCHA 未驗證；遠端 CAPTCHA 挑戰會建立記錄，因此未呼叫。使用者要求先不要部署；無部署、commit、push、Supabase／正式資料寫入或 LINE 訊息。



#### 收工稽核與 Codex／Claude 接手提示（2026-10-09）

- **本輪變更範圍**：只修正 `tools/admin-line-test-check.mjs` 的本機 fixture，讓它模擬目前 `system_settings.in()` 查詢、未設定 LINE 設定拒絕推播、LINE Push API payload 及送出／失敗稽核。測試以 stub `globalThis.fetch` 取代網路呼叫，未送出 LINE。G→C 單檔同步後 SHA-256 相同：`9A793510E3AD611D0FDE4ADFFFD9C750A9F802C6F46712635CB7E4DC81644017`。本輪沒有新增目錄；前批登入標誌圖位置是 `web/public/system/assets/logo-title.png`，登入路由 helper/test 與機電列印 helper/test 都留在既有 `web/lib/` 結構。
- **交接簿共用設計**：三本簿沿用 `handover-sheet.css` 的 `hs-*` 工具列、表頭、指標、班卡、簽名、簽核及 A4 骨架，及 `handover-sheet.tsx` 的共用標題／圖示與日報元件。機電課保留工作內容、人員、結果、備註、費用、續辦、修正歷程及原簽認；角色、隔日起簽、三班完成門檻與 server 權限重驗不變。列印以 0.82 為單頁最低縮放，低於門檻切 `.is-multipage` 原尺寸多頁，重複表頭並避免拆開簽核／交接區。共用 `hs-*` 外觀只在共用檔維護，各簿特有內容留在各自 CSS，列印可覆寫。
- **本輪實際命令／結果（C runtime）**：`npm test` exit 0；`npm run typecheck:v2` exit 0；`npm run test:admin-api` exit 0；`npm run test:mechanical-print-fit` exit 0（4/4，integration checker passed）；`git -C G diff --check -- tools/admin-line-test-check.mjs PROJECT_PLAN.md handoff.md Obsidian/04-開發與部署.md` exit 0。GET login 與 mechanical handover 都 HTTP 200；Node PID 84780 仍監聽 `127.0.0.1:3000`。
- **未完成／阻擋**：本輪未重跑 build，因活躍 Next dev server 使用同一 `web/.next`，Next CLI 沒有 `--dist-dir` 隔離選項；先前 C build 已成功產生 97 靜態頁。瀏覽器登入後 UI／響應式、實際 A4 短長報表、裝置字體、遠端 CAPTCHA 尚未驗收；瀏覽器啟動遭執行環境政策拒絕，遠端 CAPTCHA 挑戰會寫入 challenge 紀錄而本輪未呼叫。G 槽 npm tar 解包問題仍未修復，但已核准 C runtime 的全套測試與 typecheck 通過。
- **下一位 Codex／Claude 開工步驟**：從 G 專案根目錄開始；先讀根目錄 `AGENTS.md`、`CLAUDE.md`、`ANTIGRAVITY.md`，再讀 `web/AGENTS.md`／`web/CLAUDE.md` 和 `docs/AGENT_COLLABORATION_WORKFLOW.md`，並照 `antigravity-workflow` 技能 Open 段落檢查 handoff、計畫與唯讀 git status。G 是唯一 source；C `Inspection-G-runtime` 僅供目前執行，任何必要更新只能 G→C 單檔複製並核 SHA-256；不碰 task-2 舊備份、不另建 QA 副本、不變更 Drive／安全設定。維持單一 writer，不停止目前 server；先完成可用的非瀏覽器靜態工作。不可繞過瀏覽器政策，不部署、commit、push、連正式 Supabase／寫正式資料或發 LINE。用 Close 段落更新同一份 handoff／計畫／Obsidian 紀錄；本次沒有新建日誌或空紀錄。

## 2026-10-09 續作 checkpoint：共用 UI、資安計畫與歷史索引

### 本批實作與檔案差異

- 找到共用元件實際缺口：LocationAnalysisAdmin 的「異常次數」傳入 red，但 MetricCard 原型 tone 是任意 string，globals.css 沒有 .metric-card.red，畫面因此使用預設青色。
- 修正 web/components/MetricCard.tsx，tone 改為 cyan／green／amber／violet／red 封閉型別；web/app/globals.css 以既有 var(--red) 加紅色上框；新增 tools/metric-card-standard-check.mjs，並在 package.json 登記 test:metric-card-standard。
- G→核准 C runtime 單向更新上述四個檔案，SHA-256 對照：MetricCard.tsx FB080A59192DAB6DB971ACE7FF21E0874F51A93D25803577AC29331E76F4E2F0；globals.css 39390B6FA57B6CA02FBA74D89326C10E3B918192817192084D8592FFE62A0726；package.json 408DBA9AEC133BDE6DEFA6F82300557A4E7271CC6308BBF69763AC4814E3582E；checker 9B8FCF84E4B291FF73DE4C7D49C325AA3490CF1152AADDBF11C2F5D5CC074DB4。
- 無新增目錄；新增一個檢查器至既有 tools/。其餘記錄寫入既有 SECURITY_POSTURE.md、PROJECT_PLAN.md、handoff.md、Obsidian/04-開發與部署.md、Obsidian/05-待辦清單.md。沒有重排或刪除舊紀錄。

### 實際驗證與證據

- 本輪 C runtime 驗證：`npm test` 全套 exit 0（包含新增 `test:localized-date-input` 5/5 與 `test:weather-widget-layout` 4/4）；`npm run typecheck:v2` exit 0。
- G 工作樹 git diff --check 對本批程式檔案通過。C/G 上述四檔 hash 一致。
- 較早同日的獨立紀錄有 npm test 全套通過、npm run test:admin-api、機電列印 fit 4/4 與相關 handover/style check 通過；該全套未在本批重跑，新的 red-tone 變更由上述定向測試與 typecheck 覆蓋。
- 本批未跑 build、browser、實際 A4 列印、正式資料庫或 production security scan；靜態測試不等於全站資安或視覺驗收。

### 尚待驗收清單規格

- 桌面瀏覽器 100% zoom，CSS viewport 1440／1100／600px；檢查入口、一般內容頁、交接簿與 Weather，分別在 light／tech 主題確認欄位折行、無水平溢出、頁首／卡片／表格一致性。
- 核對 Noto Sans TC／Rajdhani 的實際 computed font 與繁中字形。字型檔未隨 web/public 打包，故目前只確認 fallback token，未確認目標裝置安裝與實際 fallback 字形。
- 使用隔離合成資料測機電短報表及長報表的 A4 預覽：0.82 縮放界線、多頁原尺寸、重複 thead、工作列不截斷、簽核 footer 與交接勾稽區不拆頁。不得以正式已簽案件作測試資料。
- 執行環境政策曾拒絕啟動瀏覽器，且目前沒有可呼叫的 browser 工具；不得繞過政策或反覆嘗試不同啟動法。可用的授權瀏覽器工具出現後再完成，否則持續標示未驗證。
- build:v2 現為 next build web，web/next.config.ts 設 output: export，未設定 distDir；G/C 的 web/.next 存在且由正在運作的 C server 共用。沒有既存安全的獨立 build output 路徑；本批未跑 build、不碰 .next。需先有不碰服務且不建立未核准副本的隔離方案。
- 開工技能要求的唯讀 fetch 已完成：截至本次檢查 origin/HEAD 領先本地 2 commits。工作樹有大量既存修改，沒有 pull、commit 或 push；先逐項審視遠端差異後才可考慮同步。Google Drive 雲端同步回執無法由本機工作樹確認，狀態標未驗證。

#### 第一輪靜態模組、路由與共用元件盤點（2026-10-09）

- **方法與範圍**：從 `web/lib/modules.ts` 列出現行系統／子系統，對照動態 route 建置、`WorkspaceRouter` 分派、`AuthGate`／`hasModuleAccess` 及共用頁首／按鈕／卡片檢查。這是程式拓樸盤點，不等於每個角色的實際資料權限或瀏覽器視覺已驗收。

| system key | modules | module route slugs | route dispatcher |
| --- | ---: | --- | --- |
| admin | 11 | users, permissions, locations, audit, alerts, notices, layouts, cycles, costs, locanalysis, health | AdminWorkspace |
| workorder | 6 | requests, dispatch, orders, attachments, analytics, repairmap3d | ModuleWorkspace / WorkorderExtras / RepairMap3DModule |
| guardpatrol | 6 | checkins, points, shifts, notifications, records, map3d | OperationsWorkspace |
| handover | 7 | records, mechanical, business, guard, open-items, equipment, mechanical-schedule | OperationsHub; seven permission-filtered root cards |
| equipment | 8 | assets, plans, records, contracts, documents, costs, monitoring, materials | EquipmentWorkspace |
| structuremap | 6 | areas, markers, floor2d, floor3d, models, relations | StructureMapModules |
| vehicle | 5 | requests, vehicles, drivers, managers, logs | VehicleWorkspace |
| meetingroom | 4 | bookings, changes, notifications, rooms | MeetingWorkspace |
| officialdocs | 1 | routing | OfficialDocsWorkspace |
| marketanalytics | 6 | command-center, interactive-dashboard, overview, sources, templates, comparison | marketAnalyticsWorkspace |
| dashboard | 0 | dedicated `/dashboard/` route | no dynamic system module |
| marketboard | 2 | executive, ticker | MarketBoardWorkspace |
| vehicletracking | 5 | live, history, devices, geofences, alerts | VehicleTrackingWorkspace |

- **路由與權限結論**：共 13 個 system definition／67 個 module；`[system]/page.tsx` 只為有 module 的 12 個系統產生入口，`[system]/[module]/page.tsx` 使用 `allModuleParams` 產生 67 個子路由。系統入口由 `SystemHubClient` 先檢查大系統權限；子路由通過 `WorkspaceRouter` 的 `AuthGate`／`hasModuleAccess`，並保留 `handover/guard-approve` 專用例外。交接簿根路由由 `OperationsHub` 顯示七張子系統卡，依 `hasModuleAccess` 及明確 `handover/guard-approve` 例外篩選；子路由仍由 `AuthGate`／`WorkspaceRouter` 套用既有權限。
- **共用外觀檢查**：`AppShell` 接上 `SystemPageHeader`；`test:page-headings`、`test:button-standard`、`test:module-card-standard`、`test:font-tokens`、`test:input-select-standard`、`test:handover-style` 通過。SYS-04 七卡根入口與 `MetricCard` red tone 亦納入現有檢查。
- **首批差異修正**：新增 `web/lib/weather-widget-layout.test.ts`，固定檢查桌面地圖在左、縣市／鄉鎮下鑽在右、鄉鎮預設收合、寬度縮小後先地圖後資訊，並將測試挂入 `npm test`。
- **首批元件修正**：`LocalizedDateInput` 在 native picker 模式會鎖住手動文字輸入，但原生日期選擇器／日曆按鈕原先未依 `readOnly`／`disabled` 停用，存在共用元件的屬性契約差異。已以 `localized-date-input-access.ts` 集中狀態映射，讓兩種模式的手動輸入、原生選擇器與鍵盤按鈕一致適用讀取／停用狀態。
- **對應回歸**：`test:localized-date-input` 5/5、`test:weather-widget-layout` 4/4；`npm test` 全套命令 exit 0，並包含兩個新測試；`typecheck:v2` exit 0。本輪不停服務，不建置，不連正式資料庫。
- **關鍵檔案索引**（G=C SHA-256）：`package.json` F7E9AC71A80B507143FD6E12764C684B80F34453EF55D2C4AE4D1A3232199078；`web/components/LocalizedDateInput.tsx` 3C914965A6DBC9CEBF7CD6782A2928F2F44C63F08D7ABC92AB6DB1C4CC1470AF；`web/lib/localized-date-input-access.ts` AA23448ECF7D579C094A88D611C0DEFE0D9E6B16492E3840806228714F1D6847；`web/lib/localized-date-input-access.test.ts` C95AD1B2321D05BF2E80A8186E1B55815EB6B1C7843D4AF9DDF4CFADA59CE0E9；`web/lib/weather-widget-layout.test.ts` 38045BEA7FCE5303895D3E9DAACB6079F06EE854A0A7AD08C3AEB846DF70D641。
- **尚未完成**：本批完成靜態 route 拓樸與相關共用元件修正，不代表完成 67 路由的角色×資料全矩陣、每頁 loading／錯誤／競態驗證、瀏覽器視覺、字體實機與 A4 實印。相關待驗收項繼續保留。

### 本階段四項待辦

- [ ] **共用 UI／debug 矩陣**：已完成 13 系統／67 子系統的靜態路由拓樸與共用元件盤點，並恢復 SYS-04 七卡根入口、LocalizedDateInput 存取狀態，補齊 Weather 版型回歸；各角色資料權限矩陣、逐頁 loading／錯誤／競態與裝置／列印視覺證據仍待完成。
- [ ] **資安 S1→S3**：18 類方法、門檻與建議責任已記入 SECURITY_POSTURE.md；逐項實測、責任人指派及 RPO/RTO/SLO 決策仍待完成。
- [ ] **瀏覽器／字體／A4**：依 1440／1100／600px、light／tech、字型 fallback 與機電長短報表清單驗收；目前瀏覽器啟動受執行政策阻擋，均未作視覺／列印通過宣稱。
- [ ] **2026-09-01 前歷史紀錄**：179 節逐段索引已附在 Obsidian/04-開發與部署.md，未刪除或移動原文；逐項判斷保留、整理或摘要仍待人工審閱。

### G 專案實際分工、依賴、驗收與估時（2026-10-09）

範圍只涵蓋本網站、debug／UI、資安、派車 LINE 與 G 專案自身歷史。每個狀態明確區分已完成、待排程、受阻；阻塞工作不標成「進行中」。估時是工作量假設，不是全系統完工承諾。

| 工作 | 責任人 | 優先級 | 依賴 | 驗收條件 | 估時假設 | 狀態／證據 |
| --- | --- | --- | --- | --- | --- | --- |
| G 專案唯一寫入、整合與可行本機驗證 | Codex（唯一 writer） | P1 | 核准 G／C 路徑與可用本機 Node | G 改動具體、定向測試與 typecheck 有結果、單檔 G→C hash 一致、保留其他 dirty worktree | 已完成的 MetricCard 修正與本批定向驗證；不回填未量測耗時 | 本輪核心項已完成；證據見本段 hash 與下方命令 |
| 官方資安研究及規格整合 | 獨立官方研究 → Codex 整合 | P1 | 官方標準／供應商來源 | 版本、控制範圍與限制有正式來源；整合於 SECURITY_POSTURE，不把規劃當通過 | 研究已交付，整合已完成 | 已完成；SECURITY_POSTURE 收錄 ISO、ASVS、Supabase、LINE、Next.js 官方連結 |
| UI／debug 驗收矩陣研究 | 獨立 UI/debug 研究者；Codex 負責來源盤點與證據 | P1 | 矩陣交付（已完成） | 每頁記實際 route／入口、角色／資料、PROJECT_PLAN 規格、元件／CSS、字級行高間距對齊、控制項、各狀態、競態／返回、裝置／列印與證據狀態 | 研究已交付；Codex 靜態來源盤點先估 4–8 小時，假設 route/component 可從 repo 追溯；需瀏覽器的驗收另估 | 研究已完成並整合於下段；實際逐頁盤點待排程 |
| UI／debug 實際源碼盤點及低風險修正 | Codex | P1 | 已交付矩陣；一次一 writer | 對全站版型、三本交接簿、主管每日簽核／說明、日期、報修維修、設備十筆分頁、派車 LINE、行情記錄實際路由／元件／樣式／角色，並附通過／失敗／受阻／未測證據 | 第一輪 4–8 小時；遇到 API／資料語義問題另列依賴，不以靜態檢視當完成 | 結構盤點已完成；已修交接根路由／日期欄位／Weather 回歸檢查，全角色、競態、視覺與列印矩陣仍待逐項完成 |
| 瀏覽器、裝置與 A4 視覺驗收 | Codex | P1 | 執行環境允許的授權瀏覽器、合成測試資料；不得繞過政策 | 依下方視窗／觸控／縮放／列印樣本完成實際視覺證據 | 授權工具及資料就緒後先估 0.5–1 工作日；若修正缺陷另計 | 受阻；瀏覽器啟動曾被政策拒絕，沒有視覺／PDF／真觸控證據 |
| S1 靜態資安執行 | Codex；安全 owner 復核高風險 | P1 | SECURITY_POSTURE 已建立；不得讀 secret 值或連正式服務 | 18 類中 S1 可本地檢項有命令、遮蔽證據與結果；P0/P1 未處置不得進 S2 | 初次盤點約 4–8 小時，假設既有工具可用；scanner 發現另估 | 首批已執行；修正 fail-closed 缺陷、相依漏洞更新及回歸通過；剩餘 S1／完整矩陣待完成 |
| S2 隔離驗證與 S3 營運治理 | Codex＋DBA／維運／業務 owner | P0/P1 | 核准的隔離環境、測試帳號與合成資料；RPO/RTO/SLO、負載門檻與 owner 決定 | 正反權限、Storage、LINE 重播／冪等、回復、40 併發及 DB＋Storage 復原證據符合 SECURITY_POSTURE 門檻 | 需環境與責任人確定後估；目前不可可靠估時 | 受阻，未開始；不能以核准 C runtime 代替隔離安全環境 |
| 指定 LINE 單次通知狀態核對 | 使用者提供有效授權登入；Codex 先查送達狀態 | P1 | 有效登入、可查歷史送出狀態；需確認未送且有明確送出授權 | 先查是否已送；若已送或結果不明即停止，不重送；stub failure／timeout 不可宣稱成功 | 登入與送達查詢可用時約 10–30 分鐘；若查詢不可用則停止且不估完成 | 受阻，這一輪沒有送出 LINE |
| 2026-09-01 前歷史內容審閱 | Codex 整理；有爭議規範由業務 owner 決定 | P2 | 179 節候選索引已完成 | 每節決定保留／現行規範已吸收／可摘要並附理由；未明確授權不刪除、不移動 | 約 2–4 小時，假設每節初讀 1–2 分鐘；需交叉查程式時另計 | 索引完成，內容判斷待審 |

#### UI／debug 逐頁驗收矩陣規格（研究已交付；實際盤點未宣稱完成）

每個 route／入口一列，至少填：實際路由與入口、角色及資料來源、PROJECT_PLAN 對應規格章節、元件與 CSS 唯一來源、字級／行高／間距／對齊、控制項與權限、loading／空／錯誤／成功／無權限狀態、非同步競態／返回與 direct-link、裝置與列印條件、命令／檔案／結果證據，以及「通過／失敗／受阻／未測」之一。不可用相鄰頁面的結果代替本頁證據。

覆蓋範圍：全站布局；機電、業管、駐警隊三本交接簿及主管每日簽核／說明；日期欄位；報修／維修；設備 10 筆分頁；派車及 LINE；行情。每一列先從實際路由與程式確認入口、權限與資料欄位，不推測角色或路徑。

低風險順序：①記錄現況與路由；②共用 CSS token／樣式來源；③按鈕、欄位、日期呈現（禁止改日期儲存格式或時區）；④先驗一本文字／資料簿，再驗其餘兩本；⑤其餘模組；⑥裝置與列印。每一步只修有證據的問題，保存修正前後對照及定向測試。

指定 debug 案例：雙擊＋Enter 同次只能發起一次送出（前端防重與 server 冪等分別取證）；Modal 關閉／取消後舊 response 不得重開視窗或覆蓋新表單；日期 A 慢於 B 時只能顯示 B；篩選分頁的舊錯誤不得蓋新結果；返回／forward／direct-link 可正確載入；撤權後 server 拒絕且 UI 不顯示成功；空／loading／timeout／retry 狀態清楚；送出結果不明不得盲目重送；設備 0／1／10／11／20／21 筆及篩選後頁碼正確；簽核長說明保留內容與正確日期；月底、年底、閏日及時區邊界不改資料語義；報修多人同時更新可辨識衝突；LINE stub failure／timeout 不得稱已送；行情 0 與 null 分開且不產生 NaN。

裝置樣本不是新增 breakpoint：360×800、390×844、768×1024、1024×768、1280×800、1440×900，另測既有 breakpoint 前後 1px、鍵盤焦點、200% 縮放與真觸控。A4 使用短／長資料、多頁與長單列，確認不漏字、不裁切，列印後 screen 樣式不受污染。靜態檢查、Promise 競態測試與純列印計算可先做；無法用它們宣稱目視 PDF 或真觸控通過。執行環境已拒絕啟動瀏覽器，不得以本矩陣為由重試或改用 headless 繞過政策。

- [ ] **共用 UI／debug 矩陣**：已完成 13 系統／67 子系統的靜態路由拓樸與共用元件盤點，並恢復 SYS-04 七卡根入口、LocalizedDateInput 存取狀態，補齊 Weather 版型回歸；各角色資料權限矩陣、逐頁 loading／錯誤／競態與裝置／列印視覺證據仍待完成。
- [ ] **行情 MOA 2026-10-08 失敗根因確認**：10/10 run #88 `38044837170`（head `d5ee8f6`）記錄第一市場蔬菜第 1 列 `CropCode` 為字串 `'-'`，同一錯誤註記出現兩次。該 run 無 artifacts，完整回應列與官方來源 schema 仍未取得，根因未確認；保持 fail-closed，不推定休市 placeholder、不放寬格式、不略過列。新增 `'-'` 離線回歸測試後 25/25 通過。取得授權保存的原始回應前，不重跑正式匯入、不呼叫 DB／MOA。既有 `--dry-run` fallback 仍可能讀正式 DB 近 90 天 `code_items`，不能視為離線模式。
- [ ] **資安 S1→S3**：18 類方法、門檻與建議責任已記入 SECURITY_POSTURE.md；逐項實測、責任人指派及 RPO/RTO/SLO 決策仍待完成。
- [ ] **瀏覽器／字體／A4**：依矩陣中的裝置、light／tech、字型 fallback 與機電長短報表清單驗收；目前瀏覽器啟動受執行政策阻擋，均未作視覺／列印通過宣稱。
- [ ] **2026-09-01 前歷史紀錄**：179 節逐段索引已附在 Obsidian/04-開發與部署.md，未刪除或移動原文；逐項判斷保留、整理或摘要仍待人工審閱。

## 2026-10-09 origin/main +2 唯讀審查

- 現有 refs 顯示 `HEAD...origin/main` 為 `0 2`；只讀檢查既有 refs，未 fetch、pull、merge、commit 或 push。兩個提交為 `e215de4` 與 `279e4c6`。
- `git diff --stat HEAD..origin/main` 只有一個新檔 `docs/開發歷程-由萌芽到開發.md`，累計 157 行；沒有應用程式、測試、資料庫或部署流程差異。
- 目前 `origin/main` 可達提交數為 1,803、追蹤檔案 2,382。新文件寫 1,802 次提交；1,802 正好是最新提交 `279e4c6` 的父版本可達數，應在交付稿說明統計是否排除本文件更新提交。追蹤檔案數 2,382 與 tree 統計相符。
- 文件敘述「13 系統／67 子系統全數上線」及正式資料、服務已在地端運行；這兩筆文件提交本身沒有部署證據。本輪也未做正式環境讀回，交付前需用既有 release／主機驗收紀錄佐證，不能以本機測試代替。
- 後續驗證：`test:weather-widget-layout` 4/4、`test:localized-date-input` 5/5、`typecheck:v2` exit 0。瀏覽器視覺、角色／資料全矩陣、A4 實印及 SECURITY_POSTURE 18 類實測仍未完成；本輪未部署。

## 2026-10-09 S1 靜態資安首批（本機）

- 範圍：只讀檢視 app-api／admin-api 的身分驗證、帳號停用防護、系統／模組權限解析、user-scoped DB client、輸入驗證與現有負向測試；未讀 secret 值、未連正式 Supabase／API、未改資料庫或 RLS。
- 確認缺陷：app-api 查詢個人 `user_system_access` 失敗時只記錄錯誤，仍可能將缺少的個人覆寫當作 inherit，套用角色大系統授權。新增 `supabase/functions/app-api/system-access.ts`，查詢錯誤時對非系統管理員 fail-closed；成功查詢時保留既有 allow／deny／inherit 與系統管理員行為。`index.ts` 傳入查詢失敗狀態；加入 3 個純合成測試、靜態檢查及 Edge Function 同步清單。
- 套件：lockfile 原有兩項 High advisory，分別為 `sharp` 0.35.4（Next optional dependency）及 `source-map-js` 1.2.1（PostCSS／Next dependency）。依官方修補版只更新相容範圍內 lockfile 至 `sharp` 0.35.5、`source-map-js` 1.2.2；`package.json` 未變、未安裝套件。更新後 `npm audit` 為 0 vulnerabilities。實際執行路徑／可利用性未確認；見 [sharp GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) 與 [source-map-js GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)。
- 驗證：`test:permission-fail-closed`（含新增 3/3）、`test:permission-revocation` 3/3、`test:app-api-handlers` 41/41、`test:admin-api` 6/6、完整 `npm test` exit 0、`npm run typecheck:v2` exit 0、`deno check --no-lock supabase/functions/app-api/index.ts` exit 0、`npm audit` 0 項。G→C 涉及程式與 lockfile 的 7 個檔案 SHA-256 一致。
- 尚未完成：S1 其餘資料流／資產／secret 掃描與全入口負向測試；全角色／子系統／個人／跨單位權限矩陣；正式 runtime、RLS 與 Storage 驗證。S2 等核准隔離 Supabase、測試帳號及合成資料；S3 等 owner 與 RPO/RTO/SLO。無部署、commit、push、build；本機服務保持原狀。

### 2026-10-09 收尾狀態（依使用者要求不部署）

- 已完成：機電交接簿套用三本共用版型與 Guard 日報元件；保留機電工作欄、續辦及修正紀錄，長報表列印改為可分頁。
- 已完成：Guard 區間列印入口與機電管理按鈕標示；天氣地圖桌面版在左、縣市／鄉鎮下鑽在右，鄉鎮預設收合；LocalizedDateInput 唯讀契約修正。
- 已完成：補齊 app-api 系統與子系統權限查詢 fail-closed；任何必要權限表查詢失敗都不再讓舊交接白名單回退放行。正常查詢時仍保留個人設定優先、角色設定次之的權限順序。
- 最新驗證：C 執行副本 npm test exit 0、npm run typecheck:v2 exit 0、deno check --no-lock supabase/functions/app-api/index.ts exit 0；權限測試 8/8、app-api handlers 41/41、admin-api 19/19。G 與 C 的受影響程式檔以 SHA-256 核對一致。
- 尚未完成：瀏覽器實際列印／視覺驗收、正式 Edge endpoint／DB-RLS／Storage 授權驗證；部分 inline API 尚缺直接 route-level 測試。詳 SECURITY_POSTURE.md。
- 相依風險：lockfile 已更新，但未執行 npm install／ci；node_modules 仍是舊版本。不得將 lockfile audit 結果描述為執行中的 server 已套用修補。
- 部署狀態：未部署。未 build、未 commit、未 push；使用者明確要求先不要部署。PID 84780 的 127.0.0.1:3000 服務保持原狀，沒有停止或重啟。

### 後續工作順序

1. 取得使用者部署授權後，先依正式 release 流程確認 staging、權限與回復方式；本輪不執行。
2. 在核准的本機維護時段更新 C 執行依賴並重啟本機服務，再做瀏覽器畫面與跨頁列印驗收；目前服務不可中斷。
3. 另補 app-api inline actions、admin-api 高風險 actions、patrol-checkin 的假資料庫 route-level 授權測試；對外環境測試需明確核准及隔離測試租戶。

- 權限相容性待收斂：admin-api 仍有舊交接白名單寫入 action，但目前 web source 無直接呼叫；其資料尚未盤點，尚未決定遷移至 user_module_access 或退役。部署前需完成映射審核；本輪未讀寫資料庫。

## 2026-10-09 對使用者階段排程（依已知證據；不含部署）

以下是主動作業時間，不是日曆日期；等待瀏覽器、測試帳號、維護時段與 owner 決策的時間不計。估時以一位工程師、每工作日約 6–8 小時、沒有重大新缺陷為假設；各列可部分平行，不加總成全站完工日。

### 前置條件（不是第一里程碑）

- C runtime 相依更新：最新成果是 package-lock 已更新、lockfile audit 0 vulnerabilities；node_modules 尚未更新，PID 84780 的本機服務仍在 127.0.0.1:3000。下一門檻是取得本機維護時段，更新核准的 C 執行副本、核對實際版本並做登入前 smoke check。責任：Codex 執行，使用者安排不中斷工作的時段。阻礙：目前不得停止或重啟服務。估時：0.5–1 工作日，假設套件安裝成功；安裝失敗需先診斷，另估。
- 驗收資源：目前沒有可用瀏覽器與隔離測試帳號／合成登入資料；既有測試是程式、靜態契約與假資料庫測試。要開始實際驗收，需提供可使用的核准瀏覽器和隔離測試帳號，並確認測試資料不指向正式案件。負責提供環境／帳號者：使用者或系統管理者；Codex 不會改用正式帳號或正式資料。

### 第一里程碑：網站正常登入、操作與列印驗收

- 最新成果：相關程式與回歸檢查已完成；完整 npm test、typecheck:v2、Deno app-api check 通過。這只代表程式／測試完成，尚未證明瀏覽器登入、真實互動或紙本輸出可用。
- 下一驗收門檻：在隔離環境由核准瀏覽器驗證登入／登出、指定主要操作流程、駐警隊與機電日報操作，以及短／長日報實際列印；保存錯誤與修正證據，由業務 owner 確認結果。不得使用正式案件。
- 責任：Codex 執行與修正；業務 owner 確認操作與列印內容。依賴／阻礙：前置 runtime 更新、瀏覽器、隔離帳號與合成資料全部就緒。
- 剩餘主動作業時間：1–2 工作日，假設只做首輪代表流程、沒有重大缺陷；缺陷修正另估。未滿足前置條件前無法排日曆日期。

### 全站 UI／debug 矩陣

- 最新成果：已完成 13 系統／67 子系統路由與共用元件的靜態拓樸盤點；機電交接、Weather 地圖位置／鄉鎮預設收合、LocalizedDateInput 等修正已加入測試。
- 下一驗收門檻：依 67 個模組逐頁確認角色／資料、loading／空／錯誤、競態／返回、響應式、鍵盤與實際列印；每列保存通過、失敗、受阻或未測證據。責任：Codex 逐項驗收與修正；系統／業務 owner 確認角色及預期資料。
- 依賴／阻礙：瀏覽器、代表性隔離角色帳號和測試資料；部分頁面需 owner 說明業務預期。靜態測試不能取代視覺驗收。
- 剩餘主動作業時間：5–10 工作日，假設一輪 67 模組盤點、共用缺陷可批次修正且不涉及大幅重構；重大缺陷另估。

### 資安 S1、S2、S3（分開驗收）

- S1 本機檢查：最新成果為 18 支 Edge Function 原始碼靜態盤點、app-api 權限 fail-closed 修正與回歸；權限測試 8/8、app-api handlers 41/41、admin-api 19/19，lockfile audit 0 vulnerabilities。下一門檻是補齊高風險 inline API／patrol-checkin 的 route-level 負向測試，並逐項核對 18 類清單的本機可測項。責任：Codex 執行，安全 owner 復核高風險。阻礙：無正式端點測試權限，但本機工作可先做。估時：2–4 工作日，假設既有合成 fixture 可重用。
- S2 隔離驗證：目前未開始，沒有隔離 Supabase、測試帳號及合成 Storage／webhook 資源。下一門檻是 DBA／安全 owner 提供一次性隔離環境與明確範圍；再驗證正反權限、RLS／Storage、重播與冪等。責任：DBA／安全 owner 提供環境與授權，Codex 執行。估時：資源備妥後約 2–5 工作日；環境未提供前不能估日曆時間。
- S3 營運治理：目前待 owner 決定 RPO／RTO／SLO、資料保留、復原責任與負載門檻。下一門檻是這些目標及負責人書面確定，再建立復原演練範圍。責任：業務、維運、DBA owner；Codex 協助整理證據。估時：目前無法合理估，先解除目標與責任人未決。

### 舊交接權限表退役決策

- 最新成果：app-api 已不以舊 user_handover_module_access 作新版權限查詢失敗時的回退授權；admin-api 仍保留寫舊表的 action，現行 web 原始碼沒有直接呼叫。沒有讀取或修改既有資料。
- 下一驗收門檻：IAM／DBA owner 決定保留映射或退役；核准只讀盤點及新舊權限對照規則，再於隔離資料庫驗證遷移／退役方案。責任：IAM／DBA／業務 owner 決定資料語意，Codex 實作與測試。阻礙：既有 grants 未盤點、映射未核准；不得推測為無使用者。
- 剩餘主動作業時間：決策與隔離資料就緒後約 1–2 工作日完成程式／測試方案；若資料例外多或需實際資料修復，另估。未核准映射前不執行遷移，也不碰正式資料。

### 部署狀態

- 使用者已要求先不要部署，因此沒有排定部署日期。下一門檻是第一里程碑與必要安全驗收通過，再由使用者明確授權 release；取得授權前不執行。部署本身的時間不納入上述估算。


### 登入 CAPTCHA 本機修正（2026-10-10，未同步／未部署）

- 根因已由原始碼確認：登入頁雖先呼叫載入 CAPTCHA，但 functions.invoke 使用的 Supabase Functions transport 會先等待 Auth getSession()；尚未建立 session 時，挑戰請求可能卡在 Auth 初始化。Next 本機開發也曾把 localhost 當成 Edge Functions 來源，實際沒有相應路由。
- G 正本修改 web/lib/backend-origin.ts、web/lib/config.ts、web/lib/supabase.ts、web/lib/username-login.ts、web/app/login/page.tsx，並擴充 web/lib/username-login-routing.test.ts。開發環境改走既有雲端 Supabase 公開端點；CAPTCHA 以不依賴登入 session 的公開請求載入，設 15 秒逾時、不重試，並避免重複請求；登入按鈕等 CAPTCHA 載入完成才可使用。一般帳密登入仍沿用既有登入流程。
- 驗證：node --experimental-strip-types --test web/lib/username-login-routing.test.ts web/lib/username-login-error.test.ts 14/14 通過；6 個 TS／TSX 檔以記憶體 esbuild transform 語法檢查通過；git diff --check exit 0。未執行完整 typecheck、build 或瀏覽器驗收。
- 本機 127.0.0.1:3000/Inspection/v2/login/ 曾回 HTTP 200，但讀到的靜態 bundle 是修正前版本。G 目前 branch 為 codex/html-daily-report-preview、HEAD be0f47335d5681782c423662792b9fd2fe2049b2；C 核准 runtime 未同步，相關五個來源檔仍是修正前 SHA-256。新測試檔留在 G 工作樹未追蹤，未 stage。
- 先前唯一一次獲准的 CAPTCHA POST 回 HTTP 200，但回應本文已丟棄，不能證明回傳挑戰內容或圖像可見。本輪未再發請求，因此挑戰 payload、畫面及實際登入均未驗證。
- 後續若要確認目前服務，需先取得一次涵蓋 G→C 同步及本機 HMR／瀏覽器驗收的明確範圍；該驗收會再發 CAPTCHA 請求。沒有重啟服務、寫 DB／Storage、登入正式帳號、build、commit、push 或部署。


### 登入 CAPTCHA 驗收追蹤（2026-10-10 更新）

- 依明確核准，已將 G 的六個執行期必要檔同步至指定 C runtime：backend-origin.ts、config.ts、supabase.ts、username-login.ts、username-login-error.ts、login/page.tsx；同步後六個 SHA-256 與 G 相符。C 與 G 的 username-login-routing.ts 原本雜湊相同而未動；C 的 username-login-routing.test.ts 與 G 不同，為避免覆蓋既有工作而保留。
- G 登入回歸測試重跑 14/14 通過。C 六個 TS／TSX 檔以記憶體 esbuild transform 檢查通過，沒有輸出 build 檔。
- 3000 埠未找到 LISTEN 程序，Test-NetConnection 回報 false，唯讀 GET 登入頁連線遭拒；因此無法確認 HMR 或目前服務載入的 bundle。工具環境沒有可用的瀏覽器自動化介面，沒有啟動／重啟服務，也沒有發新的 CAPTCHA 請求。
- CAPTCHA 圖片實際呈現、瀏覽器中的 15 秒逾時及重複請求行為仍未驗收；相關單元測試已通過。沒有提交帳密、解題、停用驗證、DB／Storage 寫入、build、commit、push 或部署。


### CAPTCHA 執行副本切換與驗收（2026-10-10 更新）

- C 的既有安全腳本 start-local-preview.ps1 已核對：僅在 3000 空閒時執行 next dev web --hostname 127.0.0.1 --port 3000；若已占用即退出且不停止程序。先前的 3000 程序確認來自舊 task-2：PID 25136 → 52068 → 51988 → 41296，父程序 49324。依使用者批准並重驗命令列、父子關係、task-2 路徑與建立時間後，只停止四個網站程序，外層 shell 未動，舊檔保留。
- 已使用 C runtime 安全腳本啟動新版；目前 127.0.0.1:3000 由 PID 42632（命令列含 2026-10-09 Inspection-G-runtime）監聽。啟動終端輸出保留於本次工具 session；C 的 web/.next/dev/logs/next-development.log 目前只有啟動 LOG，沒有阻擋警告。
- 127.0.0.1 與 localhost 的登入頁 GET 均 HTTP 200；兩者各 16 個 JS 與 1 個 CSS 資產全數 HTTP 200，bundle 均含 invokePublicLogin、captchaInFlight、captchaLoading 新標記。兩個 hostname 的 /Inspection/v2/_next/hmr WebSocket 均開啟，首訊息 metadata type 為 isrManifest。
- 舊 task-2 Next 日誌的完整 623-byte內容有一筆 WARN：從 127.0.0.1 請求 /Inspection/v2/_next/hmr 被跨來源開發資源保護實際阻擋。舊程序由 next dev web 啟動、預設 localhost；該紀錄不是單純提示，但只針對 HMR。兩個 hostname 的頁面與 JS/CSS GET 均為 200。Next 官方文件說明開發資源預設會阻擋跨來源請求，只比對 Origin／Referer 主機名稱；核准 C 腳本以 127.0.0.1 啟動後，127.0.0.1 及 localhost 的 HMR 測試均成功，因此未新增 allowedDevOrigins 或 wildcard。文件：https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins
- 唯一一次受控 CAPTCHA metadata POST 回 HTTP 200，欄位 challenge_id、expires_in、image、ok 齊全；challenge_id 未保存／輸出，image 為 SVG data URI，Base64 可逆解碼且安全 XML reader 驗證根元素為 svg，圖片 2238 bytes。未重試；短效 challenge／限流使用在核准範圍內。
- 自動測試另計：G 登入測試 14/14、C 六個 TS／TSX 檔 in-memory esbuild syntax check 通過。視覺驗收另列為未完成：沒有可用瀏覽器自動化介面，未由瀏覽器實際呈現或目視 CAPTCHA 圖片；也未提交帳密、解題或登入。API 有效與資產標記成功不等於使用者畫面驗收。
- 新版 C dev server 目前維持運行。沒有 build、資料表結構修改、正式 DB／Storage 業務寫入、commit、push 或部署。

### 2026-10-10｜V2 系統 ICON 載入修正

- 根因確認：V2 basePath 是 /Inspection/v2，G/C 原有 13 個 Web 檔案的 75 處圖示引用卻指向 /Inspection/assets/...，且兩份 web/public 都沒有該批圖檔。C 本機 127.0.0.1:3000 對駐警隊交接圖示回 404／HTML。
- 已將 75 處引用改為 /Inspection/v2/assets/...，把 system-icons-v20260901、system-icons-v20260913 和 5 個舊版共用圖示同步到 G/C 的 web/public/assets。檔案均取自 repo 根目錄 assets。
- 更新頁首檢查器以核對 V2 URL 與 web/public 圖檔；G、C 的 npm run test:page-headings 都通過。C 本機圖示端點回 200 image/png，13 個系統 Logo 的 HTTP、MIME 與 PNG 標頭檢查全數通過。
- C 的服務在 127.0.0.1:3000；使用者另啟的 task-2 舊服務仍在 ::1:3000，沒有停止或改動。localhost 可能會走舊服務。
- Library 截圖未能轉存或顯示像素，故沒有完成畫面目視比對；未做已登入頁面驗證。使用者已確認 CAPTCHA 正常，本輪沒有再送 CAPTCHA 請求。
- 未 build、未部署、未改 DB/Storage、未 commit/push。

### 2026-10-10｜正式前端發布續作檢查點（2026-10-10 10:50 Asia/Taipei）

- **來源／執行副本**：G 正本 G:\我的雲端硬碟\AI\Codex\北農巡檢系統，branch codex/html-daily-report-preview，HEAD e0f47335d5681782c423662792b9fd2fe2049b2；C runtime C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime。目前隔離發布 worktree C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-release-verify 位於獨立 .next，基準 origin/main  c58a668d3253acfe33f1203e17421eda4f56382。
- **ICON 證據**：13 個前端檔共 75 處 /Inspection/assets/... 引用改為 V2 basePath；78 個 web/public 圖示資產（共 6,500,131 bytes）與 repo 根圖檔核對 hash。頁首檢查器通過 13 系統／67 模組（62 標準、4 緊湊）；C runtime 13 個系統 Logo 回 HTTP 200、image/png、PNG 標頭正確。登入及帳號申請標題圖亦納入發布候選。
- **CAPTCHA 範圍**：使用者已回報「驗碼驗證 OK」；單元測試 14/14 通過，涵蓋 public request、15 秒逾時、不可重送、single-flight、路由與診斷。這不等於完整帳密／session 登入驗收。本輪未再送 CAPTCHA，不存 challenge 或 key。
- **服務切換／可驗證 URL**：依先前核准停止舊 task-2 網站程序，舊檔保留；C runtime PID 42632 目前只監聽 127.0.0.1:3000。唯讀 GET：/Inspection/v2/login/、/Inspection/v2/systems/、/Inspection/v2/systems/handover/guard/、/Inspection/v2/systems/handover/mechanical/ 與 /Inspection/v2/ 均 HTTP 200；/dashboard/ 是 404，戰情／氣象儀表板在登入後的根路由。尚無已登入瀏覽器目視或實際列印驗收，待使用者在目前本機頁面確認。
- **隔離候選範圍**：只帶入前端 ICON、CAPTCHA、三本交接簿共用版型／Guard 列印、機電多頁列印、天氣版面、LocalizedDateInput 及對應檢查器／測試。排除 G 工作樹中的 Supabase functions/config、migration、LINE／車輛通知、車輛測試預覽與私人計畫差異。G 工作樹仍有大量其他修改，不可整樹 stage。
- **遠端／合併**：origin/main 為  c58a668...，比 G HEAD 領先 6 commits，G 無分支專屬提交。4 個登入檔衝突在隔離 worktree 逐檔核對並解除；保留 main 的既有 backend-origin/config 行為，登入修正保留回應解析、錯誤診斷與 CAPTCHA 不重送。未 commit／push；正式 Pages、CI、production assets 尚未驗證。使用者已明確授權 G 正式前端發布，但本檢查點尚未執行發布。
- **截至本檢查點測試**：隔離 worktree 
pm ci 成功（16 秒）；	est:username-login 14/14、	est:mechanical-print-fit 4/4 + integration checker、	est:weather-widget-layout 4/4、	est:localized-date-input 5/5、	est:handover-style、	est:page-headings、	est:button-standard 均通過。
pm ci audit 摘要回報 2 個 high，尚未查明套件／影響；沒有更新依賴。完整 
pm test、	ypecheck:v2、V2 build、秘密掃描仍待執行。
- **阻塞／風險**：登入後畫面、跨頁權限、真實資料工作流程、A4 瀏覽器列印未測；不能宣稱完整系統驗收。G .git/packed-refs.lock 為 2026-10-06 的 0-byte 檔案仍存在，未移除；提交／遠端 tracking 更新可能受阻。前端 push 會觸發 Hardened Pages workflow；候選不含會觸發 Supabase Edge workflow 的路徑，亦不含 DB migration。
- **接續**：先查明 2 個 high 的 audit 範圍，再完成完整測試、	ypecheck:v2、隔離 V2 build、秘密掃描與 diff review；使用者本機目視確認後才考慮一般 fast-forward commit/push。不要啟停服務、寫正式業務資料或發 LINE。
## 2026-10-10 發布候選最終靜態驗證補記

- 隔離候選位於 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-release-verify`，基底為 `origin/main`（`0c58a668d3253acfe33f1203e17421eda4f56382`）；目前 131 個明確檔案已暫存、尚未 commit。G 工作樹另有既存修改與私人／後端內容，沒有納入候選。
- 安裝完成：`npm ci` 最終回報 0 vulnerabilities。驗證完成：`npm test`、`npm run typecheck:v2`、`npm run build:v2`（96 個頁面）、`npm run security:secrets`、`npm run security:gitleaks` 全數成功；候選 `npm audit` 為 0 vulnerabilities。定向測試包含登入 14/14、機電列印適配 4/4、天氣版面 4/4、日期欄位 5/5、交接版型、頁首覆蓋與按鈕標準皆通過。
- **尚未完成的驗證**：沒有瀏覽器視覺檢視，也沒有真實列印／分頁預覽；未登入狀態下首頁不能驗證登入後的天氣儀表板。C runtime 的登入、系統入口、Guard 與 Mechanical 路由 GET 為 200；`/dashboard/` 為 404，登入後入口是 `/Inspection/v2/`。需由有權限的使用者在既有 C 預覽環境檢視畫面；尚未執行正式簽核或任何真實資料寫入。
- 使用者要求先不要部署；截至本補記，尚未 commit、push、執行 Pages workflow 或部署。沒有連 Supabase、寫資料庫／Storage、送 LINE，也沒有重啟 C runtime。`.git/packed-refs.lock` 是既存 0-byte 檔案，保持原狀。
- 後續：正式前端已發布（commit `eeb8fd82fa7b4547febb50db966aea1cc622e3bc`），Pages／CI／CodeQL／商用就緒檢查成功；官方登入、系統、Guard／Mechanical 路由與三個交接圖示的手機 UA GET 均為 200。真實登入後畫面與 A4 PDF 列印驗收仍待使用者回到電腦後進行，目前不要求操作；未部署 Supabase／LINE。Git 曾回報 packed-refs.lock 建立衝突，但提交已建立；再次檢查時 lock 不存在且無 Git 程序，未手動刪除 lock，fast-forward push 成功。

## 2026-10-10｜MOA 診斷修正發布與接手

- **G 正本與 C 隔離目錄**：G 正本 G:\我的雲端硬碟\AI\Codex\北農巡檢系統，branch codex/html-daily-report-preview、HEAD be0f47335d5681782c423662792b9fd2fe2049b2；兩個目標檔案保留為未提交本機差異，G HEAD 未移動，其他既存差異未覆蓋或提交。C runtime Inspection-G-runtime 未檢查、未修改。發布隔離 worktree 為 C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-market-diagnostic-release，從 eeb8fd82fa7b4547febb50db966aea1cc622e3bc 建立，提交後乾淨。
- **提交與範圍**：commit 9a7196fef8142166f885493083258b728d5bab83，parent eeb8fd82fa7b4547febb50db966aea1cc622e3bc，message fix: add safe MOA import diagnostics。僅包含 tools/market_daily_import.py、tools/test_market_daily_import.py；一般 fast-forward push 後遠端 main 確認為相同 SHA。
- **程式驗證**：python -B -m unittest discover -s tools -p 'test_market_daily_import.py' -v，24/24 通過。測試使用純 fixture 與注入 code_items，沒有 DB/API/正式匯入。兩個檔案個別 Gitleaks 8.30.1 掃描均為 no leaks found；diff --check 通過。
- **檔案 SHA-256**：tools/market_daily_import.py 902403B2E1EAD49AB4F049973C33AC00CF1AC34673DEE69879CFFC4A8EDE56A9；tools/test_market_daily_import.py DF11DC8F63FE63FC63CE24B6F91ABC0C28CD156F1CE7E99E57C0DF4EF44A9E60。G 檔案雜湊與隔離 worktree 提交檔案完全一致。
- **自動驗證**：CI #38024051733、CodeQL #38024051747、Commercial readiness #38024051762、Hardened Pages #38024051764 全部 completed/success，head_sha 均為 9a7196fef8142166f885493083258b728d5bab83。Pages 的 build/deploy/verify-deployment 三個 job 均成功；沒有 market import、migration 或 Edge workflow run。
- **正式 HTTP**：Pages 根網址 https://jnfakimo.github.io/Inspection/、V2 根 https://jnfakimo.github.io/Inspection/v2/、機電交接簿 https://jnfakimo.github.io/Inspection/v2/systems/handover/mechanical/，GET 均回 200。這只證明路由可取用，不是登入後 UI 或列印驗收。
- **變更語意與未解根因**：MOA 錯誤現在帶 1-based 列號、要求日期／市場／品類、CropCode 型別及安全截斷 repr；異常代號仍 fail-closed。10/08 真實 payload 未取得，不能說已修復 MOA 來源問題或判斷為休市 placeholder。
- **未做／不可推定**：本次沒有登入瀏覽器目視、responsive 檢查或 A4 預覽／實印；相關前端驗收仍待完成。沒有手動匯入行情、呼叫正式 DB、migration、Edge、LINE 或讀取 key。push 後未手動啟動匯入；既有 daily schedule 後續會使用 main 新版並依原流程可能寫入 DB。--dry-run fallback 仍會讀正式 DB 近 90 天代碼對照，並非離線模式。
- **下一步**：取得有權限保留的 10/08 MOA 原始回應，根據真實列定位根因並新增純 fixture 回歸；在此之前不放寬代碼規則、不忽略異常、不重跑正式匯入。另行完成登入後 UI／A4 實際驗收。
- **repo lock 限制**：G 的 .git/packed-refs.lock 當時為 0 bytes、時間戳 2026-10-06，未發現 Git 程序；Git worktree add/commit 曾輸出 lock collision，但提交和 push 均成功。遵照要求未刪除 lock。

## 2026-10-10｜交接簿四方比對（未部署）

- **基線與範圍**：舊 C `C:\Users\jnfa\Documents\Codex\2026-10-05\task-2\Inspection` 僅讀；G `G:\我的雲端硬碟\AI\Codex\北農巡檢系統` 是唯一原始碼寫入處，branch `codex/html-daily-report-preview`、HEAD `be0f47335d5681782c423662792b9fd2fe2049b2`；C runtime `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime` 未修改；遠端 main 以隔離 worktree `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-market-diagnostic-release` 的 `9a7196fef8142166f885493083258b728d5bab83` 為準。
- **班別色差與修正**：舊 C 的 `mechanical-handover.css` 使用共用 token：早班 `#0284c7`、中班 `#047857`、晚班 `#b45309`、當班標示 `#10b981`。修正前 G、C runtime、遠端 main 都以 cyan／green／amber 作班別色，當班標籤誤用 violet。已只在 G 的 `web/app/systems/[system]/[module]/mechanical-handover.css` 把 legend 改接 `--hs-shift-color-1/2/3` 與 `--hs-current-color`；G 檔案 SHA-256 為 `A8B2AE5CB3DE42ADC5C2F42B9CFB3012F62758AE521E8669876B26E1D21C2B11`。舊 C 未寫；C runtime 與遠端 main 仍是修正前樣式。
- **HTML 簽核比對**：舊 C、G、遠端 main 機電頁均有 `HTML 網頁報表` 預覽、共用 `HandoverReportApprovalForm`（「簽核說明」文字欄）及 `HandoverReportApprovalFooter`（課長簽核列）；此功能不是舊 C 獨有，也不是可編輯原始 HTML。機電首頁 `.hs-approval` 管理簽核列在相同 DOM 位置，沿用共用灰底 `#F1F5F9` 與共用簽核狀態樣式，未發現需要移植的外觀差異。
- **當時未處理的業務差異，已於本節後續完成前端補強**：舊 C 業管組有逐階段 `business_market_can_approve` 查詢；後續已確認 G/main migration、app-api 與 RLS 都有相同的 current-user 授權鏈，故只把 fail-closed 唯讀提示補回 G UI，不改角色規則或資料庫 migration。詳見本檔「使用者要求暫緩部署後的續作」。
- **驗證**：G `npm run test:handover-style` 通過；色票 token 斷言與 CSS 大括號平衡（359/359）通過；該檔 `git diff --check` 通過（僅 Git 提醒 LF 將來可能轉 CRLF）。`npm run test:mechanical-handover` 因 G `node_modules/@electric-sql/pglite/package.json` 是 0 bytes 而停止；PostCSS 解析也因 `node_modules/postcss/package.json` 為 0 bytes 無法執行。未重裝依賴。
- **正式站與發布狀態**：遠端 main `9a7196f...` 的 Hardened Pages run `38024051764` build、deploy、verify-deployment 均成功；機電／業管／駐警隊正式路由匿名 GET 均 200，但 HTML 只呈「正在驗證登入狀態」外殼，不能據此宣稱已驗登入後 UI。該 SHA 是既有已部署版本；本次 G 樣式修正未 commit、未 push、未部署（使用者要求先不要部署）。
- **待辦／限制**：登入後三本畫面與 A4 實際列印仍未驗；G 修正尚未同步至 C runtime 或正式站；業管組逐階段權限差異待安全審查。沒有啟停 server、build、讀 key、連 Supabase、簽核正式案件、commit、push 或部署。
## 2026-10-10｜使用者要求暫緩部署後的續作

- **唯一寫入處與發布狀態**：只在 G 正本 G:\我的雲端硬碟\AI\Codex\北農巡檢系統修改；舊 C 僅讀。遠端 main／既有正式部署基線為 9a7196fef8142166f885493083258b728d5bab83，Pages run 38024051764 已成功。本輪沒有 commit、push、build、server 操作或部署，G 既有 dirty worktree 保留。
- **可重現來源盤點**：以 SHA-256 比對舊 C、G、隔離 main 的 1,066 個來源路徑（OLD 1,025、G 975、MAIN 939；507 三方相同）。分類為舊 C/main 同內容但 G 不同 317、G/main 同內容但舊 C 不同 36、舊 C/G 同內容但 main 不同 11、三方皆不同 33、old/main-only 90、old/G-only 31、G/main-only 41。排除 .git、依賴、.next／web/out／快取、憑證／env、docs／Obsidian 歷史與 system/plans 現場圖資；因此不把狀態分類當成直接覆蓋指示。
- **交接簿完成項**：86 個交接簿來源檔中 40 三方相同、31 舊 C/main 相同而 G 不同、9 三方皆不同，其餘 6 為單方或雙方檔案。機電班別與當班色改用 shared handover token；Guard／Mechanical／Business HTML 報表都有簽核輸入與 footer。業管報表將簽核說明與空白／未簽核提示統一，並恢復透過 business_market_can_approve 對每階段顯示唯讀／停用狀態；寫入仍由 app-api 與 RLS 授權，未改 migration 或後端角色規則。
- **其他範圍**：weather-widget-layout 4/4（台灣地圖在左、窄螢幕置上、鄉鎮明細預設收合）；LocalizedDateInput 5/5；這兩項實作目前與已發布 main 相同。業管簽核 presentation 4/4、角色／市場／階段 PGlite 矩陣通過；業管 API handler 5/5；機電三組 DB 測試通過。權限失敗即拒絕靜態檢查、8 個 system-access 單測、migration PGlite 3/3 通過。
- **車輛 LINE 通知離線驗證**：4 個 PGlite migration／outbox／link suite 26/26，webhook、worker、通知預覽及管理 API 等純單測 56/56 通過；G-only 功能仍未部署，沒有寫正式 DB 或送 LINE。
- **仍未完成／限制**：已登入畫面與瀏覽器 A4 真實預覽／列印未驗；車輛通知 migration／Edge function 尚未上正式環境。MOA 診斷程式與測試檔目前 SHA（902403B2…／DF11DC8F…）已與已發布 main 相同，但 10/08 真實回應仍缺，不能定位來源根因。workorder 防重複目前只有 trigger 的序列檢查，未找到 request_id 的 active 狀態 unique index，並無併發保證；在正式資料重複盤點前不加風險 migration。
- **測試環境**：G 的 PGlite/PostCSS 套件 metadata 是 0-byte，未重裝。DB 測試以 G 測試檔和 migration 為輸入，透過 C runtime 已安裝的 PGlite 模組路徑注入；全部是本機記憶體 DB。TSX transpile 0 syntax diagnostics；四本交接簿 CSS PostCSS parse 通過；未跑 build、未碰 .next。

## 2026-10-10｜續作盤點更正（未部署）

- **本輪動作**：只更新此追蹤文件中的盤點結論；沒有修改應用程式、資料庫或 Edge Functions，沒有 commit、push、build、啟停服務、連正式 Supabase 或發 LINE。G 工作樹既有 dirty 狀態保留。最後已知 Pages 版本為 main `9a7196fef8142166f885493083258b728d5bab83`，Hardened Pages run `38024051764` 成功；這不是本輪新部署，也不代表登入後視覺／列印驗收完成。
- **天氣／行情／共用元件**：G 與已發布 main 對 `weather-widget.tsx`、`weather-widget-layout.css`、`weather-widget-layout.test.ts` 的文字內容一致（忽略 CRLF/LF）；map markup 在 drilldown 前，桌面 grid 將地圖置左、資訊／鄉鎮下鑽置右，鄉鎮 `<details>` 沒有 `open`，窄版地圖排在前面。新版使用獨立 `weather-widget-layout.css` 與 `web/lib/weather-widget-layout.test.ts`；舊 C 的 `dashboard-integrations.css` 與 `web/app/weather-widget-layout.test.ts` 是舊路徑，已由新版取代。天氣靜態測試先前 4/4 通過，但本輪未做登入後瀏覽器目視。
- 本次抽查的行情輪播、互動式行情看板、`MarketExecutiveBoard`、market board workspace/CSS，以及 `AppShell`、`LocalizedDateInput`、日期存取 helper、`modules.ts`、`MetricCard`、shared actions 和版本化系統圖示，G 與 main 文字內容一致。`system-hub-client.tsx` 的唯一實質差異是 G 保留通知預覽卡，main 沒有；這是 G 本機預覽入口，不視為正式功能漏版。MOA 診斷兩檔仍與 main 一致；10/08 原始 MOA payload 未取得，所以來源根因仍未知。
- **業管簽核**：G 的業管 UI/helper 改動不在 main，未發布。版本化 migration 定義 authenticated current-user 的 `business_market_can_approve(p_market,p_stage)`，API 將 RPC error 視為失敗、權限不符回 403；G UI 在 RPC 拒絕或無法取得時顯示唯讀原因並停用簽核。若正式 DB 未套用該 RPC，安全結果是簽核請求失敗／合法簽核人被阻擋；本輪沒有連 DB，因此 migration 現況未驗證。
- **工作單併發防重**：`prevent_duplicate_active_workorder()` 在 INSERT trigger 用 `EXISTS` 查同一 request_id 的 active 維修工單；目前索引是普通 request_id index，未找到 active 狀態 partial unique index。`tools/e2e-repair-flow.mjs` 沒有併發重複插入案例。序列重複會被 trigger 擋下，但同時交易是否互相看見未證明，不能宣稱併發保證；沒有正式資料重複盤點前不加 migration 或索引。
- **更正車輛 LINE 通知部署狀態**：以下是使用者提供的 2026-10-08 歷史正式部署快照，不是本輪 live recheck；它 supersede 本文件先前「migration/Edge 尚未部署」的說法。正式 DB migration 記錄為 `20261008085955 vehicle_driver_line_notifications`、`20261008090006 vehicle_dispatch_line_outbox`、`20261008090014 vehicle_driver_line_link_start`、`20261008090021 vehicle_dispatch_line_worker_leases`、`20261008090030 vehicle_personal_line_notifications`。本機 migration 檔時間戳不同，不可據此判定未套用。
- 同一歷史快照記錄 `line-notify v31`（verify_jwt=false）、worker v1（verify_jwt=false，另驗 `x-cron-secret`）、`app-api v118`（verify_jwt=true）、`admin-api v53`（verify_jwt=true）；當時六張 private tables 已啟用 RLS，anon/authenticated 無直接讀寫，功能開關全關、outbox/test 為 0、cron 為 0。晚間 `admin-api v54` 修正初始化 deadlock，回報 27+17 測試與讀回一致。來源識別：owner turn `01a11ab8-aaaa-7674-b798-e594cb12e84e`／Sentinel `c58c279bc4d88191aabe6d6e08ec1fdf`；晚間 owner turn `01a11b97-9a1c-7151-ac13-f5579a015adb`／Sentinel `e61936643ce481919f95f809d6d036bf`。
- **車輛通知未完成項**：TEST-001 單次測試曾獲准，但歷史記錄明確說當時未送，沒有 LINE 收訊回報；後續必須先核對目前 binding/outbox 狀態，不能自行重送。此次不連正式 DB、不送 LINE。G 有對應 migration/function 本機差異，而已檢查的 main `9a7196f` 不含這批 vehicle LINE migration/Edge source；因此雲端歷史部署與 Git main 的來源一致性尚未證明。不能把「曾部署 default-off」說成「功能已啟用或端對端完成」。
- **仍待完成／阻塞**：登入後天氣／交接簿視覺與 A4 真實列印未驗；10/08 MOA payload 未取得；工作單併發防重未證明；車輛 LINE 現況未重查且沒有測試送達證據；業管 RPC 正式 DB 是否存在未查。以上都沒有藉由部署或正式資料寫入處理。
## 2026-10-10｜併發重現、簽核 metadata 與 main 候選（未發布）

- **工作單併發重現**：讀取 G 的 `tools/workorder-concurrency-repro.sql` 與目前 trigger。PGlite 0.5.8 本機 README 明載 single user/connection；本機沒有 `postgres`、`initdb`、`pg_ctl`、`psql` 或 `pg` client，因此不能建立兩個真正共享同一 Postgres 的交易，沒有宣稱已重現併發。新增的隔離 SQL fixture 僅允許資料庫名 `workorder_concurrency_test`，在專屬 schema 複製目前 INSERT trigger 行為；兩個 session 對同一 request_id、equipment_id 插入不同 active order。PGlite 記憶體檢查確認 fixture 可載入且序列第二筆被 SQLSTATE 23505 擋下；這只驗證序列限制，不是併發結果。正式 DB、正式表、索引均未改。
- **正式業管 RPC metadata**：透過既有 Supabase connector，以 project `qztffronusdhgxhjjubt` 的 `pg_catalog.pg_proc`／`pg_namespace` 唯讀查 `business_market_can_approve` 與 `business_market_approval_allowed` 定義。前者存在、`authenticated_can_execute=true`，body 僅以 `active_user_id()` 呼叫後者；後者是 `SECURITY DEFINER`、`search_path=''`，且 `authenticated_can_execute=false`。只讀函式目錄，沒有讀業務資料、呼叫 RPC 或寫入。第二次補查 ACL 的 connector action 回 `Unknown tool`；不影響已查到的存在與 authenticated 權限結論，未重試。
- **基於 main 的候選**：main 基準 `9a7196fef8142166f885493083258b728d5bab83`。為避免碰既有 `G/.git/packed-refs.lock`，未建立 worktree；只在 repo 外 G 候選目錄產生三份可審 patch：`G:\我的雲端硬碟\AI\Codex\handover-release-candidate-9a7196f\01-handover-ui.patch`（機電共用班色 CSS、業管 UI/CSS/helper）、`02-business-tests.patch`（helper 單測、業管 PGlite 矩陣與測試路徑 harness）、`03-vehicle-preview-card-separate.patch`（單獨派車通知預覽卡差異）。三份在乾淨 main worktree 均通過 `git apply --check`，沒有套用、commit、push 或部署。候選只含明列路徑；不會把 G 其他修改一起帶入。通知預覽卡刻意不混入交接 UI 候選。
- **車輛 LINE 原始碼可追溯表**：正式部署版本與時間依使用者提供的 10/08 Sentinel 歷史紀錄，非 live recheck。資料庫 migration 名稱及 G/舊 C 對應檔（下列本機檔案時間戳不同，不代表未部署）：`vehicle_driver_line_notifications` → `supabase/migrations/20261008070454_vehicle_driver_line_notifications.sql`；`vehicle_dispatch_line_outbox` → `.../20261008071250_vehicle_dispatch_line_outbox.sql`；`vehicle_driver_line_link_start` → `.../20261008072136_vehicle_driver_line_link_start.sql`；`vehicle_dispatch_line_worker_leases` → `.../20261008073738_vehicle_dispatch_line_worker_leases.sql`；`vehicle_personal_line_notifications` → `.../20261008081918_vehicle_personal_line_notifications.sql`。五檔舊 C 與 G 正規化內容 hash 相同，main 9a 沒有這五檔。
- Edge 版本歷史為 `line-notify v31`、worker `v1`、`app-api v118`、`admin-api v53`，晚間 `admin-api v54` 修正初始化死結。G/舊 C 同內容而 main 不同或缺檔的安全路徑包括 `supabase/functions/line-notify/index.ts`、`supabase/functions/line-notify/route-contract.test.mjs`、`supabase/functions/vehicle-line-dispatch-worker/index.ts`、`supabase/functions/_shared/vehicle-dispatch-line-worker.ts`、`supabase/functions/_shared/vehicle-dispatch-line-worker.test.ts`、`supabase/functions/app-api/handlers/vehicle.ts`、`supabase/functions/admin-api/index.ts`、`supabase/functions/admin-api/vehicle-line-personal.ts`、`supabase/config.toml`。這些 Edge／migration 檔沒有納入 Pages 候選或推送；因會觸發 Supabase 部署，仍需獨立明確 scope。功能開關與 TEST-001 狀態沿用前節歷史紀錄；目前線上狀態未重查、沒有 LINE 收訊證據。
- **舊 C 全量差異與語義審核邊界**：既有路徑/hash inventory 為 OLD 1,025、G 975、main 939、union 1,066；本輪新增唯一掃描範圍內 G-only 檔 `tools/workorder-concurrency-repro.sql`，故更新為 G 976、union 1,067；state counts 中 G-only 由 6 增為 7，其餘原分類不變：507 三方同、317 old=main≠G、36 G=main≠old、11 old=G≠main、33 三方皆異、90 old-only、25 old+G 同／main 缺、6 old+G 異／main 缺、13 G+main 異／old 缺、21 G+main 同／old 缺、1 main-only。這是檔案存在／hash 分類，不能代替語義審查。
- **尚未逐檔語義審核範圍**：分類中仍需逐檔查內容與業務行為的主要群組為 handover（85 檔，僅抽查本輪候選）、weather/dashboard/market（158 檔，僅抽查地圖布局與主要行情頁）、workorder（47 檔，僅檢視 trigger／e2e 及新增 fixture）、patrol/auth（105 檔，本輪未審）、vehicle（115 檔，僅審車輛 LINE 相關檔）、shared UI/date/icons（209 檔，僅抽查主元件與指定圖示）；其他舊 C/G/main 不同路徑也未完成逐檔語義審查。不能把 hash inventory 說成「全 repo code review」。
- **操作狀態**：G HEAD 仍為 `be0f47335d5681782c423662792b9fd2fe2049b2`；候選 patch 在 repo 外，工作單 fixture 為新增 G 本機測試檔。沒有 migration、schema、index、正式資料、密鑰、LINE、commit、push、Edge deploy 或 Pages deploy 操作。

## 2026-10-10｜業管／機電交接簿正式發布回報

- **提交與範圍**：commit `d5ee8f6ec4d8e9d177aee6045d8535dbc7554d4f`（`Unify handover approval presentation`），由 `9a7196fef8142166f885493083258b728d5bab83` 一般 fast-forward 推送至 `main`。僅 7 個核准檔案：機電共用班色、業管簽核說明 UI/helper 與相關測試；車輛預覽卡 patch 03、Supabase／migration／Edge Function 及其他 G 差異均未納入。
- **驗證**：隔離 worktree 的 `npm test`、`npm run typecheck:v2`、`npm run build:v2`（96 頁）、`npm run security:secrets`、helper 單測 4/4、`git diff --check` 通過。GitHub 同 SHA 的 CI #38043300422、CodeQL #38043300433、Commercial readiness #38043300457、Hardened Pages #38043300390 全部 completed/success；Pages build、deploy、verify-deployment 均成功。
- **正式站**：`https://jnfakimo.github.io/Inspection/v2/systems/handover/`、`.../business/`、`.../mechanical/` 唯讀 GET 均 HTTP 200；Pages verify-deployment 完成。這不代表已登入畫面與紙本版面目視驗收。
- **未完成驗收／資料範圍**：尚未用登入瀏覽器目視業管／機電畫面，也未實際列印或驗 A4 PDF；正式資料簽核未操作。沒有 Supabase、Edge、LINE 或真實業務資料寫入。
- **工作區**：舊 C `C:\Users\jnfa\Documents\Codex\2026-10-05\task-2\Inspection` 保持唯讀；G HEAD 仍為 `be0f47335d5681782c423662792b9fd2fe2049b2`，既有差異保留。本次只更新 G 追蹤文件，未動 `.git/packed-refs.lock`。
## 2026-10-10｜舊 C／G／main 巡檢、報修與共用元件審查（未發布）

- **基準與保護**：舊 C C:\Users\jnfa\Documents\Codex\2026-10-05\task-2\Inspection 僅讀；Git 因 dubious ownership 拒絕，未加 safe.directory。G HEAD 為 be0f47335d5681782c423662792b9fd2fe2049b2；比對／隔離驗證 main 基準為 d5ee8f6ec4d8e9d177aee6045d8535dbc7554d4f。G 原有未提交檔案保留。
- **報修詳情競態**：workspace.tsx 中工作流程、派工、完工在非同步操作後原本固定重新打開該案件；若使用者先關閉或切換案件，舊回應會覆蓋目前畫面。加入 repair-detail-refresh session generation/request-id guard，成功仍刷新列表，只在原案件仍開啟時更新詳情；角色與 API／權限流程不變。
- **巡檢新增回應**：create_inspection 成功後若 inspections 清單 GET 失敗，原畫面會把成功新增誤報為失敗，使用者重試可能建立重複紀錄。加入 create-refresh，分別回報新增成功與清單刷新失敗；刷新可重試讀取，不會重送新增。新增中禁止關閉表單。
- **共用日期欄位**：目前 main 的手動 fallback 會將任意文字換成連字號後寫回頁面狀態，未拒絕無效日、閏日錯誤或 min/max 越界。補上 ISO／斜線日期解析、有效日與 required/min/max 檢查、錯誤提示及 picker 開啟節流；保留 main 的 getLocalizedDateInputAccess 唯讀／停用契約。沒有任何主線呼叫者依賴舊 C 的額外 validity callback。
- **差異範圍**：共用 UI 選取 17 檔逐一正規化換行後比較（修改前），G 與 main 17/17 相同；其中 4 檔舊 C 也相同，另外 13 檔舊 C 為較早樣式／元件版本。日期手動驗證是此組中確認的實際功能缺口，已補修。舊 C 的 InstallAppGuide 頂列差異與目前共用導覽規範不符，未移植；車輛通知預覽卡差異不在本範圍。
- **需另行決策**：舊 C 獨有 20261008061007_patrol_shift_atomic_rename.sql 與 save_patrol_shift_v2 UI。既有唯讀正式 metadata 查詢未找到該 migration version 或 RPC；因此沒有搬入 shift rename UI／migration，也未更動正式 DB。若要啟用，需先確認 migration 實際狀態及採用方案，再另行處理。
- **離線驗證**：隔離 C 驗證 worktree 執行 create/repair/date helper 測試 17/17、patrol session/check-in 測試 8/8、頁首盤點 13/67（62 標準、4 緊湊）通過；V2 TypeScript --noEmit --incremental false、v1-layout.css PostCSS 解析及本次檔案 git diff --check 通過。Node 顯示 package type-less 模組警告，測試仍成功。未做 browser 手動／日期 picker 測試、完整 npm test 或 build。
- **操作狀態**：本輪只改 G 應用程式／測試與追蹤文件；隔離 C worktree 暫存相同驗證檔案。沒有改 migration、schema、Edge Function、key 或正式資料；沒有 commit、push、deploy、build、啟停服務。## 2026-10-10｜三項低風險修補隔離候選驗證（未發布）

- **遠端基準**：驗證前後 git ls-remote origin refs/heads/main 均為 d5ee8f6ec4d8e9d177aee6045d8535dbc7554d4f；隔離 C worktree HEAD 相同。驗證期間主線沒有變動，沒有 cherry-pick 或覆蓋新 main。
- **候選位置／隔離**：C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-release-verify 是 linked worktree；其 web/.next 為獨立實體路徑，與 G 的 web/.next 不同且非 junction。build 僅寫入隔離 C 的 web/.next。舊 C task-2 維持唯讀。
- **精確候選範圍（12 檔）**：package.json；web/app/systems/[system]/[module]/patrol-workspace.tsx；web/app/systems/[system]/[module]/workspace.tsx；web/app/v1-layout.css；web/components/LocalizedDateInput.tsx；web/lib/localized-date-input-access.test.ts；web/lib/create-refresh.ts；web/lib/create-refresh.test.ts；web/lib/repair-detail-refresh.ts；web/lib/repair-detail-refresh.test.ts；web/lib/localized-date-input.ts；web/lib/localized-date-input-validation.test.ts。11 個 TSX／CSS／helper／test 檔 C 與 G SHA-256 原始位元組完全相同；package.json 只帶入這三項測試腳本與 npm test chain 更新，不帶 G 其他 scripts/diffs。
- **排除項目**：patrol shift rename migration、save_patrol_shift_v2 UI／API、任何 Supabase／Edge／schema／正式資料、vehicle 功能、私人文件及其他 G diff 均不在候選。正式 DB metadata 未找到 shift rename migration/RPC，未作任何 DB 操作。
- **完整驗證**：npm test 成功；新增 create-refresh 3/3、repair-detail-refresh 5/5、date validation/access 9/9；既有巡檢／交接等整套測試無失敗。npm run typecheck:v2 成功；npm run build:v2 成功，96 個靜態頁；npm run security:secrets 成功；git diff --check 成功，未追蹤 helper/test 另查無尾端空白。Node 對部分 TS 測試顯示 MODULE_TYPELESS_PACKAGE_JSON 非致命警告。
- **候選內容 hash**：按上述 12 個檔案以「相對路徑、NUL、原始檔案 bytes、NUL」排序串接後 SHA-256 為 48BD0602106806C1651D487AA065CF6B1E5A3633F2F37A8A0938449A02639643。基準 SHA 為 d5ee8f6ec4d8e9d177aee6045d8535dbc7554d4f；可在隔離 worktree 用逐檔 hash 重建。
- **操作狀態**：候選留在隔離 C worktree 作 review；G HEAD 為 be0f47335d5681782c423662792b9fd2fe2049b2。沒有 stage、commit、push 或 deploy；沒有啟停 server。使用者尚未授權發布，因此等待明確發布指示。

## 2026-10-10｜MOA 10/08 原始列查核續記

- **Actions 證據**：[Market daily import run #88](https://github.com/jnfakimo/Inspection/actions/runs/38044837170)，觸發時間 2026-10-10 18:25（Asia/Taipei），head d5ee8f6。註記顯示 2026-10-08 第一市場蔬菜 MOA 第 1 列 CropCode 型別 str、repr '-'; 同錯誤註記出現兩次。北農來源曾 6 次 ConnectTimeout 後切換 MOA。
- **完整資料缺口**：Actions run 頁沒有 artifacts，註記只保存查詢範圍、列號及 CropCode，不是原始回應列。repo 測試 helper 的合成列欄位為 TransDate、TcType、CropCode、CropName、MarketCode、MarketName、Upper_Price、Middle_Price、Lower_Price、Avg_Price、Trans_Quantity；這不是官方 schema 證明，也不是 10/08 payload。實際列中除 CropCode 外，上述欄位值及任何未建模來源欄位都未取得；日期／市場／品類是查詢範圍，不能當作原始欄值。
- **離線修補與驗證**：只在 tools/test_market_daily_import.py 增加 CropCode='-' 的 fail-closed 回歸測試；測試列其餘值由 fixture 合成，明確不宣稱重建實際 MOA 列。python -B -m unittest discover -s tools -p 'test_market_daily_import.py' -v 25/25 通過；git diff --check 通過。未更動 importer 行為。
- **狀態／限制**：來源根因仍未確認；不把 '-' 解讀為休市，不放寬代號規則。未讀正式原始行情檔、未呼叫 MOA／DB/API、未執行匯入（包含 --dry-run）、未讀 key。G HEAD 保持 be0f47335d5681782c423662792b9fd2fe2049b2；沒有 commit、push 或部署。舊 C task-2 與 12 檔前端候選均未修改。

## 2026-10-10｜12 檔前端候選發布收工

- **授權與精確候選**：收到使用者明確「發布」指示後，從已驗證的 Inspection-release-verify 候選發布。核准內容雜湊仍為 48BD0602106806C1651D487AA065CF6B1E5A3633F2F37A8A0938449A02639643；範圍恰為 12 檔，沒有包含 G 行情第 25 項測試、其他 G 差異、Supabase／Edge／migration／角色權限、車輛功能或私人文件。
- **Git**：發布前 origin/main 與候選基線均為 d5ee8f6ec4d8e9d177aee6045d8535dbc7554d4f。commit 647fb50d63afda5dadfa617fafd7f51503e90f43（parent 為 d5ee8f6ec4d8e9d177aee6045d8535dbc7554d4f，subject：fix: prevent stale refreshes and validate localized dates）僅含核准 12 檔；一般非 force fast-forward push 成功。推送後與 workflow 完成後 origin/main 均確認為 647fb50d63afda5dadfa617fafd7f51503e90f43。G 正本 HEAD 仍為 be0f47335d5681782c423662792b9fd2fe2049b2，未提交 G 其他差異。
- **同一 SHA 的 workflow**：CI 38051189491、CodeQL 38051189453、Commercial readiness 38051189437、Hardened Pages 38051189441 全部 completed/success；Pages 的 build、deploy、verify-deployment 三個 job 全部成功。部署後掃描每個正式頁面成功。
- **正式網址 GET**：https://jnfakimo.github.io/Inspection/、/Inspection/v2/、/Inspection/v2/systems/workorder/requests/、/Inspection/v2/systems/guardpatrol/shifts/ 均以 commit query cache-buster 回 200 text/html。這只驗證 HTTP 回應，不代表登入後畫面驗收。
- **驗證與未完成項**：本批原候選雜湊未變，先前本機完整測試、typecheck、96 頁 build、security:secrets 與 diff check 結果沿用；CI／CodeQL／readiness 亦成功。實際登入畫面、手動互動與 A4 PDF 列印仍未驗收，維持 Obsidian/05 的待辦狀態。
- **操作記錄**：commit 時 Git 曾提示共用 packed-refs.lock 已存在，但 commit 明確成功；隨後確認 lock 不存在、沒有 Git process，未手動刪除。GitHub push 輸出提示 default branch 有 5 個 Dependabot alerts（1 critical、4 high），本次未調查。沒有 force push。


## 2026-10-11｜逐系統靜態覆蓋與 G／runtime 續作

本節是截至 2026-10-11 的補記；本表確認模組路由與本輪已取得的證據，不等於全角色／實際資料功能驗收。詳細模組 slug 沿用本文件「靜態路由拓樸盤點」表。

| 系統 | 模組數 | 本輪狀態 | 尚未完成 |
| --- | ---: | --- | --- |
| admin | 11 | 靜態 build 與 13/67 頁首盤點覆蓋 | 每個角色、資料範圍、失敗狀態與競態矩陣 |
| workorder | 6 | G 入口補齊 6 張逐模組權限卡；hub 靜態檢查 3/3；build 通過 | 全案件權限／資料與競態；正式資料併發防重未證 |
| guardpatrol | 6 | 靜態路由／頁首覆蓋 | 每種角色、打卡與排班資料、附件及真實互動 |
| handover | 7 | G/C runtime/main 根入口為七卡；三本共用版型與機電 print-fit 通過 | 登入後視覺、A4 實印與逐角色資料矩陣 |
| equipment | 8 | 靜態路由／頁首與 97 頁 build 覆蓋 | 角色資料矩陣、載入／錯誤／競態與設備實際資料 |
| structuremap | 6 | 靜態路由／緊湊頁首覆蓋 | 各圖資互動、裝置縮放與瀏覽器視覺 |
| vehicle | 5 | 車輛入口有本機通知預覽卡；C 預覽測試 4/4 | LINE 正式 DB／Edge、送達與重試端到端未驗證；預覽不是正式推播 |
| meetingroom | 4 | 靜態路由／頁首與 build 覆蓋 | 預約角色、衝突、通知及完整狀態矩陣 |
| officialdocs | 1 | 靜態路由／頁首與 build 覆蓋 | 實際角色流程、送收文端到端與錯誤狀態 |
| marketanalytics | 6 | 靜態路由；共用戰情導航測試 4/4 | 各市場／期間資料、切換競態與視覺驗收 |
| dashboard | 0 | 不屬 67 個子系統路由；有專用儀表板入口 | 登入資料、角色卡片與瀏覽器視覺 |
| marketboard | 2 | 靜態路由／頁首與 build 覆蓋 | 即時資料、空／錯誤與期間狀態 |
| vehicletracking | 5 | 靜態路由／頁首與 build 覆蓋 | 真實設備、定位／圍籬告警與長期運行 |

### 本輪修正與測試證據

- 共用 AppShell 依規格只保留首頁、個人資料、登出；G app-navigation 5/5，C 5/5。
- workorder 定義六個模組但原 G hub 只呈現四卡；現已補維修附件、維修分析，六卡依序各自呼叫 hasModuleAccess；system-hub-client 3/3。SYS-04 根入口依最新要求恢復七卡：G/C runtime 原始碼已同步、main published baseline 亦為七卡；G hub 3/3、C hub 6/6，卡片與 guard-approve 權限條件及子路由檢查均保留。
- G LocalizedDateInput 9/9、Weather layout 4/4、Mechanical print fit 4/4、handover style 通過、business approval helper 4/4；C LocalizedDateInput 9/9、Weather 4/4、business DB＋approval helper 通過、typecheck:v2 通過。G approval UI 對簽核權限 fail-closed；主任／副理／經理各階段由 business_market_can_approve 與 RLS 確認，不要求前一階段先完成。UI 文案已移除「逐級」暗示；目前無待決的「強制順序」產品決策。實際 Supabase migration/RPC 是否已部署未查。
- G 候選在隔離 C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify build 成功：TypeScript 通過、靜態頁 97/97。G PGlite 套件 manifest 損壞，完整 DB test 無法從 G 執行；C runtime DB suite 通過。G tracked 目標檔 diff-check 通過；全 repo check 仍遇既存 Obsidian/04 第 2794 行尾端空白。
- 最新遠端 main／Pages 是既有 647fb50，Hardened Pages run 38051189441 build/deploy/verify 均成功；本輪沒有更改遠端，也未 commit／push／deploy。

### 未完成工作

1. 67 模組的角色×資料可見性、loading／empty／error／競態、直接連結及返回矩陣；本輪靜態建置不替代此驗收。
2. 使用已登入瀏覽器完成桌機／窄版、light／tech、字體 fallback 與機電 A4 實際 PDF 分頁檢查；目前只有純函式 print-fit 測試，未作列印通過宣稱。
3. SECURITY_POSTURE 的全部 S1 實測、核准隔離環境 S2、責任人與 RPO/RTO/SLO 的 S3；2026-09-01 前 179 節歷史紀錄仍待人工逐節判斷。
4. 10/08 MOA 真實 payload 未取得，來源原因未知；保持 fail-closed，不重跑正式匯入。
5. workorder trigger 的序列檢查未證明併發唯一性；需先盤點正式資料再考慮索引。
6. vehicle LINE 的正式 DB／Edge 部署、binding/outbox 與實際送達未驗證；通知預覽只使用固定資料，不送 LINE。

## 2026-10-11｜SYS-04 七卡入口恢復與驗證閉環
- 使用者最新要求是恢復 SYS-04 七張子系統卡。較早的 AGENTS.md 2026-08-27 直達 records 規則已標明被此要求取代；根入口回到 OperationsHub。每張卡仍用 hasModuleAccess；駐警隊卡保留明確 handover/guard-approve 權限例外；子路由與後端簽核門檻不變。
- 差異來源已查明：G 的 direct-to-records branch 是本工作樹相對 HEAD 的未提交修改（G 檔時間 2026-10-11 10:49:13）；C runtime 在 10:13:37 已是七卡。已發布 main commit 647fb50d63afda5dadfa617fafd7f51503e90f43 的 system-hub-client blob fe733e57cd6a1d1374ab61a0355219b543927a5f 亦為七卡。沒有權限或安全理由需要直達 records。
- 同步 C runtime 前比較完整 diff 與檔案時間。G/C hub 現在逐位元相同，SHA-256 E14A49D8283A37735A2DD4AEF224F64472A47A8965FE0752B22D797A240842BC；workorder 六張卡原本已在 G/C 相同，並保留每張 hasModuleAccess gate。同步檔案清單：web/app/systems/[system]/system-hub-client.tsx、tools/market_daily_import.py（SHA-256 902403B2E1EAD49AB4F049973C33AC00CF1AC34673DEE69879CFFC4A8EDE56A9）、tools/test_market_daily_import.py（SHA-256 C97A5E47508FF1BE165F0D582F0B5A3458506C11BB929A51F0132361BEE98A45）。C runtime 原有六項 hub tests 保留並通過 6/6。
- MOA 測試核對：現行 G 測試檔是 25 個 unittest，含 logged CropCode='-' 回歸；G 與 C runtime 均 25/25。先前報 24 是舊隔離 release snapshot 缺少 dash test；該缺項已明確確認，本次不是用 24 項結果代替 25 項。
- 驗證：C runtime npm test exit code 0；獨立 C hub tests 6/6；G test:system-hub-client 3/3；G/C Python MOA tests 各 25/25；隔離快照 typecheck:v2 exit 0；build:v2 exit 0，靜態頁 97/97。完整 npm test 與 typecheck/build 的輸出和 exit code 存於 C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\（npm-test-20261011.log/.exitcode、typecheck-v2-20261011.log/.exitcode、build-v2-20261011.log/.exitcode）。
- 本批沒有 commit、push、deploy、正式資料庫讀寫、LINE 呼叫、server 啟停或 C runtime .next build。車輛 LINE 2026-10-08 歷史部署紀錄仍依既有更正保留；本批沒有重新查詢、重送，也沒有把歷史部署改記成未部署。
- 開收工流程：已讀 AGENTS.md 與 CLAUDE.md；repo 未找到開收工 SKILL.md，依 CLAUDE.md 直接更新既有 handoff、PROJECT_PLAN 與 Obsidian/04，無另造日誌。下一位 Codex／Claude 先讀 AGENTS.md、PROJECT_PLAN.md 本節、handoff.md 與 Obsidian/04；不要再套用舊 direct-to-records 規則。其餘 13 系統／67 模組角色資料矩陣、登入後視覺與機電 A4 實印、MOA 真 payload、workorder 併發保證等待辦仍依本計畫處理。

## 2026-10-11｜13 系統／67 子系統唯讀路由盤點與非同步載入修正
- 路由盤點完成：依 web/lib/modules.ts 核對全部 13 系統、67 個有頁面子系統；另確認 handover/guard-approve 是權限項，不是瀏覽路由。新增 module-access 回歸覆蓋 67 條路由的系統＋子系統精確授權，並確認結構圖模型管理別名不可沿用其他子系統授權。
- 已修正模型管理別名的權限檢查，並為 AuthGate、設備、儀表板、會議室、公文、駐警打卡、報修分析、稽核、安全警示與通知的非同步載入加上過期請求防護；設備與通知另避免錯誤時顯示假空資料，載入狀態在錯誤後收尾。
- 驗證：request-sequence 5/5、async-load-safety 6/6、module-access 6/6、auth-consistency 通過；17 個修改中的 TypeScript/TSX 檔由 TypeScript transpile syntax pass。
- 驗證：隔離候選由 G HEAD 加 228 個變更檔組成，使用 C 驗證環境既有 TypeScript 5.9.3、Next 16.3.8、esbuild 0.25.12；候選與來源 228/228 個 SHA-256 一致。npm test 的 53 個子命令全通過；typecheck:v2、build:v2（97/97 靜態頁）、security:secrets、MOA importer unittest 25/25、system hub 3/3、page headings 13/67 通過。
- 未完成／限制：登入後各角色與資料範圍矩陣、瀏覽器視覺／互動及實際 A4 PDF／列印仍未驗收；MOA 真實 payload 尚未取得，因此未執行真實資料驗證或匯入。本輪只在隔離 C 候選建置，沒有 commit、push、deploy、啟停 server、呼叫 Supabase 或 LINE。
- C runtime 交付狀態：57 個 web 程式／測試檔已與 G 同 hash；4 個原缺檔安全新增，19 個 C/G 衝突檔完整保留未覆寫；web/public 資產已一致。C 三組定向測試 5/5、3/3、5/5 通過；路由／資產 GET 200、Turbopack HMR WebSocket 握手成功，PID 58620 未重啟。G 實體 AGENTS.md 已記載七卡入口；task-2 舊副本另行保留。細節見 Obsidian/04、Obsidian/05。本輪沒有 commit、push 或 deploy。

## 2026-10-11｜C/G 三方語意合併第 1 批（暫不部署）

本批依 C runtime、G 候選與 release 基準 647fb50d63afda5dadfa617fafd7f51503e90f43 做逐 hunk 比對；G HEAD be0f47335d5681782c423662792b9fd2fe2049b2。完成並同步 5/19 檔：AuthGate、dashboard-client、equipment-workspace、NoticesAdmin、workorder-extras。逐檔 G／C-before／candidate-after SHA-256、決策與備份位置詳見 Obsidian/04-開發與部署.md 及 c-runtime-sync-audit.json。

保留 C-only 設備營運／能源元件、CSS 與測試，並把 C 的 hub 六項 route/access 測試加回候選測試鏈。設備主檔 status 不推定即時狀態；無能源／工單／巡檢／結案來源時顯示 unknown/pending。C 舊 CommandCenterNavigation 跨系統導覽依 G 共用導覽規範不保留。角色、權限與資料庫契約未改。

隔離候選 npm test、typecheck:v2、build:v2（97 頁）、security:secrets 均 exit 0；hub 3/3 + 6/6、設備視圖 9/9、request-sequence 5/5、async-load-safety 6/6。完整輸出位於 C:/Users/jnfa/Documents/Codex/2026-10-10/Inspection-G-build-verify/verification/candidate-full-worktree-67-route-audit-20261011-logs/c-runtime-merge-20261011-batch1-validation.log；同步前五檔備份及 sync-record.json 在同目錄 c-runtime-merge-20261011-pre-sync。

最近唯讀確認 C 3000 listener PID 31188；V2 root、設備監控、報修分析 GET 200。先前記錄 PID 58620，PID 已改變，本次未啟停服務。還有 14 檔待合併：mechanical-handover.css、meeting-workspace.tsx、official-docs-workspace.tsx、operations-workspace.tsx、patrol-workspace.tsx、workspace.tsx、modeler-client.tsx、v1-layout.css、AlertsAdminV2.tsx、AuditAdminV2.tsx、PermissionsAdminV2.tsx、module-access.test.ts、vehicle/notification-preview/page.tsx、username-login-routing.test.ts。登入後畫面、角色矩陣、A4 列印及能源資料來源未驗。未連正式 Supabase、未讀 key、未寫 DB/Storage、未送 LINE；未 commit、push、deploy。

## 2026-10-11 G/runtime 19 檔三方雜湊與安全合併

- **工作根目錄**：G 正本 `G:\我的雲端硬碟\AI\Codex\北農巡檢系統`；正確 runtime `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`；隔離 candidate `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify`。舊 `C:\Users\jnfa\Documents\Codex\2026-10-05\task-2\Inspection` 是先前誤寫的保護備份；本批更正後沒有再讀寫，保留原狀；其中既有測試不列為正確 runtime 證據。
- **三方 SHA-256 複核**：19 個既定路徑逐檔重算，G=runtime 15/19、G=candidate 14/19、runtime=candidate 17/19。前 5 項中 AuthGate、dashboard、NoticesAdmin、workorder-extras 為三方一致；equipment-workspace 保留 runtime 的 `EquipmentOperationsEnergy`、`firstQueryError`／請求序列防舊回應及儲存後刷新保護，candidate 較舊，未以 candidate 覆蓋 runtime。
- **原 14 項合併結果**：14 個路徑皆已在正確 runtime 對齊 candidate；11 個與 G 雜湊完全一致。3 個刻意保留合併內容：`web/app/v1-layout.css` 留下日期錯誤提示並採用停用原生日期欄位的 pointer 修正；`web/lib/module-access.test.ts` 增加派車預覽授權守門測試；派車預覽 `page.tsx` 保留原 `AuthGate`／`hasSystemAccess(profile, 'vehicle')`，將 gate 移至新 client wrapper 後保留 server metadata。
- **runtime 本批異動**：
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\app\systems\[system]\[module]\mechanical-handover.css`
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\app\systems\[system]\[module]\meeting-workspace.tsx`
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\app\systems\[system]\[module]\official-docs-workspace.tsx`
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\app\systems\[system]\[module]\operations-workspace.tsx`
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\app\systems\[system]\[module]\patrol-workspace.tsx`
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\app\systems\[system]\[module]\workspace.tsx`
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\app\systems\structuremap\modeler\modeler-client.tsx`
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\app\v1-layout.css`
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\components\admin\AlertsAdminV2.tsx`
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\components\admin\AuditAdminV2.tsx`
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\components\admin\PermissionsAdminV2.tsx`
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\lib\module-access.test.ts`
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\app\systems\vehicle\notification-preview\page.tsx`
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\app\systems\vehicle\notification-preview\page-client.tsx`（新增，用以保留既有登入／系統權限 gate）
  - `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\web\lib\username-login-routing.test.ts`
- **runtime 原件備份**：第一批 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\runtime-pre-sync-first-safe-batch-20261011`；第二批 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\runtime-pre-sync-second-batch-20261011`；派車頁改造前 candidate 備份 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\route-guard-merge-20261011\page.tsx`。每批同步前核對舊 SHA 與 candidate 新 SHA，同步後逐檔重驗。
- **candidate 驗證**：工作目錄固定為 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify`。`npm run test:handover-style` 通過；`npm run test:page-headings` 通過（13 系統／67 子系統、62 標準及 4 緊湊頁首）；`npm run test:permission-fail-closed` 8/8；`node --experimental-strip-types --test web/lib/module-access.test.ts` 7/7；`npm run test:create-refresh` 3/3；`npm run test:repair-detail-refresh` 5/5；`node --experimental-strip-types --test web/lib/request-sequence.test.ts` 5/5；`node --experimental-strip-types --test web/lib/username-login-routing.test.ts` 9/9；`npm run test:localized-date-input` 9/9；`npm run typecheck:v2` exit 0；`npm run build:v2` exit 0，Next 產生 97/97 靜態頁。candidate 起初缺少檢查腳本與 app-api 測試來源；只在 candidate 複製 G 的純檢查檔及必要 app-api source 後重跑通過，未改 G/runtime 的測試來源。
- **邊界**：沒有在 runtime 執行 build/test，沒有啟停 server、讀 key、連 Supabase／資料庫、呼叫 LINE、commit、push 或 deploy。發布維持使用者指定停止狀態與既定 SHA `647fb50d63afda5dadfa617fafd7f51503e90f43`。
- **待辦／接手**：下一位 Codex／Claude 先讀 G 的 `AGENTS.md`、`CLAUDE.md`、`PROJECT_PLAN.md`、`handoff.md` 與本節；只使用上列正確 G/runtime/candidate 路徑，絕不回寫 task-2。後續先把 runtime 的 equipment-workspace 功能同步到隔離 candidate 再做 typecheck/build，保留能源概覽與拒絕部分查詢錯誤資料的防護；再視需要補做瀏覽器視覺／A4 列印驗收。未收到新授權前不 commit/push/deploy。

### 2026-10-11 equipment/runtime parity follow-up

candidate 在 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify` 已用正確 runtime 的 `dashboard-client.tsx`、`equipment-workspace.tsx` 覆蓋候選舊版，並加入 runtime 專屬 `equipment-operations-energy.tsx`／`.module.css`；原 candidate 兩檔備份於 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\runtime-overlay-candidate-validation-20261011`。另外只在 candidate 放入 G 的 `async-load-safety.test.ts` 做驗證。runtime 未再被改寫，保留能源面板、`firstQueryError`、stale response 防護及資料儲存後刷新保護。

candidate 實際命令：`node --experimental-strip-types --test web/lib/async-load-safety.test.ts` 6/6；`npm run typecheck:v2` exit 0；`npm run build:v2` exit 0，97/97 靜態頁。完成後再次三方核對原 19 路徑：G=runtime 15/19、G=candidate 15/19、runtime=candidate 19/19；能源 component、CSS、`async-load-safety.ts`、`request-sequence.ts`、派車 page-client 等 5 個 runtime/candidate 補充路徑亦 5/5 同 hash。G/runtime 的四項刻意差異是 equipment-workspace、v1-layout.css、module-access.test.ts、vehicle notification preview page，均為保留的 C/runtime 專屬功能或權限防護。未在 runtime build/test；未啟停 server、讀 key、連 DB/Supabase、LINE、commit、push 或 deploy。發布仍暫停。

接手方式不變：Codex／Claude 由 G 的 `AGENTS.md`、`CLAUDE.md`、`PROJECT_PLAN.md`、`handoff.md` 與 `Obsidian/04-開發與部署.md` 起步；task-2 僅保留為歷史保護備份，不讀寫也不引用其測試。原 19 檔核對／安全合併已完成；後續若續作，只處理尚未驗證的瀏覽器視覺及 A4 PDF，且除非取得新授權，不發布。

## 2026-10-11 Runtime parity merge completed (deployment remains frozen)
- G is the source of truth. After reviewing the isolated candidate and its tests, four portable runtime changes were synced into G: equipment operations/energy overview; disabled localized-date picker touch behavior; vehicle notification-preview authentication and system-access gate; and the gate regression test.
- Updated paths: web/app/systems/[system]/[module]/equipment-workspace.tsx; web/app/systems/[system]/[module]/equipment-operations-energy.tsx; web/app/systems/[system]/[module]/equipment-operations-energy.module.css; web/app/v1-layout.css; web/lib/module-access.test.ts; web/app/systems/vehicle/notification-preview/page.tsx; web/app/systems/vehicle/notification-preview/page-client.tsx.
- Equipment integration is additive and retains G's existing request sequencing and firstQueryError handling. The overview only reports the available equipment and monitor-event feed; unavailable work-order, inspection, and closure sources remain pending, and master inventory status is not presented as a live signal. The preview client retains AuthGate and hasSystemAccess(profile, 'vehicle'); page metadata remains on the server route.
- Isolated candidate validation completed: npm test exit 0 (node syntax check plus all 53 chained test scripts); npm run typecheck:v2 exit 0; npm run build:v2 exit 0 with 97/97 static pages; npm run security:secrets passed with no Edge Function private values detected in web/ or system/.
- Candidate had started without the complete G test harness. G's package/test inputs and required source fixtures were mirrored into the isolated candidate only; no .env, key, production database data, local host configuration, or protected task-2 source was used. G's original versions of the five pre-existing target files are backed up at C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\g-pre-sync-backup-20261011.
- No server was started, no production database or LINE operation was performed, and no commit, push, or deploy was made. Continue to honor the user's no-deploy instruction. Logged-in browser appearance and actual A4/PDF pagination remain unverified.
## 2026-10-12 SYS-04 交接簿日期工具列樣式回復（未部署）

- 參考圖證據：parent agent 已直接檢視同一張 Library PNG，確認紅圈為駐警隊 2026/10/06 值班日期列，需求是恢復原版順序與尺寸：市場切換、日期前一日（‹）、日期欄、日期後一日（›）、回到今天；不得帶回圖中舊說明文字或舊列印按鈕。本紀錄不宣稱本代理重新讀取或比對 PNG 像素。
- 歷史基準：G 的 `940ad62f46228b463ce8de71ed86f58cd3a1955d`（2026-10-05，Polish guard daily report...）與 G HEAD `be0f47335d5681782c423662792b9fd2fe2049b2`（2026-10-08）中，共用 `handover-sheet.css` 的基準 blob 相同（`46f14b0d096e0cbfc1fcd7382c8fb8b4ada94a2f`）。駐警隊 JSX 在 G HEAD 與 940ad62 都保留巢狀 `<label><LocalizedDateInput /></label>` 及一般 `secondary-btn compact` 前後按鈕，順序與參考圖描述吻合。
- 根因：未提交的共用 CSS 原 SHA-256 `BC9929C4D5B82C633137D6029DF811E7B306EF32B4BA02BDFAFBAA10929E6907` 改用 `.hs-date-label`、`.hs-date-arrow` 及 `.hs-date-nav > .localized-date-input` 等 JSX 不存在的 selector，並更改工具列／右側資訊對齊，令日期欄寬、箭頭及響應式排列規則落空。
- 修正：只在 `web/app/systems/[system]/[module]/handover-sheet.css` 恢復歷史工具列規則（space-between、巢狀 label／180px 欄位標籤、右側可換行、窄版 label 滿寬）；保留日期區間欄位規則及其他既存工作。沒有改 JSX、日期存取／驗證、角色權限、簽核 handler 或三本各自業務欄位。G 與正確 runtime 同步後 SHA-256 為 `5539C657C3A3F85526737874E6A55E0CC5D37672C0C646211E078EE909A61BDE`。
- 原始檔備份及雜湊在隔離候選 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\handover-toolbar-restore-20261012`：`handover-sheet-0.css`（G）、`handover-sheet-1.css`（runtime）、`handover-sheet-2.css`（candidate），三份均為原 SHA `BC9929C4...E6907`；文件寫入前的 PROJECT_PLAN、handoff、Obsidian/04 原件也在同目錄，備份 SHA 與寫入前一致。
- 隔離 candidate 驗證：`npm run test:handover-style` 通過（三本共用樣式）；`npm run test:localized-date-input` 9/9；`npm run test:css-source-balance` 通過（含三本交接簿 CSS）；`npm run typecheck:v2` exit 0；`npm run build:v2` exit 0，Next 產生 97/97 靜態頁。沒有執行完整 `npm test` 鏈。
- 未驗證：沒有可用瀏覽器／截圖工具，未做登入後真實畫面、桌機／窄版實際視覺比對，也未做瀏覽器列印／A4 實印；parent 對 Library PNG 的觀察只作參考圖證據，不等同網站畫面驗收。沒有啟停 server、讀 key、連 Supabase／資料庫、簽核正式案件、commit、push 或 deploy；遵守使用者「先不要部署」。
## 2026-10-12 交接簿新截圖複核：歷史 CSS 回復不足，畫面差異待修

- parent agent 已檢視使用者新圖（頁面 09:04:54）。本輪依新指示只讀診斷，不再改 JSX/CSS、不重啟服務。先前已同步的日期列 CSS 不代表此畫面已驗收，也不代表黑色日期圖示已移除。
- **服務位置**：`127.0.0.1:3000` 只有 listener PID `31188`，Node parent PID `41548`；啟動命令指向 `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime\node_modules\next`，以唯讀 PEB 查得 PID 31188 CWD 正是 `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`。未讀 process env/key，未停止任何程序。G/runtime 的 Guard、Mechanical、AdminHeader、admin-workspace.css、modules.ts、LocalizedDateInput 相關雜湊相同；common `handover-sheet.css` 皆為 `5539C657C3A3F85526737874E6A55E0CC5D37672C0C646211E078EE909A61BDE`。錯誤工作目錄不是目前證據支持的原因。
- **HTTP/資產限制**：唯讀 GET `http://127.0.0.1:3000/Inspection/v2/systems/handover/guard/` 回 200，但沒有登入 cookie；`page.tsx` 經 `WorkspaceRouter`／`AuthGate` 保護。未登入回應僅載入 `web_app_0sugxw3._.css` 全域 CSS（GET 200、167,934 chars），不含 `.hs-date-nav`／Guard 標籤規則，且無已登入交接元件 JS。這只證明入口可達，不能證明登入後瀏覽器拿到新 `handover-sheet.css`；不可用此回應宣稱畫面通過。沒有讀取瀏覽器 profile/session。
- **畫面差異可在 G 現行源碼找到**：Guard JSX 仍先 render 前日按鈕，再 render「值班日期＋LocalizedDateInput」，再後日／回到今天；使用者新圖預期「值班日期文字 → 前日按鈕 → 白底日期欄 → 後日 → 回到今天」，需調整 DOM/label 結構，CSS 單獨無法改順序。共用 `AdminHeader`（`web/components/admin/shared.tsx`）固定輸出 `module.description`，G 的 CSS 沒有交接頁隱藏該段，故 SystemPageHeader 會重複說明。Guard `AdminHeader` action 仍寫「列印本日報表」。這些值與新圖吻合，說明不能把問題單歸於錯誤 CWD；authenticated asset/cache 本輪仍無法判定。
- 日期欄寬也需登入後確認：`LocalizedDateInput` 根元素為 `.localized-date-input`，全域規則設 `width:100%`，共同 CSS `.hs-date-nav label>span{width:180px}` specificity 較高；若該共用 CSS 已載入，應限制寬度。未登入 CSS 回應不含該規則，所以本輪不能確定截圖寬欄是未載入樣式、瀏覽器舊資產或實際 cascade。未盲加 `!important`。
- **黑色小圖示來源盤點**：日期列 CSS 沒有繪製三角形；日期前後是文字 `‹`／`›`。`LocalizedDateInput.tsx` 有可見的日曆按鈕 glyph `▣`，並另有透明 `type=date` picker；`v1-layout.css` 在 coarse pointer 將原生欄覆蓋全欄並設 `appearance:none`，但沒有 `::-webkit-calendar-picker-indicator` 規則。Guard 下拉元件另有 `▾` caret，屬於清單下拉、非日期列。因沒有登入瀏覽器 computed style，無法確認圖中的深色形狀是 `▣` 的字型呈現還是 UA 原生日期 indicator；本輪沒有改圖示或原生 picker。
- **三本簽核來源只讀比對**：Guard 歷史 `d31bc1e68`（2026-10-05，`Open guard daily report from supervisor signoff`）將實際簽核輸入移至日報預覽 footer；G 現行 top band 的「主管每日簽核」是狀態／開啟日報按鈕，真正表單在 `HandoverReportApprovalForm` footer，且現行加上唯讀與 submit 權限控制。Mechanical G working file 與 `eeb8fd82...` 的內容 blob 相同，保留 `HandoverReportApprovalFooter`、簽核人／時間／說明與表單。Business G 現行相對 `d5ee8f6ec` 僅更正「逐級審核」為「三階段簽核（各階段依授權）」說明文字；三階段簽核及意見欄仍在。簽核流程功能仍存在，未簽任何案件；若需求是移除 Guard 頁首狀態帶，這是額外版面決策，不能把狀態帶誤認為可直接簽核欄。
- **本日補跑驗證**：絕對目錄 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify`；`npm test` exit 0（完整 package test chain）；`npm run security:secrets` 通過，回報 `web/` 與 `system/` 未發現 Edge Function 私密值。這些是候選測試結果，不是瀏覽器畫面驗收。未停/重啟 server，未讀 key、未連 DB/Supabase、未正式簽核、未 commit/push/deploy。沒有更新 Obsidian/05 待辦的 UI 驗收狀態。
- 下一個實作切片應以使用者最新參考順序為準，先明確排日期 label／前日按鈕／固定日期欄，再檢查 AdminHeader 說明與列印文案；先取得登入後 CSS/JS 實際資產證據，避免再用靜態 CSS 假定畫面已改好。依目前使用者「先只讀診斷」要求，本輪不執行該實作。


## 2026-10-12 SYS-04 三本交接簿日期列與重複說明修復（未部署）

依使用者指定，在隔離 candidate 完成並驗證後，只同步 10 個交接簿／日期元件相關檔案到 G 與正確 runtime。歷史檢索只找到可作樣式線索的舊 CSS，沒有找到同時具備目標 DOM 順序與對應 JSX/CSS 的完整歷史版本；本次因此是最小的共用元件修正，不宣稱完整找回舊實作。

三本交接簿改共用 `HandoverDateNavigation`，DOM 固定為「日期標籤 → 前一天 → 日期欄 → 後一天 → 回到今天」，三簿各自保留原日期格式、日期移動與回今天 handler。共用 CSS 固定日期列與箭頭可點區尺寸、淺藍直角細框、桌面日期欄上限 180px 並允許窄版收縮；`LocalizedDateInput` 的黑色方格 glyph 改成 16px SVG 日曆圖示，圖示按鈕固定 24px，輸入文字預留右側空間，隱藏 WebKit 原生日曆 indicator，觸控裝置仍由透明原生 date 欄位開啟系統日曆。只在三本 `AdminHeader` 傳入 `hideDescription`，其他頁預設與原行為相同；note、操作按鈕、重新載入仍在。Guard 頁面列印按鈕與預覽內按鈕標示「列印日報表」。未改其他下拉圖示。

權限、簽核與業務資料處理均未改。Guard 頁首 `hs-approval` 仍為簽核狀態帶／開啟日報按鈕，實際核閱與簽核表單仍在日報 footer；機電／業管簽核欄位、handler 也保留。若「主管每日簽核最後面」是指主畫面最底端，這仍是明確未完成的版面差異；本次依要求不移動或改動業務流程。

候選驗證：`npm test` 完整鏈 exit 0；`npm run typecheck:v2` exit 0；`npm run build:v2` exit 0、97/97 靜態頁；`npm run security:secrets` 通過；`npm run test:localized-date-input` 10/10；`npm run test:handover-style` 與 `npm run test:css-source-balance` 通過。G/runtime/candidate 受影響檔案修改前都有絕對路徑備份與 SHA-256 核對。沒有可用瀏覽器／截圖工具，登入後桌面／窄版實際畫面及 A4 瀏覽器列印仍未驗；build 不作為畫面驗收。未啟停 runtime server、未讀 key、未連 Supabase／DB、未簽核正式案件、未 commit／push／deploy；使用者「先不要部署」持續有效。Obsidian/05 視覺待驗狀態不變。


## 2026-10-12 Guard 主管簽核狀態卡移至交接內容最後（未部署）

使用者確認原有明確版面需求「駐警隊電子交接簿 主管每日簽核 請往下放在最後面，參考機電課電子交接簿」已授權。本次把原有 `hs-approval` 狀態／日報入口卡移到 `.hs-sheet` 三班交接內容之後，作為主畫面最後一個可見業務區塊；保留卡片文字、狀態、顯示條件與原有日報入口。實際 `HandoverReportApprovalForm` 仍在日報 footer，權限、核閱說明、資料流程與 handler 均未改，也沒有新增簽核動作。

歷史檢索 `d31bc1e68`（2026-10-05）與 `6ba8f0524`（2026-09-12）中的 Guard 狀態卡均在交接內容之前，沒有可完整恢復的卡片置底歷史版；因此只作最小 DOM 順序修改。`tools/handover-style-check.mjs` 新增回歸檢查，確認卡片在交接表之後且日報 footer 實際表單仍存在。candidate `npm test` 完整鏈 exit 0、`npm run typecheck:v2` exit 0、`npm run build:v2` exit 0（97/97 頁）；`npm run test:guard-handover` 與 `npm run test:handover-style` 通過。G、runtime、candidate 的兩個修改檔 SHA-256 相同；修改前原件備份於 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\guard-approval-card-last-20261012`。

**正式版 SHA 更正**：上一則 assistant 回覆錯把 `eeb8fd82fa7b4547febb50db966aea1cc622e3bc` 稱作仍在正式站的版本。依 G 交接文件最新核實紀錄及本機 `origin/main` ref，最近核實的正式版 SHA 是 `647fb50d63afda5dadfa617fafd7f51503e90f43`（commit `fix: prevent stale refreshes and validate localized dates`，2026-10-10）；`eeb8fd82...` 是較早的歷史發布，所有舊發布紀錄保留不改。本輪狀態卡置底修改只在 G/runtime/candidate，未 commit、push 或 deploy。

沒有瀏覽器／截圖工具，登入後真實畫面及使用者視覺確認仍待完成；build 不代表畫面驗收。沒有啟停 runtime server、讀 key、連 Supabase／DB 或執行正式簽核；task-2 保持唯讀。


## 2026-10-12 SYS-04 七個頁面模組盤點與業管簽核置底修復（未部署）

正式版基準只採本機唯讀核實的 `origin/main`：`647fb50d63afda5dadfa617fafd7f51503e90f43`。G：`G:\我的雲端硬碟\AI\Codex\北農巡檢系統`；正確 runtime：`C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`；隔離 candidate：`C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify`。未寫 task-2。修改前已對三份程式樹各自保存原檔並核對 SHA-256，備份在 candidate `verification\business-handover-bottom-colors-20261012`。

歷史 `d5ee8f6ec`（2026-10-10 `Unify handover approval presentation`）只加業管簽核不可編輯時的說明 CSS；更早 `1d1bf6e24`／`00fc04076` 有業管三階段簽核與 A4 摘要，但沒有本次目標的完整置底版。因而沒有把失真的 task-2 現況當原版，也沒有聲稱從歷史找回舊配色。依既有共用規範，業管主管簽核外框改與 `handover-sheet.css` 的主管藍灰相同（`#F1F5F9`／`#CBD5E1`／`#334155`），班別本色仍用既定早藍、中綠、晚棕；三級簽核是職務階段，沒有套用班別色。

業管頁把整個「一市場主任／營業部副理／營業部經理」批核區移到三班交接 `.hs-sheet` 後、列印專用報表前。保留三階段各自權限判斷、簽核說明欄與既有 handler／資料欄位；沒有新增先後順序限制，沒有改 RPC、schema 或簽核資料。移除標題旁重複的 emoji，使用既有盾牌圖示。螢幕簽核區在 `@media print` 隱藏，既有 A4 `BusinessReportContent` 底部簽核摘要與說明不變。`tools/handover-style-check.mjs` 增加業管簽核置底、藍灰、簽核說明／列印摘要及 SYS-04 載入錯誤回歸檢查。

### SYS-04 registry 核實與逐項結果

`web/lib/modules.ts` 的 SYS-04 實際頁面共七項；`guard-approve` 是權限專用項目，沒有獨立頁面。動態 route 經 `findModule`、`WorkspaceRouter`／`AuthGate` 與 `HandoverModules` 再次檢查子系統權限；Guard 主管只依既有明確 `guard-approve` 授權例外進入 Guard 頁面。

| 子系統與路由 | 日期、共用外觀、簽核／列印 | 篩選與錯誤處理 | 證據 |
| --- | --- | --- | --- |
| 指揮台交接 `records` | 起訖日與建單日期用 `LocalizedDateInput`；接班簽收沿用雙方交接流程。主管日簽、列印：N/A。 | 搜尋、狀態、班別、日期區間；主要資料／人員／部門查詢錯誤顯示，網路拒絕會清空失效結果並解除 busy。 | 靜態＋全測＋HTTP |
| 機電課 `mechanical` | 三本共用日期列與表頭；班卡遵守早藍／中綠／晚棕。每日課長簽核狀態在交接內容後，真正表單仍在報表 footer；日報列印及區間列印。 | 市場、日期、班別／工作紀錄篩選；載入錯誤有提示與 busy 復原。 | 靜態＋全測＋列印 fit 測試＋HTTP |
| 業管組 `business` | 共用日期列／表頭；三階段簽核現置交接內容底部，主管區採共用藍灰；保留每階段說明與 A4 簽核摘要。 | 市場、日期、勤務時段篩選；資料／簽核權限查詢維持 fail-closed，載入錯誤有提示。 | 靜態＋全測＋HTTP |
| 駐警隊 `guard` | 共用日期列／表頭；狀態入口卡在交接內容底部，實際主管簽核表單位於日報 footer；每日及既有批次列印。 | 市場、值勤日期、班別與異常篩選；錯誤提示、唯讀權限資訊仍在。 | 靜態＋全測＋HTTP |
| 未結事項 `open-items` | 日期區間用 `LocalizedDateInput`；另無主管日簽或列印功能：N/A。 | 搜尋、狀態、類別、日期範圍；案件／附件／明細載入錯誤提示，網路拒絕可解除 busy。 | 靜態＋全測＋HTTP |
| 設備概況 `equipment` | 本頁無日期導覽、列印或簽核：N/A。 | 關鍵字、狀態、樓層；載入錯誤提示與 busy 復原。 | 靜態＋全測＋HTTP |
| 機電課排班表 `mechanical-schedule` | 月份前後導覽、民國年月／日期日曆與早中晚班色；列印月班表。主管簽核：N/A。 | 一市／二市、月份與日曆選日；排班、部門、人員、市場範圍查詢錯誤提示並復原 busy。 | 靜態＋全測＋HTTP |

三本交接簿日期列均由共用元件提供固定順序與 SVG 圖示；其他日期欄使用 `LocalizedDateInput`；SYS-04 TSX 未發現原生 `date`／`datetime-local` 欄位。非三本日報頁沒有硬加簽核或列印。以未送 cookie 的唯讀 GET 檢查七條 `/Inspection/v2/systems/handover/<slug>/` 都回 HTTP 200；只代表路由可達，不代表已登入的 UI。

Candidate 驗證：`npm test` 完整鏈 exit 0（含 handover-style、business／mechanical／guard handover、handover-market、page-headings、localized-date）；`npm run typecheck:v2` exit 0；`npm run build:v2` 成功產出 97/97 靜態頁；`npm run test:mechanical-print-fit` 4/4 與 integration checker 通過；`npm run security:secrets` 通過。五個修改檔在 G、runtime、candidate 的 SHA-256 完全相同：Business TSX `BEE37A651AF8A23709F0E4E5E6602955828E1673C7A3A4810AA6B0B2B41CBEFF`、Business CSS `738C92FCC89F4DB1F311A9B42BD5E03EF8A0FAA7409FC16B83746F2E1C4F2BB6`、checker `C54B26570122FC291ED6B5B34773E070261C49A19F793E9DDFE352CB43635B74`、handover workspace `3CF7B0DB96BA4A72D28E7DA368BB7A92345D9B28B595FB1AB182970909A76ACA`、mechanical schedule `DCE9874DE38200F14F6902E2B5D084A450D4544B8D684D979652C942DF10F3C2`。

沒有可用的登入瀏覽器／截圖工具；真登入畫面、窄版視覺、A4 瀏覽器列印均未驗證，build／HTTP 不代表視覺驗收。server 未啟停；沒有讀 key、連正式 DB／Supabase、執行正式簽核、commit、push 或 deploy。使用者「先不要部署」持續有效；下一步只待真登入畫面與 A4 PDF 視覺驗收。

## 2026-10-12 Guard 日報簽核區自然分頁修正（未部署）

根因是共用列印 CSS 將整個 .hs-report-footer 設為不可拆頁；當日報剩餘空間不足，瀏覽器便把整塊簽核摘要推到下一張，造成只有簽核區的稀疏頁。Guard 沒有在簽核區前強制換頁。黑白框線與列印時隱藏輸入表單都是既有 print 樣式；螢幕預覽在尚未簽核時才顯示表單，無簽核權限者仍唯讀／停用，已簽核後不顯示。權限與簽核流程均未更動。

共用列印 footer 現可自然跨頁且不再被 overflow 裁切；機電多頁模式只保留續辦區成組，不再把整個簽核 footer 綁成一塊。Guard 每個日期仍從新頁開始；同日日報長內容可自然延伸到下一頁。修改 handover-sheet.css、mechanical-handover.css，並更新兩個版型／列印整合檢查器。

Candidate 定向驗證：test:handover-style、test:mechanical-print-fit（4/4 與整合檢查）、test:css-source-balance、typecheck:v2、Guard／機電／業管交接資料流程測試均通過。四個程式檔在 G、runtime、candidate 的 SHA-256 已對齊；修改前備份位於 C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\guard-report-footer-natural-flow-20261012。沒有可用瀏覽器做修改後的實際 A4 列印驗收；不以靜態測試代替視覺驗收。沒有 build、commit、push、deploy、server 啟停、DB／Supabase／key 或正式簽核操作；使用者「先不要部署」持續有效。
## 2026-10-12 三本電子交接簿日報共用版型（本機未部署）

盤點確認 Guard 與機電日報已用共用 HandoverReportHeading、Overview、ShiftCard 與 ApprovalFooter；但機電本地列印 CSS 把班色覆蓋成黑白，業管仍用獨立標題、摘要、表格與三級簽核盒，所以三本在字級、線框、留白和簽核色塊上分岔。簽核輸入框在列印時隱藏是既有共用規則；Guard／機電只有待簽日報會在畫面預覽顯示輸入框，簽核權限仍唯讀／停用，已簽後不顯示。此修正沒有改角色、權限、handler 或資料欄位。

業管報表已改用共用標題與四格摘要；三班工作列加共用早藍／中綠／晚棕樣式；三級簽核說明框採共用藍灰外觀與可讀字級。原巡查項目、班務／出缺勤、三階段人員／時間／說明均保留。Guard、機電與業管共用 A4 portrait、零頁邊距、9mm 內容內距、日報標題、四格摘要、表格框線及班色；Guard／機電簽核 footer 改藍灰，機電交接勾稽卡也依班色標示。Guard 區間列印仍每日期另起新頁；機電每張日報仍另起新頁，過長報表解除固定高度與裁切；業管長班務／簽核說明可自然延頁，不再把整組簽核推到下一頁。簽核摘要與說明列印保留，輸入按鈕與表單列印隱藏。

Candidate 驗證：完整 npm test exit 0（含新增 13 個長短內容、三班、待簽／已簽／唯讀 fixture）；typecheck:v2、build:v2（97/97 靜態頁）、security:secrets 通過；Guard、機電、業管交接流程測試、機電列印 fit 4/4、CSS balance 均通過。G 與 runtime 的 handover-style、report fixture（13/13）、mechanical-print-fit（4/4）及 CSS balance 通過；runtime typecheck 通過。G typecheck 未能執行：G 的 node_modules 沒有可呼叫的 tsc；第一次 fixture 測試也暴露 G 的 node_modules/postcss/package.json 無效，fixture 已改為不依賴外部套件，三處目前均 13/13 通過。沒有瀏覽器／PDF 實印工具，修改後 A4 視覺與實際列印仍未驗證。

九個報表、共用 CSS、檢查器與 fixture 程式檔在 G、runtime、candidate SHA-256 相同；package.json 保留 runtime 原有的測試清單差異，只在三處都加入 test:handover-report-fixtures，因此 runtime package hash 本來就不同。修改前備份在 C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\unified-daily-report-style-20261012；較早 footer 分頁備份保留在 guard-report-footer-natural-flow-20261012。G 程式檔、PROJECT_PLAN 與 handoff 的 git diff --check 通過；Obsidian/04 整份既有工作差異仍含此次新段落以前的行尾空白，本次新段落自身無尾隨空白，未改動舊內容。Candidate 建置只產生 candidate 本機 .next；沒有同步 build 產物。

沒有啟停 runtime server、連正式 DB／Supabase、讀 key、執行正式簽核、commit、push 或 deploy。使用者「先不要部署」持續有效；不會觸發正式發布。登入後版面與 A4 實印驗收仍列待驗。

## 2026-10-12 臺灣天氣地圖 Blender V3 資產接手（未整合／未發布）

### 來源與目錄

- 唯一資產目錄：`G:\我的雲端硬碟\AI\Codex\北農巡檢系統\design\taiwan-weather-blender`。本次只讀 README、驗證 manifest 與候選校對報告；沒有修改圖檔、錨點、腳本或 web。
- 接手初始盤點時 README 為 UTF-8、2,666 bytes；透明輸出完成後，最新 README 為 2,826 bytes，記載透明 RGBA 預覽。README 記載 Blender 5.2.1 LTS；owner 曾回報實跑 Blender 5.2.1，本次沒有啟動 Blender 或重建。
- 目錄目前有 12 個檔案：

```text
design/taiwan-weather-blender/
├── README.md                         2,666 bytes
├── build_weather_map.py             18,997 bytes
├── verify_assets.py                  6,249 bytes
├── source-taiwan-counties.svg       36,461 bytes
├── taiwan-weather-map.blend        320,680 bytes
├── taiwan-weather-map.glb        7,661,860 bytes
├── taiwan-weather-preview.png      561,313 bytes
├── marker-anchors.json              30,174 bytes
├── county-mapping-review.png       359,786 bytes
├── county-mapping-review.md          7,658 bytes
├── county-mapping-review.csv         4,193 bytes
└── county-mapping-review.json       27,214 bytes
```

- `source-taiwan-counties.svg` 與 `system/assets/taiwan-counties.svg` 本次讀取 SHA-256 相同：`701F571D53E96E55CA2493A28D3276CB38A58A9F59CF88702FED5EA2A2AAE6B5`。

### V3 狀態與既有驗證證據

- PNG IHDR 確認為 619×847；`marker-anchors.json` 記錄 19 個固定 marker、`--°C` 佔位且實際溫度為 null，天氣 icon 是靜態示意。
- manifest 記錄本島 raster bbox `(145,119)–(519,833)`，目標 bbox `(145,119)–(520,834)`，最大差 1 px；18 個中心在岸外，`weather-15` 中心位於來源 SVG 的南投縣 polygon 內。這與 owner 所述 V3「南投為唯一島內 marker，其餘岸外、南部位置貼近」一致；本次未改位置。
- manifest 記錄岸距 8.04–12.01 px（要求 8–16 px，pass）；最小 marker 中心距離 64.846 px，最近為 weather-09／weather-10（badge 直徑 63 px，pass）；本島 bbox 內 near-black 裂縫像素 0。
- `county-mapping-review.md/.csv/.json/.png` 是依幾何距離排列的人工校對候選，不是正式縣市或測站對照。只有 weather-15 已核實南投；其餘 18 個 county 欄位維持未知。README 記錄專案沒有 weather-01..19 的權威映射；未核實前不可把縣市預報套到 marker。
- `verify_assets.py` 結尾會 `write_text` 回寫 `marker-anchors.json`；為遵守本輪不改資產的限制，本次沒有執行它。上述幾何結果是唯讀 manifest 記錄，不是本次重新跑出的驗證。已另以只讀方式確認 PNG 尺寸及 SVG 副本 hash。
- 透明底輸出已完成。最新 G README 記錄預覽 PNG 為 619×847 RGBA 且背景含全透明像素；依資產負責者交付回報，全透明像素為 323,296。負責者重開 Blender 場景確認 ORTHO 相機、19 個圖示中心與 19 個文字錨點保持原位，錨點投影誤差 0 px、本島 raster bbox 相對基準最大差 2 px；透明化前的不透明 V3 備份位於 `design/taiwan-weather-blender/backup-2026-10-12-v3-opaque/`。Library preview v4 已更新並交付使用者。此完成不代表 18 筆縣市映射、即時天氣、web 整合或發布完成。

### 待辦與 Codex／Claude 接手

1. 先由使用者確認 marker 是代表縣市、測站或區域；再由 `county-mapping-review.csv` 的 `confirmed_county_user_input` 填入 weather-01..14、weather-16..19 的權威對應，或提供正式 `marker ID／氣象站代碼 → 縣市` 表。不得用最近 polygon 候選猜映射。
2. 對照確認前，18 個未知 marker 維持 `county_id=null`、溫度 null 和 `--°C`；不可新增即時預報值。
3. Blender `build_weather_map.py` 會覆寫 `.blend`、PNG、GLB 與 `marker-anchors.json`；`verify_assets.py` 也會寫錨點 JSON。任何重建／重驗須先另行授權並保留目前 V3 副本。本輪禁止修改 map 資產、web 或部署。
4. 下一位 Codex／Claude 從 G 開工，先讀根 `AGENTS.md`、`CLAUDE.md`、本節、`handoff.md`、`Obsidian/04-開發與部署.md` 及上述 README。`mapowner` 只負責校對圖上傳，不寫主計畫；主計畫與歷史紀錄由本 writer 維護。後續先處理人工映射確認；web／即時天氣整合須另有明確授權。

本次只讀命令範圍：PowerShell `Get-ChildItem`、`Get-Content -Encoding utf8`、`ConvertFrom-Json`、`Get-FileHash` 與 PNG IHDR 位元組讀取。未執行 Blender、`build_weather_map.py`、`verify_assets.py`、web 測試、資料庫／LINE 或部署。

- 補充相機來源證據：唯讀檢查 build_weather_map.py 第 51、254–268 行，腳本將輸出解析度設為 619×847／100%，建立 ORTHO 垂直取景相機並斷言校準畫格符合 619×847；這是腳本設定讀取，不是本次重新執行 Blender 或檢查 .blend 內部狀態。
## 2026-10-12 儀表板天氣地圖 V3 整合進度與 Workorder 圖卡名稱（進行中）

- 使用者新增的小項已完成：只將 `web/app/systems/[system]/system-hub-client.tsx` workorder MAIN-01 圖卡標題由「報修 & 維修」改為「報修」。路由 `/systems/workorder/requests/`、`hasModuleAccess(profile, 'workorder', 'requests')`、alt、描述與 CTA 均保留。G 原 SHA `E14A49D8283A37735A2DD4AEF224F64472A47A8965FE0752B22D797A240842BC`；G、C runtime、C candidate 修正後 SHA 同為 `55243683AF457B635BC137A2D8A9DE0B0F240C5CCF6DE2F913F7E33DA907BB29`。由 G 單向同步，未從 C 回寫。
- 在核准 candidate `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify` 執行 `npm run test:system-hub-client`，3/3 通過；另用唯讀靜態檢查確認圖卡標題、路由、授權 gate、alt 與 CTA。Node 24.18.0、npm 11.16.0、Next 16.3.8。此小項未單獨跑 typecheck/build；會隨天氣整合一起驗證。
- 核准 runtime 為 `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`；只核對到 PID 31188 綁 `127.0.0.1:3000`，啟動命令位於該 runtime；沒有啟停服務。C candidate／runtime 非 Git 編輯來源。G 工作樹既有大量未提交修改，均保留。
- 天氣地圖準備：透明 v4 PNG 已讀取，包含 19 個烘焙圖示及 `--°C`，不得再把它作底圖後疊第二套即時標記。G `web/public/taiwan-counties.svg`、V1 SVG 與 Blender `source-taiwan-counties.svg` SHA 均為 `701F571D53E96E55CA2493A28D3276CB38A58A9F59CF88702FED5EA2A2AAE6B5`；唯讀核對 `build_weather_map.py` 以相同 affine transform 將 SVG 轉入 619×847 Blender 畫布，因此可用 SVG 向量作乾淨底圖，暫不需另匯 Blender 素材。
- `marker-anchors.json` 是 19 個位置唯一來源；badge 半徑 31.5px，僅 `weather-15 → 南投縣` 已核實，另外 18 個 county id 為 null。candidate UI 將沿用同一 619×847 viewBox／固定中心／63px badge；僅已核實對應可用縣市即時資料，其餘明示縣市待確認與 `--°C`，不依幾何候選猜值。天氣卡、縣市 path 下鑽、API 與授權保持既有流程。
- 本機實作已完成：`web/app/weather-widget.tsx` 改用 `weather-map-v3.ts` 的 619×847 向量底圖與 19 個固定 V3 錨點；只將 weather-15 對應南投接入 CWA 摘要，其餘 18 個保留待確認／`--°C`，不依鄰近位置推測。縣市圖層仍可點擊／鍵盤下鑽，右側縣市與鄉鎮資料流程保留，鄉鎮預設收合。
- 回歸檔 `web/lib/weather-map-v3.test.ts` 對照錨點 manifest、源 SVG SHA、仿射邊界與資料缺值政策。候選定向測試通過：weather API 6/6、weather layout 4/4、V3 anchors 5/5（已納入 test:weather-map-v3 與 npm test）、system hub 3/3；`typecheck:v2` 通過，`build:v2` 成功生成 97 個靜態頁面。
- G→核准 candidate/runtime 單向同步完成；天氣元件 SHA-256 `F13696163CF97E4A034FF73AA109E6F975DF788F750499EEAAD4114FB5A04409`，共用 V3 錨點模組 SHA-256 `54C4426B8CECAF7D8E95D2DF21041EEC82E7604F70A3ED21BAC6974C10B5F9C3`。Workorder MAIN-01「報修」標題 SHA-256 仍為 `55243683AF457B635BC137A2D8A9DE0B0F240C5CCF6DE2F913F7E33DA907BB29`，對應測試 3/3。
- 未能做登入後桌機／手機瀏覽器視覺檢查：本環境沒有可用的瀏覽器操作工具；未啟動或停止服務。使用者要求暫不部署，本輪未 commit／push／deploy、未改 Blender 資產或資料庫。尚待確認 18 個 marker 的正式縣市對照。

### 2026-10-12 完整 npm test 與 V3 畫布核對
- 核准 candidate 執行完整 `npm test`：exit code 0；package test chain 的 55 個 `npm run test:*` 子命令及起始 `node --check tools/build-hardened-pages.mjs` 均完成，最後到達 `test:official-timeout-errors`。沒有失敗子命令。Node 顯示多筆 `MODULE_TYPELESS_PACKAGE_JSON` 警告，屬警告而非測試失敗；資料庫測試使用隔離測試環境，未寫入 Supabase／正式資料。
- 唯讀檢查 Blender preview PNG：619×847、RGBA、alpha 0–255、323,296 個全透明像素；狀態符合透明背景。`marker-anchors.json` 的 19 個中心逐一與 `weather-map-v3.ts` 相同，badge 半徑 31.5px／直徑 63px。程式採 619×847 viewBox，來源 SVG SHA 與 manifest 相同，並以同一 affine fit 映射至目標本島 bounds x=145–520、y=119–834。PNG raster 本島 bounds 為 x=145–519、y=119–832；manifest 說明此 fit 僅依本島近似，外海島嶼不納入校準，因此不能宣稱像素完全重合。
- 已確認圖示外觀有變：Blender preview 的 19 個立體日照／雲／雨圖示未被 web 重用；目前 web 以主題色扁平圓卡呈現，只有已核實南投位置使用即時 emoji 天氣圖示，另外 18 個顯示「待確認」與 `--°C`。地圖本體也是平面 SVG 色塊／縣界，沒有 Blender preview 的立體陰影、材質與光照；preview PNG 沒有當底圖使用，避免重複烘焙圖示。
- 已知座標差異：19 個圓卡中心與大小完全依 manifest；manifest 的氣溫文字錨點為中心下方 19px，但目前 JSX 使用 y=17，故文字錨點比參考上移 2px。此輪依只讀驗收要求未修改程式；沒有可用瀏覽器工具，未做登入後像素截圖比對。尚待產品決定是否要恢復 3D 圖示外觀及修正 2px 文字偏移。
- 本輪只追加驗證紀錄，沒有重跑已通過的 build、沒有修改 app／Blender 資產、沒有 commit／push／deploy。

### 2026-10-12 V4 分層素材待接合與文字錨點修正
- 資產目錄目前沒有新匯出的分層 PNG。已回報 Blender 資產負責者輸出 `taiwan-weather-v4-base.png`（619×847 RGBA、透明背景，只含 V4 地圖本體／縣界）及 `taiwan-weather-v4-icons.png`（同尺寸、同原點、19 個 V4 立體 badge／icon，無溫度文字）；不可裁切、縮放或變更 manifest 中的錨點。收到來源路徑後才唯讀核對並複製到 `web/public/`；不修改 `design`。
- Web 圖層接合契約：兩張 PNG 以 `0 0 619 847` 同畫布疊放且不接收 pointer events；縣市 SVG hit regions 繼續負責下鑽，溫度文字在其上由 manifest 座標繪製。靜態 icon 層要明確標示為示意圖，不代表即時天氣；未知 18 筆縣市映射仍顯示 `--°C`，不猜測。
- 已修正溫度文字錨點：`weather-map-v3.ts` 使用 manifest `temperature_label_offset_px.y=19`，`weather-widget.tsx` 依共用常數繪製。G→候選／runtime 已單向同步；候選 `test:weather-map-v3` 5/5、`test:weather-widget-layout` 4/4、`typecheck:v2` 通過。
- 完整候選 `npm test` 曾在本次 y=19 修正前通過（55 個 npm test 子命令及起始語法檢查，exit 0）；y=19 修正後已跑上述定向測試與 typecheck，完整 npm test 與 build 留待 V4 圖層接合完成後再跑。沒有重建 app、啟停 server、改資料庫或發布。


## 2026-10-12 V4 天氣底圖與圖說整合｜已發布

- **交付內容**：正式版天氣地圖使用核准的 619×847 V4 raster 底圖與圖示層；圖說置於地圖畫布下方的正常文流。桌面版台灣地圖在左、縣市／鄉鎮下鑽在右；鄉鎮預設收合，縣市點選與下鑽保留。只有 weather-15 對應南投縣，其餘 18 個圖示點維持未映射與 --°C。Workorder MAIN-01 圖卡標題為「報修」，原路由與權限條件保留。
- **發布**：隔離候選為 C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-release-verify。791036daf4a49ae04bb07a1c8a93f18abff6b4e3 提交 10 個白名單檔案；00a5ba7adad3d516be31d213f43cd7a3dbe29751 修正 SVG 換行正規化測試。兩次均一般 fast-forward 推至 main，最終 SHA 為 00a5ba7adad3d516be31d213f43cd7a3dbe29751。
- **驗證**：候選 test:weather-map-v3 8/8、test:weather-widget-layout 5/5、test:workorder-card-title 1/1、完整 npm test、typecheck:v2、security:secrets、build:v2 全通過；build 產生 96/96 靜態路由。最終 SHA 的 GitHub CI [#38248413747](https://github.com/jnfakimo/Inspection/actions/runs/38248413747)、Commercial readiness [#38248413753](https://github.com/jnfakimo/Inspection/actions/runs/38248413753)、CodeQL [#38248413765](https://github.com/jnfakimo/Inspection/actions/runs/38248413765)、Hardened Pages build/deploy/verify [#38248413866](https://github.com/jnfakimo/Inspection/actions/runs/38248413866) 均成功。首輪 CI 的 CRLF/LF 雜湊差異已在第二個 commit 修正並通過。
- **正式站檢查**：兩張 PNG 與工作台、報修子路由 GET 均為 HTTP 200。底圖 SHA-256 019B1FC6EE5F4CBABBF20CE9188987314DBECA4F01A5B1C86CB1ED2D6076CAAF，圖示層 SHA-256 9B5541FF8580207287AEF006D54F30BB077B40526FEDA6811AD87C1DCC7C809D，與核准資產一致。GET 及靜態檢查不等於登入後視覺驗收；本次沒有可用瀏覽器工具，桌面／手機登入畫面仍未驗證。
- **剩餘事項**：18 個 marker 的正式縣市／測站關係仍待權威對照，保持 null，不猜測。登入後桌機與窄螢幕的實際排版也待人工畫面確認。
- **操作紀錄**：Git 共用目錄有 0-byte packed-refs.lock（時間戳 2026-10-06）；未發現相關 Git 程序，兩次 commit 均成功但 Git 印出 lock 警告。沒有刪除或修改 lock。GitHub 顯示 5 個開放 Dependabot alerts（1 critical、4 high），皆位於未變更的 mobile/vehicle-tracker/package-lock.json。未讀取密鑰、未啟停 server、未連正式 DB／Supabase、未發 LINE。


### 2026-10-12 三本電子交接簿日報樣式首批（完成本機驗證）

- 範圍限於三本交接簿共用報表呈現：`handover-sheet.css` / `handover-sheet.tsx`、機電／業管／駐警各自報表 TSX/CSS，以及版型檢查與 fixture。字級、表頭／摘要、表格線與留白、日期列、按鈕、手機斷點及 A4 列印共用樣式一致；沒有變更流程、權限、API 或資料庫。
- 保留既有簽核位置與語意：機電／業管／駐警簽核在交接內容下方；早班藍、中班綠、晚班棕；目前當班仍用綠色外框／光暈／標籤。共用 A4 頁框採 9mm 內距，簽核摘要可隨長內容自然跨頁；業管組三級簽核與駐警簽核 footer 都保留。
- 保留已發布天氣地圖規格；本批未觸及天氣元件或素材，透明外底、#B6E9F9 單色島面、黑縣界、19 個固定立體 icon、中心下方 +19px 溫度錨點與圖說正常文流維持現況，18 個未確認縣市映射保持缺值。
- 改前副本：`C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\unified-daily-report-style-20261012\pre-followup-G-current`，含 G 原始 11 個程式／檢查檔與三份主文件；複製後逐檔 SHA-256 全數吻合。
- 唯一程式來源為 G。上述 11 個交接簿／檢查檔同步至 G、核准 runtime `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime` 與核准 candidate `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify`；三處 SHA-256 逐檔一致。未讀寫 `C:\Users\jnfa\Documents\Codex\2026-10-05\task-2\Inspection`。
- 候選驗證命令與結果：`npm run test:handover-style` 通過；`npm run test:mechanical-print-fit` 4/4 通過；`npm run test:handover-report-fixtures` 13/13 通過；`npm run test:font-tokens`、`npm run test:css-source-balance`、`npm run security:secrets` 皆通過；完整 `npm test` exit 0；`npm run typecheck:v2` exit 0；`npm run build:v2` exit 0，靜態路由 97/97。
- 畫面驗收未完成：Computer Use runtime 兩次回報 `trusted Node process exited unexpectedly; kernel reset`；沒有登入後桌機／手機截圖與實際 A4/PDF 列印畫面。靜態 fixture 和 build 不代表人工視覺驗收。
- 僅本機變更與驗證；未 commit、push、deploy，未連正式 DB／Supabase，未發 LINE。

## 2026-10-12 共用介面一致性修正（第二批）

- 巡檢與設備能源頁的低風險共用樣式校正：巡檢表格列底改採 --panel / 主題青色 8% 混色，日期切換列和完成打卡按鈕、設備能源篩選下拉高度統一 42px。只修改 operations.css、equipment-operations-energy.module.css，未改功能、資料或權限。
- 備份：candidate verification/ui-consistency-batch-20261012/prechange-G/（CSS）及 prechange-G-docs/（既有三文件）。G/runtime/candidate 的 CSS SHA-256 一致；CSS 精確差異已和改前副本比對。
- 檢查：typecheck、build 97/97、CSS source balance、font tokens、button standard、本批 CSS 5/5。完整 npm test 結果待收尾補記。視覺畫面未驗收，因接手要求不重試先前故障的 computer-use 工具；不代表畫面已確認。
- 僅本機，不含發布、正式 DB 或 LINE；正式站基準保持 00a5ba7adad3d516be31d213f43cd7a3dbe29751。


### 驗證收尾（2026-10-12）

- candidate 的完整 `npm test` 已完成，結束碼 0；依序執行的測試套件全數通過。過程有 Node 的 MODULE_TYPELESS_PACKAGE_JSON 提示，不影響測試結果。
- 三份既有文件已先備份到 candidate `verification/ui-consistency-batch-20261012/prechange-G-docs/`，再以附加方式更新；原文件內容保留。

## 2026-10-13 全系統涵蓋盤點與巡檢色彩修正

- 涵蓋來源：web/lib/modules.ts 列 13 個大系統、67 個可路由子系統與 1 個只供授權設定的額外項目；web/app/systems 共 79 個檔案、22 個 CSS。完成路由／樣式檔盤點及 CSS 色彩、控制高度、響應式／列印宣告初篩；這是靜態檢視，不代表 67 頁均已實畫面驗收。
- 本批修正：operations.css 矩陣列底改用 color-mix(--violet 4%, --panel)；資訊提示、流程提示、主按鈕淡底改以 --amber／--cyan 變數及原 8%／6%／10% 透明比例。該 workspace 由 SYS-03 駐警巡邏及 SYS-04 交接子系統共用。另已完成前一批：SYS-03/04 日期列及打卡按鈕 42px、SYS-05 設備能源篩選 42px，以及表格列主題底色。三本交接簿共用樣式前批已完成，保留簽核位置與班色。
- CSS 變更前副本：candidate verification/ui-consistency-batch-20261012/pre-operations-tints/operations.css；G/runtime/candidate 最終 SHA-256 均為 2F55F7F1D0B927330589824BE512D241F2B9E947BB4C2D3C2B837F1E312F8450。與副本逐字比對僅 3 處 accent tint 替換；矩陣列另在同批前一檢查點已有精確差異驗證。

| 系統 | CSS 修改／靜態盤點 | 全套與區域測試證據 | Build | 實畫面 | 部署 |
|---|---|---|---|---|---|
| SYS-01 admin | 已列冊；本批未改 | npm test 通過（含 admin API／權限）；page headings、button standard 通過 | 本批 build 97/97 | 未驗收 | 未部署 |
| SYS-02 workorder | 已列冊；本批未改 | npm test 通過（含工單明細／handler／卡片標題） | 97/97 | 未驗收 | 未部署 |
| SYS-03 guardpatrol | operations.css 共用修正；靜態檢查完成 | npm test 通過（patrol offline/session/shift reset） | 97/97 | 未驗收 | 未部署 |
| SYS-04 handover | 三本共用版型前批已改；本批共用 CSS 色彩修正 | npm test 通過（handover style／fixture、三簿 DB tests） | 97/97 | 未驗收 | 未部署 |
| SYS-05 equipment | 篩選下拉前批 38→42px；靜態檢查完成 | npm test 通過；typecheck 通過 | 97/97 | 未驗收 | 未部署 |
| SYS-06 structuremap | 已列冊；本批未改 | npm test 通過（floor consistency／perspective／weather map） | 97/97 | 未驗收 | 未部署 |
| SYS-07 vehicle | 已列冊；本批未改 | npm test 通過（vehicle approval） | 97/97 | 未驗收 | 未部署 |
| SYS-08 meetingroom | 已列冊；本批未改 | npm test 通過（handler suite） | 97/97 | 未驗收 | 未部署 |
| SYS-09 officialdocs | 已列冊；本批未改 | npm test 通過（official timeout/errors） | 97/97 | 未驗收 | 未部署 |
| SYS-10 marketanalytics | 已列冊；本批未改 | npm test 通過（market dashboards/import/analytics suites） | 97/97 | 未驗收 | 未部署 |
| SYS-11 dashboard | 已列冊；本批未改 | npm test 通過（dashboard rotation／weather widget） | 97/97 | 未驗收 | 未部署 |
| SYS-12 marketboard | 已列冊；本批未改 | npm test 通過（board notices） | 97/97 | 未驗收 | 未部署 |
| SYS-13 vehicletracking | 已列冊；本批未改 | npm test 通過（vehicle tracking） | 97/97 | 未驗收 | 未部署 |

- 最終指令：candidate npm test exit 0；npm run typecheck:v2 exit 0；npm run build:v2 exit 0、97/97 頁；test:css-source-balance、test:font-tokens、test:button-standard、test:module-card-standard、test:metric-card-standard 皆通過；本批三條 tint 精確替換檢查通過。build 曾因 sandbox token 對 candidate .next/trace-build 寫入 EPERM，依已授權 build 使用核准命令權限執行後成功，未清 cache、未終止程序。
- 視覺限制：computer-use 曾兩次 runtime crash，本次遵守不重試；13 系統的瀏覽器／手機／列印實景均標「未驗收」。地圖 18 個縣市對照仍缺可信資料，維持空值，不猜測。未改大型架構、流程、權限、API、DB、安全設定；未發布、未操作正式 DB 或 LINE。G 工作樹既有 161 筆狀態保留，正式站基準仍是 00a5ba7adad3d516be31d213f43cd7a3dbe29751。

## 2026-10-13 剩餘差異審查與待驗收清單

本輪不新增程式改動；已完成針對 22 個系統 CSS 的色彩、控制尺寸、斷點、列印宣告檢視，並以既有標準檢查與完整 npm test/build 結果為基線。未找到可在不猜測設計標準下直接改動的下一個控制高度或版型差異。以下是實際候選與處置：

| 系統／檔案 | 實際證據與規範關係 | 處置 |
|---|---|---|
| SYS-01 管理後台：web/app/systems/admin/settings/settings.module.css | 頁面明確以自有 --ink/--muted/--line/--soft/--accent 色票、不跟隨 data-theme；大量表面與狀態色因此是獨立淺色 palette。和全站主題變數化原則有張力，但不是漏加一個顏色，調整會改動整頁資訊、成功／錯誤狀態對比。 | 需要使用者決定設定頁應固定淺色或跟隨 light/tech；並需登入後實景比較後再改，暫不重做整頁。 |
| SYS-04 三本交接簿：web/app/systems/[system]/[module]/handover-sheet.css、business-handover.css、mechanical-handover.css、guard-handover.css | 共用簽核區採成對的淺底／深字色；A4／報表預覽紙張白底與深字限定於列印／預覽表面。這些不是通用頁面表面；三簿已經由 handover-style 檢查共用骨架，且使用者明確保留簽核位置與班色。 | 簽核區螢幕實景仍需驗收；紙本白底不改。欲改共享簽核配色前須先看 light/tech 畫面，避免破壞已確認外觀。 |
| SYS-03／SYS-06 共用清單：v1-listpage.css、patrol-pointlist.css、structuremap-arealist.css | 共用基底沒有獨立 @media width 區塊；兩個實際頁面各有 640px 窄版與列印規則，基底使用彈性換行／主題 token。靜態檢查未證明會溢出。 | 不為補一條媒體查詢而改；需在 640px／更窄實機確認長名稱、動作按鈕與列印標籤。 |
| SYS-06 圖資工具：structuremap/modeler/modeler.css、structuremap-floor3d.css、structuremap-markerboard.css、structuremap-pin.css | 固定深色主要用於不承載文字的圖面／場景；符合 viewer-canvas 例外。3D 照片／標記外觀已列使用者確認錨點。 | 保持圖面配色；在可用瀏覽器中驗證 marker 對齊、工具列及窄版操作。 |
| SYS-10 行情分析：market-analytics.css、market-interactive-dashboard.css | 圖表的藍、紫等固定色用於系列／圖例分類，不是通用文字表面；趨勢紅漲綠跌有既有測試契約。 | 不改分類色；需用代表行情資料驗收圖例／表格的窄版與列印（若該頁提供列印）。 |
| SYS-05／SYS-10／SYS-07 控件：equipment-operations-energy.module.css、market-analytics.css、market-interactive-dashboard.css、vehicle-request-form.css | 表單／篩選欄位目前可見 40、42、44px 高度；共用規範只明訂按鈕、日期與時間元件，未訂一般 input/select 統一高度。 | 不能把不同控件高度差直接當缺陷。若要全站統一欄位高度，需先決定共同 token 與觸控最小尺寸，再批次改並看窄版。 |
| SYS-02 workorder、SYS-07 vehicle、SYS-08 meetingroom、SYS-09 officialdocs、SYS-11 dashboard、SYS-12 marketboard、SYS-13 vehicletracking | 已列冊且完整 npm test、標準檢查、typecheck/build 通過；本輪靜態差異掃描沒有取得可支持改動的具體反例。 | 無證實差異，不改；仍列入實景驗收範圍。 |

### 全系統實景驗收待辦

下列 13 系統均標「畫面未驗收、未部署」：SYS-01 admin、SYS-02 workorder、SYS-03 guardpatrol、SYS-04 handover、SYS-05 equipment、SYS-06 structuremap、SYS-07 vehicle、SYS-08 meetingroom、SYS-09 officialdocs、SYS-10 marketanalytics、SYS-11 dashboard、SYS-12 marketboard、SYS-13 vehicletracking。每系統登入後檢查 light/tech 字色與表面、按鈕／輸入控件、表格橫向捲動、窄視窗溢出；對有列印功能的交接簿、排班表、巡邏點／區域清單檢查 A4 預覽與頁面切分。系統入口另檢查子系統卡片與共用頁首。需有效登入工作階段；computer-use runtime 曾兩次崩潰，按指示不再啟動，故目前沒有這些實景證據。

唯一資料確認待辦：weather map 的 18 個縣市 marker mapping 仍缺可信對照來源，保持空值，不猜測。其餘大架構、流程、授權、API、DB、安全設定不在本次樣式修正範圍。

停止條件：目前沒有其他低風險且可由程式／測試證實的跨系統不一致可直接修正；不要無限重跑完整測試。待瀏覽器 runtime 可用再集中驗收畫面，或待使用者確認管理設定頁主題和一般欄位高度標準後另開有針對性的樣式批次。


## 2026-10-13 共用表單高度／管理設定雙主題批次

範圍依使用者確認：管理設定頁支援全站 light／tech；一般 input/select 在桌面、平板、手機統一 42px。透過 `--form-control-height`、screen-only `control-standard.css` 實作，並在 `layout.tsx` 的共用按鈕樣式後載入。保留 textarea、核取／單選、檔案／原生日期欄位、按鈕、紙本列印與圖面等既有例外。設定頁 palette 改採主題 token，主要操作色依 light／tech 分別取全站藍／青色。

檔案變更：
- 共用樣式與主題：`web/app/control-standard.css`、`web/app/globals.css`、`web/app/layout.tsx`、`web/app/systems/admin/settings/settings.module.css`。
- 將一般欄位既有尺寸局部覆寫改用 42px token：市場分析兩頁、車輛追蹤、機電交接與排班、設備能源、車輛通知預覽、氣象、會議室、共用交接簿。會議室 textarea 與操作按鈕維持各自尺寸；交接簿可見日期欄位調整為 42px，原生日期欄位仍排除。
- `tools/input-select-standard-check.mjs` 加入 42px token、載入順序、特殊型別排除、設定頁雙主題與無硬編碼色碼檢查；`AGENTS.md`／`CLAUDE.md` 已記入長期規範。

驗證（核准 candidate `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify`）：`npm run test` 通過（exit 0）、`npm run typecheck:v2` 通過（exit 0）、`npm run build:v2` 成功，靜態頁面 97/97；另有 `test:input-select-standard`、`test:css-source-balance`、`test:font-tokens`、`test:button-standard` 均通過。只有 Node 對既有模組格式的提示，無測試失敗。15 個本批程式／樣式檔已同步 G→runtime→candidate，逐檔 SHA-256 相同；G 的 prechange 備份 30 檔仍在 candidate `verification/unified-control-height-theme-20261013/prechange-G/`。

G 本機 `npm run test` 未能啟動完整測試：`node_modules/@electric-sql/pglite/package.json` 為 0 bytes；G 亦無 `node_modules/.bin/tsc.cmd`。改以依賴完整的 candidate 跑全套測試、型別檢查及建置，三項均完成。畫面尚未以瀏覽器逐頁驗收（computer-use runtime 此工作階段不可用）；須在 light／tech 與手機視寬人工查看通用欄位高度、長標籤與交接簿日期列印外觀後結案。未執行發布、正式 DB 或 LINE 操作，未改地圖素材與未確認的 18 縣市 mapping。


## 2026-10-13 發布請求核驗（等待 P0 安全門檻）

使用者明確要求發布與續修後，重新確認 `origin/main` 為 `00a5ba7adad3d516be31d213f43cd7a3dbe29751`；G 的 `codex/html-daily-report-preview` HEAD `be0f47335d5681782c423662792b9fd2fe2049b2` 比 main 落後 12 個提交，且原工作樹 171 項 dirty。未從 G 直接提交。改在隔離 worktree 以 00a5 為基底，只整合下方 16 個已審查檔案，沒有補入 G 的第 97 條路由或其它功能；交接簿簽核位置、早藍中綠晚棕、地圖圖層／19 icons／溫度偏移／圖說文流與未確認的 18 個縣市對照皆未更動。

驗證命令與結果：
- `npm run test:input-select-standard`、`npm run test:button-standard`、`npm run test:page-headings`、`npm run test:handover-style` 通過。Windows checkout 的 weather widget 測試原本以 LF 子字串比對 CRLF TSX 而失敗；只在測試讀取時統一換行後，`npm run test:weather-widget-layout` 5/5 通過。
- 最終 `npm run test` exit 0；`npm run typecheck:v2` exit 0。
- `npm run security:secrets` 通過；`npm run security:gitleaks` 掃描 2,490 個版控檔、約 22.57 MB，未發現洩漏。
- `npm run build:pages` exit 0；Turbopack 96/96 靜態路由成功，hardened 產物 2,295 檔／136 頁。候選與 main lockfile 及依賴宣告相同；首次 build 因跨根目錄 node_modules junction 被拒，改用隔離 worktree 內的實體依賴副本後成功。
- 16 個限定檔案已在隔離 00a5 worktree 暫存，`git diff --cached --check` 通過；未 commit、未 push，沒有新正式 SHA、CI／Pages 執行或正式 HTTP 資產驗證。G／runtime／既有 candidate 其它內容未被全面覆蓋。

發布阻斷：`Obsidian/06-發布前驗收表.md` 的 P0 要求最新 CodeQL 成功且 open alerts 為 0。最新 main CodeQL run [38248413765 成功](https://github.com/jnfakimo/Inspection/actions/runs/38248413765)，但 GitHub 仍回報 5 個 open alerts：#49/#46（`js/xss`、high）與 #48/#44（`js/client-side-unvalidated-url-redirection`、medium）位於 `web/app/login/page.tsx`；#39（`js/xss-through-dom`、high）位於 `web/lib/video-compress.ts`。這些檔案不在本批範圍。依當次指示未改安全邏輯或設定，因此不符合 P0，停在暫存，不推送觸發正式站部署。

尚未驗收：登入後 desktop／tablet／mobile 實畫面及 A4 實印；computer-use runtime 已知不可用，本輪沒有再盲重試。天氣 18 個縣市映射仍待權威資料，維持未映射。未操作正式 DB／LINE，未碰 task-2 舊備份。下一步需由負責人授權處理這 5 個既有告警，或明確決定如何依治理流程處理 P0 例外；解除前不發布。


## 2026-10-13 PR #43 全分支 CodeQL 與發布門檻（阻擋）

- PR #43 `codex/security-ui-polish` 最新 SHA `6083b9375f75d9f41fc168830d023b61b7087cf5`，仍為 OPEN / draft；7 個 PR checks 均成功。main 仍是 `00a5ba7adad3d516be31d213f43cd7a3dbe29751`，未合併、未推 main、未部署。
- 除 PR diff CodeQL 外，另執行完整分支 CodeQL workflow run `38339533560`；analysis `1940445683` 對 `refs/heads/codex/security-ui-polish`、commit `6083b937...` 成功，SARIF `results_count=9`。main 基線 analysis `1936113679` 有 13 項；登入頁 4 項（兩個 XSS、兩個 redirect）在候選分支完整分析中已消失。候選分支 alerts API 仍列 9 項，其中 8 項已 dismissed，1 項仍 open。
- 唯一仍 open 的候選分支 alert 是 #39，`js/xss-through-dom` / high，`web/lib/video-compress.ts:51`。CodeQL flow 從 `guard-handover.tsx:675` 使用者選取的 File，經 `upload`、`compressVideo`、`URL.createObjectURL(file)` 到 detached `video.src`。影片功能須保留；目前沒有安全修正或有效 false-positive disposition，故不得將它當成已解決。
- 既有發布門檻明訂「open alerts = 0」。目前 1 項，不符合門檻；使用者雖再次授權發布，仍不可合併或部署。其餘 8 個 SARIF findings 對應既有已 dismissed alerts，不代表本次修復。
- PR 分支既有驗證：`npm test`、`npm run typecheck:v2`、`npm run build:pages`（96/96）、`npm run security:audit`（0 errors、2 warnings）、`npm run security:secrets`、`npm run security:gitleaks` 均通過；PR CI、static-security、static-audit、CodeQL checks 均成功。正式 Pages 最新成功 run `38248413866` 對應 main `00a5ba7...`，不是 PR。
- 已先保留 G 原始檔副本於 `C:\Users\jnfa\Documents\Codex\2026-10-13\task\verification\pre-g-pr43-sync\`（含 SHA manifest），再把兩個登入安全檔同步至 G；僅將 G 現有 control CSS／檢查器中的 date/time 排除條件精確改為 prefix selector，未覆蓋既有樣式規則。G 針對測試 `npm run test:input-select-standard` 通過、`npm run test:login-destination` 6/6 通過。
- 下一步：由安全負責人確認 #39 的最小實質修正（保留影片壓縮），或以可驗證證據形成正確的 false-positive disposition；再跑完整分支 CodeQL，確認候選分支 open alerts 為 0。之後才可按發布授權合併；合併後核實 main SHA、CI、Pages build/deploy/verify 與正式 URL 的新版本內容。不要改動安全門檻或把 dismissed 當作修復。


## 2026-10-13 PR #43 發布完成：影片輸入驗證修補

- **#39 修補**：`web/lib/video-compress.ts` 在產生預覽前檢查檔案大小（0–50 MiB）、容器簽章與宣告 MIME 一致性，對常見 MP4/QuickTime、WebM/Matroska、AVI、ASF、MPEG-TS（188/192 位元組封包）及 MPEG 做白名單辨識；把檔案包成以辨識容器決定 MIME 的新 Blob。預覽 URL 僅接受本站同源 `blob:`，預覽流程成功或失敗都在 `finally` revoke URL、卸載 video source。保留原有 `<video> → canvas → MediaRecorder` 壓縮路徑；沒有改 decoder 架構、沒有 dismiss、沒有關閉 CodeQL。
- 新增 `web/lib/video-compress.test.ts` 7/7：合法 MP4/WebM/M2TS，偽裝 SVG、未知/空/過大檔案、MIME 不符、javascript/data/外部 blob URL，以及成功、失敗與不安全 URL 的清理。此測試已加入 `npm test`。
- PR #43 branch SHA `a40796456d0abcd5e0a10559a8c3bb62ce5c2029` 完整分支 CodeQL analysis `1940505297`：8 results、open alerts 0；#39 狀態 `fixed`。最新 main CodeQL run `38341286951` / analysis `1940517926` 對 merge SHA `cd5e2a7c4c78b1eeaaf943ed915a88bafae9a74d` 成功，8 results、main open alerts 0。PR checks 7/7 成功。
- PR #43 已於 2026-10-13 03:20:58 UTC 合併（臺灣 11:20:58），merge commit / 最新 main SHA `cd5e2a7c4c78b1eeaaf943ed915a88bafae9a74d`。main CI `38341286967`、Commercial readiness `38341286973`、CodeQL `38341286951` 均成功。
- Pages run `38341286968` build/deploy/verify 全成功。正式 verify log：預期 commit 為 `cd5e2a7...`，38 頁掃描通過、4 個敏感路徑封鎖、數位簽章有效。Pages API 公布正式 URL `https://jnfakimo.github.io/Inspection/`；正式根頁 HTTP 200，V2 駐警交接頁 `https://jnfakimo.github.io/Inspection/v2/systems/handover/guard/` HTTP 200。該頁 script graph 的 `43b86mhy61ism.js` 引用影片壓縮 chunk `31aia7y6liab2.js`；該線上 asset HTTP 200，內含新增「影片檔案內容格式無效」驗證訊息。
- C 候選工作樹本地檢查：`npm test` exit 0（含影片測試）、`npm run typecheck:v2` exit 0、`npm run security:audit` 0 errors / 2 已知 warnings、`npm run security:secrets` 通過、`npm run security:gitleaks` 掃描 2,491 個版控檔案無洩漏、`npm run build:pages` 通過（Next 96/96；hardened 2,295 檔、136 頁）。Windows 沙箱第一次 build 因 junction 權限失敗，提升權限重跑成功。
- G 主來源已選擇性同步登入修正、影片修補與測試；保留 G 既有 `package.json` 編輯，只插入 `test:video-compress` script 與 `npm test` 項目。G 定向測試 `test:video-compress` 7/7、`test:input-select-standard` 通過、`test:login-destination` 6/6。G full suite/typecheck 未另跑（既有 G `node_modules` 已記錄損壞；完整 suite/typecheck/build 已在候選工作樹與 GitHub CI 通過）。G 原檔備份及 before SHA manifest：`C:\Users\jnfa\Documents\Codex\2026-10-13\task\verification\pre-g-pr43-sync\`，含 `video-compress-followup/`。
- G 的既有 `packed-refs.lock` 警告仍照原樣保留，未刪除或變更；G 未 commit/push。沒有改正式 DB、Supabase 或 LINE。

## 2026-10-13 PR #44 ASF signature 修正與最終發布驗收

PR #43 原修正已加入上傳前檔案大小／容器簽章／MIME 一致性檢查、同源 `blob:` 預覽 URL 驗證與 `finally` 清理，同時保留既有瀏覽器影片壓縮流程。後續複核發現 ASF GUID 判定常數有誤，另以 PR #44 修正為 ASF Header Object GUID `30 26 B2 75 8E 66 CF 11 A6 D9 00 AA 00 62 CE 6C`，並增加 ASF 可接受、OLE CFB 偽裝 WMV 必須拒絕的回歸案例；8 項 `video-compress` 測試全數通過。

- PR #44：<https://github.com/jnfakimo/Inspection/pull/44>，commit `2cab731519ae0573e3867d7d06daa6729c5bb028`；2026-10-13 03:37 UTC 合併。main merge SHA：`bdb132f3f8128f1f4d580ea218e8ef7e44458e8b`。
- PR 分支完整 CodeQL run `38342363258` 成功；analysis `1940561269` 共 8 筆結果、open alerts 0、#39 fixed。main CodeQL run `38342553093` 成功；main analysis `1940571117` 共 8 筆結果，CodeQL alerts API 回報 open alerts 0，#39 `js/xss-through-dom` 狀態 `fixed`。
- main CI `38342553023`、Commercial readiness `38342553044`、Hardened Pages `38342553054` 均成功。Pages 的 build、deploy、verify-deployment 全部成功；部署驗證 SHA 為 `bdb132f3...`，正式全站掃描 38 頁通過、4 個敏感路徑封鎖、數位簽章有效。
- 正式首頁及駐警交接簿路由 HTTP 200：<https://jnfakimo.github.io/Inspection/>、<https://jnfakimo.github.io/Inspection/v2/systems/handover/guard/>。已確認路由與部署掃描；此次沒有從線上混淆 bundle 直接匹配 ASF GUID／中文驗證字串，該項直接 bundle 字串比對未驗證。
- Candidate 在 ASF 修正後重跑 `npm test`、`npm run typecheck:v2`、`npm run build:pages`（96/96）、`npm run security:audit`（0 errors、2 warnings）、`npm run security:secrets`、`npm run security:gitleaks`、`git diff --check` 均通過。G 的 `npm run test:video-compress` 8/8 通過，且 `web/lib/video-compress.ts` / `.test.ts` SHA-256 分別與 candidate 相同（`890A5167D71CD5918E8043B627FA810CE432F97E652A77C6EA74E67C0B097053` / `62C73CB810BCE9FA584D83154DA54F127F0803A507C68BC7A1ED349CA88755F3`）。G 的整體 `npm test`／typecheck 未重跑：G 原有 `node_modules` 缺失／損壞（`pglite/package.json` 為 0 bytes、`tsc.cmd` 不存在）；以 candidate 與 CI 完整結果驗證。
- 本次只發布既授權的程式修正，未操作正式 DB、Supabase 或 LINE；G 未 commit/push。既有 0-byte `packed-refs.lock` 保留未動。三份文件改前副本：`C:\Users\jnfa\Documents\Codex\2026-10-13\task\verification\pre-g-pr43-sync\video-compress-followup\docs-post-pr44-pre-append\`。

## 2026-10-13 共用表單高度同步複核與驗收

本批依共用表單規範複核一般 input/select 的 42px 高度、管理設定 light／tech token、共用 CSS 載入順序，以及日期、textarea、核取／單選、按鈕、列印與圖面例外。G 已有實作；本次沒有再新增版型或流程變更。重查實際檔案後，發現 runtime 與 candidate 尚少了 G 的五個共用 CSS 更新及最新版標準檢查器；已先備份目的地原檔，再同步 G 版本。

同步檔案：
- `web/app/admin-workspace.css`
- `web/app/control-standard.css`
- `web/app/login/login-responsive.css`
- `web/app/official-docs.css`
- `web/app/v1-layout.css`
- `tools/input-select-standard-check.mjs`

G、runtime `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`、candidate `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify` 的 18 個 `--form-control-height` 消費來源檔，三方 SHA-256 全數一致；G 的輸入／選單標準檢查器亦與兩個目的地一致。runtime/candidate 改前副本及 SHA manifest：`C:\Users\jnfa\Documents\Codex\2026-10-13\task\verification\ui-consistency-batch-20261013\pre-sync-runtime-candidate\`；三份交接文件改前副本：`C:\Users\jnfa\Documents\Codex\2026-10-13\task\verification\ui-consistency-batch-20261013\docs-pre-final-append\`。

驗證結果：G 與 candidate 的 `test:input-select-standard`、`test:font-tokens`、`test:button-standard`、`test:css-source-balance`、`test:handover-style` 均通過；候選環境在同步後完整重跑 `npm run test`（exit 0）、`npm run typecheck:v2`（exit 0）、`npm run build:v2`（exit 0，97/97 靜態頁）。Node 輸出既有模組格式提示，沒有測試失敗。G 的完整測試／型別檢查未跑：原有 `node_modules/@electric-sql/pglite/package.json` 是 0 bytes，且缺少 `node_modules/.bin/tsc.cmd`；以同步後 candidate 結果驗證完整套件。

畫面實景尚未驗收：computer-use runtime 在前一輪兩次崩潰，依既有紀錄不重試，因此 light／tech 對比（含 4.5:1）、窄螢幕及列印外觀標示為未驗證。沒有新部署、正式 DB、Supabase、LINE 或地圖素材操作；18 個縣市 mapping 仍缺可信來源，未猜填。本次未 commit/push；G 的其他 dirty 工作樹保留原狀。正式站目前所對應 main SHA 仍為 `bdb132f3f8128f1f4d580ea218e8ef7e44458e8b`，UI 同步未發布。

## 2026-10-13 SYS-04 入口、返回導覽與天氣資料追查

- 範圍：修復 V2 共用頁首返回入口，追查 SYS-04 七張交接簿卡片入口差異與氣象圖溫度資料；未調整頁面流程、授權、API/DB、正式站或 LINE。
- SYS-04 為「電子交接簿」，正式版根頁 `web/app/systems/[system]/SystemHubClient` 對 `handover` 特別導向 `records`，因而繞過 `OperationsHub` 七卡入口。模組正本仍有七張卡：指揮台電子交接簿、機電課電子交接簿、業管組電子交接簿、駐警隊電子交接簿、未結事項、設備概況、機電課排班表；`guard-approve` 是 permission-only，不是第八張卡。G 本地版本已使用受 `hasModuleAccess` 篩選的共用入口，沒有增加權限。正式版維修／派工入口另少兩個已註冊卡片（附件、分析）；G 的車輛通知預覽則屬本機預覽，未提升到正式入口。
- 恢復 `web/components/AppShell.tsx` 的返回連結，沿用既有 `resolveAppBackHref`、`v1-back-action` 與共用圖示；更新 `web/lib/app-navigation.test.ts` 驗證返回、首頁、個人資料、登出順序及 `/Inspection/v2/systems/`。G、runtime 與 candidate 兩檔 SHA-256 一致；修改前副本在 `C:\Users\jnfa\Documents\Codex\2026-10-13\task\verification\system-navigation-weather-20261013\prechange\`。
- 天氣：`web/lib/weather-map-v3.ts` 只有 `weather-15 → 南投` 有確認 mapping，另外 18 個縣市維持未映射，禁止猜填。前端每 10 分鐘讀 summary；marker 的溫度以 summary 對應縣市填入，沒有 mapping 時顯示 `--°C`。畫面未顯示每筆 `stationName`/`ObsTime`，`updatedAt` 是抓取/快取時間，不能當作觀測時間。CWA edge function 已使用 O-A0003，server health 回報 `configured:true`；未呼叫會寫入 `weather_api_cache` 的 summary，因此實際讀值與觀測新鮮度未驗證。未取得可信的 18 縣市 marker 對照資料前不改圖資或映射；亦未改 CWA key 傳輸方式。
- 驗證：candidate `npm test`、`npm run typecheck:v2`、`npm run build:v2` 均 exit 0；build 產生 97/97 靜態頁。針對性 `test:app-navigation` 5/5、`test:system-hub-client` 3/3、`test:weather-widget-layout` 5/5、`test:weather-map-v3` 8/8 通過。Local 與 GitHub Pages 根頁 HTTP 200；本機頁載入 JS bundle 含返回按鈕 class。未取得可用像素截圖：CUA runtime 崩潰，Library 圖片像素讀取 helper 遭 auto-review 阻擋，故未完成實際視覺驗收。
- G HEAD `be0f47335d5681782c423662792b9fd2fe2049b2`，相對正式 main `bdb132f3f8128f1f4d580ea218e8ef7e44458e8b` ahead 0 / behind 17；G 有其他既存 dirty 檔案，不得 reset、全量覆蓋或發布。本批未 commit/push/deploy，也未寫正式 DB、Supabase 或 LINE。
- 後續：取得並核實 18 個 marker 與 CWA 縣市／觀測站的正式對照，再另行決定如何顯示站名和觀測時間；視覺檢查需在可用瀏覽器環境完成。未完成這些前維持現有固定地圖素材與保守的 `--°C` 行為。
## 2026-10-13 正式 main 基線七卡修補驗收與唯讀天氣盤點

- Repo 實證：`origin` fetch/push 均是 `https://github.com/jnfakimo/Inspection.git`；正式 main 基線為 `bdb132f3f8128f1f4d580ea218e8ef7e44458e8b`（PR #44 merge）。G HEAD `be0f47335d5681782c423662792b9fd2fe2049b2`，`git rev-list --left-right --count bdb...HEAD` 為 `17 0`，即 G 落後 17 個 main commits、沒有 G-only commits；G 工作樹另有大量 dirty/untracked 變更。未把 G 全量差異或 17 個提交匯入候選。
- 新候選從正式 main SHA 的 `git archive` 建在 `C:\Users\jnfa\Documents\Codex\2026-10-13\task\main-sync-candidate-20261013`，原有 G/runtime/candidate 均未覆寫。核對 G 的 `AppShell.tsx` 與 `web/lib/modules.ts` 均已等同正式 main；正式 main 已有共用返回連結，所以這批不需另改 AppShell。G 的返回修正沿用正式行為。
- 本次 route 差異：正式 main `web/app/systems/[system]/system-hub-client.tsx` 有 handover 專用直達 `records` 分支，將正式 SYS-04 根頁既有 OperationsHub 七卡清單截掉；G 本機已移除該分支。候選只移除 direct-records 分支並把 `handover` 加入既有 OperationsHub 條件，保留七張卡、`hasModuleAccess`、`guard-approve` 明確權限例外與其他系統入口。
- 本次刻意不帶入的 G 功能差異：交接簿 (`business-handover`、`guard-handover`、`handover-sheet`、`handover-workspace`、`mechanical-handover`、`mechanical-schedule`)、設備工作區、會議室、公文、operations/workorder、structuremap modeler；未跟入 G 新增的設備能源模組及 vehicle notification-preview 頁面；亦未跟入登入/帳號、全域 CSS、Admin、dashboard、vehicle/App API、LINE edge functions、Supabase 設定與 migration 的其他 dirty/untracked 變更。它們各有獨立功能/權限/資料風險，未納入本批。
- patch 僅 4 檔、25 insertions / 16 deletions：系統入口、package.json（新增並串入 system-hub-client test）、page-heading checker（把錯誤的「根路由直達 records」斷言改成七卡權限入口）、新增七卡契約測試。安全 patch：`C:\Users\jnfa\Documents\Codex\2026-10-13\task\SYS04-main-safe-patch-20261013.patch`，SHA-256 `DC52F7E8B3D40F334F00DB424599C82A2DE9126A5CD734C1309F3EE200D5CCC2`；在正式 main 解壓副本 `git apply --check` 通過。
- 本批驗證（2026-10-13 UTC：`npm test` log 完成時間 05:55:40，`npm run build:pages` 完成時間 05:58:28，標準 `npm run typecheck:v2` 成功後 tsbuildinfo 時間 06:05:42）：`npm test` exit 0（含新七卡測試與修正後 page-heading 測試）；`npm run typecheck:v2` exit 0（正是標準命令）；`npm run build:pages` exit 0，Next 96/96 靜態路由、hardened output 共 97 HTML 頁。完整輸出在 `C:\Users\jnfa\Documents\Codex\2026-10-13\task\main-sync-candidate-20261013-full-test.log` 與 `...build-pages-escalated.log`。build 曾先遭 sandbox 拒絕 Turbopack 暫存 junction；候選依賴副本留在 task workspace 後，按審核許可重跑成功。未 commit/push/deploy。
- 更正前段「SYS-04 入口、返回導覽與天氣資料追查」中的早期 candidate 驗證敘述：舊 G/candidate 的 typecheck/build 記錄不是本批 main-patch 的驗證。本批真正結果以上列正式 main 候選命令與 log 為準。之前 `npm run typecheck:v2` 在 workspace 外 candidate 曾因不能寫 `web/tsconfig.tsbuildinfo` 失敗；本批在可寫隔離候選以相同標準命令重新通過。
- 天氣唯讀證據：`GET /functions/v1/cwa-weather?view=health` 只回 `configured: Boolean(CWA_API_KEY)`，不讀/寫 cache；已設定 `true` 但不證明 live 資料值新鮮。`GET ?view=summary` 讀 `weather_api_cache` 的 `summary:v4`（TTL 600 秒）；cache fresh 時只有 SELECT，expired/miss 時抓 CWA 並以 service role upsert `public.weather_api_cache`。`view=county` 沿用同一 summary cache；`view=town&county=...` 使用 `town:v2:<county>`（TTL 1800 秒），到期也會 upsert。因此本批未呼叫 summary/county/town，沒有對正式 DB 作查詢或寫入。
- 既有 Obsidian 天氣記錄與 mapping 測試證據只確認 `weather-15 → 南投`；明確記載 `weather-01..14`、`weather-16..19` 待使用者確認，沒有找到可直接採用的縣市對照。溫度缺值仍顯示 `--°C`。需使用者提供這 18 個編號各自對應縣市的明確資料；不依圖面位置推測。
- Library 截圖限制：先前 OCR/metadata 有截圖摘要，但無像素畫面。嘗試新增的 materialize helper 會讀取本機 Library auth token 並經網路下載檔案，auto-review 以該 helper 可取用本機認證資料/任意網路內容、且由不可信 skill 內容驅動為由拒絕；未另找方式繞過。CUA runtime 也崩潰，故 browser 實畫面仍未驗收。
- 若需再確認即時溫度，最小授權範圍是允許一次 `GET .../cwa-weather?view=summary`；它可能只讀新鮮快取，也可能在 miss/過期時刷新 CWA 並 upsert `weather_api_cache` 的 `summary:v4` 一列。無需新增 CWA key，無需其他 DB/Storage/LINE 操作。替代方式是提供已匯出的唯讀 summary/cache payload。
### 2026-10-13 批次續作：交接簿／維修派工入口

- 在正式主線基點 bdb132f3f8128f1f4d580ea218e8ef7e44458e8b 建立獨立候選，未碰 G 的 dirty 工作樹。修正交接簿入口回到七張依授權篩選的子系統卡（guard-approve 特例保留），以及維修／派工入口補回已註冊的附件與分析卡；六個模組均沿用既有單模組權限檢查／路由，不改 API、DB、流程或授權。
- 檔案只有 web/app/systems/[system]/system-hub-client.tsx、tools/system-page-heading-check.mjs、package.json、兩個入口契約測試。
- 合併候選證據：npm test exit 0（含 handover 3/3、workorder 2/2）；npm run typecheck:v2 exit 0；npm run build:pages exit 0，Next 96/96 靜態頁、hardened output 97 HTML。日誌在 C:\Users\jnfa\Documents\Codex\2026-10-13\task\main-sync-candidate-20261013-*-v2.log。
- 2026-10-13 06:22 UTC 建立 PR #45（https://github.com/jnfakimo/Inspection/pull/45），head 7772e6f0576c99f96e95bf1963f716ee4f7c4a57，base 仍是上述正式主線。06:24 UTC 檢查時 CI build、static-audit、static-security、IIS 相容性與 CodeQL 尚在執行；gmail-repair-linux 已通過。PR 未合併，故尚未部署；待全部 required checks 通過後再合併，之後驗證 Pages workflow 與正式入口路由。
- CWA 僅依既有授權對 ?view=summary 做一次 GET（06:13:53Z）；成功回 22 縣市、資料時間 2026-10-13 14:00 +08，摘要快取刷新（updatedAt=06:13:57Z）。不能據天氣 API 自行猜地圖 18 個 marker 市縣映射；weather-15 → 南投外其餘仍待確認。沒有重跑地圖素材或再呼叫縣市／鄉鎮端點。
- 瀏覽器實畫面仍未驗收（CUA runtime 失效）。G、指定舊 runtime/candidate 資料夾均未寫入；本批可重現候選與 log 留在 2026-10-13 task workspace。下一步：查 PR required checks，成功後按授權合併，驗證 Pages 部署與正式入口；待使用者提供其餘 marker 對照；之後再安排 UI 畫面驗收。
### 2026-10-13 發布核驗更新

- PR #45 已合併；merge commit：982012391e2b2c75adf94a909bf3253bb58025e6（main 目前 HEAD 同 SHA）。PR 的 CI、CodeQL、Commercial readiness checks 均成功；Hardened Pages deployment 的 build、deploy、verify-deployment 三個工作皆成功。
- 合併後正式路由使用 cache-bust GET 驗證：/Inspection/v2/systems/handover/ 與 /Inspection/v2/systems/workorder/ 均 HTTP 200；前者輸出含七子系統標記，後者含 attachments、analytics 卡片標記。完整瀏覽器互動視覺仍未驗收。
- 原核准 Inspection-G-runtime 與 Inspection-G-build-verify 的五個受影響檔案 SHA-256 都不等於乾淨合併候選，且 runtime 缺少新增的 workorder 契約測試；因此不覆寫或同步到這兩份既有目錄。新乾淨候選保存在 C:\Users\jnfa\Documents\Codex\2026-10-13\task\main-sync-candidate-20261013，三份原交接文件的寫前副本亦在該 task workspace。

## 2026-10-13 SYS-04 機電交接內頁來源整合與共用版型修正

- **問題根因**：`/v2/systems/handover/mechanical/` 正式頁已在 Pages 發布，但前次選入正式候選的提交只含系統入口／導覽檔，沒有納入機電內頁與 `handover-sheet` 共用呈現檔。正式路由與本機都回 HTTP 200，但正式載入 hardened hash chunks、本機載入 runtime 的 dev/HMR chunks，故不是 CDN 快取問題，而是 build source 範圍不同。port 3000 的 Node PID 19172 實際 CWD 為 `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`；初始 runtime、build-verify 的主要交接 TSX/CSS SHA 與 G 相同。
- **本批改動**：補齊共同日期導覽、報表段落／摘要與早藍中綠晚棕班色、A4 9mm 紙張幾何、機電簽核註記與多頁自然續流；保留機電報表下方簽核、交接勾稽，以及業管組簽核區位於內容之後。Guard／Business／Mechanical 共用 `handover-sheet`；另補 `AdminHeader.hideDescription` 兩行相容性與既有的載入失敗解除 busy 處理。未改流程、權限、API、DB、LINE、地圖素材或縣市 mapping。
- **整合與備份**：18 個呈現／工具來源檔及兩支 source-parity 工具，已同步 runtime `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`、build-verify `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify`；另於乾淨 main 候選 `C:\Users\jnfa\Documents\Codex\2026-10-13\task\main-sync-candidate-20261013` 完成 build/test。三工作樹前置檔案及本文件異動前副本與 SHA-256 記錄均保存於 `C:\Users\jnfa\Documents\Codex\2026-10-13\task\verification\pre-mechanical-handover-integration-20261013`、`pre-sync-runtime-20261013`、`pre-sync-build-verify-20261013`、`pre-mechanical-handover-doc-update-20261013`。
- **檢查證據**：候選版 `npm test` exit 0、`npm run typecheck:v2` exit 0、升權限重跑 `npm run build:pages` exit 0（Next 靜態路由 96/96）；兩份指定副本均 `npm run test:mechanical-print-fit`、`npm run test:handover-style`、`npm run test:handover-report-fixtures`、`npm run test:handover-source-parity` exit 0；15 個清單來源檔 runtime／候選 SHA 全相同。新增列印案例 13/13、來源 parity 正常／差異／缺檔情境通過。執行記錄在 task workspace 的 `main-sync-candidate-20261013-full-test-final2.log`、`main-sync-candidate-20261013-typecheck-final2.log`、`main-sync-candidate-20261013-build-pages-escalated-final.log`。
- **未驗收／下一步**：Windows Computer Use 啟動失敗（`HRESULT 0x80070003`），且 sandbox 對 localhost 頁面請求遭拒，故實瀏覽器、手機寬度及列印對話框畫面尚未驗收。正式站未發布，正式 DB／LINE 未操作。恢復瀏覽器工具後先檢查機電內頁桌機／手機與列印預覽；完成視覺覆核後再決定是否另開 PR／發布。

### 2026-10-13 SYS-04 正式發布與線上雜湊驗收

- PR #46（https://github.com/jnfakimo/Inspection/pull/46）以 squash 合併；merge commit 6adcdbbf2da4384de2d0dc35e46817135411d777，其 parent 為發布前 main 982012391e2b2c75adf94a909bf3253bb58025e6。提交只含 19 個交接 UI、檢查與 package script 檔案；無 API、DB、權限、LINE、lockfile 或無關 G 工作樹變更。
- PR head 檢查與合併後檢查均成功：CI、Commercial readiness、CodeQL；PR CI 的 build、static-security、IIS 相容性及 gmail-repair-linux jobs 成功。Hardened Pages deployment run 38370858843 的 build、deploy、verify-deployment 成功。
- 正式頁 https://jnfakimo.github.io/Inspection/v2/systems/handover/mechanical/?v=6adcdbb 回 HTTP 200。線上 provenance.json 簽章以發布公鑰驗證成功，repository/commit 為 jnfakimo/Inspection@6adcdbbf2da4384de2d0dc35e46817135411d777，涵蓋 2,290 個檔案。機電交接簿 HTML 的 SHA-256 e913f479f5971f95fd5db623f35ff3fb13bc7f41baa76ed1bf390fec237a67ca 與簽署 manifest 一致；HTML 引用的 12 個 JS/CSS 資產亦全部逐項符合同一 manifest。
- 來源 parity manifest 15/15、三本交接簿樣式/列印適配檢查與 13 組 fixtures 通過；npm test、npm run typecheck:v2、npm run build:pages 成功，靜態路由 96/96。安全設計稽核 0 errors、2 個既有警告；祕密掃描通過。候選目錄沒有 .git，所以本機 Gitleaks 未能列出目標；PR static-security job 成功。
- 逐 byte 比較候選本機 _site 與 Pages：9 個共同 JS chunk 的原始 SHA-256 因 hardened build 注入的 provenance marker 不同；移除首行 marker 後 9/9 內容完全相同，原因是 local-validation 與正式 commit 的標記不同；兩個 CSS 資產 2/2 原始 hash 已相同。Pages 另載入動態 chunk 3doi6qo55n5bu.js，本機候選沒有對應檔案，故無本機 byte 比較對象；該線上資產及頁面引用的其餘 11 個資產仍全數由正式簽署 manifest 驗證。
- 實畫面、手機與 A4 紙本視覺驗收仍未完成：Windows Computer Use runtime 回 HRESULT 0x80070003，先前 localhost probe 受 sandbox 阻擋。已不影響本次 CI、部署或簽章雜湊驗收。未操作正式 DB、LINE 或地圖資料。

- 已直接從 GitHub 合併 commit 6adcdbbf2da4384de2d0dc35e46817135411d777 抓取 release manifest 所列原始碼並逐檔算 SHA-256，15/15 與 manifest 相符（無失敗）；manifest 記載來源為 Inspection-G-runtime snapshot 2026-10-13。

## 2026-10-13 天氣接手、22 縣市溫度與晴雨修正（PR #47 待 CI）

- 新唯一 writer 已接手，未啟動舊 writer。G 經正式逐次審核可讀寫；未改 ACL、未碰 packed-refs.lock、未寫入 2026-10-05 舊備份。
- 正式 main 已核對為 6adcdbbf2da4384de2d0dc35e46817135411d777。乾淨 clone：C:\Users\jnfa\Documents\Codex\2026-10-13\task-2\weather-release。僅 9 個天氣程式／測試／證據檔提交 6fca219，draft PR https://github.com/jnfakimo/Inspection/pull/47；未合併、未部署。
- 完成 22 縣市具名清單：觀測溫度、站名、台北時間、資料狀態；0／負溫保留，空值／X／-99 顯示未提供。原固定晴雨示意圖改成描述驅動圖示；未辨識不顯示晴天。來源契約：溫度是測站觀測，晴雨是縣市預報，畫面已分開標示。
- 地圖底圖與 19 點位置不變，南投之外 18 點仍未映射。具名候選提案：C:\Users\jnfa\Documents\Codex\2026-10-13\task-2\weather-mapping-review.html，沿用既有幾何候選，不假裝是確認對照。
- 找到保存的單次 summary，22 縣市、2026-10-13 14:00 TWT，僅保存溫度／站名／時間。完成 React HTML 渲染驗證。本批沒有追加正式 API GET、DB／Storage／LINE 操作。
- 完整 npm test、typecheck、build:pages 通過；96/96 靜態頁、hardened 2292 檔／136 頁。security:audit 0 errors／2 既有 warnings、secrets、Gitleaks 通過。交接來源 15/15 通過；兩個測試檔 CRLF 在本地改回 LF 以符合既有 byte hash，未提交內容變更。
- G/runtime/build-verify/前任 main candidate 七個天氣檔已同步，28 個逐檔備份與 SHA manifest 在 task-2/weather-pre-sync。保留 G 的 42px CSS token，以及 candidate 原本的圖資 manifest 測試，只改三條天氣 UI 斷言。未覆盖其他工作或交接簿。
- 視覺仍未驗證：前任 CUA HRESULT 0x80070003 尚無恢復證據；靜態 HTML／程式測試不等於桌面、手機、對比或 A4 驗收。
- 另外發現 main 有 5 個既有 Dependabot 告警（#14–18，全在 mobile/vehicle-tracker/package-lock.json；1 critical、4 high，建立於 10/02–10/08），本批不改 mobile 依賴。CodeQL open alerts 在接手時為 0。
- 第二批機電：手機右欄超出（橫捲未驗）、NT$／新臺幣／星期二拆行、浮月亮遮產製時間、一市頁首／二市排班表需查資料與文案；不影響本批天氣。A4 PDF／紙本、業務／駐警圖仍未驗。


### PR #47 已發布：正式資產驗證

- PR https://github.com/jnfakimo/Inspection/pull/47 已 squash 合併；正式 main commit `f58f380a3a55225adbd2f342088bd8b33626b9df`，基底 PR #46 `6adcdbbf…`。只含 9 個天氣相關程式／測試／證據檔，package.json／lockfile 未變動。
- PR 七項 checks 全通過。合併後 CI run `38382238881`、Commercial readiness `38382238987`、Hardened Pages `38382238877` 成功，Pages build/deploy/verify-deployment 全通過。
- 正式 `provenance.json` 簽章驗證成功，repository/commit 精確相符，共 2289 個檔案。`v2/index.html`、15 個引用 JS/CSS、地圖 PNG 共 17 個檔案 SHA 全數符合簽章 manifest；引用 JS 確認含 `weather-county-observations` 新元件。不以 HTTP 200 代替部署驗證。
- 本機證據：`C:\Users\jnfa\Documents\Codex\2026-10-13\task-2\weather-production\verified-assets.json`，附簽章清單與 dashboard HTML；同任務目錄有完整測試、typecheck、build、安全與渲染紀錄。
- 18 點具名映射仍待確認；未改點位、未填入幾何猜測。22 縣市資料不依賴地圖映射。瀏覽器視覺、手機與 A4 仍未驗證。第二批機電報表與 mobile 既有 Dependabot 告警留待另批。

- 合併後 main CodeQL run `38382238974` 成功；open alerts 再查仍為 0。


## 2026-10-13 機電手機報表修正候選（回存完成，尚未發布）

- 一市畫面顯示「二市排班表」已定位為固定文案；排班與人員範圍查詢本來已依 market_code 過濾。改成選定市場的 short 標籤，未更動查詢、權限或正式資料；未查正式紀錄，不能據此宣稱每筆既有資料正確。
- 五欄表格改局部水平捲動並有提示；日期、NT$／金額與新臺幣完整顯示；機電報表開啟時隱藏浮動主題按鈕。A4 保留五欄、早藍中綠晚棕、下方簽核及長篇自然續頁。
- 候選 mechanical-mobile-candidate 的完整 npm test、typecheck:v2、build:pages、security:audit、security:secrets 通過。首次新增測試僅因 CSS 空白比對過嚴失敗，修正斷言後完整重跑通過。
- 視覺驗證分層：實際 React DailyReportPreview／PrintSheet 加合成資料，離線 headless Edge 執行 320/375/390/430/768/1280 × light/tech 共12組瀏覽器視窗模擬；非 iPhone 實機。另4組由瀏覽器列印引擎產生 A4 PDF：短篇、核准、唯讀各1頁，長篇13頁，並檢視PDF轉圖。非紙本列印。不是只有靜態程式 fixture，但也未驗正式登入頁、Safari、真實印表機或另兩本實際畫面。
- Library 對照圖：libfile_f667c45db54c8191a2495eb898077e1e（mobile-evidence-contact.png，file_00000000d29881f6805790c2d473bc99）。
- G、2026-10-09 runtime、2026-10-10 build-verify、2026-10-13 main-sync-candidate 的15檔事前比對無內容衝突：每處5檔待套本批更新，其餘10檔原本逐byte相同。先備份後只寫入5檔與來源manifest；其餘工作保留。備份與前後SHA：C:\Users\jnfa\Documents\Codex\2026-10-13\task-2\mechanical-pre-sync-20261013。
- 更新15檔來源manifest，待回存後逐項驗證。證據、測試與PDF在 task-2/mechanical-mobile-evidence 與 mechanical-*.log；完整候選說明 mechanical-mobile-handoff.md。
- 依最新指示先不發布，等使用者看修正圖；未commit／push／PR／部署，未新增天氣API、DB、Storage或LINE操作。正式已驗證版本仍是PR47的 f58f380a3a55225adbd2f342088bd8b33626b9df。


## 2026-10-13 開收工接續：使用者三份PDF失敗與七子系統檢查（未發布）

### 保存與接續規則

- 同一工作、同一唯一writer接續，未重啟舊writer。重新讀取G的AGENTS.md、CLAUDE.md、ANTIGRAVITY.md及既有antigravity-workflow技能；G內與已核對父層沒有 .agents/skills。web/AGENTS.md另要求遵循目前Next版本文件。
- 依收工流程保存來源／證據／待辦，再依開工流程核對git狀態與接續點。當次明確禁止發布，因此未stage、commit、push或開PR；不把技能中的Git步驟當成授權。G HEAD仍be0f47335且有大量既有未提交修改；獨立候選基底為正式PR47 f58f380a3a55225adbd2f342088bd8b33626b9df。禁止從G整包推送或重設。
- 上一節手機修正已完成備份回存：4處各15/15逐byte相同，27處寫入（每處5檔與manifest、G三文件），66份原檔備份於 task-2/mechanical-pre-sync-20261013，含前後SHA manifest。沒有未確認內容衝突。

### 使用者PDF的實際失敗證據（由根的唯讀逐頁工作者回報，三份共5頁）

1. 機電設備養護紀錄表：1頁，MediaBox/CropBox 612×792pt（Letter）。主管簽核面板從y629.71到808.22，超出底部16.22pt，約5.7mm，且沒有第2頁；空資料三班各0筆，五欄完整。向量化文字不能單靠此PDF判斷CSS成因。
2. 駐警隊交接紀錄表：2頁Letter。第2頁晚班、主管簽核與產製時間完整，但晚班色塊／表框貼紙頂，缺續頁上留白及名稱／日期／頁碼。第1頁中班後約四分之一留白是晚班整塊移頁，本身不判為錯誤。
3. 業管組值勤巡查及交接報告：2頁Letter。早班列被拆頁，第1頁僅早班／本班無交接事項，第2頁才有01:00–09:00及接班／交班／交予；重複表頭贴頂，缺續頁名稱／日期／頁碼。三階批核完整；第1頁上方留白原因尚未證實。

以上三份均無右側裁切證據，不得把本次手機橫捲修正當作這次列印問題已解決。Library原件身分由根保留；本機未下載正式人員PDF或寫入公開repo。

### 七個子系統檢查矩陣（路由以modules.ts及HandoverModules分派核對）

共同前綴 /Inspection/v2/systems/handover/。以下畫面與操作列為待驗清單，不代表已通過。

|子路由|畫面／操作範圍|交接／簽核適用|報表列印入口與目前狀態|
|---|---|---|---|
|records|指揮台列表、篩選、建立與明細|交班／接班確認；不得送出正式資料|程式無專用列印入口，不適用；画面操作待離線驗證|
|mechanical|市場／日期／班別、工作明細、報表預覽|交接雙簽、每日主管簽核；僅合成資料|本日報表及日期區間列印，使用者PDF裁切待修|
|business|點檢、三班事項、出勤、預覽|交接與三級批核；僅合成資料|本日報表列印，短列拆頁及續頁識別待修|
|guard|排班帶入、勤務、事件、物品、預覽|交接雙簽與主管每日簽核；不得改權限|日報表列印，續頁貼頂及識別待修|
|open-items|未結事項列表、篩選、明細與狀態操作|無獨立主管簽核；狀態寫入不得真送|程式無專用列印入口，不適用；畫面操作待驗|
|equipment|設備運轉摘要、篩選|無交接簽核操作|程式無專用列印入口，不適用；畫面操作待驗|
|mechanical-schedule|一／二市月排班、月切換、草稿與檢核|無簽核；不得儲存正式排班|列印本月班表（橫式）；空／正常／多人待PDF逐頁驗證|

### 已做、未做與命令結果分層

- **已修改**：只完成上一節手機修正與回存；收到三份PDF後尚未改列印程式。
- **已靜態定位風險**：機電仍有 height:297mm／overflow:hidden 及依beforeprint計算才解除限制；業管短列和儲存格被一律設 break-inside:auto!important；各模組匿名@page互相覆蓋，頁面padding只保護首尾而非每張紙；這些是程式證據，不等同已證實使用者PDF的唯一根因。
- **上一批完整測試／建置**：獨立候選 npm test、typecheck:v2、build:pages、security:audit、security:secrets 全exit0。這些結果不涵蓋尚未實作的新列印修正。
- **上一批12畫面**：實際React元件+合成資料，用離線headless Edge測6寬度×light/tech，檢查捲動、日期／金額與浮鈕。不是iPhone實機、不是正式登入頁，也不是只有文字靜態測試。
- **上一批4 A4**：同一實際元件合成短篇、長篇、核准、唯讀，瀏覽器列印引擎產PDF後做幾何與轉圖檢视；不是紙本，也不代表使用者新PDF通過。
- **本次擴大重現**：render-handover-prints.cjs --before exit0，實際機電／業管／駐警報表元件及排班元件、包含交接模組完整CSS集合、無API；check-handover-prints.py --before exit0生成32份診斷PDF（4類×空／正常／長文／長簽核×A4／Letter）。這是診斷工具執行成功，不是32份驗收通過。
- **已重現失敗**：mechanical-empty-Letter.pdf產2頁且第2頁空白；機電normal-Letter為2頁；業管空／正常為2頁。新合成PDF不能取代使用者原件；需再確認所有列、頁尾及跨頁邊界。診斷檔在 task-2/handover-print-before/pdf-results.json，所有32份PDF同目錄。
- **未驗證**：全七子系統互動畫面、全部新PDF逐頁、iOS Safari、真實印表機、正式資料、修正後A4與Letter。無部署、DB、Storage、LINE或額外天氣API操作。

### Codex／Claude下一步

1. 先讀本節與前節、重新比對工作樹及manifest；繼續用 task-2/mechanical-mobile-candidate 做唯一寫入候選，G是來源但不整包合併。不要重跑已執行的sync-mechanical.cjs --execute（會拒絕覆蓋備份）。
2. 先重現相同列印入口、beforeprint與CSS集合。針對機電去除固定高度裁切風險、業管短列避免拆頁但長列允許自然跨頁、三本共用每頁留白與名稱／日期／頁碼；排班橫式頁面需隔離，避免匿名@page污染。方案尚未實作，不可宣稱已修。
3. 檢查空／正常／長文多頁／長簽核，A4為目標並重現Letter；逐頁確認無多餘空白、漏欄、裁切、短列拆頁，簽核完整自然續頁。完成七子系統只讀／合成操作矩陣；無列印功能標不適用。
4. 修改後重新跑相關與完整測試／typecheck／build／安全檢查；來源變更多於原15檔時擴充同一manifest，不另造正本。備份後選擇性同步四處並更新本三文件。
5. 等使用者看圖與當次指示；目前不發布、不自行簽核或改資料庫。手機圖Library已成功：libfile_f667c45db54c8191a2495eb898077e1e；本機Windows不支援xattr，未宣稱xattr成功，完整Library身分另存task-2/mechanical-library-upload/identity.json。


## 2026-10-13 電子交接簿列印修正完成（本批未發布）

本節接續同日列印診斷 checkpoint；後續以本節完成狀態為準。唯一 writer 維持本工作，沒有重新啟動失敗舊 thread。使用者最新範圍為修正、測試、同步與提供三本 A4 證據，不發布。沒有 stage、commit、push、PR、部署、正式資料庫、Storage、LINE、簽核或安全設定操作，也沒有重抓天氣 summary。

### 已修正及原因

- 機電：移除固定 A4 高度、overflow hidden 與 beforeprint 高度縮放路徑，改自然分頁；五欄完整保留，長工作與長簽核不截斷。短簽核整塊換頁，長備註可續頁。先前手機修正（局部橫捲、金額／星期不拆字、預覽隱藏浮動月亮）保留。市場尚未載入時顯示安全空值，避免 market 空值造成整頁錯誤；排班標題跟隨所選市場，資料查詢原有 market_code 篩選未改。未讀正式資料，不能宣稱曾發生跨市場資料混入。
- 三本共用：HandoverPrintPage 依報表與日期建立獨立 named @page，A4 直式，上14／左右9／下12mm，每頁名稱、日期與「第 n 頁／共 N 頁」。紙张邊界留白由每頁管理，移除模組互相覆寫匿名 @page 的風險；批次每日另起一份報表，不保證長內容一日一頁。
- 業管：短班別列避免拆頁；超長內容允許自然續頁。短簽核卡整塊換頁、長備註可拆頁。列印時解除共用內容85%寬度與底色，避免右側紫色帶與表格縮窄。
- 駐警：使用同一套每頁標題、日期、頁碼與留白；保留三班內容、簽核和產製時間。
- 機電排班：獨立 A4 橫式 named page，不污染其他報表；31日、24人合成排班表含頁尾可在一頁完整列印。
- 原使用者 Letter PDF 的裁切是已確認現象；本次移除了原始碼中可確認的裁切機制並做實際瀏覽器回歸，但不能僅憑原 PDF 斷言唯一 CSS 根因，也未聲稱 iOS 真機已驗證。

### 來源清單與同步

唯一候選：C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/mechanical-mobile-candidate，以正式 PR47 f58f380a3a55225adbd2f342088bd8b33626b9df 為底。本批修改下列12檔及既有 tools/handover-release-manifest.json（擴充為16檔，不另造來源清單）：

- web/app/systems/[system]/[module]/handover-sheet.tsx、handover-sheet.css
- 同目錄 mechanical-handover.tsx、mechanical-handover.css
- 同目錄 business-handover.tsx、business-handover.css
- 同目錄 guard-handover.css
- 同目錄 mechanical-schedule.tsx、mechanical-schedule.css
- tools/mechanical-print-fit-check.mjs
- tools/handover-style-check.mjs
- tools/handover-report-style-fixtures.test.mjs

同步由 task-2/sync-print-final.cjs 先執行 preflight-print-sync.cjs，比對前批備份與現況。機電排班CSS三處只有CRLF/LF差異，已逐行確認相同；其餘無未處理衝突。逐檔備份後同步 G、2026-10-09/Inspection-G-runtime、2026-10-10/Inspection-G-build-verify、2026-10-13/task/main-sync-candidate-20261013，只寫本批12檔與manifest，並更新G原有三文件。備份與前後SHA在 task-2/handover-print-pre-sync-20261013/manifest.json；完成時 state=verified、每處16/16一致。G原有大量其他修改與git鎖保留；2026-10-05只讀備份未動。

### 七子系統驗證矩陣

前綴 /Inspection/v2/systems/handover/。七路由均以實際 React 元件＋離線假資料，390／1280px × light／tech 共28組；重新載入、市場切換、篩選、預覽與列印入口依適用性操作，無 runtime error，記錄寫入次數0。AppShell為測試替身，不等同正式登入端到端；簽核／儲存一律未執行。

|子路由|畫面／唯讀互動|列印|
|---|---|---|
|records|列表、篩選、重新載入通過|沒有專用列印入口，不適用|
|mechanical|市場切換、三班、預覽與列印入口通過|空、一般、超長工作、超長簽核 × A4／Letter|
|business|市場切換、點檢、三班、預覽與列印入口通過|同上四情境，短班別不拆頁|
|guard|市場切換、三班、預覽與列印入口通過|同上四情境，內容／簽核／產製時間完整|
|open-items|列表、篩選、重新載入通過|沒有專用列印入口，不適用|
|equipment|摘要、篩選、重新載入通過|沒有專用列印入口，不適用|
|mechanical-schedule|市場切換、月份與列印入口通過|空／一般／24人31日 × A4／Letter 橫式；無簽核功能|

### 命令與證據層級

以下npm命令工作目錄均為上述唯一候選，全部最終 exit0：

1. npm test → task-2/handover-print-full-test-final.log，包含頁首、共用交接版型、權限fail-closed、schema、機電／業管／駐警與來源parity等。
2. npm run typecheck:v2 → handover-print-typecheck-final.log。
3. npm run build:pages → handover-print-build-final.log。Turbopack曾因sandbox禁止建立候選內junction而失敗；經正式逐次審核重跑，不改ACL。
4. npm run security:audit → handover-print-security.log；npm run security:secrets → handover-print-secrets.log。
5. node render-handover-prints.cjs --built-css（task-2）→ 實際元件＋最新build CSS，含動態CSS chunks；來源清單 handover-print-evidence/built-css-sources.json。
6. Python312 python.exe check-handover-prints.py → Edge隔離profile、禁止HTTP/HTTPS，32份PDF；verify-pdf-pages.py → 每頁MediaBox、標題日期、頁碼、內容終點、頁尾、文字範圍與空白頁檢查，每頁轉PNG。詳 verified-pdf-results.json 與 pages/。A4與Letter均真正覆寫named page並驗證實際尺寸，不只檔名。
7. node build-handover-ui.cjs；Python312 python.exe verify-handover-ui.py → 上述28組，handover-ui-evidence/ui-results.json。先前手機12組另存 mechanical-mobile-evidence。
8. node tools/handover-source-parity-check.mjs --source-root <每處根目錄> --release-root <唯一候選> → 每處16檔SHA比對。

靜態測試、型別與建置通過不等於視覺通過；本批另使用Edge實際渲染PDF及PNG看圖。沒有正式人員資料或真簽章，所有樣張皆「離線測試人員」等合成資料。iPhone Safari原生列印、實體印表機、正式登入資料流程尚未驗證；不把桌面窄viewport冒充iPhone。沒有新增後端服務、金鑰、API或資料庫變更。

三本A4檢閱圖為 handover-print-evidence/handover-three-a4-review.png，對應機電1頁、業管2頁、駐警2頁空資料樣張，仍含合成簽核以驗證完整性；可從Library取得，身分記錄於 task-2/handover-print-library-upload/identity.json。Windows不支援helper的os.setxattr，Library成功身分另存sidecar，不宣稱本機xattr成功。

### 下一步

本批完成修正與本機證據後停在未發布狀態。之後若使用者另授權發布，再從乾淨main選擇性整合上述來源清單，跑CI／CodeQL與正式commit／資產核對，不整包推G。不要求使用者重做已由代理完成的測試；iOS與實體紙本保留未驗證標示。


最終PDF驗證：32份／104頁；每頁已產生PNG，並以各情境contact sheets視覺核對分頁、欄位、簽核與頁尾。三本檢閱圖 Library ID：libfile_1ee6b4efa3448191a89c791c3cb3a9dd，下載：https://chatgpt.com/api/library/files/libfile_1ee6b4efa3448191a89c791c3cb3a9dd/download 。upload status=succeeded；本機xattr未成功，sidecar已保存。最後僅恢復業管兩檔原有換行序列，沒有語意變更；重新計算manifest，16檔parity通過。


## 2026-10-13 電子交接簿手機／列印修正正式發布

使用者於11:41 UTC明確授權「發布」，取代上一節本批未發布狀態。沿用唯一writer，沒有重新啟動舊writer。

- PR：https://github.com/jnfakimo/Inspection/pull/48 （先draft，所有門檻通過後ready並squash合併）。
- 分支提交：e485ba5b2a408bb862055ee694bc8b36f24ee320；正式main：e2d1a413ff9a7d51e4bbd74c62d64c44873b4446。合併時間2026-10-13 11:46:39 UTC。
- 發布範圍只有手機與列印修正的13個差異檔；既有handover-release-manifest的16檔在G、runtime、建置候選、main-sync-candidate、分支commit與合併main逐檔SHA均一致。未混入天氣地圖映射、公務車或G其他工作。
- PR CI 38392268833、CodeQL 38392268999、Commercial readiness 38392268785 全數success。Gitleaks完整歷史及目前原始碼、Semgrep、安全設計與production dependencies audit通過；相關handover／mechanical-schedule open CodeQL alerts為0。
- Pages部署：https://github.com/jnfakimo/Inspection/actions/runs/38392567193 ，build／deploy／verify-deployment全數success。正式commit之CI、CodeQL、Commercial readiness亦success，原始結果存task-2/handover-production-evidence/workflow-results.json。
- 正式驗證命令：node verify-handover-production.cjs e2d1a413ff9a7d51e4bbd74c62d64c44873b4446。以repo公鑰驗證正式provenance.json／provenance.sig，commit完全相同；7個交接子路由HTML及88個V2 JS／CSS逐一對照已簽署manifest SHA-256，並確認手機橫捲、短簽核、每頁留白等修正標記。不是只看HTTP200。證據在task-2/handover-production-evidence/verification.json。
- GitHub現有5個Dependabot警示均在mobile/vehicle-tracker/package-lock.json（shell-quote critical；source-map-js、compression、braces、node-forge high），不屬本批且未變更；未忽略本批任何失敗門檻。
- 本次沒有force push、admin bypass、重設工作樹、改ACL、刪git lock或正式DB／LINE／簽核操作。G原有其他修改保留。

正式測試入口（可加?v=e2d1a413避免舊快取）：
- 機電：https://jnfakimo.github.io/Inspection/v2/systems/handover/mechanical/?v=e2d1a413
- 業管：https://jnfakimo.github.io/Inspection/v2/systems/handover/business/?v=e2d1a413
- 駐警：https://jnfakimo.github.io/Inspection/v2/systems/handover/guard/?v=e2d1a413

原本32份PDF／104頁與28組離線互動證據有效；正式靜態路由與資產已驗證，但正式登入資料操作、iPhone Safari原生列印、實體紙本仍未驗證，不能冒充完成真機驗收。檢閱圖：https://chatgpt.com/api/library/files/libfile_1ee6b4efa3448191a89c791c3cb3a9dd/download 。


## 2026-10-13 天氣地圖19縣市映射候選完成（本批未發布）

本節與已發布交接簿PR48分批。依使用者原要求恢復原點位正確縣市天氣，先交付具名預覽，待另一次發布確認；沒有commit／push／PR／部署，也沒有新增正式summary GET、天氣服務、DB或LINE操作。

### 身分來源與實作

- 官方首頁 icon_zone[name=C…]／span.city 與 main-map.css 的 #default_map 座標，加上G Blender腳本保留的原始19點索引鏈，足以建立19縣市一對一映射。完整表、官方URL、原點／現點與歷史限制保存於 docs/WEATHER_MARKER_MAPPING_20261013.md；不以目前最近縣市猜測，也不當作使用者逐點簽認。
- 01新北、02臺北、03桃園、04基隆、05新竹市、06苗栗、07臺中、08彰化、09雲林、10嘉義市、11臺南、12高雄、13屏東、14新竹縣、15南投、16嘉義縣、17宜蘭、18花蓮、19臺東。全部中心、619×847比例、底圖PNG與黑邊保留；只有南投在島內。14仍在東側、16仍在西側，沒有自行移點。
- 新增 weather-map-markers.tsx，把19點共同資料顯示集中：小字縣市、描述驅動預報ICON、測站觀測溫度、鍵盤／點選縣市，title與明細包含氣象署來源、測站、觀測與預報時間。
- 晴雨ICON是預報，溫度是觀測；未知顯示問號，X/-99/空值顯示未提供，0/負溫保留。星號與虛線框表示快取或觀測過期。夜間採臺北18:00–06:00圖示慣例，非日出計算；晴天用月亮、多雲用純雲，不顯示太陽。
- 手機維持地圖在清單之前，增加自然比例高度讓具名標記可讀；說明在圖下正常排版不覆蓋。既有表單／按鈕高度保留共用變數並至少42px。固定SVG點位仍依整圖比例縮放。
- 真實saved fixture只有2026-10-13 14:00觀測、測站與時間，沒有預報，所以官方fixture樣張全部問號是正確缺值行為。另行注入晴／雨／多雲／雷雨／未知的樣張明確標合成預報，不能當成即時官方結果。

### 驗證與差異處理

候選：C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/mechanical-mobile-candidate，分支codex/weather-county-map-review，底為已發布e2d1a413。npm test、typecheck:v2、security:audit、security:secrets、build:pages最終exit0，log在task-2/weather-mapping-*.log；最後合併既有高度與本機圖層測試後再跑test:weather-map-v3、test:weather-widget-layout及build:pages，均exit0。沒有略過安全門檻。

node build-weather-mapping-preview.cjs 使用實際WeatherWidget及實際CSS，僅替換天氣reader為saved fixture；Python312 check-weather-mapping-preview.py 使用隔離Edge、阻擋HTTP/HTTPS，360／390／768／1280px × light／tech × saved／合成日間／合成夜間／缺值過期，共32組通過。核對19個唯一縣市、14與16點選／Enter選取、0／負溫、缺值、夜間圖示、過期星號、圖下注解不重疊、無水平溢出與runtime errors。證據weather-mapping-preview/results.json與24張PNG；已視覺檢查手機、桌面、平板雙主題代表圖。這不等同iPhone真機或正式API驗證。

同步差異已逐項檢視：G／runtime等的CSS既有form-control-height予以保留；舊地圖測試有raw SVG SHA與依賴未追蹤design版本，改沿用main的LF/CRLF正規化SHA，並保留有design時的透明圖層／無烘焙溫度／錨點投影檢查。沒有design的乾淨候選會明確skip該額外本機測試，其餘PNG SHA、座標、映射與幾何測試必須通過。原只允許南投映射的舊斷言由新的19縣市完整斷言取代。精確已審閱來源SHA見task-2/weather-mapping-reviewed-sources.json。

只同步8檔：web/lib/weather-map-v3.ts、weather-map-v3.test.ts、weather-observation.ts、weather-observation.test.ts；web/app/weather-widget.tsx、weather-widget-layout.css、weather-map-markers.tsx；docs/WEATHER_MARKER_MAPPING_20261013.md。未追蹤design整包不納入、不修改底圖資產、不回退交接簿。

sync-weather-mapping.cjs --execute 在每次寫入前比對已審閱SHA，備份後回存G／2026-10-09 runtime／2026-10-10 build-verify／2026-10-13 main-sync-candidate，並更新本三文件。備份前後SHA：task-2/weather-mapping-sync-backup/manifest.json；成功state=verified、四處8/8一致。

### 後續

先看具名預覽，尤其目前在東側的新竹縣與西側嘉義縣；若相對位置要調整，需使用者明確指定，不能由代理按地理直覺重排。本批尚未發布，正式網站仍是PR48交接簿修正版。不得因本節候選完成而宣稱19點映射已上線。


具名預覽Library：libfile_0bff0b43d6688191a781c2fd08733fab；https://chatgpt.com/api/library/files/libfile_0bff0b43d6688191a781c2fd08733fab/download 。上傳status=succeeded；Windows helper沒有os.setxattr，metadata未套用，Library身分另存weather-mapping-library-upload/identity.json，沒有繞過憑證限制。


### 2026-10-13 天氣黑色縣界與資料契約修正（離線候選，未發布）
- 保留既有 Blender PNG、透明背景、淺藍填色與19點座標；使用同一原始 SVG 縣界與既有矩陣疊加黑色 1.5px non-scaling-stroke。移除縣市選取／hover 填色覆蓋，選取提示保留在標記。14號新竹縣仍在原東側位置。
- cwa-weather 從既有 F-C0032-001 Wx 保留 startsAt／endsAt；既有 O-A0003-001 同測站 Weather 保留 observedWeather 與 observedAt，缺值為 null，不新增資料來源、金鑰、資料表或服務。前端優先標示測站觀測天氣，缺少時明確標示縣市預報、時段與過期狀態。
- 保存的正式 summary 是精簡四欄投影，不能據以判定正式服務無預報；使用該 fixture 仍顯示問號。合成觀測／預報預覽不代表正式晴雨資料已驗證。
- 驗證：npm test、前端 typecheck、build:v2、安全設計與密鑰掃描通過；40組離線 Edge 尺寸／主題／情境渲染通過，實際截圖可見黑縣界。後端解析以禁止網路／DB的 VM 執行真實解析器通過。Deno完整型別檢查因 --no-remote 禁止遠端依賴解析而未完成，未放寬限制。實機手機、正式服務及正式部署未驗證。
- 最小後續：取得正式呼叫授權；後端需部署 cwa-weather 才會輸出新增欄位，現有 summary:v4 快取正常到期後更新即可，不需 migration／清除快取／新增金鑰。後端部署與正式 GET 均未執行。
- 工作證據：C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/weather-contract-*.log；weather-mapping-preview/results.json（40組）；weather-contract-sync-backup/manifest.json；新版 Library 預覽 libfile_fa4bbfa39e208191a1f9508b34c9f8ff。


## 2026-10-13 天氣發布中途收工保存／開工接續

- 唯一writer與同一批工程持續；依AGENTS.md、CLAUDE.md、PROJECT_PLAN與實際antigravity-workflow保存後接續。使用者14:39 UTC明確「請發佈」，授權既有cwa-weather、地圖發布及快取正常到期後一次summary驗證；未擴大DB或安全範圍。
- 已修改：13個天氣檔案，19縣市映射、原座標的縣市／ICON／觀測溫度、既有SVG黑色non-scaling縣界；保留Blender PNG及透明底。觀測Weather與預報Wx起訖分開。完整清單為PR49及weather-release-sync-backup/manifest.json，不混入其他dirty工作。
- 靜態／完整測試：候選npm test、typecheck:v2、security:audit、security:secrets全部exit0。後端deno check --no-lock --deny-import使用既有主機cache先抓到鄉鎮組裝誤套欄位，已移除並補鄉鎮回歸測試；重跑Deno完整型別檢查exit0。CI部署前再次deno check也success，未略過此門檻。
- 建置：候選npm run build:pages exit0；Turbopack junction僅依正式逐次審核執行，不改ACL。日誌weather-release-test/typecheck/security/pages/deno.log。
- 離線畫面：既有40組Edge尺寸／主題／情境通過，原PNG及SVG SHA與19座標不變。單欄1536×5080預覽Library libfile_94a533c7b3408191b87fc30c59e983af 明確標為合成／非即時／尚未發布；不當成正式資料證據。
- 正式Git：PR https://github.com/jnfakimo/Inspection/pull/49，分支commit dbe1488bc699e96deb662593cb9082b686dd16f3；CI38416322797、CodeQL38416322777、Commercial38416322768全success，7checks通過後於14:50:20UTC squash合併為8674b47637dc3ec0cc77a0ffbebeaadf283c8da9。
- 後端部署：Edge run38416820471 success，實際只部署cwa-weather；Deploy於14:50:53UTC完成，Deno與OPTIONS smoke均success。沿用現有金鑰，不改schema／安全設定／cache key，不清快取。
- 前端部署：Hardened Pages run38416820431及合併後CI／CodeQL／Commercial仍待最新結果；尚未完成簽章manifest與正式資產核對，不宣稱全部部署驗證完成。
- 正式summary：本批允許的唯一一次GET尚未使用。最早15:01:03UTC（部署完成＋原600秒TTL＋10秒餘裕）才可執行task-2/weather-summary-once.cjs；有exclusive journal防重複。不可因錯誤或欄位不足自行再呼叫。預計保存完整非敏感payload，核對19點的實際溫度／ICON／來源／時間；未驗證前不得拿合成資料替代。
- 備份同步：weather-release-sync-backup保存四處13檔及原三文件共55份；Deno修正及測試兩檔已核對雜湊後同步四處（8處寫入），其他設定保留。G大量既有修改、git lock及2026-10-05只讀備份未動。
- 接續／Codex-Claude：仍由本writer完成Pages／main安全檢查、簽章與資產SHA、等待上述時點後一次summary與離線真實回應重播，再追加本三文件最終狀態。不要重新開另一writer／重推整包G／重複正式GET。iPhone實機、登入端對端仍未驗證。


## 2026-10-13 天氣地圖與既有服務正式發布完成

本節取代上節發布中／summary尚未使用狀態；同一唯一writer完成，沒有啟動其他程式寫入者。

### 已修改與來源同步
- 本批13檔天氣來源已經PR49選擇性整合；分支dbe1488bc699e96deb662593cb9082b686dd16f3，正式main 8674b47637dc3ec0cc77a0ffbebeaadf283c8da9，14:50:20UTC合併。未整包推G、未回退交接簿或其他dirty工作。
- 19縣市具名標記、原點位ICON／觀測溫度、黑色縣界、觀測／預報時間契約已發布。Blender PNG SHA仍019b1fc6ee5f4cbabbf20ce9188987314dbeca4f01a5b1c86cb1ed2d6076caaf；19中心及14號新竹縣東側位置不變。
- 四個核准工作樹本批13檔皆與正式來源內容一致；package只要求天氣測試命令相同，其他本地設定保留。55份原檔備份與同步manifest在weather-release-sync-backup；Deno修正後四處天氣測試exit0，four-root-parity.json為最終核對。

### 靜態、完整測試與建置
- npm test、typecheck:v2、build:pages、security:audit、security:secrets均exit0。日誌task-2/weather-release-*.log。
- Deno完整型別檢查已完成，使用既有主機cache的deno check --no-lock --deny-import exit0；CI部署前再次deno check success。之前鄉鎮欄位誤套造成3個型別錯誤已修正並新增parseTownForecast回歸，沒有略過門檻。
- PR CI38416322797／CodeQL38416322777／Commercial38416322768及7checks全success。正式main CI38416820300／CodeQL38416820393／Commercial38416820076全success。

### 部署與正式靜態資產
- Edge部署 https://github.com/jnfakimo/Inspection/actions/runs/38416820471 success，只部署既有cwa-weather，14:50:53UTC完成；沿用既有金鑰，無schema／安全設定／cache key變更、無cache清除。
- Pages https://github.com/jnfakimo/Inspection/actions/runs/38416820431 的build／deploy／verify-deployment全部success。
- node verify-weather-release-assets.cjs 8674b47637dc3ec0cc77a0ffbebeaadf283c8da9 exit0：正式provenance簽章、公鑰、repository與commit相符；92個公開靜態檔案SHA-256一致，包含HTML、V2 JS/CSS、SVG、PNG。正式bundle解析出的19個ID、縣市與座標逐項等於核准來源，黑縣界與觀測欄位標記存在。不是只看HTTP200。

### 唯一一次正式summary：已使用，成功，禁止自行重試
- 使用者本批授權已於2026-10-13T15:01:42.959Z使用一次GET，晚於部署完成＋600秒TTL＋10秒餘裕。未呼叫第二次、未清除快取、未直接讀寫資料庫；服務既有cache更新路徑維持原樣。
- HTTP200，22縣市，新增observedWeather／startsAt／endsAt欄位全部存在，cached=false、stale=false、sourceWarnings=[]。19/19地圖溫度有效、19/19圖示可辨識；溫度來源是測站實測，不是預報高低溫。
- 觀測時間全為2026-10-13 22:50（臺灣）；正式回應晴／晴有靄，故本次夜間19點為月亮。範例臺北24.5°C、南投19.9°C、新竹縣23.7°C。雨天圖示已有離線合成情境驗證，本次正式資料沒有雨，不能說已觀測到正式雨天。
- Wx預報起訖是2026-10-14 00:00–06:00（臺灣），當時尚未開始；地圖使用當下測站觀測，沒有把這段未來預報當成現在。
- 完整原樣非敏感payload：weather-release-evidence/summary-full.json，SHA256 3a3464141524ff3cbad78c1f52ce26e0440176a785bc5bb411c856a160a6c3a5，redactions=0，沒有再做四欄投影。summary-once-journal.json保存一次性請求；summary-verification.json保存19點的來源／數值／符號／時間；forecast-period-verification.json保存全部預報時段。以上在本機工作區，未加入公開repo。

### 畫面證據與尚未驗證
- 既有40組合成／缺值離線Edge檢查通過；另以本次完整正式回應與已發布元件做390／768／1280 × light／tech共6組離線重播，19個ICON／溫度／來源時間逐項等於保存回應、22縣市清單完整、無水平溢出或runtime error，14與16鍵盤／點選可用，黑縣界保持。過程封鎖外網，沒有額外天氣GET。
- Library真實回應快照 libfile_bc78f00be7788191b65d228245ef569f，https://chatgpt.com/api/library/files/libfile_bc78f00be7788191b65d228245ef569f/download 。明確標「正式單次回應快照／離線重播／非持續更新」，不是正式登入頁端到端或iPhone實機。Windows helper不支援os.setxattr，本機identity sidecar保存，不宣稱xattrs成功。
- 未驗證：正式登入端對端、iPhone Safari實機。無剩餘發布阻礙。若需再正式summary請求，必須取得新的明確授權，不能因本次收工自動再抓。

### 正式入口與交接
- https://jnfakimo.github.io/Inspection/v2/?v=8674b476
- PR https://github.com/jnfakimo/Inspection/pull/49
- Codex／Claude接手先讀本節與上節；本批已完成，不重啟舊writer、不重複部署、不重複一次性GET。G其他未提交項目維持原狀，本節只更新原三份主文件，未新增平行專案日誌。


## 2026-10-13 四項未完驗收續辦（執行中、未發布）

接續既有全站雙主題／字型／42px、正式流程、實機紙本及 S1–S3 資安項目，不另建平行專案計畫。使用者已授權離線验收與明確違反既有規格的小範圍修正；本批不 commit／push／PR／部署、不改安全設定、不寫正式資料、不簽核／送通知、不新增天氣 API 請求。唯一 writer 維持目前代理。

1. 以 G 現有前端來源快照及實際元件，封鎖外網，建立 13 系統／67 子模組 light／tech、桌面／平板／手機的文字對比、字型、42px 控制項與水平溢出驗收；先保存來源 SHA，再對確認違規做最小修復。
2. 沿用 Obsidian/06-發布前驗收表.md 的角色與業務流程清單補矩陣：合成資料只證明離線流程；正式登入／跨角色／RLS／實際寫入另列未測與必要隔離條件。
3. 把 iPhone／平板實機、原生列印及 A4 紙本最小清單補進同一驗收表；既有 32 PDF／104 頁、28 組交接互動不能冒充真機或紙本。
4. 既有資安正本 SECURITY_POSTURE.md 的 S1 部分完成、S2／S3 未完整執行；docs/security_audit_report.md 只有三項技術掃描對照，其 COMPLIANT 字样不足以宣稱 ISO 合規。等獨立只讀研究後補來源、控制對照、責任及證據缺口。

工作證據：task-2/global-acceptance-evidence；原文件寫入前備份 document-before.json。G origin/main 停在 6adcdbbf，正式版本以已核對的乾淨候選 origin/main 8674b476 為準，不對 G 執行 reset 或整包同步。此節為開工範圍，並非驗收通過。


### 2026-10-13 四項續辦安全交付點：離線盤點與三檔小修完成，全面驗收尚未通過

本節取代前述「執行中」的初步數字，並保留未完成項目。唯一writer；沒有commit、push、PR、部署、正式登入、DB／Storage寫入、簽核、LINE或新增天氣API請求。正常使用者使用網站不受代理呼叫限制影響。

**程式變更（僅三檔，未發布）：**
- web/app/v1-layout.css：淺色小字dim微調、品牌／時鐘／後台選單／inline-message使用較深主題文字色；26px系統標題既定cyan不變。品牌及時鐘實测對比從約4.09提升至5.88。原生日曆透明載體加top:0／left:0，避免行情頁的較高權重width規則把它排到右側產生整頁橫捲；沒有全站overflow hidden。
- web/components/admin/LayoutsAdmin.tsx：只加版面編輯器範圍class與移除一個固定360px最大寬設定。
- web/app/admin-workspace.css：800px以下長版本選单可換行、子容器可收縮。修正後該頁390px兩主題整頁溢出0。

G保留所有其他未提交工作。相同局部修補亦施於 task-2/mechanical-mobile-candidate（HEAD dbe1488，已發布PR49來源；origin/main 8674b476），沒有把G整包同步；runtime／build-verify與main-sync三處本輪未寫入，不宣稱此三處已同步。每檔前後SHA與備份見 task-2/global-acceptance-evidence/code-changes.json、code-before/。

**實際驗證：**
- 94個頁面／入口 ×390、768、1280 ×light／tech，共564組離線量測，包含67個子模組、12個有子模組的系統入口、管理設定及其他14頁。AuthGate和API為合成替身，資產取已發布候選；外部請求全部攔截，未接觸正式session。這是空／合成資料狀態的廣度盤點，不是全站完整互動或真機驗收；公開board及404特殊狀態尚未纳入。
- 第一輪後發現測試環境漏載admin巢狀layout CSS，已讀實際layout補回並重跑後台78組；巡檢頁假資料契約亦已補正。原始結果保留，最終以 verified-results.json／summary.json為準：0 runtime errors、0 write attempts。
- 42組受影響頁另載入正式 npm run build:pages 產出的CSS chunk覆核對比及透明日期欄位，見built-css-results.json。其餘由實際來源CSS編譯，不能冒充全部正式Next頁面視覺驗收。
- 真實瀏覽器CDP在機電與後台標題的兩主題確認Noto Sans TC Bold（isCustomFont=false，主機已安裝字型）；字型token一致不保證所有裝置載入同字型，Rajdhani與跨裝置fallback仍需驗收。
- G現行模組權限／人員清單／機電狀態／登入導向22測試通過；67模組×6種合成權限配置=402斷言通過；G fail-closed檢查通過。這不是部署後API/RLS驗證。
- 乾淨候選 npm test、typecheck:v2、build:pages、security:audit、security:secrets、git diff --check均成功。security:audit仍有2個既有警告：layout HTML注入及vehicle報表字串輸出，不能稱資安風險全清。完整日誌在同一證據目錄。沒有本輪CI／CodeQL或發布。
- G來源快照預設Turbopack因既有node_modules junction超出偵測根目錄而失敗；以官方webpack模式獨立建置成功，這只是補充證據。正式預設Turbopack＋hardened Pages流程在上述乾淨候選已成功，沒有更改專案設定。

**仍需處理，不得勾選全面通過：**
1. 窄版溢出：admin/alerts在390px為135px；vehicletracking/devices、geofences、alerts在390px為578px、768px為264px；modeler在390px為2px；tv-dashboard在390px為55px。需先區分表格局部捲動與容器問題後修復。
2. 派車requests在768／1280px保留既有zoom:.85，一般控制項CSS約42px但視覺約35.69px；本輪未以更大欄位或取消整頁縮放擅自改既有版型。
3. 戰情版面仍有固定深色面板、低對比文字及行內樣式；contrast-review.json有283筆去重候選，包含可能的大字、disabled、遮罩等需逐項覆核，不能把候選數當確定缺陷數。未逐張人工檢閱所有頁面。
4. 真機iPhone／平板、原生列印、A4紙本與完整正式登入流程均未驗證。精簡清單及失敗紀錄格式已整合到Obsidian/06-發布前驗收表.md，不要求重做既有32 PDF／104頁。
5. SECURITY_POSTURE.md原有三階段確實存在；現已補候選ISO控制、官方參考版本、責任欄位與執行條件。S1部分完成，S2隔離整合與S3治理／復原尚未完成。docs/security_audit_report.md保留歷史數值並加「COMPLIANT不等於ISO合規」更正；JSON原始歷史未改。

下一安全工作批次：先收斂上述窄版容器與戰情版面主題問題，再補長資料／modal／錯誤狀態及公開board；正式登入整合須先確認可使用的隔離環境／測試帳號，不能拿正式資料作測試寫入。不得自動發布本批。

<!-- UI-RELEASE-20261014 -->
### 2026-10-14 UI 兩階修正／離線驗收／發布交接

**授權與單一寫入者：**使用者 2026-10-13 22:43 UTC 已明確「請發佈」（Sentinel_37dcebd7ea94819196cf9ecc8a86c599），取代上一節本批不得自動發布的暫停狀態；只含已驗證前端 UI 與相關既有文件。沒有 backend、DB、RLS／安全設定、LINE 或新增天氣 API 操作。仍由此任務唯一寫入；不啟動已失敗舊 writer，不自動呼叫 Claude。遵守 AGENTS／CLAUDE、ANTIGRAVITY 與 antigravity-workflow；不另造工作日誌。

**程式與保存：**第一階段三檔共用小字對比／日期透明層定位／版面編輯器容器；第二階段併為七檔：v1-layout.css、admin-workspace.css、dashboard.css、vehicle-tracking.css、tv-client.tsx、LayoutsAdmin.tsx、DashboardWidgetContent.tsx。資安告警晚出的 desktop grid 已限制斷點；追蹤頁容器 min-width:0、保留表頭／欄位並局部橫捲；派車移除 .85 zoom、保留等效桌面幅寬而控制項實測42px；TV 窄版換行、桌面12／24欄邏輯保留，文字／面板／外層背景用主題 token。
- G 大量未提交變更完整保留；七檔同步核准 runtime 前逐檔備份且確認原始雜湊未變，同步後 SHA-256 完全一致（runtime-sync.json）。build-verify／main-sync 路徑未同步，不能宣稱四處一致。
- 乾淨 candidate：C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/mechanical-mobile-candidate；基底正式 main 8674b47637dc3ec0cc77a0ffbebeaadf283c8da9；分支 codex/ui-responsive-theme-20261014；source commit adc92bc34395bcea2eb875213449a2e910546ad9；只7前端檔。六檔與G正規化內容相同，v1-layout.css 唯一差異為 G 未發布日期選擇器 button／indicator CSS，候選保留已發布元件，沒有拿整份 G 覆蓋。
- 本節寫入前既有三文件備份在 batch2/handoff-before；第一階段備份 code-before、第二階段 before、runtime-before。舊2026-10-05備份未寫入，G packed-refs.lock 未處理。

**驗證層級與確切命令結果：**證據根 C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/global-acceptance-evidence/；以下 batch2/ 相對於此。
1. npm.cmd test exit0（release-test.log）；npm.cmd run typecheck:v2 exit0（release-typecheck-final.log）；npm.cmd run build:pages exit0（release-build-final2.log）。前一次 sandbox build junction access denied（release-build.log），逐次審核重跑成功；沒有更改ACL或降低設定。最後 CSS 調整另跑 npm.cmd run test:vehicle-tracking exit0（release-tracking-final.log）。
2. npm.cmd run security:audit exit0、0 errors／2 warnings（release-security-final.log）；npm.cmd run security:secrets exit0（release-secrets-final.log）；git diff --check exit0。未重跑已完成項目只為記錄。
3. 最初G盤點94入口×3尺寸×2主題=564組；後台漏載nested CSS曾補78組、日期透明層用42組build CSS覆核。正式候選不包含G獨有 notification-preview，故最終候選93入口×3×2=558組（release-offline.log、release-verified-results.json），0 runtime error、0 write attempt。這是離線合成資料，不是正式登入E2E；公開board、404、完整長資料／modal／錯誤狀態未全面覆蓋。
4. python check-global-batch2.py after exit0，7頁×320/390/768/1280/1920×雙主題=70組，使用候選JS與實際 build CSS，0整頁溢出／0error／0write（release-targeted-final.log、after-results.json）。390px告警135→0、追蹤578→0、TV55→0；追蹤328px容器／920px表格實測scrollLeft=200，6或7可見表頭保留；派車各尺寸42px。最後表格／TV補修結果覆入558集合，而非把舊截圖當最終。
5. G純角色路由402斷言、22項隔離流程與fail-closed檢查沿用第一階段證據；正式session/RLS未驗。字體CDP僅部分Noto Sans TC Bold已確認，未聲稱全裝置Rajdhani載入一致。
6. PR https://github.com/jnfakimo/Inspection/pull/50：CI run38480995484、CodeQL38480995445、commercial static-audit38480995430；七項檢查success（含build、static-security、static-audit、CodeQL Analysis、CodeQL、gmail-repair-linux、iis-powershell-compatibility）。

**兩項warning與資安對照：**
- web/app/layout.tsx：「HTML 注入 API」，掃描等級warning；兩段常數bootstrap無動態HTML插入跡象，屬靜態檢視，不等於XSS滲透測試。
- vehicle-workspace.tsx：「文件字串輸出」，掃描等級warning；報表文字欄位escHtml、計數數值化，惡意HTML分隔符跳脫測試通過（warning-review.json），未抑制警告。工具未給CVSS，不擅自改標高低風險。現有離線檢視不需另行授權；正式資料／安全設定變更仍須另定範圍。
- SECURITY_POSTURE.md既有18類S1–S3架構保留；ISO27001:2022+Amd1:2024、27002:2022／ASVS5.0.0／SSDF1.1／NIST80061r3為候選對照與參考，不是認證。S1部分完成；S2隔離整合、S3治理／復原尚未完成。docs/security_audit_report.md歷史COMPLIANT不可當ISO合規；原JSON未改。GitHub另提示既有相依5項（1critical、4high），本批未改依賴也未宣稱解決。

**發布狀態：**已正式發布；main commit e4fd4b17ab312afaebe0f1f51279c41cc5acdb93；Pages run 38481581566；簽章有效、正式 92 個資產雜湊吻合。正式入口 https://jnfakimo.github.io/Inspection/v2/ 。合併後 CI38481581555、CodeQL38481581567、commercial38481581581及Pages38481581566皆success；沒有Edge Functions部署。main前端樹與已驗證source commit完全一致；只取公開靜態資產檢查，沒有正式頁面登入視覺／天氣API請求。

**未驗與待辦：**建模頁390px仍有既有2px溢出（雙主題）；實體iPhone／平板／42吋螢幕、原生列印、A4紙本、正式登入與角色/RLS、長資料與公開board、S2/S3均未完成。先前32PDF／104頁離線證據不要求重做，也不轉記為紙本通過。實機／紙本短清單與兩批前後圖已組成單一可離線列印HTML（beinong-ui-verification-and-device-checklist.html）；Library 已成功交付：libfile_8009f904a92c8191a76f26ee132fdf29（file_00000000e6d082099932f87c83f06899），檔案1,620,850 bytes，內嵌12張前後對照圖，390/1280px附件排版驗證通過。Windows不支援os.setxattr，官方helper套用metadata失敗；Library建立本身成功，完整identity已保存在library-identity.json，沒有繞過憑證或重複上傳。

**Codex→Claude接手：**先讀AGENTS、CLAUDE、PROJECT_PLAN本節及handoff；核對candidate git status、HEAD／origin/main、PR50及Pages實際狀態，不重跑已完成檢查只為記錄。確認目前writer停止後才接手，勿啟動另一writer；以release-summary.json／runtime-sync.json／正式資產證據判讀各層通過範圍。未部署時只續PR50既有前端發布，不新增天氣summary GET；已部署時先讀正式簽章與commit，避免重複merge／部署。後續未验項先取得隔離環境與測試帳號／實體設備存取證據，不拿正式DB作試寫；不退回交接簿／天氣已發布修正。
<!-- /UI-RELEASE-20261014 -->


### 2026-10-14 PR50後續：建模溢出已本機修正、兩項warning資料流審查完成（未發布）

**範圍與狀態：**唯一writer接續使用者已授權兩項獨立工作；本批明確先不發布。正式仍為 PR50／main e4fd4b17ab312afaebe0f1f51279c41cc5acdb93。候選分支 codex/modeler-warning-review-20261014 基於該正式main，只有 modeler.css 5行未提交修正；未commit／push／PR／部署。本批未改權限、DB、CSP、安全設定、LINE，也沒有新增天氣API。G獨立日期選擇器及其他未提交工作保留。

**建模2px：**web/app/systems/structuremap/modeler/modeler.css:16 的導覽列 margin 為左右-16px；共用v1-layout.css在≤760px內容左右padding為14px，造成390px畫面nav left=-2/right=392（320px同樣多2px）。這是容器本身越界，與導覽列內合理的 overflow-x:auto 不同。只新增同≤760px斷點的左右margin:-14px，保留其他幾何／樣式／橫捲。G、核准runtime、candidate原始該檔一致，逐檔備份後套用相同修正；備份與雜湊見 modeler-changes.json／before/。
- npm.cmd run test:page-headings exit0（page-headings.log）；npm.cmd run build:pages exit0（build-pages.log，含Next型別檢查）；git diff --check exit0。
- python check-modeler-built.py exit0：320/390/600/760/761/780/1280 × light/tech =14組實際build CSS，整頁溢出0、runtime error0、write attempt0；320px局部scrollLeft>0且最後按鈕可到達，未用全頁overflow hidden遮蔽。modeler-before.json保留2px證據；modeler-after-built.json與390/1280截圖為修正後證據。

**warning 1：HTML 注入 API**
- 掃描入口 tools/security-design-audit.mjs:33，只以 dangerouslySetInnerHTML 字樣發出 warning；不是污點分析結果，也沒有CVSS。
- 確切sink web/app/layout.tsx:55、56；所有V2頁面載入RootLayout時執行。55插入32–47行 CHUNK_RECOVERY_SCRIPT 的固定模板字串，無資料庫／HTTP／使用者欄位插入其中。56同樣是固定程式字串。
- 未信任來源仍存在，但不進HTML解析：localStorage.siteTheme讀取後只傳给固定名稱 data-theme 的 setAttribute；錯誤事件的url/message/reason及sessionStorage.chunkRecoveryAt只做字串比對／Number轉換／60秒重載節流，不經eval、HTML拼接或script字串插值。固定程式本身不需要HTML消毒；主題值不屬富文字，也不會重新解析成屬性或節點。
- 測試：8個惡意localStorage值（img onerror、svg onload、script結尾、引號、entity、javascript字串）在實際script的無CSP離線瀏覽器執行後，data-theme保留字串、執行旗標0、注入活動節點0。實際chunk程式另在VM驗證惡意錯誤字串不執行，非chunk不重載、首次chunk重載1次、重複事件仍1次。
- 結論／嚴重度：掃描等級仍warning；此資料流未證實可利用XSS，屬需要保留審查的危險API提示，沒有已確認漏洞可評CVSS。不抑制掃描、不更改CSP，也不聲稱所有瀏覽器／其他sink均安全。

**warning 2：文件字串輸出**
- 掃描入口 tools/security-design-audit.mjs:34，依 document.write 字樣提示warning。確切sink vehicle-workspace.tsx:592–606；入口453「派車報表」→498/505 VehicleReportModal →665「A4列印」→574 printReport，576建立同源空白報表視窗。
- 資料來源：271–280直接讀取 vehicle_dispatch_requests 並setRows；不因來自DB就視為可信。報表from/to為507–508的表單state，profile.name來自登入profile；request_no、單位、人名、地點、用途、車牌、司機、status fallback、abnormality_note等可含未信任文字。reportQuery只參與includes篩選，未插入HTML。
- 編碼與context：581–589及603的文字值全部經 web/lib/html-escape.ts:10–13 escHtml，將 & < > 引號及單引號編碼；這些插值均位於文字節點，無動態URL／屬性／script context。timeText（61）只是截字但其結果仍escHtml；未知status fallback也有escHtml。里程／油費於587–588先Number再格式化；604的metrics由524–530的長度、Number及布林計數產生。body雖直接插入605，但它由上述逐欄編碼的列組成。這是context正確的輸出編碼，不是允許富文字的消毒器。
- 測試：從實際TypeScript AST提取 printReport、metrics、STATUS_LABEL、timeText、escHtml，沒有重寫其編碼；8組payload同時放所有文字、日期、profile及數字欄位，產出真正函式報表。在無CSP離線Edge解析，payload以字面文字呈現、script/img/svg/iframe/object/embed數0、事件屬性0、執行旗標0、沒有外部請求。非法數字變NaN而非HTML，此項資料品質不代表XSS，也未順帶更改業務驗證。
- 結論／嚴重度：現有掃描warning保留；在已追到的輸出路徑未找到編碼缺口或可利用XSS，因此沒有必要改source或suppress。報表視窗同源，若日後漏掉跳脫，潛在影響會涉及使用者session；這是回歸理由，不是本次已證實漏洞或已評定的高風險缺陷。

**既有與新增測試界線：**既有npm test／security:audit已在PR50通過；本批搜尋 tools、web/lib 測試未找到直接針對 escHtml／CHUNK_RECOVERY_SCRIPT／vehicleDispatchReport 的專用XSS回歸，掃描只證明語法提示。新增的可重跑隔離證據在 C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/global-acceptance-evidence/followup/：security-fixtures.json（來源SHA、8個HTML）、security-browser-results.json（16組全通過）、chunk-recovery-results.json、warning-source-parity.json（G/candidate三來源正規化一致）。執行腳本在task-2：build-html-warning-fixtures.cjs、check-html-warning-fixtures.py、check-chunk-warning.cjs；均exit0，未加入CI、未動正式資料。

**是否需批准／正式資料驗證：**本次最小CSS修正、只讀資料流分析與離線fixtures已在授權範圍，無需另批；沒有發現必須改安全設定的修復。驗證輸出編碼不需要往正式DB寫入payload。若要補「登入→儲存→跨角色讀取→列印」stored-XSS／RLS整合層，須先指定可用隔離環境、測試帳號與資料範圍；本次沒有該層證據，也不因16組通過而標S2/S3完成。實體設備與紙本仍未驗。

**交付與接手：**既有 Library libfile_8009f904a92c8191a76f26ee132fdf29 是可離線閱讀／列印HTML，並非PDF；390px附件閱讀測試已過，未因假設手機不佳另外新增PDF。後續Codex/Claude先確認本writer已停止，再讀本節、git status與followup證據；保留modeler.css未提交修正、不要重發PR50，也不要把本批本機修正當正式上線。沒有任何新的發布授權。


### 使用者決定：暫緩隔離測試環境

使用者指示「先不要 列入待辦事項」（Sentinel_d265de5b7d5481919223b215999d7b29）。既有 S2 環境待辦狀態更新為：**使用者暫緩：建立本機隔離 Supabase 環境，完成真實登入／跨角色／RLS 驗收；待日後批准。**

此為同一待辦的狀態更新，不新增工程任務；既有只讀盤點及驗證證據全部保留。不安裝 Docker／Supabase、不建立帳號、不啟動容器、不再次請求批准；正式資料庫不可替代隔離測試。本條環境設置工作停止，直到使用者日後明確批准。實機／紙本仍未驗證，建模 CSS 候選仍未提交、未發布，正式站維持 PR50；其他未完成項目不因此視為完成。


### 2026-10-14 Adobe PDF／Letter 列印問題修正（本機，未發布）

- 使用者三份原始 PDF 由 Adobe PDF 印表機／PScript5.dll／Acrobat Distiller 26.0 產出，Letter 612×792 pt；不是瀏覽器另存 PDF。原始檔判讀依雲端父任務 Library 檢查：業管 3 頁含空白首頁與第二節孤立標題，機電及駐警各 2 頁且簽核完整；留白不等於資料遺失，未發現頁首日期裁切。
- 3000 listener PID 19172，其父 PID 30372 執行 `next dev web --hostname 127.0.0.1 --port 3000`；實際來源 `C:/Users/jnfa/Documents/Codex/2026-10-09/Inspection-G-runtime`。本次候選基底 `e4fd4b17ab312afaebe0f1f51279c41cc5acdb93`（PR50），不是把 runtime 的歷史 BUILD_ID 當作 dev 版本。
- 唯讀 Adobe PrintTicket 明確為目前預設 ISOA4 210000×297000 μm、Portrait、PageScaling None；不能反推原始三份 Letter 工作當時設定。未修改印表機設定，未操作真實帳號或正式資料。
- 根因與最小修正：業管 print selector 漏掉實際 `.system-page-heading`，仍占位的共用頁首先產生一般頁，接著切換報表 named page 造成空白首頁；加入 display:none。共用 800px 手機 media query 原本也套用列印，指標與簽核變單／雙欄增高；限定 screen，保留既有列印字級。區段標題加入 break-after:avoid-page，避免孤立。公文 QR 的 `body *{visibility:hidden}` 限於 `body:has(.od-qr-modal)`，防止跨模組列印污染。
- 真實 React OperationsWorkspace＋AppShell＋全模組樣式、隔離假 API、封鎖外部連線：直接列印與預覽後列印兩條實際按鈕路徑，三本×兩種紙張共 12 PDF／20 頁，均無空白頁。業管 3→2 頁、第二節標題與早班首列同頁；機電 2→1 頁，所有班別、交接簽名、主管簽核與產製時間保留；駐警 2 頁保留完整班卡及簽核。這些是 Edge/Skia PDF、使用現有 CSS A4 named-page 版面適配 Letter/A4 輸出，不能宣稱 Adobe Distiller 實機列印已通過。
- 另以新 build CSS 跑 32 PDF／104 頁短文、空資料、長文、長簽核及排班表 A4/Letter 回歸，全部無空白頁且末端標記完整。test:handover-report-fixtures 19/19、test:handover-style、test:page-headings、typecheck:v2、build:pages 通過。build 在 sandbox 下 junction 被拒，正式逐次審核重跑成功；未變更 ACL。git diff --check 通過。
- 前次 104 頁漏測原因：只渲染 PrintSheet／ReportContent，AppShell 為 stub，沒有實際共用頁首與全域公文 CSS，且驗證只檢查空頁／末端標記，沒有 section heading keep-with-next 判斷。本次補完整頁面與兩個真實列印入口，並加三項持續回歸規則；104 頁只能作長內容補充證據。
- 證據 `C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/print-path-repair/`：full-after.json、*-direct-after-{Letter,A4}.pdf、*-preview-after-{Letter,A4}.pdf、build.log、sync-preflight.json、sync-result.json；驗證程式 task-2/verify-print-path.py。修改前備份在 before 與 sync-backup。公文 CSS 的 G/runtime 原有 form-control-height 等差異保留，只替換單一列印 selector；其他三檔與候選修正前相符。
- 未驗證／待辦：Adobe Distiller 實機重印及紙本；目前工具清單沒有可呼叫 node_repl／CUA，因此不以替代 helper 繞過桌面控制限制。業管產製時間列一致性尚未改。未建立 PR、提交、推送或部署；保留未發布 modeler.css、G 日期欄位與其他未提交工作。Supabase 隔離環境依使用者「先不要」維持暫緩，不安裝、不啟動、不再要求許可。

- 同步後本機 HTTP 層：初始 HTML 僅含根 CSS，交接簿樣式為延遲 chunk；已逐一 GET 實際 dev 的 business-handover 與 handover-sheet CSS，200 且包含實際頁首隱藏、screen-only 800px 與 keep-with-next 修正（runtime-css-chunks.json）。歷史 production chunk 在 dev 下 404 不作目前版本證據；此檢查不等同登入後 Adobe 實機列印。


### 2026-10-14 PR51 列印修正發布結案

使用者於 2026-10-14 06:10:08 UTC 明確授權「發布」。僅七檔列印 CSS／回歸／雜湊及交接紀錄納入 PR51 https://github.com/jnfakimo/Inspection/pull/51 ，候選 926e7eb196fa85a866dd6e743d3644807c287ae7，正式 a3ea9458a49257146cf908b5472caf108ea7f0a7（06:21:39 UTC 合併）。先前「本批尚未發布」描述以此結案更新取代；建模與日期欄位其他候選仍未發布。

正式 CI 38521752438、CodeQL 38521752468、Commercial readiness 38521752476、Hardened Pages 38521752431 全部 success。正式 provenance Ed25519 簽章與確切 commit 符合；三本交接頁及 JS/CSS 共92項資產 SHA-256 驗證通過，實際頁首隱藏、screen-only 800px、標題 keep-with-next、QR作用域四項均存在。只讀靜態站，沒有正式 DB／簽核／LINE／天氣API操作。

G/runtime 16份交接來源符合更新後 manifest；換行標準化與manifest同步先備份於 print-path-repair/release-sync-backup，逐檔 SHA 在 release-sync-hashes.json。完整44份PDF共124頁，all-44-pdfs.json記錄尺寸、Producer及雜湊；命令與根因詳見 evidence-addendum.md。

Library六份附件上傳尚未完成：標準helper首次DNS失敗，正式審核重試回報 Library prepare_uploads is not available，尚無library_file_id，沒有建立或重複附件。六份Letter/A4修後PDF及hash清單包在 handover-print-six-pdfs.zip，可由使用者一次上傳父對話。

Adobe原生仍未驗證：現行工具無node_repl／桌面／瀏覽器互動入口；最少必要實機步驟是重新整理三本報表、使用同日資料，各點列印並選Adobe PDF、本次工作Letter，存三份一次提供。檢查無空白首頁、章節標題不落單及班別簽核完整，不要求真實資料固定頁數。Edge/Skia測試不取代Adobe實機。Supabase隔離環境依使用者決定暫緩。

GitHub推送提示的5項既有相依警示均屬 mobile/vehicle-tracker/package-lock.json（2026-10-02至10-08建立），本批不含該模組或lockfile；發布要求的production dependency audit通過，未宣稱整個repo無警示。


### 2026-10-15 行動端相依修補接續檢查點

使用者已授權「可以的 請將資料寫入 並部署」，指定 G 為主來源。本次先保存狀態，後續僅選擇性同步及發布完成且驗證通過項目。正式 main 最近已核對為 PR58／69a47285986e193c5e50745a50a5a81ca3ffb130；不得回退至 PR51 或 PR52。

乾淨候選：C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/mobile-deps-20261015。候選目前僅 mobile/vehicle-tracker/package-lock.json 有修改，目標 compression 1.8.2、shell-quote 1.12.0、source-map-js 1.2.2，保留 uuid 11.1.1。前次 npm ci 已確認 exit 0；工具連線中斷後 typecheck、相依樹與 CI 編輯尚無完成證據，本次檢查未找到預期 typecheck/npm-ls 日誌，CI 未呈現修改，必須重新核實後完成測試。此檢查點不代表已部署。

G/runtime 與最新 main 仍有交接檔案／manifest 差異，需逐檔備份及比較後同步，不整包覆蓋 G 未提交工作。證據存於 mobile-deps-evidence-20261015。業管報表末尾空白頁及隔離 Supabase 安裝維持使用者暫緩；不操作正式 DB、簽核、LINE 或天氣 API。原生行動裝置、Adobe 與紙本仍未驗證。


### 2026-10-15 PR59 驗證與同步紀錄

PR https://github.com/jnfakimo/Inspection/pull/59 ，候選 c5648296da6aec0916a61b5c0fb76f7c7036f4ad。本機行動端 npm ci、typecheck、相依樹、Android/iOS Hermes bundle、BLE 8/8、完整 npm test、V2 typecheck、build:pages、秘密掃描全部通過；資安設計稽核 0 錯誤、2 項既有警告。遠端 mobile-vehicle-tracker、static-security、Windows 相容性與 commercial static-audit 已通過；其餘 CI/CodeQL 尚待完成，不在此宣稱部署。

G/runtime 已先逐檔比對舊 PR51 內容、備份，再同步 PR58 已發布版本：每處六份原始檔及 manifest，共 14 個檔案項目。兩處 16 份 manifest 原始檔雜湊均通過；行動端 lockfile 與 ci.yml 另各兩檔同步並讀回相同。其他 G 未提交修改保留。證據：checkpoint-result.json、main-sync-result.json、mobile-sync-result.json、final-source-parity.json、local-validation.json。

本機初次 npm 根相依安裝因沙箱 DNS 失敗、Hermes 暫存寫入因沙箱權限失敗，皆經正式逐次審核後成功重跑，未改 ACL／安全設定。全程無正式 DB、簽核、LINE 或天氣 API 請求。原生裝置、Adobe、紙本仍未驗證；業管末尾空白頁與隔離 Supabase 安裝維持暫緩。


### 2026-10-15 PR59 正式部署結案

使用者已授權寫入並部署。PR59 https://github.com/jnfakimo/Inspection/pull/59 於 2026-10-15 05:21:26 UTC 合併，正式 commit 73abe7935fdc355c45930dfb595d49cd00edc0f8；先前等待 CI／未部署描述以本節更新。僅五檔：行動端 lockfile、CI、三份交接文件；未整包提交 G 修改。

正式 CI 38686345907、CodeQL 38686345974、Commercial readiness 38686345926、Hardened Pages 38686345943 均 success。正式 provenance commit 與 Ed25519 簽章正確，三本交接頁及 JS/CSS 共 92 項資產 SHA-256 全通過；四項既有列印修正仍存在。證據在 mobile-deps-evidence-20261015/main-workflows.json、deployment/verification.json、local-validation.json 與 evidence-hashes.json。此為網站部署與來源驗證，非 Android/iOS 商店發布，也不代表原生設備、Adobe 或紙本已驗證。

GitHub Dependabot 已確認 compression、shell-quote、source-map-js 三項警示消除；剩餘 #15 braces、#14 node-forge 均 high，first_patched_version 為 null，列為後續追蹤，不宣稱全庫零漏洞。G/runtime 已讀回核對每處 16 份交接 manifest 來源及兩份本批修補檔一致。備份留在 checkpoint-backup、main-sync-backup、mobile-sync-backup、validation-doc-backup、release-doc-backup。

業管末尾空白頁、隔離 Supabase 安裝仍暫緩。本批無正式 DB、簽核、LINE、天氣 API 操作，沒有修改 ACL 或安全設定，未刪除 packed-refs.lock 與讀寫測試檔。其他未提交工作保留。


### 2026-10-15 全站共用視窗操作續作（本機完成，未發布）

依使用者「請繼續工作」，唯一 writer 沿用 antigravity-workflow，重讀 AGENTS.md、CLAUDE.md、ANTIGRAVITY.md、web/AGENTS.md 與原待辦；遠端 main 核對仍為 PR59／73abe7935fdc355c45930dfb595d49cd00edc0f8。原告警頁窄版溢出在最新來源 320/390/768/1280 × light/tech 已無法重現；車輛追蹤設備清單為局部可捲表格，整頁溢出 0，不重複修補。其餘追蹤模組及全站流程尚未逐頁重新驗收。

本批唯一程式修改 web/components/admin/shared.tsx 的 AdminModal。修正前真實元件測得開窗焦點仍為背景開啟按鈕，Escape 後視窗仍在。新增開窗聚焦、Tab/Shift+Tab 循環、阻止焦點落入背景、Escape 僅關閉最上層視窗、關閉還原開啟者焦點；保留既有 onClose 業務行為、巢狀視窗、已處理鍵盤事件及輸入法組字保護。元件卸載移除事件監聽，不變更視覺 CSS、權限或資料操作。

自動化／畫面證據：check-modal-before.py exit0 重現缺陷；check-modal-after.py exit0，實際 AdminModal ＋完整 build CSS，320/390/768/1280 × light/tech 共 8 組，每組 3 次取消／Escape／關閉、巢狀 Escape／返回、Tab 循環、強制背景焦點、重開輸入清空皆通過；整頁溢出 0，視窗位於可視區內。390px 雙主題截圖已目視檢查；視窗文字對比 14.63:1／16.41:1。Playwright 使用本機無頭 Edge，攔截全部請求並僅供應離線檔案，沒有正式登入或資料請求；這不是正式跨角色／各業務表單驗收。

命令結果：npm run typecheck:v2、test:page-headings、test:button-standard、security:audit、build:pages、git diff --check 均 exit0；安全設計稽核仍為 0 錯誤／2 既有警告。未宣稱本批完整 npm test 或 CI 已執行。源碼初次 CRLF 造成 diff whitespace 檢查失敗，僅本批檔改回 LF 後通過。

G/runtime 修改前與 main 正規化內容一致；先備份 source-backup，再逐檔同步並讀回 SHA，其他 dirty 工作保留。證據目錄 C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/ui-followup-20261015：modal-before.json、modal-after.json、modal-after-{width}-{theme}.png、source-sync.json、typecheck.log、headings.log、buttons.log、audit.log、build.log；執行腳本在 task-2/build-modal-followup.cjs、check-modal-before.py、check-modal-after.py。候選為 mobile-deps-20261015，僅 shared.tsx 有本批語意差異，仍未 stage／commit／push／PR／deploy。正式站維持 PR59。

未完成：正式登入後業務視窗、真實手機／平板觸控與螢幕閱讀器驗收；本機畫面不替代正式帳號流程。業管報表尾端空白頁、隔離 Supabase 安裝仍依使用者暫緩；braces/node-forge 無修補版只追蹤。沒有操作正式 DB、安全設定、LINE、額外天氣服務或地圖定位。既有未發布 modeler.css 修正保留。


### 2026-10-15 AdminModal PR60 部署結案

使用者引用本批成果後明確要求「部署」。僅 AdminModal、其必要來源 manifest 與三文件紀錄共五檔發布，下一批 Pager 重現及既有 modeler 修正均未混入。PR60 https://github.com/jnfakimo/Inspection/pull/60 ，最終候選 ece97722337619ae38d19d9392c5b8b27083ada9；2026-10-15 05:41:24 UTC 合併正式 commit 4d5b6693d61cc01c47b8f0ab79dd36c6a6f059ca。前節本批「未發布」狀態以此結案取代。

首次完整回歸與 CI 因 handover-release-manifest 仍指向舊 shared.tsx 雜湊而失敗；補齊精確 Git 位元組雜湊後，本機來源一致性、秘密掃描及最新 PR 全套 CI/CodeQL 通過。正式 main CI 38688140370、CodeQL 38688140486、Commercial readiness 38688140546、Hardened Pages 38688140477 全部 success。來源其餘既有 CRLF 位元組保留，避免整檔換行差異；只有本批程式區塊變動。G/runtime 最終 16 份 manifest 來源驗證通過，備份與讀回見 release-sync.json／release-sync-backup。

正式 provenance Ed25519 簽章與確切 commit 正確，92 項靜態資產 SHA-256 通過；已驗證 AdminModal 焦點處理碼存在，既有四項列印修正保留。證據 ui-followup-20261015/deployment/verification.json、release-summary.json、release-evidence-hashes.json。此為來源、離線操作及正式靜態發布證據，不等同正式登入後業務流程、實體裝置或螢幕閱讀器驗收。無正式 DB／LINE／天氣請求及安全設定變更。

下一批已離線重現 Pager 在 320px、1000 筆且第 50 頁時整頁溢出 62px（pager-before.json／pager-before.png），上下頁按鈕也只有符號名稱。尚未改該程式、未納入 PR60；可依既有續作授權本機修正，但未取得新一批發布授權。兩項暫緩維持不動。


### 2026-10-15 共用分頁長清單手機修正（本機完成，未發布）

接續原長資料／共用元件待辦；此批與已正式發布 AdminModal PR60 分開，基底為 4d5b6693d61cc01c47b8f0ab79dd36c6a6f059ca，本地分支 fix/pager-responsive-local-20261015，未 stage／commit／push／PR／deploy。

實際缺陷：共用 Pager 在 1000 筆、第 50 頁、320px 時整頁溢出 62px；上下頁按鈕只有符號名稱，選中頁沒有 aria-current。只在 admin-workspace.css 的按鈕列加入 flex-wrap:wrap，在 shared.tsx 的 Pager 補繁中導覽／按鈕名稱與目前頁標示；AdminModal 保持 PR60 內容，並同步其共用檔必要 manifest 雜湊。沒有另造頁面版型或變更配色、頁碼演算法。

實際元件＋新 build CSS 離線驗證：320/390/768/1280 × light/tech 共 8 組全通過，整頁溢出 62→0、所有頁碼按鈕可見。每組連續上下頁 3 次，跳首頁／末頁的停用狀態正確，Enter 返回上一頁及 aria-current 更新通過；最小按鈕文字對比 5.79:1（≥4.5）。320px 雙主題截圖已目視確認換行與目前頁辨識。全請求只供應本機檔案並封鎖外部網路，不是真實資料分頁或正式登入流程。

命令 exit0：npm run typecheck:v2、test:page-headings、test:button-standard、test:handover-source-parity、build:pages；check-pager-after.py 及 git diff --check 通過。未宣稱新批完整 npm test／CI 執行。初次重現腳本在結果已寫檔後因 cp950 輸出符號失敗，設定 PYTHONIOENCODING=utf-8 重跑 exit0；單一修改行 CRLF 經保留其餘來源位元組方式改 LF 後 diff 檢查通過。

G/runtime 修改前與候選基底相符，先備份再同步三檔、六個檔案項目並讀回，證據 pager-followup-20261015/source-sync.json、before/、sync-backup/。重現證據 ui-followup-20261015/pager-before.json、pager-before.png；修後證據 pager-followup-20261015/pager-after.json、pager-after-{width}-{theme}.png、browser-test.log、typecheck.log、headings.log、buttons.log、parity.log、build.log。腳本 task-2/build-pager-followup.cjs、check-pager-before.py、check-pager-after.py。

真正剩餘：正式帳號跨頁載入與權限流程需要可用的授權測試帳號／隔離資料範圍；真機觸控、螢幕閱讀器需對應設備。公開 board／404 與其他長資料錯誤狀態尚可另批離線驗證，未冒稱全部受阻或全面通過。業管尾端空白頁與隔離 Supabase 安裝仍暫緩；無正式 DB／LINE／天氣／安全設定或地圖定位操作。本批不得沿用 PR60 授權自動發布。


### 2026-10-15 收尾待辦核對（狀態分類，未新增程式或發布）

依原計畫與後續結案紀錄核對，不以歷史「未完成」段落覆蓋較新的完成證據。正式最新已驗證為 PR60／4d5b6693d61cc01c47b8f0ab79dd36c6a6f059ca；PR59 相依修補、PR60 AdminModal 已發布。PR50 已處理告警／追蹤／TV 窄版及派車縮放，早期 135px／578px／55px／.85 zoom 待辦不能再次當現況；全站完整正式互動仍未完成。

| 分類 | 實際剩餘 | 下一步／最小必要條件 |
| --- | --- | --- |
| 可在現有授權離線完成 | 公開 board 的空資料、失敗／恢復、長公告；建置 404；其他表單長文字、錯誤回復及重複操作 | 使用實際元件與 build CSS、明確合成資料、封鎖所有外部請求，逐批重現後才修；不需要正式帳號或新服務。此次只核對入口與現有證據，沒有宣稱已驗過這些狀態。 |
| 已驗證、待發布授權 | Pager 手機 62px→0、語意標示；既有 modeler 2px 邊界修正 | 各批保留現有證據；發布前選擇性整合最新 main 與回歸檢查，不能沿用 PR60 授權。 |
| 需要登入與測試範圍 | 正式帳號登入、跨角色讀取、實際資料分頁、簽核／取消等業務整合 | 明確授權的測試帳號／角色與可用資料範圍；涉及寫入須指定隔離環境，不能用正式資料替代。現有合成 AuthGate/API 不構成此層驗收。 |
| 需要對應設備 | 真機手機／平板觸控、螢幕閱讀器、Adobe Distiller 原生列印與紙本 | 可存取的設備及使用者登入／必要操作；目前 Edge headless、Hermes bundle、Skia PDF 都不能替代。先保留現有證據，不要求重做已通過測試。 |
| 使用者明確暫緩 | 業管報表尾端空白頁；建立隔離 Supabase | 維持停止，只有使用者日後明確恢復才執行，不再請求批准或安裝。 |
| 上游尚無修補版本 | braces、node-forge 兩項既有高風險警示 | 以 PR59 結案時已核實的無修補版狀態追蹤；日後有正式修補與相容性證據再定向更新。此次未另查服務、未盲升級、未解除警示。 |
| 其他專案驗收／決策範圍 | S2/S3 復原演練、RPO/RTO/SLO；地端切換與 Firebase 保護範圍等原待辦 | 需要指定隔離目標、演練／切換授權及責任人決策；不是這次 UI 收尾可自動執行的項目，不宣稱完成。 |

本次沒有新增已證實缺陷，因此沒有為湊工作修改程式；可離線驗證項仍存在，不宣稱全部被外部條件阻擋。原始來源檢查確認未發布 Pager 三檔在 G/runtime 共 6/6 雜湊與前次 source-sync.json 一致；候選仍僅三檔語意差異（shared.tsx、admin-workspace.css、必要 manifest），git diff --check exit0。保留其他 G 修改、既有 modeler 修正、舊備份與 packed-refs.lock。

下一安全批次建議先做公開 board 的離線空資料／錯誤回復與 404 檢查，再依實測結果決定是否修正；不擴成新產品需求或正式服務測試。正式帳號、實機與暫緩項目各自保持原門檻。無新 commit／push／PR／deploy、無正式 DB／LINE／天氣／安全設定操作。
