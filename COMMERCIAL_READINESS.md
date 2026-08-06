# 商業化準備度稽核報告

稽核日期：2026-08-06
範圍：`system/` 靜態前端、Supabase Edge Functions、資料庫權限、GitHub Actions

## 已完成的程式與正式環境修正

1. 修正自動稽核器把 `data-*-id` 認成重複 DOM `id` 的誤判；私鑰規則也改為只比對完整 PEM 內容。
2. 移除登入、後台與交接登入頁面對 `api.ipify.org` 的呼叫，避免將使用者 IP 傳給未納管的第三方服務。
3. 巡檢逾時與會議室排程函式新增 `CRON_SECRET` 驗證；一般匿名 JWT 不再能執行排程。
4. LINE 通知函式新增 LINE HMAC 簽章、管理員身分與內部 webhook secret 驗證，並由資料庫重新讀取通知紀錄，避免偽造通知內容。
5. 會議室資料新增強制 RLS 與最小權限 migration，移除匿名讀取及 sequence 權限。
6. 新增 GitHub Actions 商業化靜態稽核，後續 push/PR 會自動掃描 37 個 HTML 頁面。
7. 正式庫全面撤銷 `anon` 資料表權限，核心業務表改為強制 RLS 與角色／本人範圍政策；匿名讀取 `checkin_logs`、`users`、`repair_requests` 均回 HTTP 401。
8. `repair-files`、`handover-attachments`、`vehicle-dispatch-files` 改為私有 bucket；前端一律使用一小時簽章網址，失敗上傳會清理孤兒檔案。
9. `ipcam-proxy` 已要求登入與後台權限；`line-notify` 會重新讀取正式紀錄並驗證建立者／管理者，兩者匿名呼叫均回 HTTP 401。
10. 完工回報改用資料庫交易 RPC，工單、報修狀態、附件 metadata、成本及稽核歷程會一起成功或一起回復。
11. 修補後台儲存型 XSS、公開初始化頁、UTC 截日、快取身分越權、缺失圖示路徑、重複樓層正規化、重複送出與即時訂閱重入。
12. Supabase JS 改用專案內固定版本；其餘外部 JS/CSS 皆鎖定版本並加 SRI，37 頁加入 CSP。
13. 共用日期格式固定 Asia/Taipei `YYYY-MM-DD HH:mm`，並補上全站鍵盤焦點、欄位標籤與對話框焦點循環。
14. 新增常用查詢索引、月份聚合 RPC，縮小大量報表查詢並對派車即時更新做 debounce／single-flight。
15. 錯誤門檻通知補上 `CRON_SECRET`／管理員驗證，停用舊匿名資料庫排程，改由具 secret 的 GitHub Actions 觸發。
16. 正式庫建立第一方 `client_error_logs`，僅允許登入者寫入本人錯誤、管理員讀取，不將瀏覽資料傳給第三方監控商。
17. Auth refresh token 與使用者快取改存 `sessionStorage`，關閉分頁即清除；資料庫角色預設與前端權限矩陣一致，且個別使用者明示拒絕仍優先。
18. 設備主檔寫入改用獨立 `sys_equipment_manage`；派工、主管結案／簽核、本人報修與受指派技師分別以 RLS 及欄位保護 trigger 限制，阻擋跨案件修改。
19. `floorplans` 保留公開唯讀以支援 2D／3D 圖臺，新增與覆寫只允許設備管理角色，且不提供刪除 policy；未刪除任何 `system/plans` 正式圖資。
20. 巡檢／會議通知投遞紀錄改為 Edge Function 專用寫入、僅管理員讀取；FCM token 表強制 RLS 且只能操作本人裝置。
21. 帳號登入改由 `username-login` Edge Function 內部解析 Email，停用匿名 `login_lookup_email`，避免公開列舉帳號與 Email；錯誤訊息一律不區分帳號或密碼。

## 驗證結果

- 商業化靜態稽核（含 CSP、SRI、私有附件、UTC 日期與 CSS 資源路徑）：0 errors、0 warnings。
- 七支 Edge Functions：Deno TypeScript 檢查通過。
- 正式站首頁：可正確導向登入頁，瀏覽器主控台無錯誤或警告。
- 已部署的巡檢、會議室排程、攝影機與 LINE 函式：未授權呼叫均回傳 HTTP 401。
- 遠端 4 筆舊 migration 已逐項核對實際資料庫物件後補登，local/remote migration 歷史一致。
- `20260806003000` 至 `20260806032000` 的本次商業化 migrations 均已套用正式庫，遠端 migration history 已同步。

## 非程式碼營運控制（需由系統所有人／供應商持續執行）

- 若要讓 LINE 官方帳號 webhook 自動登錄群組，須由 LINE Developers Console 取得 `LINE_CHANNEL_SECRET` 後設定至 Supabase Secret；未設定時 webhook 會安全拒絕，不影響既有群組的外送通知。
- 在 Supabase 控制台啟用符合採購方案的 MFA、洩漏密碼防護、備份／PITR，並至少每季演練還原與權限複核。
- 建立 staging 測試帳號與角色矩陣，執行報修、派工、完工、交接、派車、會議室的端到端驗收。
- 訂定稽核紀錄保存、個資告知、事故通報、離職停權與附件保存期限；這些屬治理流程，不能只靠前端程式代替。
- 正式攝影機影像應使用固定 HTTPS gateway；目前前端串流維持停用，代理端即使被呼叫也要求後台授權。

## 結論

本次辨識的 P0–P3 程式與資料庫項目已修補並套用正式環境；剩餘事項為需要公司制度、付費方案或第三方控制台資料的營運控制，應納入正式上線核准表持續追蹤。
