# 北農公務車定位手機 App

這是 `SYS-13 公務車定位追蹤系統` 的 iOS／Android 原生 App 原始碼。它不是一般網頁或
Expo Go 專案：背景定位與 BLE 都需要原生模組，必須建立 development build 安裝到實體手機。

## 已完成

- Supabase 電子郵件／密碼登入及定位系統權限資料讀取。
- 公務車與後台已綁定 BLE 設備選擇。
- 前景 BLE 掃描、掃描結果選取，以及 iOS／Android 分別綁定設備識別碼。
- 勤務開始／結束、30～60 秒移動定位、Android 常駐通知。
- 最多 10,000 筆手機離線佇列，依 `client_event_id` 去重補傳。
- iOS／Android 權限說明皆為繁體中文。

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
