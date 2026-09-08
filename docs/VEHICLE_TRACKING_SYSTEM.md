# SYS-13 公務車定位追蹤系統

## 目前採用方向（2026-09-08 桌機 FindTag 介接）

使用者最新要求為沿用桌機 BlueStacks 中已登入的 FindTag 自動同步。桌機收集器、限權接收層與網站同步區見 `docs/FINDTAG_AUTO_SYNC.md`。下列原生手機 App 架構為備選路徑，不表示使用者須換裝 App 或購買 Apple 開發者資格。

本機可見資料探測與限制見 `docs/FINDTAG_LOCAL_PROBE.md`。可見名稱、地址及原始時間同步與 GPS 定位分開；尚無經緯度介接，不能將本次工作稱為完整 GPS 軌跡同步。實際部署與桌機驗收狀態見開發紀錄。

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
- `vehicle_location_points`：原始定位點，受永久保護；未啟用舊版 90 天實體清除。
- `vehicle_location_daily_summaries`：每日里程／移動／停留彙總，保存至少 1 年。
- `vehicle_geofences`：電子圍籬。
- `vehicle_tracking_events`：告警與處理紀錄。

原始參考腳本為 `system/sql/vehicle_tracking.sql`。正式環境使用非破壞性的
`20260908212000_vehicle_tracking_safe_bootstrap.sql`；不要直接執行含清除函式與全面角色種子的舊 migration。

## 地圖

- 前端元件：MapLibre GL JS，本機隨站部署，不由第三方 CDN 執行程式碼。
- 預設圖磚：OpenFreeMap Liberty。
- 可透過 `NEXT_PUBLIC_VEHICLE_TRACKING_MAP_STYLE_URL` 切換相容的 MapLibre 樣式服務。
- 上正式環境前需確認所選圖磚服務的使用條款、流量上限與公司個資政策；免費圖磚不是無條件的企業 SLA。

## 手機端必要限制

### 目前交付狀態（2026-09-08 藍牙修正）

網站是管理後台，不會透過 iPhone Safari 掃描 BLE，也不會自動接收 FindTag 資料。原生 App 已加入免登入掃描檢測、完整掃描生命週期與精確綁定辨識，但尚未提供已簽署安裝包或取得 FT 實機驗證。程式推送不等同手機已能配對。

正式資料庫遷移仍待部署驗證。既有遷移含保存期限清除函式，會被正式遷移的禁止實體刪除防護攔下；本次未停用防護、未套用資料庫變更、未啟用清除排程。需要先獨立審查非破壞性的建表與權限部署，再做手機綁定端到端驗收。

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
