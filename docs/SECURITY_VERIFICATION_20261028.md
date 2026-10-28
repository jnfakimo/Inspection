# 2026-10-28 巡檢系統技術資安驗證

整體結果：fail（仍有相依漏洞與操作驗證缺口）。本次已完成可執行測試及下列修正，並非 ISO/IEC 27001 認證。

## 範圍與來源
- 原始碼：G 槽北農巡檢系統，HEAD 3885742bd，加上原有帳號審核未提交修改。未抓取遠端，不代表最新正式部署版本。
- 獨立副本與完整日誌：C:/projects/Inspection-audit-20261028/audit-evidence。
- V1 靜態頁、V2 13 大系統／68 子系統、app-api/admin-api、行動追蹤與 Python 訊號服務。
- 使用者要求數字密碼暫不調整：未新增複雜度限制，未移除登入、驗證碼、認證或權限檢查。密碼風險維持未結案。

## 已修正
1. 行動程式鎖檔只更新 node-forge 1.4.0 → 1.4.2，已排除該相依警示。其餘套件保持原鎖檔版本。
2. Semgrep/Gitleaks 包裝器遇到非零退出、訊號中止或無結果時，不再印出已掃描的成功式訊息；候選檔案數不再當成實際覆蓋數。新增 3 項回歸測試並接入 npm test。
3. 上述變更已回寫正本，保留既存修改；未提交、推送或部署。

## 驗證證據
|項目|結果|日誌|
|---|---|---|
|npm test 既有序列|先執行至交接簿雜湊檢查；Git archive 換行差異造成失敗。核對並恢復 16 個 Git blob 原始位元組後 parity 通過，餘下 5 組腳本逐項完成；未重跑先前已通過項目。Node 測試輸出合計 399 pass，不含獨立檢查腳本|full-test.log、parity-retry.log、remaining-test.log|
|新增掃描器回歸|3 pass|scanner-final.log|
|V2 型別|pass|typecheck.log|
|資安設計|0 錯誤、3 警告|security-audit.log|
|網站 npm audit|0 漏洞|npm-audit.json|
|Semgrep|3 條專案規則、593 實際掃描檔案、1 略過、0 findings；非全面漏洞保證|semgrep-final.log|
|Gitleaks／前端祕密掃描|pass|gitleaks-final.log、secrets.log|
|app-api/admin-api Deno check|pass|deno-app.log、deno-admin.log|
|安全建置|138 頁／2313 檔案；Turbopack 不接受跨目錄依賴 junction，改用 Webpack 建置通過|build-webpack.log、hardened.log|
|V1 產物掃描|38 頁、44 段內嵌程式、18 個自有 JavaScript 通過|pages.log|
|行動端|npm ci、型別、4 項儲存測試、Android/iOS bundle 通過|mobile-install.log、mobile-typecheck.log、mobile-storage.log、mobile-native-bundle.log|
|行動 npm audit|修補前 9 項（4 high/5 low），修補後 8 項（3 high/5 low）|mobile-audit.json、mobile-audit-final.json|
|Python|10 pass；正式鎖檔相依 pip-audit 0 漏洞|python-tests.log、pip-audit.json|
|Bandit|21 low：19 個測試 assert、2 個 demo subprocess 提示；沒有 medium/high，未隱藏提示|bandit.json|

## 警告判讀與未結案項目
- V2 layout 的注入內容為固定程式字串；派車報表資料欄位有 escHtml／數值轉換；client-ip 的 http 字串只用於 URL 解析 IPv6，不是發出明文網路請求。這是靜態判讀，非真實瀏覽器攻擊測試。
- 行動端仍有 zod 高風險及 deepmerge 低風險與其 Expo 間接相依。npm 提出的 force 方案會把 Expo 57 改至 51，未採用；須由相容升級與原生整合測試處理。
- 瀏覽器實際開啟隔離副本登入頁及忘記密碼畫面成功；沒有寄信或修改密碼。靜態伺服器沒有 captcha 後端（HTTP 501），登入停用。登入後角色操作、報修／派車／交接簿端到端、真實資料庫 RLS、A4、手機實機未驗證。現有 E2E 腳本需要測試環境與憑證，不能對正式資料直接寫入測試。
- 地端 IIS 443/445、代理來源可信性、備份實際恢復與 RTO/RPO、事件演練、組織政策、風險核定、SoA、內部稽核及管理審查未驗證。
- OpenCode 無有效結果，設定的 Ollama 127.0.0.1:11434 無法連線；本次由 Codex 完成與獨立檢視 diff。

ISO 官方說明：https://www.iso.org/standard/27001 。ISO 27001 是管理系統與風險管理要求；自動測試成功不能替代組織的符合性評估。
