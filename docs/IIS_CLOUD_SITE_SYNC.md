# 雲端與內網站台同步

兩站的網頁使用同一份 GitHub Pages 正式產物；共用雲端 Supabase 作為應用程式資料來源。2026-09-02 已從內網 executive 頁面的實際網路請求確認，其 app-api 與 audit-event 都指向雲端專案，行情資料日亦為 9/2。

本機 Docker Supabase 仍保留移轉時的資料（行情到 8/30），不能把那份副本的日期當成目前內網頁面的資料日期；本工具不合併或覆蓋該副本，也不變更 IIS 反向代理。

## 網頁更新

`tools/sync-iis-cloud-site.ps1` 取得 `main` 最近成功的 Hardened Pages deployment，下載相同產物、驗證受信任簽章與每個檔案 SHA256，再同步至 `C:\InspectionRuntime\site\Inspection`。預設僅試跑，`-Apply` 才寫入。

- 先備份所有被覆寫檔案，再更新資源，HTML 最後更新。
- 寫入後重新檢查 SHA256；成功版本記在 `C:\InspectionRuntime\site-sync\last-success.json`。
- 不使用 mirror，不刪除舊檔、不修改 `web.config`，舊瀏覽器仍能載入舊版 chunk。
- 備份保留在站台之外；同步失敗記在 `last-error.txt`，不記錄憑證。
- 依賴本機 GitHub CLI 登入與 Node.js；排程須以已登入的操作員執行。

```powershell
powershell.exe -NoProfile -File C:\InspectionRuntime\site-sync-source\tools\sync-iis-cloud-site.ps1 -Apply
```

公開播放 `/board/` 與登入後 `/systems/marketboard/executive/` 共用市場圖卡、表格及行情。登入後頁保留系統標題與帳號導覽，公開播放保留完整播放版面及公開資料範圍；不能把登入者可見的公文／資安通知搬到免登入頁。
