# 交接檔 handoff

> 這份只放「下次接手需要知道的事」。完整決策脈絡見 git log、`V1-V2-比較.md`、
> `V2-MIGRATION-MATRIX.md` 與 `SECURITY_POSTURE.md`。

## ⏯️ 目前做到哪

2026-08-18 這天有多個 agent 並行推送，成果分三塊。

**一、V1 → V2 移植完成（八系統 51 模組全部有專屬元件與寫入路徑）**

- 後台管理 7 → 11 模組：補上巡檢週期、費用統計、位置分析、系統健康。
- 駐衛警巡檢：巡邏點 QR 標籤檢視與整批列印（qrcode-generator，動態 import
  切成 20 KB 獨立 chunk），並修掉打卡矩陣「逾期未打卡恆為 0」的統計缺陷。
- 電子交接簿：交接單自動帶入當班設備與報修概況、異常／待辦逐項清單、
  案件建立與 `handover_case_attachments` 附件。
- **戰情儀表板改由版面設定驅動**——先前 V2 能編輯並發布戰情版面，卻沒有任何頁面
  會去讀它，等於設定了沒地方生效。首頁現在讀 `dashboard_layouts` 已發布版本，
  十個 widget 全部到位（含臺灣即時氣象，走既有的 `cwa-weather`）。
- 登入補上「Email 寄重設連結 → 設定新密碼」兩段流程；專案關係圖搬進 SYS-06
  的 relations 模組（內嵌 SVG，未引入 vis-network）；V2 有了自己的 manifest。
- 修掉兩個既有缺陷：`/mobile` 的「掃描設備二維碼」指向已關閉的 `app.html`；
  `/equipment-map` 用公式排出與實際位置無關的假座標。

**二、資安**

- 修補派車報表的儲存型 XSS（`vehicle-workspace.tsx` 的 `document.write` 未跳脫），
  跳脫規則沿用 V1 的 `escHtml()`，抽成 `web/lib/html-escape.ts` 共用。
- **V2 補上 CSP**（V1 是 37/37 頁都有、V2 原本 0 頁）。
- CI 的商用整備稽核排除 `docs/removed-edge-functions/`，連續三次 commit 的紅燈解除。

**三、資料庫（兩支 migration 已套用正式庫並驗證）**

- `20260818120000`：`is_admin()` 對齊 repo 定義，補回漏認的 `sysadmin`。
- `20260818130000`：派車時段排除約束納入 `vehicle_id`。

**四、樣式收斂（美編）**

淺色主題原本是白名單制，新元件一定會漏（儀表板就是這樣變成深底深字）。已改為
元件一律使用主題變數，白名單從 9 條縮到 4 條真正的視覺特化。同時補上
`admin-workspace.css` 依賴卻從未定義的 `--blue`／`--muted`／`--ink`、全域鍵盤焦點樣式，
以及表格在手機的卡片式排列（欄位名由 `ResponsiveTableLabels` 自動從 `<thead>` 注入）。

另一個 agent 同期完成：全站暴露路徑改為 `/Inspection`、V1/V2 操作稽核介面繁中化與
JSON 摘要優化、多項 i18n 與版面調整。

## 🚦 目前狀態

**程式碼全部已推送並部署成功，但這批東西沒有一項經過實機驗收。**

驗證只到「型別檢查、建置、部署、HTTP 200」這一層。SYS-02、SYS-03、SYS-07 是
2026-08-17 驗過的，其餘五個系統與今天新增的全部功能都還沒用真實帳號點過。

Supabase 設定已由使用者完成：Redirect URLs 補上 `/Inspection/v2/login/` 與
`/Inspection/**`（舊的 word-cloud 兩筆保留），Site URL 改為 `/Inspection/system/login.html`。
順帶發現 V1 的忘記密碼在 repo 改名後很可能一直是壞的，這次一併救回。

## ➡️ 下一步

1. **實機驗收**，建議順序：先驗唯讀（首頁十個 widget、位置分析、系統健康、
   巡邏點 QR、關係圖），再驗會寫入的（費用記錄、交接簿案件與附件、交接單草稿）。
   **巡檢週期的「開啟新週期」會把所有設備重置為紅燈，現場立刻看得到，先不要按。**
