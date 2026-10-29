# GitHub Pages 安全發布紀錄（2026-10-29）

基底為 GitHub `main` 的 `bd66db1fd0468da5f5bb4bfd85a790c2f3b4c81d`，其中包含 Claude 已合併的 hooks、32px 工具列、交接樣式、資安 migration 與交接紀錄。此發布只加入不依賴正式資料庫結構或 Edge Functions 更新的前端防護：

- V1、V2 巡檢跨分頁會話只在永久儲存保留身分與期限，並移除舊的永久 bearer token；恢復時向仍登入的同來源分頁索取短暫憑證，失效時拒絕恢復。
- 水果、業管、機電交接報表須待所選市場與日期載入完成才可預覽或列印，避免顯示上一筆資料。
- 更新交接報表發行清單中的實際原始檔雜湊，不修改或放寬一致性驗證。

正式 Supabase migration、Edge Functions、密碼政策與正式資料均不在這次發布變更內。涉及主管簽核資料結構與 API 的完整整合版保存在 `codex/inspection-security-handover-20261028`；其正式部署需要另行處理資料庫與後端相容性。驗證以本提交的 CI、CodeQL、Hardened Pages 工作流程及部署後網站掃描為準。

本機隔離驗證已通過：`npm ci`、`npm test`、`npm run typecheck:v2`、`npm run build:pages`，以及 16 個交接報表來源檔案的雜湊一致性檢查。
