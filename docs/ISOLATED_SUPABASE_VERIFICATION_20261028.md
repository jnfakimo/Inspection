# 隔離 Supabase 與登入操作驗證（2026-10-28）

## 結果與範圍

本機隔離環境已建立；報修、派車、公文三套既有跨角色 E2E 通過。
瀏覽器以 8 位數字密碼及實際驗證碼登入，完成會議室與預約新增、業管交接新增／完成、機電工作新增／報表預覽、個人資料儲存、登出及未登入導回登入頁。
正式資料庫、正式帳號、正式密碼政策均未變更；未 commit、push 或部署。
此紀錄是測試證據，不是 ISO/IEC 27001 認證或全系統零漏洞證明。

## 環境與隔離

- 專用目錄：`C:\projects\Inspection-supabase-e2e-20261028`。
- 專用 WSL：`Inspection-test`（Ubuntu 24.04），磁碟位於 `C:\AI\tools\Inspection-test-wsl`。
- Supabase CLI：2.122.0，官方發布檔 SHA-256 已比對；Docker 29.1.3。
- 前端：`http://127.0.0.1:8769/Inspection/v2/login/`，由 `C:\projects\Inspection-audit-20261028\web\out` 提供。
- Supabase API／DB／本機信箱分別綁定 `127.0.0.1:55321`／`55322`／`55324`。沒有綁定區域網路介面。
- 每個容器／網路／資料卷均屬 `Inspection-supabase-e2e-20261028`；未使用正式專案連線或 production dump。
- 從原始碼建立資料結構及 repository 既有參照／歷史行情種子；操作資料與人員為合成測試資料。
- `.local` 憑證目錄限制目前 Windows 使用者與 SYSTEM，已排除版本控制。報告與測試輸出不含密碼、session 或 service-role key。
- 前端 CSP 限制 API 連線為本機；測試腳本核對本機 URL，三套 E2E 的 fetch 額外拒絕非本機目的地。
- 專用 Docker 子網以 `DOCKER-USER` 阻擋新建對外連線，實測對外 TCP 被拒絕；本機 API 仍可運作。
- pg_cron `cron.launch_active_jobs=off`。未配置正式 LINE、Google OAuth、外部 SMTP 等憑證。
- 密碼政策保持應用既有 8 位數字；未啟用額外複雜度要求，未更改正式帳號密碼。

## 通過的驗證

| 項目 | 實際結果 | 證據（隔離目錄下） |
|---|---|---|
| 7 種保留測試帳號 | 管理員、課長、一般人員、技師、經理、派車管理員、駕駛；數字密碼登入及 profile 身分一致 | `evidence/test-accounts.json` |
| 報修完整生命週期 | 建立報修 → 派工 → 接單 → 維修 → 完工 → 報修人驗收 → 主管結案；提前結案被拒絕，6 筆歷程 | `evidence/e2e-repair.log` |
| 派車兩階段核准 | 帳號申請核准、課長、部門經理、派車、駕駛接單；越權核准 403、經理核准前不能派車，4 筆歷程 | `evidence/e2e-vehicle-dispatch.log` |
| 公文跨角色 | 31 項：會辦、陳核、核決、結案、退回重送、身分／順序限制、冪等、事件不可刪除及竄改 | `evidence/e2e-official-document.log` |
| 共用模組資料讀取 | 44 個 `module_data` 對應項目全數登入讀取 HTTP 200 | `evidence/module-api-reads.json` |
| 瀏覽器導覽 | 13 個系統入口、68 個實際可見子頁連結完成登入畫面載入；這是載入檢查，不代表每頁全部功能都完成交易測試 | `evidence/ui-pages.json`、`ui-modules.json` |
| 會議室與預約 | UI 新增會議室與預約，API 查回；重複時段、取消他人預約、提前報到被阻擋；兩週週期建立及本人取消成功 | `evidence/ui-meeting-created.png`、`auth-meeting-checks.json` |
| 業管交接 | 新增後續帶晚班，標記完成後鎖定內容且停止續帶 | `evidence/ui-business-completed.txt`、`.png` |
| 機電交接 | 配置合成機電課／一市技師後新增已完成工作；報表呈現人員、內容、結果與費用；未完成雙方交接時課長簽核停用 | `evidence/ui-mechanical-preview.txt`、`.png` |
| 登入與權限 | 匿名 profile 401；一般人員後台設定及維護會議室 403；缺驗證碼 400；錯誤密碼拒絕；session refresh 正常 | `evidence/auth-meeting-checks.json` |
| 個人資料與登出 | 合成聯絡資料儲存、規則仍顯示 8 位數字；登出後直接開管理頁導回登入 | `evidence/ui-profile.txt`、`ui-logout-guard.txt` |
| 臨時帳號清理 | 25 個一次性 Auth 帳號停用，保留 7 個專用帳號；不刪歷程 | `evidence/temporary-account-cleanup.json` |
| 本機前端建置 | 使用本機 URL／anon key 完成 Next production static export | `evidence/frontend-build.log` |
| 停止／重啟與持久資料 | 完整停止再啟動成功；首次就緒檢查含登入、profile、匿名拒絕與前端，11 項驗證再次通過；7 帳號、UI 預約及機電紀錄保留 | `evidence/restart-verification.log`、`final-db-verification.txt` |
| 最後隔離核對 | cron 關閉、一次性啟用帳號為 0；users／repair_requests／meeting_bookings／official_documents 的 RLS 與 FORCE RLS 皆啟用 | `evidence/final-db-verification.txt`、`container-bindings.txt`、`egress-policy.txt` |