2. **忘記密碼走一次完整流程**（寄信 → 點連結 → 設定新密碼 → 用新密碼登入）。
3. 深色主題下確認後台對話框、分頁按鈕、會議室分區跳色——這批樣式改動都沒實機看過。
4. 前端直接寫表收斂回 API：第一級（`inspection_cycles`、`cost_records`、
   `official_vehicles`）已有另一個 agent 在做，`app-api` 的 action 與
   migration `20260818150000` 已存在。

## ⚠️ 注意事項

**這次新增的**

- **V2 的 CSP 定義在 `tools/build-hardened-pages.mjs`，不在 `layout.tsx`**。
  React 19 會攔截 `<head>` 裡的 `<meta>`、Next 的 `metadata.other` 也會被濾掉，
  兩種寫法都是「看起來有防護、產出裡卻沒有」。改 CSP 要去建置腳本，
  而且只注入 `v2/` 底下（V1 每頁自帶的 CSP 含 CDN 白名單，覆蓋會壞）。
- **新增樣式一律用主題變數，不要寫死顏色**。淺色主題的白名單已經廢除，
  寫死深色的新 class 不會再有人幫你補救。
- **手動組 HTML 一定要過 `escHtml()`**（`web/lib/html-escape.ts`）。React 渲染天生跳脫，
  但 `document.write` 產生的列印視窗是 `about:blank`、繼承 opener 的 origin，
  讀得到 sessionStorage 裡的 access token。
- **本地 `node_modules` 在 Google Drive 路徑下會壞**（曾出現 204 個 0-byte 的
  `package.json`，`npm install` 噴 `TAR_ENTRY_ERROR`）。要跑本地建置請把
  `package.json` + `web/` 複製到本機路徑再裝。
- **用 robocopy 同步到建置目錄會因時間戳判定跳過檔案**，導致驗證跑在舊檔上。
  關鍵檔案改用 `cp` 強制覆蓋。

**沿用的**

- **plpgsql 建立函式時不驗證欄位參照**——`create or replace function` 成功不代表
  函式可執行。新增或修改資料庫函式後務必實際呼叫一次。
- **新增資料庫函式的 migration 結尾要加 `notify pgrst, 'reload schema';`**。
- **測試資料刪不掉**：41 張表設有 `trg_prevent_removal`，只能用狀態停用。
  測試時填的名稱／說明請一律註明「驗收測試（勿使用）」。
- **SYS-07 驗收留下的測試夾具**（刪不掉，已全部停用，請勿指派實際任務）：
  車輛 `TEST-0001` status=inactive、里程 50123.4；帳號 `SYS07TEST` 已停權；
  派車單 `CAR-20260817-0008`、`CAR-20260817-0012` 兩張 completed。
  正式車 9390-AG 未被動到，里程維持 15000.0。
- **`supabase functions deploy` 不帶參數會部署所有函式**。已移除函式的原始碼留在
  `docs/removed-edge-functions/`，不要搬回去。

**未處理、另行追蹤**

- `exceljs@4.4.0` 帶進來的 `uuid@8.3.2` 有 dependabot moderate 告警，升級會牽動所有匯出功能。
- Android PWA 一鍵安裝需要 Service Worker，本系統對 SW 有踩雷紀錄
  （`patrolcheckin.html` 特地移除舊 SW），要加得先定快取策略。
- 派車排除約束的生效狀態集合仍含 `pending_approval` 與 `completed`
  （未核可的申請就鎖時段、當日已完成的行程永久占住時段），屬流程決策未動。

## 🕐 最後更新

2026-08-18 · Claude Opus 5 @ DESKTOP-0CFB6UK · Git push：✅ 已推
· 本次：V1→V2 移植收尾（三系統補完、戰情儀表板、忘記密碼、關係圖、氣象）、
  資安（XSS 修補、CSP、CI 稽核）、兩支 DB migration 已套正式庫、全站樣式收斂
· 同日另有 agent 並行推送：路徑替換、稽核介面繁中化、i18n 與多項版面調整
· L3 Obsidian：未更新（AGENTS.md 未登記 vault 路徑）
