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

**待清理**：正式專案另有 4 支已部署但原始碼不在本 repo 的函式（`hyper-worker`、`smart-function`、
`bright-function`、`dynamic-processor`），研判為早期於儀表板試建後遺留的範本，尚未確認並移除。

## 規格符合度

| 項目 | 原系統 | V2 處理方式 |
| --- | --- | --- |
| React / Next.js | 不符合，為多頁靜態 HTML | Next.js App Router + React + TypeScript，靜態匯出至 `/v2/` |
| 後端 API | 部分符合，既有 Supabase Edge Functions，但多數頁面直連資料表 | 新增 JWT/RBAC 保護的 `app-api`，新版頁面統一經 API 執行業務操作 |
| PostgreSQL / Supabase | 符合 | 沿用現有 PostgreSQL、RLS、Auth、Realtime、Storage |
| 角色權限 | 符合 | API 再驗證 `users`、`rbac_role`、`role_permissions`，形成 API + RLS 雙層防線 |
| 檔案獨立儲存 | 符合 | 沿用 `repair-files`、`floorplans`、`handover-attachments`、`vehicle-dispatch-files` Storage buckets |
| 即時與 FCM | 符合 | 沿用 Realtime publication、FCM subscription 與通知 Edge Functions |
| 分析層 | 部分符合 | V2 Dashboard 在 API 聚合 30 日巡檢、異常率、設備與未結維修；後續可導入 materialized view |

## 部署拓撲

```text
Browser / Mobile
  └─ GitHub Pages /word-cloud/v2 (Next.js static export)
       ├─ Supabase Auth / username-login
       ├─ Supabase Edge Function / app-api
       │    ├─ JWT / active user / RBAC validation
       │    └─ user-scoped Supabase client → PostgreSQL RLS
       ├─ Supabase Realtime
       ├─ Supabase Storage
       └─ Firebase FCM
```

## 遷移原則

1. 舊 `/system/` 保持運作，V2 與它共用資料，不複製正式資料。
2. 優先遷移 Dashboard、巡檢、設備圖臺與手機入口。
3. 涉及異動的新版功能必須經 `app-api`；RLS 仍是最後一道資料庫防線。
4. 完成逐頁驗收後，再把入口由 `/system/index.html` 切換到 `/v2/`。
5. 高精度 OpenSeadragon / Three.js 圖臺暫時由 V2 深連結既有頁面，第二階段再封裝成 React 元件。
