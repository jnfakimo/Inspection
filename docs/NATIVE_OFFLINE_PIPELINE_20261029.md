# 2026-10-29 原生 GPS、離線佇列與隔離資料庫整合補驗

## 本輪補足的缺口

此前原生測試使用不存在的合成勤務，證明 GPS 可以進入加密佇列及停止收集；成功補傳／關閉勤務則由另一組 API 測試以記憶體佇列驗證。兩者分別通過，不能直接推論同一次原生流程已完整串接。本輪將真實 Android 原生定位、加密儲存、產品補傳與勤務完成模組，接到真實隔離 Auth／PostgREST／PostgreSQL／RLS，補上這段整合證據。

程式基準仍為 5fa667ec0ddb0b40a04985d80bf616be3414ffbe，開始本輪時修正分支為 08fb8deb7edd0e2d3ac1e43c04cca78759d26298（其後只有文件變更）。本輪六項檢查均通過，沒有發現需要新增修改的產品缺陷；只提交報告及交接紀錄，密碼政策、正式資料及部署狀態不變。

## 隔離與操作方式

- 沿用專用 WSL／KVM Android API 35 Google Play 映像及既有隔離 debug APK，載入目前分支原始碼。APK SHA-256：281894ff7352e99e8b25429e901d9e4f1203041f9709da4192e31467d5429ec2。
- Windows fixture 工具只允許 127.0.0.1:8770；模擬器後端固定為已核對的隔離 Kong 172.18.0.14:8000。先核對容器 IP、專用 UID 防火牆與原有拒絕外網規則，沒有存取正式後端或對外通知。
- 只在隔離資料庫建立本輪合成車輛及設備。模擬器使用原測試數字密碼登入，經使用者權限 API 建立勤務；GPS 上傳與勤務結束由原生產品模組使用登入憑證執行。service role 僅由本機 fixture 工具建立／清理合成資料及獨立讀回，未放入 App 或用來代替 App 上傳。
- 斷線由 Linux 核心防火牆實施：僅暫時拒絕專用模擬器 UID 到隔離後端的 TCP 8000，Metro／測試接收器及其他隔離客戶端不受影響；不是修改產品 fetch 回傳值。finally 移除本輪新增規則，原有外網阻擋全程保留。
- 私有原生測試入口呼叫實際 background-location、storage、encrypted-storage、sync 與 duty-completion 模組，沒有以記憶體替身取代手機佇列。此入口繞過實體 BLE 綁定操作，不能據此宣稱真實標籤／完整人工介面流程已通過。

## 結果

| 檢查 | 原生與伺服器讀回結果 |
|---|---|
| GPS → 隔離資料庫 | emulator geo 注入合成座標後，伺服器讀到 1 筆定位；勤務 active，車輛／設備／駕駛符合本輪 fixture |
| 核心層斷線 → 加密佇列 | 移動座標後，原生佇列保留 1 筆新位置，底層儲存沒有明文定位欄位／駕駛值；伺服器仍為原先 1 筆，勤務仍 active |
| 斷線時嘗試結束 | 實際 completeTrackingDuty 回傳「勤務尚未結束」錯誤；原生定位已停止，本機勤務與待傳點保留；獨立讀回確認伺服器未提前關閉 |
| 恢復後補傳再結束 | 移除本輪阻斷規則後，原生模組補傳成功，伺服器共 2 筆；逐一比對斷線時保存的 client_event_id 全部存在且無重複，駕駛符合，勤務 ended；本機佇列與勤務清除 |
| 再次補傳 | 回傳上傳數量 0，伺服器仍 2 筆，未新增重複資料。此項是空佇列再次操作，不冒稱已測量網路回應遺失後重送的所有情況 |
| 本機清理 | 讀回 0 筆待傳位置、無本機勤務、原生定位停止 |

六項整合檢查 **6/6 pass**。伺服器清理另讀回：本輪 1 筆勤務 ended、車輛 inactive、設備 inactive，沒有刪除資料列；2 筆測試位置保留在隔離庫作為證據。手機已登出，專用模擬器、Metro 與結果接收器已停止，防火牆還原原有規則，既有隔離網站／Supabase 未停止。

未變更產品、依賴、workflow 或既有測試，因此不重跑不受影響的既有 CI／CodeQL、43 項生命週期與 10 項安全檢查；本輪文件提交不冒稱具有新的 CI 執行結果。提交前執行文件 diff 與機密掃描，結果以本輪回執為準。

## 仍需要使用者配合的最少步驟

本次新增原生資料鏈的整合證據，仍不替代以下實機、正式現場及組織驗收：

| 項目 | 最少操作步驟 |
|---|---|
| Android／BLE／NFC／相機 QR／紙本／長時間背景 | 接上核准手機並允許首次 USB 偵錯；備妥實體標籤、測試碼、印表機，指定八小時測試時段。代理接續執行；本次核心層斷線不等於實際 4G／5G 切換或耗電測量 |
| iOS | 提供可存取 Mac／Xcode，接上測試 iPhone 並信任；由本人完成必要公司簽章授權 |
| 正式 IIS／VPN／代理／Python | 本人完成 VPN／MFA，開啟指定主機與站台的唯讀連線；代理核對綁定、路徑、TLS／CSP、標頭與版本，不部署或寫入正式資料 |
| 外部通知 | 指定測試帳號及收件人，明確授權各項單次發送；必要 OAuth／MFA 由本人完成 |
| 異機復原 | 提供空白隔離第二主機、核准去識別備份與安全金鑰取得管道，指定 RPO／RTO 目標 |
| ISO 管理驗收 | 指定風險所有人，完成密碼例外、權限複核、SoA、內稽及管理審查核准 |

7 筆 deepmerge 低風險依賴仍依既有補丁與雜湊守門列管，本輪未重新查詢上游版本，也未宣稱消除公告。帳密、金鑰、session、APK 及資料庫不進 Git；無需在聊天提供這些秘密。

私有證據目錄 C:/projects/Inspection-supabase-e2e-20261028/evidence/：native-offline-flow.json、native-offline-server-initial.json、native-offline-pending.json、native-offline-end-failed.json、native-offline-server-offline.json、native-offline-end-recovered.json、native-offline-server-final.json、native-offline-server-repeat.json、native-offline-server-cleanup.json、native-offline-device-cleanup.json、native-offline-firewall-blocked.txt／restored.txt。私有測試入口與 fixture 工具留在隔離目錄，不混入產品。

後續補驗：本報告未涵蓋的「後端已寫入但成功回應遺失、App 強制關閉後重送」已另完成 6/6 原生整合檢查，見 [原生回應遺失與重送報告](NATIVE_ACK_REPLAY_20261029.md)。兩份報告的測試 fixture 與證據分開，不能混用筆數。
