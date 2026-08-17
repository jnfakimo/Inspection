# 北農巡檢系統 V2 架構與遷移說明

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
