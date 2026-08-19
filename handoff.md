# 交接檔 handoff

> 這份只放「下次接手需要知道的事」。完整決策脈絡見 git log、`V1-V2-比較.md`、
> `V2-MIGRATION-MATRIX.md` 與 `SECURITY_POSTURE.md`。

## ⏯️ 目前做到哪

**2026-08-19：SYS-06 設備圖臺兩件事（本機 session）**

一、**模型管理改為 V1 的 3D建模系統 hub**（`structuremap-modelhub.tsx` ＋ 同名 css）。
V2 原本的 `models` 是一張 `floor_models` 維護表格，與 V1 `admin.html#modelhub` 是兩個
不同的東西。依需求把版型與功能對齊 V1：`■ 3D-MODELER v1.0` 註記 → 五張 HUB-01～05
圖卡 → 介接關係面板（流程、說明、空間主檔／已標記／未標記三格統計）。五張卡依需求
**全部連回 V1 頁面**——V2 沒有 modeler（DXF 上傳建模）的對應模組，五張一起留在 V1
才不會走到一半換介面。`floor_models` 的維護介面隨之移除，入口回到 V1 `modeler.html`。

移植時順手處理三件事：卡片由 `<div onclick>` 改為 `<a href>`（原寫法 tab 不到、
無法中鍵開新分頁、螢幕閱讀器讀不出是連結）；卡片底色由寫死的 `rgba(4,17,31,.9)`
改為 `--panel`；五個識別色收斂成 token 並補淺色主題版本（V1 的霓虹色印在白底卡片
上讀不到）。`V2-MIGRATION-MATRIX.md` 原本記載此頁「刻意不搬」，已改寫說明推翻的理由。

二、**修掉一個會讓三個模組失效的 bug**。`structuremap-workspace.tsx` 的 `MARKET`
常數寫成 `'first'`，但 `markets` 只有 `market1`／`market2` 兩列
（`system/sql/locations_schema.sql:66`），而 `floor_spaces.market_id` 與
`locations.market_id` 都是 `references markets(market_id)`。影響：區域位置表讀取
永遠 0 筆、**新增區域直接違反外鍵必定失敗**、專案關係圖的場域清單永遠 0 筆。
常數改放 `lib/config.ts` 的 `MARKET_ID`，與 `LEGACY_BASE` 並列，收成單一來源。

同日另有 agent 並行推送：後台角色建立／編輯、使用者去識別化 RPC、戰情儀表板樣式、
大螢幕專用的 `tv-dashboard`、dependabot uuid 修補與相依套件漏洞閘門。

## 🚦 目前狀態

**本次兩筆已 push（`3950009`、`dbfb367`，rebase 到 `404073b` 之上），但沒有實機驗收。**
驗證只到型別檢查、`next build`（69 頁全過）、`security:audit`（錯誤 0／警告 4 皆為既有）、
`stylelint`，以及把 CSS 與 DOM 兜成離線頁在科技版與淺色版各截圖確認版型。
`models` 頁在 AuthGate 後面，三格統計的真實數字沒有人看過。

**2026-08-18 那批（V1→V2 移植收尾、CSP、XSS 修補、兩支 DB migration）同樣仍未實機驗收。**
SYS-02、SYS-03、SYS-07 是 08-17 驗過的，其餘五個系統都還沒用真實帳號點過。

## ➡️ 下一步

1. **驗 SYS-06 的 `models` 頁**：五張卡是否都連得到 V1 對應頁面、三格統計數字是否
   合理（空間主檔數應等於 V1 區域位置表的啟用筆數）。順帶驗 `market_id` 修好之後，
   **區域位置表能不能成功新增一筆**——那是先前必定失敗的路徑。
2. **實機驗收 08-18 那批**，建議先驗唯讀（首頁十個 widget、位置分析、系統健康、
   巡邏點 QR、關係圖），再驗會寫入的（費用記錄、交接簿案件與附件、交接單草稿）。
   **巡檢週期的「開啟新週期」會把所有設備重置為紅燈，現場立刻看得到，先不要按。**
