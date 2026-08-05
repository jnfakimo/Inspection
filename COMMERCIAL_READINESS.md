# 商業化準備度稽核報告

稽核日期：2026-08-06
範圍：`system/` 靜態前端、Supabase Edge Functions、資料庫權限、GitHub Actions

## 本次已修正

1. 修正自動稽核器把 `data-*-id` 認成重複 DOM `id` 的誤判；私鑰規則也改為只比對完整 PEM 內容。
2. 移除登入、後台與交接登入頁面對 `api.ipify.org` 的呼叫，避免將使用者 IP 傳給未納管的第三方服務。
3. 巡檢逾時與會議室排程函式新增 `CRON_SECRET` 驗證；一般匿名 JWT 不再能執行排程。
4. LINE 通知函式新增 LINE HMAC 簽章、管理員身分與內部 webhook secret 驗證，並由資料庫重新讀取通知紀錄，避免偽造通知內容。
5. 會議室資料新增強制 RLS 與最小權限 migration，移除匿名讀取及 sequence 權限。
6. 新增 GitHub Actions 商業化靜態稽核，後續 push/PR 會自動掃描 37 個 HTML 頁面。

## 驗證結果

- 商業化靜態稽核：0 errors、0 warnings。
- 三支 Edge Functions：Deno TypeScript 檢查通過。
- 正式站首頁：可正確導向登入頁，瀏覽器主控台無錯誤或警告。
- 已部署的巡檢與會議室排程函式：匿名呼叫均回傳 HTTP 401。

## 上線前仍需完成

### P0：阻擋商業上線

- 正式資料庫目前曾驗證到匿名使用者可讀取 `meeting_bookings`（共 4 筆）。本次 RLS migration 已完成，但因遠端 migration 歷史缺少四筆舊版紀錄，不能安全地用 `db push --include-all`；須先核對舊 migration 是否曾人工執行，再只套用 `20260806003000_commercial_security_hardening.sql`。
- LINE Developers Console 尚需設定 `LINE_CHANNEL_SECRET` 至 Supabase Secrets，之後才部署新版 `line-notify`，否則 LINE webhook 簽章無法驗證。

### P1：正式營運必要

- 將 LINE Channel Access Token 從可被前端管理頁讀取的 `system_settings` 移至 Supabase Secrets，改由後端管理。
- 完成所有資料表的角色最小權限盤點；目前「已登入即可操作」的開發期政策不宜直接商用。
- 建立 MFA、密碼政策、登入鎖定、離職停權與權限定期複核流程。
- 啟用備份／PITR，並實際演練還原；建立 staging 的端對端回歸測試。

### P2：商用品質

- 使用自訂網域設定 CSP、HSTS、Permissions-Policy 等安全標頭，並釘選 CDN 套件版本／完整性。
- 導入錯誤監控、可用性告警、稽核記錄保存政策與個資告知／隱私政策。
- 補齊無障礙與行動裝置測試；攝影機串流改用正式 HTTPS gateway，不使用臨時 tunnel。

## 結論

程式層的 7 項稽核問題已處理且掃描歸零，但在 P0 的正式資料庫 RLS 套用與 LINE Channel Secret 完成前，系統仍不應宣告為可商業正式上線。
