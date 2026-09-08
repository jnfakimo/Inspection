# 北農公務車定位手機 App

這是 `SYS-13 公務車定位追蹤系統` 的 iOS／Android 原生 App 原始碼。它不是一般網頁或
Expo Go 專案：背景定位與 BLE 都需要原生模組，必須建立 development build 安裝到實體手機。

## 已實作（不代表已安裝或通過實機驗證）

- Supabase 電子郵件／密碼登入及定位系統權限資料讀取。
- 公務車與後台已綁定 BLE 設備選擇。
- 前景 BLE 掃描、掃描結果選取，以及 iOS／Android 分別綁定設備識別碼。
- 勤務開始／結束、30～60 秒移動定位、Android 常駐通知。
- 最多 10,000 筆手機離線佇列，依 `client_event_id` 去重補傳。
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

目前提供原始碼，沒有已簽署的 iOS 安裝包。GitHub Pages 更新只部署網站，不會把 App 安裝到手機。iOS 需可用的 Apple 簽章與 macOS/Xcode 或已授權雲端建置環境；不應把帳號密碼或簽章密鑰放進 repository。

## 建置

1. 複製 `.env.example` 為 `.env.local`，填入目標環境的公開匿名金鑰；不得填入 service role 金鑰。
2. 執行 `npm install`。
3. 執行 `npx expo prebuild` 產生原生工程。
4. Android 實機使用 `npm run android`；iOS 需在 macOS／Xcode 與公司 Apple 開發者簽章環境執行 `npm run ios`。

## 實機驗證閘門

照片無法辨識 BLE 協定。正式試辦前必須記錄同一顆標籤在 iOS／Android 的廣播名稱、
Service UUID、Manufacturer Data、裝置識別碼穩定性及能否連線。只有確認 Service UUID 後，
iOS 背景掃描才可指定服務並驗證。若實物其實是 Beacon，需更換支援 Beacon 的原生套件；
目前套件不宣稱支援 Beacon。

此外必須實測：背景 8 小時耗電、斷網後補傳、手機重新開機、App 被系統回收、使用者強制關閉
App、Android 各廠牌省電設定，以及 4G／5G 網路切換。
