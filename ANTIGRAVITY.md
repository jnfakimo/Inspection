# ANTIGRAVITY Project Record

## 2026-08-06 完工

- **新增 CI 工作流程**: `.github/workflows/ci.yml`，包含 HTML、CSS、JS Lint、HTML validation、破損連結檢查、依賴新鮮度與 SRI 檢查，排程每週執行。
- **新增 CodeQL 安全分析**: `.github/workflows/codeql.yml`，自動於 push、pull‑request 以及每週執行 JavaScript 安全掃描。
- **完成 Subresource Integrity (SRI) 檢查**: 所有外部 CDN 載入腳本均已加入 `integrity` 與 `crossorigin`，未留下缺失。
- **簽署 URL 改進**: 在 `b1plan.html`、`b1_integrated_marker_system.html`、`floor3d.html`、`guardpatrol3d.html` 中統一使用 Supabase signed URL（有效期 1 hour），確保資源安全存取。
- **分頁 UI**: `admin.html` 中 `cost_records` 表格加入每頁 10 筆的分頁介面，完成資料瀏覽需求。
- **部署**: 已將最新 commit 推送至 `origin/main`，GitHub Pages 自動部署至 `https://jnfakimo.github.io/word-cloud/`（約 1‑2 分鐘後可見更新）。
- **其他微調**: 更新 `theme.js` 中的 debounce 處理、統一品牌條、修正權限 guard、整理 XLSX 匯入程式碼。

此檔案即為本次收工的專案紀錄，供日後追蹤與交接使用。
