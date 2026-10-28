# 2026-10-28 相依風險修補與操作驗證續報

整體狀態：blocked（本機可執行項目完成；完整登入後與實機驗收受環境限制）。密碼政策未變，未提交、推送或部署。

## 修補結果
- 僅對 @expo/cli 使用 Zod 4.6.7 override；Expo 保持 57.0.20。實際 CLI plugin schema、MCP 命令 schema、合法與非法資料、JSON Schema 轉換均以安裝後真正的 Expo 模組測試。高風險警示由 3 降為 0。這是經本地測試的跨主版本 override，仍需持續維護，不能宣稱 Expo 官方已支援。
- deepmerge 4.3.1 尚無官方修補版。已重現 target 與 null-prototype source 兩種原型污染，加入局部修補：在共同列舉函式排除 __proto__、constructor、prototype，涵蓋 target/source 與巢狀陣列。保留原版本與授權，未更名或偽裝版本來消除公告。
- postinstall 可重現套用 deepmerge 修補，檢查三個上游檔案 SHA-256；重跑具冪等性，來源未知或版本變更就失敗。pretypecheck 與 test:security-deps 會檢查補丁。若用 npm ci --ignore-scripts，必須執行 npm run postinstall；否則安全測試／型別前置檢查會失敗。
- CI 新增 test:security-deps。CI 定義已更新，但未推送，GitHub CI 尚未實際跑。
- npm audit 最新結果：0 high／0 critical／7 low，低風險全屬 deepmerge 公告及間接相依（不是 7 個獨立漏洞）。高風險移除後，Expo 與 CLI 被重新歸為 low，因此低風險數由 5 變成 7。npm audit 仍退出 1；版本式掃描無法辨識本機補丁，不宣稱 audit 全綠。攻擊回歸證據表明已阻擋重現路徑，不代表對所有未知攻擊的保證。

## 本次實際通過
|項目|結果|證據（audit-evidence/followup）|
|---|---|---|
|全新 npm ci 與自動補丁|pass|clean-install.log|
|安全／相容性測試|6 pass：原型污染、正常合併、Expo schema、10000 筆超限資料只回一個錯誤、來源漂移拒絕、MCP schema|security-final.log|
|行動型別／加密儲存|pass／4 pass|typecheck.log、storage.log|
|Expo 公開設定解析|pass|expo-config.json|
|Android／iOS bundle|兩者 pass|bundle.log|
|npm 相依樹|pass，Zod 4.6.7 override、node-forge 1.4.2|dependency-tree.log|
|實際 loopback HTTP 訊號服務|7 pass：正常→異常→恢復、重複辨識、401 未授權拒絕、市場隔離、舊值不覆蓋新值、歷史保存、監控指標|signal-verification.json|

訊號服務使用合成設備、臨時測試憑證與隔離 SQLite，由 demo 自行啟停；未連正式設備。未修改任何既存帳號密碼。

## 瀏覽器實際操作（本機已建置靜態副本）
1. 登入頁可開啟；captcha 後端 501 時登入按鈕停用，未放寬認證。
2. 主題可切換，重新載入後仍保留，測試後還原一般版。
3. 忘記密碼空值送出顯示「請輸入有效的電子郵件地址」，未寄信；可返回登入。
4. 帳號申請入口可開啟；單位資料載入失敗時顯示錯誤並停用送出，未建立帳號。
5. 未登入直接開 /v2/systems/admin/users/ 導回登入，未顯示人員資料。
6. V1 /system/login.html 正確導向 V2 登入。
以上為頁面實際操作與可及性狀態觀察，非登入後完整功能或視覺／A4 驗收。

## 尚未驗證與原因
- 本機 Docker 不在 PATH，也不存在於標準安裝位置；無法啟動隔離 Supabase。沒有本次可用的測試後端與專用帳號，所以報修、派車、公文、交接簿登入後 E2E／真實 RLS 無法安全執行。既有離線資料庫測試證據沿用前報，未冒充端到端通過。
- 手機實機背景定位／藍牙／安裝升級、地端 IIS、完整災難恢復演練及 ISO 組織制度證據仍未驗證。
- Expo MCP server 的實際網路連線未測；本次只直接測實際 schema 及轉換，不宣稱整個 MCP 協定驗證。
- OpenCode 模型端點仍不可達，沿用前次阻礙，由 Codex 執行並核對差異。

## 公告來源
- https://github.com/advisories/GHSA-mrhx-c7xc-m3w5
- https://github.com/advisories/GHSA-gcqx-w48m-w2h4

原始證據目錄：C:/projects/Inspection-audit-20261028/audit-evidence/followup。
