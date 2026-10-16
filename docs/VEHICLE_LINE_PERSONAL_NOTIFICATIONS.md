# 車輛派工個人 LINE 通知部署交接

> **2026-10-16 更新（正式上線方式，取代下方「部署順序」第 2、3、5 步的舊說明）**
>
> - 程式整合進 main：四個 Edge Functions（`app-api`、`admin-api`、`line-notify`、`vehicle-line-dispatch-worker`）與五份 migration。
>   2026-10-08 曾從 G 槽直接部署，但原始碼未進 main，10-15 被 main 版自動部署覆蓋；本次以 main 為正本重新上線。
> - 前端：司機在「個人資料設定 → LINE 派車通知」產生綁定代碼（只對有公務車系統權限者顯示）；
>   管理員在「後台 → 系統設定 → LINE 推播 → 公務車個人 LINE 通知」設定開關與發送測試。
> - 排程：不使用 pg_cron／Vault，改用 `.github/workflows/vehicle-line-dispatch-worker.yml`，每 5 分鐘以 repo secrets
>   `CRON_SECRET`、`SUPABASE_ANON_KEY` 呼叫 worker（與巡邏、會議室等排程同一做法）。開關關閉時佇列為空，排程不會送出任何訊息。
> - 啟用順序不變：司機完成綁定 → 管理員開「測試模式」並送一次測試確認 022443 收到 → 再逐項開啟「啟用個人通知」「指派通知」「取消指派通知」。

## 範圍與安全界線

- 個人通知預設全部關閉；設定只由系統管理員透過管理 API 讀寫，資料表與 RPC 不授權前端直接操作。
- 指派、取消指派通知各自開關。關閉時，尚未送出的工作會取消或在最後送出檢查時被抑制；已進入 LINE 請求中的訊息無法撤回，結果會記為不確定。
- 測試模式使用獨立的合成測試資料，只能送給伺服器確認為啟用中、有效駕駛名冊中的帳號 `022443`，不讀取或建立派車案件。按「發送測試」會送出一則**真實 LINE 訊息**給該帳號，內容固定，不會送到群組。
- 目前僅完成程式與本機測試；本文件沒有套用資料庫遷移、部署函式、設定密鑰或建立排程。

## 部署順序

1. 先比對遠端遷移版本，再依版本順序部署下列五個遷移；若遠端已有版本，依正式遷移紀錄略過已套用項目，不要重複以 SQL 手動建立物件：
   - `20261008070454_vehicle_driver_line_notifications.sql`
   - `20261008071250_vehicle_dispatch_line_outbox.sql`
   - `20261008072136_vehicle_driver_line_link_start.sql`
   - `20261008073738_vehicle_dispatch_line_worker_leases.sql`
   - `20261008081918_vehicle_personal_line_notifications.sql`
