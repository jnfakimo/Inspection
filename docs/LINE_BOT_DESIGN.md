# LINE 設備查詢機器人：設計、操作與驗收

## 本次交付

沿用既有 Supabase app-api、line-notify 與 V2 個人資料設定。本人綁定 LINE 後，在一對一聊天室輸入「設備 <設備編號>」，機器人從中央系統讀取設備主檔、最後監測點位、未結監控事件與最近三筆關聯報修，回傳 LINE Flex 卡片。資料全部從查詢取得，沒有內建示範設備或感測器值。

個人異常推播採本人逐臺訂閱。監控系統新增 warning／critical 且狀態為 open 的事件時，資料庫只替已綁定、啟用且訂閱該設備的人建立通知佇列。排程每五分鐘處理一次；送出前再次確認訂閱、綁定、帳號與設備主檔／監控權限，以及事件仍未結案。既有巡檢異常／報修群組通知與公務車個人通知維持原流程。

## 使用者操作

1. 以啟用中的中央巡檢系統帳號登入，且具「設備建置系統 → 設備主檔」權限。
2. 開啟右上角「個人資料」，在「LINE 設備查詢」勾選同意並產生一次性代碼；代碼 10 分鐘有效。
3. 在 LINE 加入「@ltb9602a」臺北農產巡檢通知好友，於一對一聊天室傳送代碼。開啟機器人回傳的 LINE 帳號綁定連結完成驗證，再回個人資料頁按「確認綁定結果」。
4. 傳送「設備 REF-B1-001」（以實際設備編號替換）；設備編號與 QR 編碼以完全相同的值查找。卡片列出資料與來源時間，按鈕連到受登入與權限保護的設備主檔頁，並帶入編號篩選。
5. 如需異常通知，在同頁的「訂閱設備異常通知」輸入設備編號或 QR 編碼並按「訂閱設備」。只推播本人選的設備，可逐臺取消；最多 100 臺。
6. 不再使用時，在個人資料按「解除綁定」，會同步清除本人訂閱並取消待發通知。管理員撤銷權限或停用帳號後，即使 LINE 仍綁定，後續查詢與推播也會被拒絕。

## 資料與安全界線

- LINE webhook 先以原始請求內容驗證 x-line-signature，再解析 JSON 或連資料庫；並核對目的機器人。只有 source.type=user 的私訊能查設備；群組指令不查私人設備資料。
- 綁定由已登入的本人在 app-api 發起。資料庫只儲存代碼、nonce 與暫時 LINE ID 的 SHA-256 雜湊；LINE Account Link 成功事件才把 LINE 使用者 ID 存入 service-role 專用表。代碼和 nonce 均只能使用一次，可解除綁定；原始 LINE ID 不回傳瀏覽器。
- 每次查詢重新確認啟用帳號及系統／子系統權限。設備主檔、監測與報修分別依 equipment/assets、equipment/monitoring、workorder/requests 權限讀取。
- 已綁定帳號的查詢沿用伺服器持久限流，超額時不讀設備資料。
- 監測值只有點位啟用、時間在允許範圍內、品質為 good／ok／normal 時顯示為目前讀值。時限為 max(5 分鐘, 3 × sampling_seconds)，最多 24 小時；未設定採樣週期時為 15 分鐘。逾時、品質未知或無時間時明確標示。設備主檔的 active 只稱「資產狀態」，不推定設備運轉正常。
- 最多回傳五個監測點、三個未結監控事件、三筆報修，文字設長度上限；無資料或無權限時如實顯示。
- 推播本文只含設備名稱／編號、事件名稱、等級、發生時間與需登入的中央系統網址，不含即時讀值、個人資料或可直接打開的私密資料。每個事件對每位訂閱者最多建立一筆佇列；LINE 發送重試重用同一個 retry key，若送出狀態無法確定則停止自動重試並保留狀態供查核。
- 佇列標為 `sent` 表示 LINE Messaging API 已接受請求，不代表使用者手機已收到或讀取；正式驗收須由受控測試帳號在手機確認。
- 正式環境需先套用 migration，再部署 Edge Functions 與網站，最後才啟用 GitHub 排程。排程屬實際推播，部署後應先以受控測試設備與測試帳號驗證。

## 正式啟用順序

1. 依專案發布流程審核此隔離分支的差異與測試結果。
2. 先套用 supabase/migrations/20261104160000_inspection_line_equipment_bot.sql，確認私有表、RLS 與僅 service-role 可執行的 RPC。勿把 LINE token 或 service-role key 寫入 Git。
3. 部署更新後的 app-api、line-notify 與 line-equipment-alert-worker；沿用既有 LINE Channel Secret、Channel Access Token、CRON_SECRET 與 webhook URL。
4. 部署 V2 網站，確認個人資料頁新區塊可見。以測試帳號完成一次綁定、查詢、訂閱、事件推播、取消訂閱、權限撤銷、解除綁定，再擴大開放。
5. 確認 GitHub Actions 的 SUPABASE_ANON_KEY／CRON_SECRET 已設置，啟用 `.github/workflows/line-equipment-alert-worker.yml` 的每五分鐘排程；檢查 worker 的成功、重試、取消與不確定狀態紀錄。
6. 若監控來源尚未回寫 equipment_monitor_points.last_value、last_seen_at、last_quality，卡片只顯示「未提供讀值」或「已過期」。程式測試不能取代現場資料介接驗證。

## 驗收紀錄（2026-11-04，隔離副本）

| 條件 | 結果與證據 |
| --- | --- |
| 本人發起、同意、10 分鐘一次性代碼 | 本機 PGlite migration/RPC 測試通過；停用帳號、重複代碼受阻 |
| LINE Account Link、nonce 驗證、衝突、解除 | 本機 PGlite 測試通過；nonce 重放、ID 不符、逾期、重複綁定受阻 |
| 私訊設備查詢與權限收斂 | 本機 webhook/query 測試通過；群組、未綁定、停用、子系統拒絕、權限查詢失敗不讀設備 |
| 真實點位／監控事件／報修與 Flex 卡片 | 本機模擬資料庫測試通過；失效讀值不以目前值呈現，無權限欄位不讀取 |
| 本人逐臺訂閱與取消 | app-api 與本機 PGlite 測試通過；須同時具設備主檔及監控權限，撤權後仍可取消 |
| warning／critical 事件佇列 | 本機 PGlite 測試通過；非訂閱者、info 與結案事件不進佇列，解除綁定／取消訂閱會取消待發工作 |
| 排程、重試與發送前卡控 | 本機 worker 測試通過；無密鑰、訂閱失效、無效收件者及 LINE 失敗均有對應處理。未對正式 LINE 發送 |
| 公務車 LINE 既有流程 | 原 webhook 與路由契約測試通過 |
| 型別、安全與版型 | TypeScript、Deno、個人資料彈窗／頁首／按鈕／色彩檢查通過 |
| 正式 LINE 帳號、正式資料庫遷移、真實設備與行動裝置 | 未驗證：本次未部署或使用正式 LINE／資料庫 |
| 個人設備異常自動推播 | 本機邏輯已實作並測試；正式帳號收訊與排程執行尚待部署後驗收 |

LINE Account Link、簽章、Flex 和 reply token 設計依 [LINE 帳號綁定](https://developers.line.biz/en/docs/messaging-api/linking-accounts/)、[簽章驗證](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)、[Flex Message](https://developers.line.biz/en/docs/messaging-api/using-flex-messages/) 與 [Messaging API](https://developers.line.biz/en/reference/messaging-api/) 官方文件。
