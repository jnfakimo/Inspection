# 資安告警紀錄的存放、存取與保存期限

> 2026-10-15 建立。對應 ISO/IEC 27001：A.5.15 存取控制、A.8.3 資訊存取限制、A.8.15 日誌、A.5.33 紀錄保護。
> 本文件描述「現況」與「待使用者決定的項目」，不取代公司正式的資訊安全政策。

## 一、紀錄放在哪裡

| 資料 | 資料表 | 內容 | 誰能讀 | 能不能刪 |
|---|---|---|---|---|
| 資安告警本體 | `security_alerts` | 類型、嚴重度、來源 IP、資源、事件數、細節 | 僅管理員（RLS 強制，`FORCE ROW LEVEL SECURITY`） | 不能（`trg_prevent_security_alert_removal`） |
| 告警通知紀錄 | `security_alert_deliveries` | LINE 發送嘗試與結果 | 僅管理員 | 不能（append-only trigger，禁止改與刪） |
| 工作階段封鎖紀錄 | `security_session_blocks` | 因大量讀取被封鎖的工作階段 | 僅管理員 | 不能（`trg_prevent_security_session_block_removal`） |
| 通知中心提醒副本 | `notifications`（`event='security_alert'`） | 只有「請至後台資安告警查看」與告警編號 | 收件的管理員本人 | 保存 90 天後**自動清除內容**（列保留） |

寫入只透過 Edge Function 的 service role；瀏覽器端沒有寫入權限。

## 二、2026-10-15 的變更

1. **通知中心副本不再複製告警內容**。原本副本帶有告警標題與完整訊息（含流量次數、資源名稱），
   會被任何讀取 `notifications` 的程式一併帶出（市場看板跑馬燈就是這樣露出的，已於 PR #71 修正）。
   現在只放固定提示與告警編號，細節只在 `security_alerts`。
2. **副本保存 90 天**：`redact_expired_security_notices()` 把 `notifications` 中 `event='security_alert'` 且超過 90 天的列「清除內容」（標題改為已清除、本文清空），**不實體刪除**——正式資料依規範只能追加、更新或停用，
   而 `apply-database-migration` 流程也會拒絕含 `DELETE FROM` 的 migration。函式僅 service role 可執行，且至少保存 7 天（避免誤傳 `now()` 清掉近期通知）。
   由 `platform-log-alert` 在臺灣時間 03 點該小時內呼叫（監測排程每 10 分鐘一次，函式可重複執行，已清除的列不會重複改寫）。
3. 守門：`npm run test:security-notice-minimal` 確認副本不含告警內容、清除只動副本、證據資料表未被解除保護。

## 三、這次刻意沒做的事

**沒有為 `security_alerts`、`security_alert_deliveries`、`security_session_blocks` 設定自動刪除。**
這三張表是資安事件的證據，專案設計上就以 trigger 禁止刪改。若要加保存期限，必須先拿掉這些防護，
等於反轉既有的安全控制，這是政策決定，不是工程細節。

## 四、待使用者／公司決定

1. **證據的保存年限**：目前等同永久保存。常見做法是依公司資安政策或法規要求訂定年限（例如 1–3 年），到期後匯出封存再刪除。
2. 若要設保存年限，建議做法：
   - 不直接 `DELETE`；以排程匯出到唯讀、加密的封存位置（可參考 `database-backup.yml` 的加密流程），確認匯出完整後才刪除。
   - 暫時關閉防刪除 trigger 的授權需要明確、可稽核的程序（誰、何時、為何），並留下 `audit_logs`。
   - 工作階段封鎖紀錄與已確認的重大事件建議保存較久。
3. 通知中心副本的 90 天是否合適。