2. 部署四個 Edge Functions：`app-api`（登入者綁定／解除綁定 LINE）、`line-notify`（LINE 簽章 webhook 與綁定回呼）、`admin-api`（個人通知設定與測試）、`vehicle-line-dispatch-worker`（正式佇列與獨立測試佇列）。`app-api` 保持 `verify_jwt = true`；`admin-api` 保持預設 JWT 驗證開啟；`line-notify` 保持 `verify_jwt = false` 並由 handler 驗 LINE 簽章；worker 新增 `verify_jwt = false`，由 handler 驗 `x-cron-secret`。排程與管理 API 對 worker 的呼叫都帶 Supabase `apikey`。Supabase 的排程範例以 `pg_cron`、`pg_net` 呼叫函式，並建議把呼叫憑證存於 Vault（[Edge Function 排程文件](https://supabase.com/docs/guides/functions/schedule-functions)、[授權標頭文件](https://supabase.com/docs/guides/functions/auth-headers)）。
3. 部署 V2 前端，確認管理設定頁可讀取伺服器回傳的收件人資格，不顯示 LINE 使用者 ID。`022443` 必須先完成個人 LINE 綁定，且帳號仍啟用並在駕駛名冊中，才會顯示可測試。
4. 由有權限的維運人員在 Supabase Dashboard → Edge Function Secrets 確認 `CRON_SECRET` 已設妥；勿將密鑰貼到聊天、文件、SQL 結果或程式碼。管理 API 呼叫 worker 時使用此既有密鑰。若個人 LINE 綁定 webhook 尚未設好，另確認 Edge Function Secret `LINE_CHANNEL_SECRET` 與 LINE Developers Console 的同一 Messaging API channel 相符；LINE 官方要求以 Channel Secret 驗證 webhook 簽章（[LINE 簽章驗證文件](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)）。
5. 若需要新建 worker 排程，先在 Database → Cron Jobs 確認沒有同名工作，並確認 `pg_cron`、`pg_net` 已啟用。於 Database → Vault UI 新增下列項目；`CRON_SECRET` 必須與 Edge Function Secrets 中的值相同：
   - `project_url`：該 Supabase 專案 URL。
   - `publishable_key`：該專案的 publishable key；只放在 Vault 的 `apikey` 標頭，不放進 Authorization bearer 標頭。
   - `vehicle_line_cron_secret`：與 `CRON_SECRET` 相同的值。

   在 SQL Editor 先人工檢查排程名稱唯一後，再由維運人員執行以下排程範本。這個工作每分鐘只呼叫 production 模式；不要把測試模式或測試 run ID 放進排程：

   ```sql
   select cron.schedule(
     'vehicle-line-dispatch-worker',
     '* * * * *',
     $job$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
         || '/functions/v1/vehicle-line-dispatch-worker',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'publishable_key'),
         'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'vehicle_line_cron_secret')
       ),
       body := '{"mode":"production"}'::jsonb
     );
     $job$
   );
   ```

   `cron.schedule` 會在建立後立即啟用；五份 migration 不會建立排程。若要先上線預設關閉版本，可先完成 migration 與程式部署，不新增此排程、不設定 `CRON_SECRET`；worker 在密鑰缺少時會 fail closed，所有個人通知開關亦預設關閉。LINE 綁定 webhook 則仍需有效 `LINE_CHANNEL_SECRET`，缺少時不能完成綁定。建立排程前必須先完成 secret/Vault 設定與核對，因排程一建立就會每分鐘執行。

   Vault 可由 Dashboard 管理；不要以 `select * from vault.decrypted_secrets` 檢視密鑰，因該 view 會回傳明文（[Supabase Vault 文件](https://supabase.com/docs/guides/database/vault)）。

6. 上線後先確認排程 HTTP 呼叫成功且佇列處理數正常；個人通知設定仍保持關閉。由管理頁檢查收件人狀態，再由維運人員明確安排時間按一次「發送測試」，確認 `022443` 收到固定測試訊息。完成後可關閉測試模式；不要以實際派車案件當測試資料。
7. 驗證完成後才由管理員逐項啟用個人通知。群組 LINE 設定與群組測試維持原本流程，與個人通知開關分開。

若需要使用者完成 LINE 綁定，LINE Developers Console 的 Messaging API channel 需設定 HTTPS webhook URL、按 Verify 並啟用 Use webhook；LINE 指引也說明該 webhook URL 是單一 bot endpoint（[LINE 建立 Bot 文件](https://developers.line.biz/en/docs/messaging-api/building-bot/)）。本專案 endpoint 為：

```text
https://qztffronusdhgxhjjubt.supabase.co/functions/v1/line-notify
```

## 本機驗證

執行 `npm run test:vehicle-line-notifications` 驗證管理 API、worker 分流、設定關閉、佇列取消、權限與隔離的合成測試資料庫行為。PGlite 測試會載入五份 migration 的 SQL schema／函式並實際執行 RPC，檢查六張私有表的 RLS／table grants、服務端 RPC 權限、預設關閉與 migration 間隙佇列清理；假資料覆蓋 `022443`、其他帳號、停用帳號及非駕駛名冊。獨立 worker 測試確認測試請求不接受收件者、訊息或群組 ID，僅執行合成測試 RPC。執行 `npm run typecheck:v2 -- --incremental false` 驗證前端型別。測試不呼叫 LINE API，也不連遠端 Supabase。
