# 北農巡檢系統 V2 架構與遷移說明

## 介面設計規格：列表與分頁（2026-08-18）

所有會呈現資料列的 V2 清單，後續新增功能均須遵循以下共用規格：

1. 每頁固定顯示 **10 筆**，使用共用 `PAGE_SIZE = 10` 與 `Pager`；查詢、篩選或重新載入後，若目前頁碼超出範圍，須回到最後有效頁。
2. 列表資料列採交錯底色：奇數列白色，偶數列使用淺藍色（80% 淡化，主題變數 `--list-row-even`）；滑鼠移入使用同一淺藍色加深提示。
3. 表頭、欄位間距、操作欄與手機版橫向捲動沿用共用表格樣式，不在單一子系統重新定義另一套列色。
4. 狀態標籤仍保留語意色（成功／處理中／警示／取消），不得以列表底色取代狀態辨識。

共用色彩變數與交錯列規則位於 `web/app/globals.css`、`web/app/v1-layout.css`、`web/app/admin-workspace.css`；這些規則會套用至 `responsive-table`、`admin-panel` 與 `operations-table`。

### 日期與時間輸入規格

8 大系統、48 個子系統的日期與時間欄位統一遵循以下規格：

1. 日期欄位的空值提示與輔助文字使用 **「年／月／日」**，不得顯示 `YYYY/月/dd`、`yyyy/mm/dd` 等程式格式；資料值仍以 `YYYY-MM-DD` 儲存與傳遞。
2. 日期欄位須提供日曆選擇器（原生 date picker 或等效元件），不可要求使用者手動輸入資料庫格式。
3. 時間欄位採 **上午／下午、時、分** 三段式選單；分鐘只提供 `00` 與 `30`，即每 30 分鐘一格。若暫時使用原生時間元件，必須設定 `step="1800"`，後續改版仍須轉為三段式選單。
4. 日期時間欄位也必須遵守上述日期提示與 30 分鐘時間間隔；送出前在前端驗證，後端再以台北時區及業務規則驗證。
5. 新增系統或子系統時，先搜尋既有日期／時間元件與本節規格，不得自行建立另一種格式。

### 系統盤點

目前 `web/lib/modules.ts` 正式盤點為 **8 大系統、48 個子系統**。後續新增或調整模組時，須同步更新本表與模組定義，確保系統導航、權限與文件盤點一致：

| 系統 | 子系統（數量） |
| --- | --- |
| SYS-01 後台管理 | 人員帳號、角色權限、場域位置、操作稽核、資安告警、通知中心、戰情版面、巡檢週期、費用統計、位置分析、系統健康（11） |
| SYS-02 維修／派工／完工 | 報修案件、派工作業、維修工單、維修附件、維修分析（5） |
| SYS-03 駐衛警巡檢 | 巡邏打卡、巡邏點清單、巡檢排班、逾時推播、設備巡檢、立體巡檢雲臺（6） |
| SYS-04 電子交接簿 | 交接紀錄、未結事項、設備概況（3） |
| SYS-05 設備建置 | 設備主檔、保養排程、維修履歷、維護合約、設備文件、年度成本、中央監控、材料主檔（8） |
| SYS-06 專案關係與設備圖臺 | 區域位置表、整合標記、平面樓層圖、立體樓層模型、模型管理、專案關係圖（6） |
| SYS-07 公務車派車管理 | 派車申請、公務車輛、駕駛人員、派車管理員、派車紀錄（5） |
| SYS-08 會議室預約 | 會議預約、變更申請、預約提醒、會議室主檔（4） |

已確認的交接紀錄與派工作業均使用每頁 10 筆；其餘既有資料列表新增或改版時，必須依本節規格補齊分頁與交錯列色。

### 後台按鈕尺寸規格

後台所有「主要操作」按鈕（新增、儲存、送出、確認）統一使用淺藍色樣式，並固定以下尺寸，避免不同子系統各自縮放：

