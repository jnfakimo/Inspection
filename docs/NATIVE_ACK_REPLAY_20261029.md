# 2026-10-29 原生回應遺失、強制關閉與重送補驗

## 本輪結果與範圍

**pass：6/6 整合檢查通過，沒有發現需要新增修正的產品缺陷。** 前輪只測過後端無法連線及空佇列再次補傳；本輪補上「後端已寫入，但成功回應遺失，App 再被強制關閉」的原生整合情境。

產品程式基準仍為 5fa667ec0ddb0b40a04985d80bf616be3414ffbe；開始本輪時修正分支為 f6dcde7e9ee695f6a2fc5b0b5fc8137610c7f68e。本輪只提交驗證報告與交接紀錄，正式資料、密碼政策及部署狀態不變。既有 7 筆 deepmerge 低風險列管與補償控制不變；本輪沒有重查上游版本，也不宣稱公告已消除。

## 隔離方法與判定依據

- 專用 WSL／KVM Android API 35 Google Play 模擬器，既有 debug APK SHA-256：281894ff7352e99e8b25429e901d9e4f1203041f9709da4192e31467d5429ec2，載入目前修正分支程式碼。
- 專用 Linux UID 997 保留既有 IPv4／IPv6 拒絕外網規則。手機後端固定連到 10.0.2.2:18869，對應 WSL 的 127.0.0.1:18869 私有代理；代理只能轉送已核對的隔離 Kong 172.18.0.14:8000，不能指定任意主機。
- 代理真正轉送請求，收到定位 POST 的後端成功狀態並讀完回應後，才關閉手機連線而不傳送成功回應。沒有修改產品 fetch，也沒有以記憶體替身取代原生佇列。代理只記錄狀態、事件編號及請求本文 SHA-256，不記錄憑證、標頭或本文。
- 沿用原測試數字密碼。App 使用隔離 Auth 的登入憑證進行 PostgREST／RLS 寫入；service role 僅在本機 fixture 工具建立合成車輛設備、獨立讀回與測後停用，不進入 App。
- 原生測試入口使用實際 background-location、encrypted-storage、storage、sync、duty-completion 模組。入口繞過實體 BLE 綁定操作，不能視為實體標籤或完整人工介面驗收。

## 原生與資料庫交叉驗證

| 檢查 | 實際結果 |
|---|---|
| 後端成功、手機未收到回應 | 原生 GPS 產生 1 筆定位；後端已存在該 client_event_id，但手機仍保留 1 筆加密待傳點，勤務 active，錯誤有回報 |
| 強制關閉後恢復 | adb force-stop 後確認程序不存在，再重新啟動；原本事件編號仍在加密佇列，勤務保留。重開恢復收集新增 1 個不同事件，佇列共 2 筆；隨後停止收集以固定重送比較範圍 |
| 持續遺失回應下重送 | 兩筆事件均已在後端；再次補傳仍保留待傳點，獨立讀回仍 2 筆、無重複，勤務仍 active，車輛／設備／駕駛符合本輪 fixture |
| 恢復回應再結束勤務 | 允許回應後，實際 completeTrackingDuty 完成補傳及結束；伺服器仍 2 筆、勤務 ended，本機佇列及勤務清除 |
| 代理證據交叉比對 | 共 5 次後端成功回應被故意丟棄，最後 1 次成功回應送回；最後請求本文 SHA-256 與先前遺失回應的請求一致，兩個事件編號均曾出現在遺失及成功確認的請求中 |
| 再次補傳與本機狀態 | 再次補傳回傳 0，伺服器仍 2 筆無重複；原生讀回佇列 0、無勤務、定位已停止 |

強制關閉前後筆數由 1 變 2 是重開後恢復定位新增的不同事件，不是重送重複；本輪逐一比對原事件保留、新事件編號及重送前後固定的 2 筆資料。最後的成功確認也不是空佇列測試，而是真正重送先前已入庫、手機尚未收到確認的相同本文。

## 測後清理與交付

已獨立讀回本輪 1 筆勤務 ended、車輛 inactive、設備 inactive；沒有刪除資料列，2 筆合成定位留在隔離庫。App 已登出，專用模擬器、Metro、結果接收器及回應遺失代理均停止，8083／18868／18869／5580 無監聽；既有 UID 防火牆維持原樣，原隔離網站及 Supabase 未停止。測試輔助程式、APK、憑證與私有證據不進 Git。

本輪沒有產品、依賴或 workflow 變更，因此不重跑未受影響的既有 43 項生命週期、10 項安全、CI／CodeQL；不將程式基準先前的 success 冒稱為這次文件提交的新 CI。提交前另做文件 diff 與 Gitleaks 掃描，交付回執記錄實際結果及遠端提交雜湊。

私有證據位於 C:/projects/Inspection-supabase-e2e-20261028/evidence/：native-ack-flow.json、native-ack-pending-before-restart.json、native-ack-pending.json、native-ack-proxy-events.jsonl、native-ack-server-lost.json、native-ack-server-before-replay.json、native-ack-server-replayed.json、native-ack-server-final.json、native-ack-server-repeat.json、native-ack-server-cleanup.json、native-ack-device-cleanup.json、native-ack-environment-cleanup.json。原始事件與憑證分開保存；對外報告只列結果，不公開帳密或金鑰。

## 尚需配合的最少步驟

本輪補足回應遺失與程序重開，不代表所有設備與正式現場驗收均已完成。

| 待驗項目 | 最少配合步驟 |
|---|---|
| 實體 Android、BLE／NFC、相機 QR、列印、八小時背景及 4G／5G 切換 | 接上核准手機並允許首次 USB 偵錯，備妥實體標籤／測試碼／印表機，指定八小時測試時段；代理接續操作與蒐證 |
| 原生 iOS | 提供可存取的 Mac／Xcode、連接並信任測試 iPhone，由本人完成必要公司簽章授權 |
| 正式 IIS／VPN／代理／Python 現場 | 本人完成 VPN／MFA，開啟指定主機與站台的唯讀連線；代理核對 443 綁定、路徑、TLS／CSP、標頭與部署版本 |
| 外部 LINE／Google／簡訊／郵件 | 指定測試帳號及收件人並明確授權各項單次發送；本人完成必要 OAuth／MFA |
| 異機復原 | 提供空白隔離第二主機、核准去識別備份及安全金鑰取得管道，指定 RPO／RTO |
| ISO 管理驗收 | 指定風險所有人，核准密碼例外、權限複核、SoA、內稽及管理審查；技術測試不代替組織核准 |

不必重做本輪已通過的隔離測試，亦不必在聊天提供秘密。
