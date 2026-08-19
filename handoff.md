# 交接檔 handoff

> 這份只放「下次接手需要知道的事」。完整決策脈絡見 git log、`V1-V2-比較.md`、
> `V2-MIGRATION-MATRIX.md` 與 `SECURITY_POSTURE.md`。

## ⏯️ 目前做到哪

**2026-08-19 下午：跨 agent 並行稽核 ＋ 四筆對比／版面修正 ＋ SYS-06 部分實機驗收**

**一、修掉一個結構性問題：Claude Code 讀不到本專案的慣例**

`CLAUDE.md` 自 `66e070d`（2026-07-10 誤推）以來，內容從頭到尾在描述另一個
YouTube 逐字稿專案，一個字都沒提到巡檢系統。而 Claude Code 進 repo 會自動載入
它——等於 **OpenCode 讀 `AGENTS.md`（`opencode.json` 有指定）、Claude Code 讀錯的
檔案**，兩個工具各憑各的規則做事。已整份改寫為指向 `AGENTS.md` 為單一事實來源。
誤推的 `Clipping/`、`創作庫/`、`知識庫/` 與兩支 py 腳本未刪，僅在附註標明無關。

**二、並行稽核：實際損害一處，已排除**

逐行比對 08-18 起 12 筆 Claude commit 新增的 194 行是否存活於 HEAD。`.dash-widget`
確認是跨 agent 回歸（08-18 修好淺色主題深底深字 → 08-19 被玻璃擬態改回寫死
`rgba(2,11,24,0.7)`，1.84:1 上線於登入後首頁），但對方已於 `3ee5550` 自行整批撤回
玻璃擬態並修正，採用其版本。XSS 跳脫、CSP、`--blue/--muted/--ink`、`:focus-visible`、
會議室 `color-mix` 五項關鍵修正全數存活。

**三、四筆對比／版面修正（都已推並驗算）**

- `.admin-pager button.active` 科技版是淺藍塊、2.95:1 → `color-mix(--blue 12%, --surface)`，兩版 4.87／5.80。
- 系統設定頁 `.hero span` 與勾選框科技版 1.33:1 看不見 → 改用模組自有的
  `--accent/--accent-text`，淺色版像素級不變。
- 3D建模系統的介接關係區塊水平置中（V1 只設 max-width 沒置中）。
- 巡檢排班的日期列擠成三行 → 包一層 `.admin-toolbar-date` 固定 210px，單列排完。

**四、兩處靜默失敗已補上提示**

`906edd3` 把 modelhub 頁首改成 V1 樣式（方向正確，保留）時移除了錯誤提示；首頁的
`plan_markers`／`checkin_logs`／`patrol_shifts` 三支查詢的 `error` 從未被檢查。兩者
都會讓「查詢被擋」與「真的沒資料」在畫面上完全一樣。已補回，比照 08-06 的 P1-5 sweep。

## 🚦 目前狀態

**本 session 的修正全部已推，並在事後確認仍存活於 HEAD。建置綠燈。**

**實機驗收進度（依下方驗收腳本）**：
- ✅ A1 區域位置表 — 4 樓層／280 空間，`market_id` 修正確認生效
- ✅ A2 3D建模系統 hub — 五張卡版型正確，統計 280＝102＋178 成立
- 🔶 A3 首頁 widget — 只驗了當班巡檢（正常，見下），趨勢圖是否全 0、氣象、widget 總數**未回報**
- ⬜ A4–A7 唯讀、B1–B3 寫入、C 忘記密碼 — **全部未做**

**「目前無進行中班別」已判定不是 bug**：當日 4 個班別（早 09–10／午 13–14／
晚 16:30–17:30／夜 22–23），截圖時 12:24 正好落在早班與午班之間的空檔。

⚠️ **遠端在 12:28–15:56 之間又推了 34 筆**（Node.js 後端 runtime、DXF modeler 移植
V2、天氣 SVG 地圖、ComboboxSelect、多項 3D 檢視器版面調整）。**那批完全沒有經過本
session 驗證**，只確認了 `next build` 仍通過。

## ➡️ 下一步

1. **接續實機驗收**：A3 剩下三項（趨勢圖 12 根柱子是否全 0＝RPC `repair_monthly_counts`
   掛掉的唯一訊號、氣象 widget、widget 總數）→ A4 位置分析 → A5 系統健康 → A6 巡邏點 QR
   → A7 關係圖 → B1 區域位置表**新增一筆**（先前必定失敗的路徑，最重要）→ B2 費用記錄
   → B3 交接簿案件與附件 → C 忘記密碼完整流程。
   **⚠️ 巡檢週期的「開啟新週期」會把所有設備重置為紅燈，現場立刻看得到，先不要按。**
2. **HUB-01 的連結要重新決定**：當初五張卡全連 V1，理由是「V2 沒有 modeler」。
   `c93347e` 之後 `web/app/systems/structuremap/modeler/` 已存在，該理由消失。
3. **科技版尚未實機看過**：本 session 的四筆修正都只做了對比計算與離線預覽。

## ⚠️ 注意事項

**這次新增的**

- **所有 agent 共用同一組 git identity**（`臺北農產公司 <jnfakimo@gmail.com>`，08-18
  由 `jnfakimo` 改名）。事後只能靠 commit 訊息語言與 `Co-Authored-By: Claude Opus 5`
  署名猜是誰做的，很脆弱。**建議各工具設不同的 `git config user.name`。**