- 最小高度 **40px**、水平內距 **16px**、圓角 **8px**。
- 字級 **0.85rem**、行高 **1.2**；文字過長時允許按鈕依內容變寬，不壓縮文字。
- 次要、危險與狀態按鈕不套用主要操作色，但仍應沿用相同最小高度與圓角基準。
- 桌面與手機版維持相同觸控高度；窄版只調整容器排列，不任意縮小按鈕。

共用實作位於 `web/app/admin-workspace.css`；設定頁的 CSS Module 需同步遵循同一數值。新增後台系統或子系統時，先套用 `primary-btn`／`primaryButton`，不得建立另一組主要按鈕尺寸。

## 技術規格基準

本專案的技術選型基準（2026-08-16 確認）：

| 層 | 基準 | 說明 |
| --- | --- | --- |
| 前端 | React / Next.js | — |
| 後端 | FastAPI（Python）或 Node.js | 負責權限、流程、API、通知、資料分析 |
| 資料庫 | PostgreSQL | 若希望部署簡單，可直接使用 Supabase |

### 後端 runtime 選型決策（2026-08-16）

基準的資料庫欄註明「若希望部署簡單，可直接使用 Supabase」，本專案已採此路線，因此後端 runtime
選用 **Supabase Edge Function（Deno / TypeScript）**，而非另行架設 FastAPI 或 Node.js 服務。
規格要求後端承擔的職責均已落實：

| 職責 | 實作位置 |
| --- | --- |
| 權限 | `app-api` / `admin-api` 驗證 JWT、`users` 啟用狀態與 `role_permissions`，再疊加資料庫 RLS |
| 流程 | `app-api` 各 action，以及 PostgreSQL SECURITY DEFINER 函式（如 `create_meeting_booking_series`、`complete_repair_order`） |
| API | `supabase/functions/` 共 11 支函式，`app-api`、`admin-api` 為業務主體 |
| 通知 | `line-notify`、`patrol-timeout-check`、`meeting-booking-check`、FCM 推播 |
| 資料分析 | `app-api` 的 `dashboard` action 聚合 30 日巡檢、異常率、設備與未結維修 |

選擇 Edge Function 而非自架服務的理由：與資料庫同專案、延遲低；JWT 由 Supabase 閘道層先驗；
零維運且無額外主機費用；本站前端託管於 GitHub Pages，本身無法執行後端程式。

**何時應重新評估**：需要脫離 Supabase 以避免供應商鎖定時；或分析需求成長到必須使用 Deno 生態
無法滿足的 Python 套件時。屆時 `app-api` / `admin-api` 的業務邏輯即為搬遷起點。

**2026-08-17 再次確認**：對照規格基準重新評估後，維持 Edge Function，不另建 FastAPI／Node.js
服務。主因是本站前端託管於 GitHub Pages，自建後端需另尋主機並重做一套 JWT 驗證層，
而規格要求後端承擔的五項職責目前皆已有對應實作。

**已清理（2026-08-17）**：正式專案原有 4 支已部署但原始碼不在本 repo 的函式
（`hyper-worker`、`smart-function`、`bright-function`、`dynamic-processor`），皆停在 v12、
最後更新 2026-06-24、程式碼與資料庫零呼叫，現已全數移除。原始碼留底於
`docs/removed-edge-functions/`（刻意不放 `supabase/functions/`，避免 `functions deploy`
不帶參數時被重新部署）。

其中 `smart-function` 與 `bright-function` 並非無害範本，而是已被 `line-notify` 取代的
舊版 LINE 推播：以 service role 繞過 RLS 讀取 `line_channel_token`（該鍵本被
`settings_active_read` 政策排除、一般使用者讀不到），並依請求內容組訊息推播至公司
LINE 群組，`verify_jwt` 為 true——任一持有有效 JWT 的使用者皆可藉此把自訂內容推播到
官方群組。移除後此路徑一併關閉。

目前線上 11 支函式與 `supabase/functions/` 目錄一一對應，正式環境無未納管的程式碼。

## 規格符合度

