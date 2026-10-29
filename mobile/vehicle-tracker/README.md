# 北農公務車定位手機 App

這是 `SYS-13 公務車定位追蹤系統` 的 iOS／Android 原生 App 原始碼。它不是一般網頁或
Expo Go 專案：背景定位與 BLE 都需要原生模組，必須建立 development build。可先使用 Android 模擬器補驗原生儲存、登入與權限；BLE／NFC／耗電與廠牌背景限制仍須實體手機。

## 已實作（不代表已安裝或通過實機驗證）

- Supabase 電子郵件／密碼登入及定位系統權限資料讀取。
- 公務車與後台已綁定 BLE 設備選擇。
- 前景 BLE 掃描、掃描結果選取，以及 iOS／Android 分別綁定設備識別碼。
- 勤務開始／結束、30～60 秒移動定位、Android 常駐通知。
- 最多 10,000 筆手機離線佇列，依 `client_event_id` 去重補傳。
- 補傳先確認目前登入的啟用人員，只送該駕駛的點；其他帳號資料保留供原駕駛登入後補傳。補傳失敗時不關閉伺服器勤務，畫面會提示定位已停止、勤務尚未結束，恢復網路後須再次按結束勤務。
- Android 背景定位的持久化排程需要 `RECEIVE_BOOT_COMPLETED`，已在 app config 明確宣告並由產生 manifest 的測試把關；變更需重建原生 APK，僅更新 JavaScript bundle 不會補上權限。
  本輪背景回呼、鎖屏、Doze 與離線勤務證據見 [續驗報告](../../docs/TRACKING_FOLLOWUP_VERIFICATION_20261029.md)；短時間模擬器測試不代表八小時實機驗收。
- 登入資料、勤務狀態與位置佇列以 AES-GCM 加密存放，金鑰由作業系統 SecureStore 保護；舊明文值成功遷移後才刪除。大量密文會分成每段最多 200 KB，所有新段寫完才切換索引，避免單筆讀取上限與中斷寫入造成資料遺失。位置佇列保留 7 天，到期自動移除；到期前仍須完成補傳。
- Android 已停用應用程式自動備份，避免只還原密文、未還原 Keystore 金鑰而無法讀取。換機或重裝前須先連線補傳，離線佇列不會移轉到新手機。
- iOS／Android 權限說明皆為繁體中文。

## 藍牙掃描修正（2026-09-08）

- 登入前可使用「免登入藍牙檢測」；只列出附近 BLE 廣播，不取得 GPS 或回傳設備資料。
- 前景不套用尚未確認的服務篩選，顯示全部結果、訊號及廣播服務。掃描持續到結束才解除操作鎖；錯誤、權限拒絕與查無設備均顯示繁體中文。
- iOS 冷啟動等待藍牙狀態初始化，Android 30 以下亦請求定位權限。
- 相同名稱（例如 FT）或相同服務不能證明是同一顆標籤；只有明確綁定儲存成功的本平台識別碼才認定已綁定。首次綁定仍須本人核對實物，不能憑 RSSI 自動認領。
- 綁定與開始勤務要求一分鐘內的掃描結果；已登錄的服務不會被任意一個廣播服務取代。
- iOS 的識別碼不保證等於 FindTag 顯示的位址，換手機也需重新確認；目前不宣稱具有跨手機穩定的硬體識別協定。
- 掃描／後台綁定不是藍牙連線或原廠帳號配對；連線、尋鈴及背景相容性仍待硬體協定確認。
- 自動化回歸：在 repository 根目錄執行 `node --test tools/vehicle-tracking-ble.test.mjs`。測試使用原生模組替身，不代表實體手機測試。
- 儲存遷移、密文完整性、期限及並行佇列回歸：在本目錄執行 `npm run test:storage`。仍須用實體手機驗證安全儲存、背景定位與既有安裝升級。

目前提供原始碼，沒有已簽署的 iOS 安裝包。GitHub Pages 更新只部署網站，不會把 App 安裝到手機。iOS 需可用的 Apple 簽章與 macOS/Xcode 或已授權雲端建置環境；不應把帳號密碼或簽章密鑰放進 repository。

## 建置

2026-10-29 已於隔離 Android API 35 模擬器完成原生加密、遷移、分段、權限拒絕／服務啟停、原密碼登入、程序重啟、同簽章更新、Android 重開機與金鑰遺失補驗。修正跨帳號勤務恢復、登出競態、Expo Android 密文介面差異及中斷遷移清理；25 項儲存／生命週期測試通過。測試 APK 使用隔離後端與私有測試入口，沒有正式簽署或發布；iOS 僅 JS bundle，未跑原生模擬器。範圍、證據及需要配合的條件見 [完整報告](../../docs/ANDROID_EMULATOR_VERIFICATION_20261029.md)。

1. 複製 `.env.example` 為 `.env.local`，填入目標環境的公開匿名金鑰；不得填入 service role 金鑰。
2. 執行 `npm ci`，由鎖檔安裝並套用經來源雜湊核對的 deepmerge 防護。
3. 執行 `npm run native:prebuild` 產生原生工程。
4. Android 實機使用 `npm run android`；iOS 需在 macOS／Xcode 與公司 Apple 開發者簽章環境執行 `npm run ios`。

啟動使用 `npm start`；輸出 bundle 使用 `npm run export -- --platform android`（iOS 同理）。上述指令與 typecheck 均先驗證 deepmerge 補丁；即使安裝或執行時指定 `--ignore-scripts`，內嵌檢查仍會拒絕未修補版本。若漏跑安裝腳本，先執行 `npm run postinstall`，再跑 `npm run test:security-deps`。未知版本或雜湊不符時停止並重新審查，不手改雜湊放行。直接執行 `npx expo`、Gradle 或第三方建置服務不保證會跑本專案守門，必須先完成補丁檢查；正式簽署前也必須通過此檢查。

2026-10-29 的 7 筆 low 均來自同一 deepmerge 公告及其間接依賴，原始 audit 告警保留；本機補丁不等於上游已發布修補版。逐項原因、防護、替代方案與驗證見 [低風險依賴報告](../../docs/LOW_DEPENDENCY_REVIEW_20261029.md)。

## 實機驗證閘門

照片無法辨識 BLE 協定。正式試辦前必須記錄同一顆標籤在 iOS／Android 的廣播名稱、
Service UUID、Manufacturer Data、裝置識別碼穩定性及能否連線。只有確認 Service UUID 後，
iOS 背景掃描才可指定服務並驗證。若實物其實是 Beacon，需更換支援 Beacon 的原生套件；
目前套件不宣稱支援 Beacon。

此外必須實測：背景 8 小時耗電、斷網後補傳、手機重新開機、App 被系統回收、使用者強制關閉
App、Android 各廠牌省電設定，以及 4G／5G 網路切換。
