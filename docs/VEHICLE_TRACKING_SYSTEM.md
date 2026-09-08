# SYS-13 公務車定位追蹤系統

## 定位來源與系統邊界

- 照片中的圓形設備先視為 BLE 標籤，不假設它本身具備 GPS、SIM 或網路上傳能力。
- 車輛座標由已登入的 iPhone／Android 手機取得；BLE 標籤負責確認「這支手機目前跟哪一台車綁定」。
- 手機有 4G／5G 或 Wi-Fi 時即時上傳；無網路時先保存在手機，恢復連線後依 `client_event_id` 去重補傳。
- Web 後台是獨立的 `SYS-13`，沿用公務車主檔 `official_vehicles`，不併入 `SYS-07 公務車派車`。

## 已建立模組

1. 即時車況：開源 MapLibre 地圖、車輛群聚、更新狀態、電子圍籬圖層及即時資料訂閱。
2. 歷史軌跡：1／2／4／6／24 小時與自訂日期、路線、推估里程、停留次數及資料缺口。
3. 藍牙設備：BLE 標籤識別、實機驗證狀態、車輛綁定及停用／汰換。
4. 電子圍籬：第一版支援圓形圍籬、進入／離開事件。
5. 定位告警：離線、逾時、藍牙中斷、圍籬事件與確認紀錄。

## 資料與保存

- `vehicle_tracking_devices`：BLE 設備主檔與最後定位。
- `vehicle_tracking_sessions`：手機、車輛、設備與駕駛人的勤務工作階段。
- `vehicle_location_points`：原始定位點，保存 90 天。
- `vehicle_location_daily_summaries`：每日里程／移動／停留彙總，保存至少 1 年。
- `vehicle_geofences`：電子圍籬。
- `vehicle_tracking_events`：告警與處理紀錄。

資料庫腳本為 `system/sql/vehicle_tracking.sql`，正式遷移檔為
`supabase/migrations/20260908181500_vehicle_tracking_system.sql`。

## 地圖

- 前端元件：MapLibre GL JS，本機隨站部署，不由第三方 CDN 執行程式碼。
- 預設圖磚：OpenFreeMap Liberty。
- 可透過 `NEXT_PUBLIC_VEHICLE_TRACKING_MAP_STYLE_URL` 切換相容的 MapLibre 樣式服務。
- 上正式環境前需確認所選圖磚服務的使用條款、流量上限與公司個資政策；免費圖磚不是無條件的企業 SLA。

## 手機端必要限制

- 不能只做 PWA：iOS Safari 不提供本案所需的持續背景定位與通用 Web Bluetooth 能力。
- iOS／Android 均需安裝含原生模組的 App，並取得前景定位、背景定位與藍牙權限。
- 使用者強制結束 App 後，持續定位會受作業系統限制；畫面與教育文字不得承諾「關閉 App 仍永遠回傳」。
- iOS 背景 BLE 掃描需要已知的 Service UUID，且系統會降低掃描頻率；照片無法推得 UUID。
- 目前硬體尚待實機掃描確認廣播名稱、Service UUID、Characteristic UUID、manufacturer data、是否可連線及是否支援尋鈴。
- iOS／Android 手機端原始碼位於 `mobile/vehicle-tracker/`，已包含勤務工作階段、BLE 前景掃描與手機端綁定、背景定位及離線補傳；實機建置方式見該資料夾 README。

## 上線順序

1. 套用資料庫遷移並部署 `admin-api` 權限代碼。
2. 以 Android 與 iPhone 各掃描一次同一顆標籤，建立跨平台識別規則。
3. 驗證背景定位、斷網補傳、權限拒絕、重複點去重與耗電。
4. 先以 2～3 台車試辦，再擴到 50 台。
5. `.github/workflows/vehicle-tracking-maintenance.yml` 會呼叫 `vehicle-tracking-maintenance` Edge Function：每 5 分鐘檢查定位逾時，每日臺灣時間 03:17 清除超過 90 天的原始定位點。不要在目前的 Nano 主機重新啟用曾造成背景工作反覆重啟的資料庫網路排程。
   排程預設停用；資料庫、函式與保存政策驗證後，再設定 GitHub Actions 變數 `VEHICLE_TRACKING_MAINTENANCE_ENABLED=true`。推送程式碼不代表已完成資料庫部署或實機驗收。
