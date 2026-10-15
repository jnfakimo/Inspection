

### 2026-10-15 行動端相依安全修補

僅更新 mobile/vehicle-tracker 的 compression 1.8.2、shell-quote 1.12.0、source-map-js 1.2.2，保留 uuid 11.1.1。CI 新增鎖檔安裝、型別檢查、相依樹及 Android/iOS Hermes bundle 驗證；打包使用離線假設定，不讀寫正式服務。

本機 npm ci、行動端 typecheck、相依樹、BLE 8/8 測試及雙平台 bundle 通過；build:pages 通過。完整測試與發布門檻以本 PR 的 CI/CodeQL 結果為準。原生設備、Adobe 及紙本未驗證；業管末尾空白頁及隔離 Supabase 安裝維持使用者暫緩。braces 與 node-forge 的既有無修補版本警示不在本批宣稱解決範圍。

G/runtime 已先備份，再逐檔同步 PR58 已發布交接來源與 manifest，保留其他未提交工作；本 PR 不重複發布該批程式。


### 2026-10-15 共用視窗鍵盤操作修正

AdminModal 開啟時原本把鍵盤焦點留在背景，也無法使用 Escape 返回。本批加入開窗聚焦、Tab／Shift+Tab 循環、最上層 Escape 關閉與關閉後焦點還原，保留既有 onClose 流程、巢狀視窗及輸入法保護。

實際元件配合完整 build CSS 的離線驗證：雙主題、320／390／768／1280px 共 8 組，每組 3 次取消／關閉／重開與巢狀返回通過；整頁無溢出，文字對比 14.63:1／16.41:1。型別、頁首、按鈕、安全稽核與 Pages 建置通過。正式帳號、實體裝置及螢幕閱讀器未驗證；本批沒有正式資料／LINE／天氣呼叫。僅本批視窗修正獲使用者部署授權，分頁元件的新重現工作未納入。
