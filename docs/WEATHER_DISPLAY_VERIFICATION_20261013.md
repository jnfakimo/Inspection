# 2026-10-13 天氣溫度與晴雨圖示修正

## 範圍

- 以 main `6adcdbbf2da4384de2d0dc35e46817135411d777` 為基底，僅整合天氣 UI、呈現函式與測試。
- 22 縣市依名稱配對代表測站溫度，顯示站名、Asia/Taipei 完整觀測日期時間與狀態。0°C／負溫有效；空字串、X、-99 等缺值不得當作溫度。
- 固定晴雨圖層停止渲染；19 個錨點、唯一南投映射、行政區 SVG、Blender 淺藍黑線透明底 PNG 均未修改。
- 圖示依中央氣象署天氣描述分類；雷雨／雪／雨優先於晴。沒有可辨識描述時顯示問號，不用未核對的數字代碼猜測晴雨。
- 現有服務的 `temperature/observedAt/stationName` 為測站觀測；`weather/weatherCode` 為 F-C0032-001 縣市預報。介面明確分開標示，不把高低溫或鄉鎮預報當作即時觀測。
- summary 超過 10 分鐘或服務標記 stale，顯示「快取已過期」。觀測超過 90 分鐘另顯示延遲；每分鐘更新狀態，不增加 API 呼叫。既有每 10 分鐘 summary 更新保持原樣。

## 驗證層級

- 新增單元測試涵蓋溫度缺值／零／負數、晴雨分類、過期快取與觀測、22 縣市完整性。納入 `test:weather-api` 與 `npm test`。
- 保存的 2026-10-13 14:00 TWT 22 縣市樣本通過 React 靜態 HTML 渲染：縣市、22 筆溫度、站名、觀測時間完整；樣本沒有晴雨欄位，不捏造晴天圖示。此樣本是當時回應摘要，並非完整 payload。
- `npm test`、`npm run typecheck:v2`、`npm run build:pages` 通過；96/96 靜態頁，hardened 2292 檔／136 頁。
- `security:audit` 0 errors／2 個既有 warnings；`security:secrets` 通過。
- Windows checkout 使兩個交接測試檔案換行轉成 CRLF；本地驗證還原 LF 後，既有交接來源 manifest 15/15 通過。這兩個檔案無內容變更，不納入提交。
- 本地 Turbopack sandbox 無法建立 junction；經正式逐次審核後，同一建置命令成功。未改 ACL、安全設定或清除其他工作樹。
- **未驗證**：登入後桌面／手機視覺、互動與 light/tech 對比。前任 Windows CUA `HRESULT 0x80070003` 尚無恢復證據；HTML 渲染與靜態檢查不等於視覺驗收。
- 本批沒有再呼叫正式 cwa-weather GET，沒有 DB／Storage／LINE 寫入，也不新增 key 或後端服務。

## 映射與第二批待辦

- 地圖仍只有 weather-15＝南投縣有證據。既有 `design/taiwan-weather-blender/county-mapping-review.json` 只有幾何候選；舊清單顺序不能映射新圖的編號。
- 本地交付 `weather-mapping-review.html` 將固定點與具名候選並列，待使用者確認；其餘 18 點保留未知。22 縣市清單不受影響。
- 機電報表另批：手機右欄超出（能否橫捲未知）、NT$／新臺幣／星期二拆行、浮月亮遮產製時間，以及一市標題／二市排班表來源不一致。先查資料與文案，不猜改。A4 PDF／紙本、業務與駐警圖片仍未驗。

## 來源

- `supabase/functions/cwa-weather/index.ts`：summary 組合與快取契約；本批唯讀。
- `web/lib/weather-map-v3.ts` 與原有地圖資產 SHA 回歸測試：固定點位與底圖。
- 前任保存 `cwa-weather-summary-once-20261013.json`：已授權的單次回應摘要，22 筆觀測資料。
- 中央氣象署 [縣市預報](https://www.cwa.gov.tw/V8/C/W/County/index.html)／[官網](https://www.cwa.gov.tw/V8/C/)。