| 項目 | 原系統 | V2 處理方式 |
| --- | --- | --- |
| React / Next.js | 不符合，為多頁靜態 HTML | Next.js App Router + React + TypeScript，靜態匯出至 `/Inspection/v2/` |
| 後端 API | 部分符合，既有 Supabase Edge Functions，但多數頁面直連資料表 | 新增 JWT/RBAC 保護的 `app-api`，新版頁面經 API 或 SECURITY DEFINER 函式執行業務操作（見「遷移原則」第 3 條的實際落差） |
| PostgreSQL / Supabase | 符合 | 沿用現有 PostgreSQL、RLS、Auth、Realtime、Storage |
| 角色權限 | 符合 | API 再驗證 `users`、`rbac_role`、`role_permissions`，形成 API + RLS 雙層防線 |
| 檔案獨立儲存 | 符合 | 沿用 `repair-files`、`floorplans`、`handover-attachments`、`vehicle-dispatch-files` Storage buckets |
| 即時與 FCM | 符合 | 沿用 Realtime publication、FCM subscription 與通知 Edge Functions |
| 分析層 | 部分符合 | V2 Dashboard 在 API 聚合 30 日巡檢、異常率、設備與未結維修；後續可導入 materialized view |

## 部署拓撲

```text
Browser / Mobile
  └─ GitHub Pages /Inspection/v2 (Next.js static export)
       ├─ Supabase Auth / username-login
       ├─ Supabase Edge Function / app-api
       │    ├─ JWT / active user / RBAC validation
       │    └─ user-scoped Supabase client → PostgreSQL RLS
       ├─ Supabase Realtime
       ├─ Supabase Storage
       └─ Firebase FCM
```

### 基底路徑與 repo 更名

repo 原名 `word-cloud`，現為 `jnfakimo/Inspection`，站台基底隨之由 `/word-cloud/` 變成
`/Inspection/`。V2 的 basePath 定義在 `web/next.config.ts`（`/Inspection/v2`），
`web/lib/config.ts` 的 `LEGACY_BASE` 為 `/Inspection/system`。

V1 頁面中仍留有少量寫死的 `https://jnfakimo.github.io/word-cloud/system/...` 絕對網址
（如 `analytics.html` 的導覽連結、`AGENTS.md` 的 Base URL 說明）。GitHub 對更名後的 repo
會自動重導，因此這些連結仍可運作，屬已知的文件與連結落差，V1 不主動改動。

## 遷移原則

1. 舊 `/system/` 保持運作，V2 與它共用資料，不複製正式資料。
2. 優先遷移 Dashboard、巡檢、設備圖臺與手機入口。
3. 涉及異動的新版功能必須經 `app-api`；RLS 仍是最後一道資料庫防線。
4. 完成逐頁驗收後，再把入口由 `/system/index.html` 切換到 `/Inspection/v2/`。
5. 高精度 OpenSeadragon / Three.js 圖臺暫時由 V2 深連結既有頁面，第二階段再封裝成 React 元件。

### 第 3 條的實際落差（2026-08-17 盤點）

目前 V2 有兩類寫入沒有經過 `app-api`：

- **直接寫資料表**：`workspace.tsx`（報修建立與附件）、`operations-workspace.tsx`（交接紀錄）、
  `guardpatrol-specialized.tsx`（班別）、`handover-pilot/page.tsx`、`components/admin/NoticesAdmin.tsx`。
  這幾處只靠 RLS 一層把關，與「API ＋ RLS 雙層防線」的敘述不符，應逐步收斂回 API。
- **前端直呼 SECURITY DEFINER 函式**：`apply_repair_workflow`、`save_dashboard_layout_version`、
  `publish_dashboard_layout_version`、`vehicle_request_action`、`complete_vehicle_trip`。
  這類函式內含權限與流程檢查（guard trigger 亦照常觸發），風險低於直接寫表，屬刻意取捨：
  業務規則集中在資料庫端，改走 API 只會多一層轉發而不會提高安全性。

判斷準則：**能被單一使用者濫用的寫入必須有伺服器端檢查**——不論那層檢查在 Edge Function
還是在 SECURITY DEFINER 函式裡；純粹的 `insert`／`update` 直連則不符合。
