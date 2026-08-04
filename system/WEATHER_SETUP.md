# 中央氣象署戰情儀表板啟用步驟

前端、臺灣縣市地圖、資料快取與 Edge Function 均已建置。正式顯示即時資料前，只需完成以下一次性設定。

## 1. 申請中央氣象署授權碼

1. 登入[中央氣象署氣象資料開放平臺](https://opendata.cwa.gov.tw/)。
2. 到「會員中心／取得授權碼」複製 API 授權碼。
3. 授權碼不可寫入 HTML、JavaScript 或 Git；只存到 Supabase Secret。

本功能使用的官方資料集：

- `F-C0032-001`：各縣市未來 36 小時天氣預報。
- `O-A0003-001`：氣象觀測站 10 分鐘資料。
- `W-C0033-001`、`W-C0033-002`：目前警特報及影響區域。
- `F-D0047-091`：各縣市鄉鎮一週預報。

## 2. 建立 Supabase 快取表

在 Supabase Dashboard → SQL Editor 依序完整執行：

1. `system/sql/weather_integration.sql`
2. `system/sql/permanent_data_protection.sql`

兩份 SQL 都可重複執行。第二份必須最後執行，用來把快取表納入資料保護。

## 3. 設定 Secret 並部署 Edge Function

在專案根目錄登入 Supabase CLI 後執行：

```powershell
npx supabase login
npx supabase link --project-ref qztffronusdhgxhjjubt
npx supabase secrets set CWA_API_KEY=請貼上中央氣象署授權碼 --project-ref qztffronusdhgxhjjubt
npx supabase functions deploy cwa-weather --project-ref qztffronusdhgxhjjubt --no-verify-jwt
```

不要把真正的授權碼貼到對話、截圖或 commit。

## 4. 驗證

部署完成後可先開啟健康檢查：

```text
https://qztffronusdhgxhjjubt.supabase.co/functions/v1/cwa-weather?view=health
```

應看到 `configured: true`。再開啟戰情儀表板，確認：

1. 「氣象重要資訊」顯示警特報或「目前無生效中的氣象警特報」。
2. 臺灣地圖出現 22 縣市及氣象圖示。
3. 點縣市可看到即時觀測；選鄉鎮市區可看到預報。
4. 到版面設定頁可拖拉、縮放、隱藏「臺灣即時氣象」圖塊並發布新版。

資料快取時間：全臺摘要 10 分鐘、鄉鎮預報 30 分鐘。中央氣象署暫時無法連線時，系統會顯示最近一次成功快取並標示為快取資料。
