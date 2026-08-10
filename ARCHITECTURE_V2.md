# 北農巡檢系統 V2 架構與遷移說明

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