3. **忘記密碼走一次完整流程**（寄信 → 點連結 → 設定新密碼 → 用新密碼登入）。
4. 深色主題下確認後台對話框、分頁按鈕、會議室分區跳色。
5. 前端直接寫表收斂回 API：第一級（`inspection_cycles`、`cost_records`、
   `official_vehicles`）已有另一個 agent 在做，`app-api` 的 action 與
   migration `20260818150000` 已存在。

## ⚠️ 注意事項

**這次新增的**

- **市場代碼一律用 `lib/config.ts` 的 `MARKET_ID`**，不要在各檔再寫一次字串。
  `markets` 只有 `market1`／`market2`，其餘值會被外鍵擋下。
- **本機 Supabase MCP 看不到正式專案** `qztffronusdhgxhjjubt`（只列得出
  face-access-control 與 shingyong-hospital），`execute_sql` 會回 permission denied。
  要查正式庫資料得走 Supabase 主控台，不要以為是工具壞了。
- **`C:\claude-code\_backup\stash-vehicle-v1-2026-08-17.patch`**：08-17 那份被遠端
  取代的 vehicle-workspace 嘗試，已從 stash 匯出後 drop。**對不上現在的程式碼，
  `git apply` 會失敗**，要看內容請直接開檔，不要套用（套用等於回退 XSS 修補）。

**沿用的**

- **V2 的 CSP 定義在 `tools/build-hardened-pages.mjs`，不在 `layout.tsx`**。
  React 19 會攔截 `<head>` 裡的 `<meta>`、Next 的 `metadata.other` 也會被濾掉。
  改 CSP 要去建置腳本，而且只注入 `v2/` 底下（V1 每頁自帶的 CSP 含 CDN 白名單）。
- **新增樣式一律用主題變數，不要寫死顏色**。V2 預設是淺色主題，寫死深色的新 class
  在白底頁面上會壞掉。
- **手動組 HTML 一定要過 `escHtml()`**（`web/lib/html-escape.ts`）。`document.write`
  產生的列印視窗是 `about:blank`、繼承 opener 的 origin，讀得到 sessionStorage 的 token。
- **本地 `node_modules` 在 Google Drive 路徑下會壞**（曾出現 204 個 0-byte 的
  `package.json`）。工作區請留在 `C:\claude-code\Inspection`。
  另注意 `G:\我的雲端硬碟\AI\Claude\word-cloud` 是舊的廢棄鏡像，落後三百多個 commit，
  不要在那裡動工。
- **用 robocopy 同步到建置目錄會因時間戳判定跳過檔案**，關鍵檔案改用 `cp` 強制覆蓋。
- **plpgsql 建立函式時不驗證欄位參照**——`create or replace function` 成功不代表
  函式可執行，新增或修改後務必實際呼叫一次。結尾要加 `notify pgrst, 'reload schema';`。
- **測試資料刪不掉**：41 張表設有 `trg_prevent_removal`，只能用狀態停用。測試時填的
  名稱／說明請一律註明「驗收測試（勿使用）」。SYS-07 的測試夾具（車輛 `TEST-0001`、
  帳號 `SYS07TEST`、派車單 `CAR-20260817-0008`／`-0012`）已全部停用，請勿指派實際任務。
- **`supabase functions deploy` 不帶參數會部署所有函式**。已移除函式的原始碼留在
  `docs/removed-edge-functions/`，不要搬回去。

**未處理、另行追蹤**

- `exceljs@4.4.0` 帶進來的 `uuid@8.3.2` 有 dependabot moderate 告警，升級會牽動所有匯出功能。
- Android PWA 一鍵安裝需要 Service Worker，本系統對 SW 有踩雷紀錄，要加得先定快取策略。
- 派車排除約束的生效狀態集合仍含 `pending_approval` 與 `completed`，屬流程決策未動。

## 🕐 最後更新

2026-08-19 · Claude Opus 5 @ DESKTOP-0CFB6UK · Git push：✅ 已推
· 本次：SYS-06 模型管理改為 V1 的 3D建模系統 hub（新增 modelhub 元件與樣式、
  移除 floor_models 維護表格、文件同步改寫）、修正 `MARKET='first'` 導致
  區域位置表與專案關係圖失效且無法新增區域的 bug
· 同日另有 agent 並行推送：後台角色管理、去識別化 RPC、tv-dashboard、相依套件漏洞閘門
· L3 Obsidian：未更新（AGENTS.md 未登記 vault 路徑）