## 測試發現與修正

1. **報修狀態約束重建退化**：`20260820100000_audit_scan_fixes.sql` 把狀態縮為四種，新建環境派工會失敗。新增 `20261028160000_restore_repair_workflow_statuses.sql` 恢復現行 14 種狀態，只修 CHECK，不放寬 RLS、不移除 trigger。已套用隔離環境，正式環境未套用。
   `node tools/repair-status-migration.test.mjs` 已驗證故障重現、有效狀態、無效值拒絕、RLS 不變及重跑安全，並加入 `npm test`。
2. **派車 E2E 舊規則**：原測試只接受舊錯誤文字，且把課長核准視為最終核准。已補部門經理角色、pending_manager_approval、第二階核准、提前派車拒絕及相應歷程；越權斷言改核對 HTTP 403，避免錯誤文字導致誤判。
3. **空白資料庫建置順序**：舊 SQL／migration 有前置函式、設定表及永久資料保護等依賴；以 `scripts/schema-order.json` 與 `bootstrap-foundation.sql` 明列順序。資料庫以 psql 逐檔執行，不能宣稱是單獨 `supabase db reset` 即可重建。
4. **正式資料修正不適用空白測試庫**：僅略過 `20260913203000_market_point_revision_water_spinach_20260913.sql`，其要求既有正式行情紀錄，不改結構。排除理由在 `evidence/schema-exclusions.json`。
5. **啟動可靠性**：本機綁定重建容器後要保留 Kong 設定與檔案擁有者，並刷新依賴服務連線池；status 採就緒等待與原子寫入，避免第一次登入舊連線錯誤或空白憑證檔。

## 使用與保存

在隔離目錄執行 `Start-IsolatedTest.ps1` 或 `Stop-IsolatedTest.ps1`。停止會保留資料卷；腳本只針對專用 WSL／容器及 8769 測試前端。
帳號與密碼在受限的 `.local/test-accounts.json`；不要複製至 repo、聊天或報告。入口帳號為 `isolated_admin`，其餘帳號以 `isolated_` 開頭。
三套既有流程可用 `node scripts/run-flow.cjs repair`、`vehicle-dispatch`、`official-document` 執行；會新增合成歷程。
停止／重啟及持久資料核對見 `evidence/restart-verification.log`。

## 仍未驗證與限制

- 未連正式 IIS、正式 Supabase、正式 LINE／Google／簡訊／外部郵件；通知送達與 Google 同步不算通過。天氣服務缺金鑰回 503 是隔離設定限制。
- 未以實體手機驗證 GPS、BLE、QR/NFC、背景定位及離線同步；未接真實監控設備。
- 未匯入正式私人圖資；缺圖資的頁面顯示「尚未設定」，不算 3D 模型功能驗收。
- 水果組文件多階簽核、三班雙方交接後的日結簽核已於同日續驗通過，詳見 `HANDOVER_CLOSEOUT_VERIFICATION_20261028.md`；每頁所有編輯／匯入分支仍未逐一完成 E2E。
- 報表僅畫面預覽；實體 A4 分頁、印表機結果與手機版逐頁視覺驗收未做。
- 沒有進行壓力、災難復原演練或宣稱正式資安風險全數關閉。前輪低風險相依項目與正式維運證據仍依風險登錄追蹤。
