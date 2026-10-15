

### 2026-10-15 行動端相依安全修補

僅更新 mobile/vehicle-tracker 的 compression 1.8.2、shell-quote 1.12.0、source-map-js 1.2.2，保留 uuid 11.1.1。CI 新增鎖檔安裝、型別檢查、相依樹及 Android/iOS Hermes bundle 驗證；打包使用離線假設定，不讀寫正式服務。

本機 npm ci、行動端 typecheck、相依樹、BLE 8/8 測試及雙平台 bundle 通過；build:pages 通過。完整測試與發布門檻以本 PR 的 CI/CodeQL 結果為準。原生設備、Adobe 及紙本未驗證；業管末尾空白頁及隔離 Supabase 安裝維持使用者暫緩。braces 與 node-forge 的既有無修補版本警示不在本批宣稱解決範圍。

G/runtime 已先備份，再逐檔同步 PR58 已發布交接來源與 manifest，保留其他未提交工作；本 PR 不重複發布該批程式。