- **跨 agent 回歸的固定模式：A 加了保護，B 為了別的目的改同一段時把它拿掉。**
  今天發生四次（`.dash-widget` 顏色、modelhub 錯誤提示、以及兩處未檢查的查詢錯誤）。
  原因是「為什麼要有這個保護」只寫在程式註解裡，改那段的人不會回頭看。
  **要讓別的 agent 遵守的規則，得寫進 `AGENTS.md`，不能只留在註解。**
- **查主題相容性不能只看寫死的顏色**。CSS 變數會被作用域遮蔽——`settings.module.css`
  的 `.page` 就在自己作用域內把 `--ink/--muted/--line` 換成淺色值，那 125 個寫死色值
  全是刻意的。**正確判準：把檔內所有 `var()` 名稱與該檔自己宣告過的清單相減，
  只有差集才會跟著主題跑。** 我用錯方法時產生了 20 個假警報。
- **本機 Supabase MCP 看不到正式專案** `qztffronusdhgxhjjubt`（只列得出
  face-access-control 與 shingyong-hospital），`execute_sql` 回 permission denied。
  要查正式庫請走 Supabase 主控台，不要以為工具壞了。
- **巡檢排班沒有「樣板 → 每日班表」的產生機制**。`patrol_shift_template` 只在排班頁
  被讀取，`patrol_shifts.shift_date` 是每日一列，得有人天天手動建；漏一天，當天的
  儀表板與打卡矩陣都是空的。屬流程決策未動。
- **班別目前是 4 班 × 各 1 小時**，一天只有 4 小時有「進行中班別」，首頁該 widget
  約 83% 的時間顯示「目前無進行中班別」。要不要改成顯示「下一班」是版面決策，未動。
- **`C:\claude-code\_backup\stash-vehicle-v1-2026-08-17.patch`**：08-17 被遠端取代的
  vehicle-workspace 嘗試。**已實測 `git apply` 失敗**（對不上現在的程式碼），要看內容
  請直接開檔，不要套用——套用等於回退 XSS 修補。

**沿用的**

- **V2 的 CSP 定義在 `tools/build-hardened-pages.mjs`，不在 `layout.tsx`**。React 19
  會攔截 `<head>` 的 `<meta>`、Next 的 `metadata.other` 也會被濾掉。
- **新增樣式一律用主題變數**，淺色主題的白名單已於 08-18 廢除，寫死深色沒有保險絲。
  完整規則已寫進 `AGENTS.md` 的 Conventions。
- **手動組 HTML 一定要過 `escHtml()`**（`web/lib/html-escape.ts`）。
- **工作區在 `C:\claude-code\Inspection`**。GDrive 路徑下 `node_modules` 會壞，
  `G:\我的雲端硬碟\AI\Claude\word-cloud` 是落後三百多個 commit 的廢棄鏡像。
- **plpgsql 建立函式時不驗證欄位參照**，新增或修改後務必實際呼叫一次；migration
  結尾要加 `notify pgrst, 'reload schema';`。
- **測試資料刪不掉**：41 張表有 `trg_prevent_removal`，只能停用。測試填的名稱請一律
  註明「驗收測試（勿使用）」。SYS-07 的測試夾具（`TEST-0001`、`SYS07TEST`、
  `CAR-20260817-0008`／`-0012`）已全部停用，請勿指派實際任務。
- **`supabase functions deploy` 不帶參數會部署所有函式**；已移除函式的原始碼留在
  `docs/removed-edge-functions/`，不要搬回去。

**未處理、另行追蹤**

- `exceljs@4.4.0` 帶進來的 `uuid@8.3.2` 有 dependabot moderate 告警。
- Android PWA 一鍵安裝需要 Service Worker，本系統對 SW 有踩雷紀錄。
- 派車排除約束的生效狀態集合仍含 `pending_approval` 與 `completed`。
- 08-18 那批（V1→V2 移植收尾、CSP、XSS、兩支 DB migration）仍未實機驗收。

## 🕐 最後更新

2026-08-19 · Claude Opus 5 @ DESKTOP-0CFB6UK · Git push：✅ 已推
· 本次：CLAUDE.md 指錯專案（Claude Code 讀不到慣例）與 AGENTS.md 主題變數慣例、
  跨 agent 並行稽核（實際損害一處已排除）、四筆對比／版面修正、兩處靜默失敗補上提示、
  SYS-06 的 A1／A2 實機驗收通過
· 同日另有 agent 並行推送 34 筆：Node.js 後端 runtime、DXF modeler 移植 V2、
  天氣 SVG 地圖、ComboboxSelect、3D 檢視器版面
· 該 34 筆已於 08-19 晚間補驗建置層級：TypeScript strict 與 next build 皆通過；
  儀表板新引入的 chart.js 雖是靜態 import，實測首頁初始載入 818 KB、
  僅比登入頁多 29 KB，Turbopack 已切出去，不需改成動態載入。功能面仍未實機驗收。
· 清掉一個殘留的 cherry-pick 狀態（b37424c，內容已以 a06f2ce 提交、兩者 diff 相同），
  以 --quit 只清狀態未動歷史；若再遇到 pull 被 CHERRY_PICK_HEAD 擋住可比照處理
· L3 Obsidian：未更新（AGENTS.md 未登記 vault 路徑）
