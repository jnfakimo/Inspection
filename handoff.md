# 交接檔 handoff

> 這份只放「下次接手需要知道的事」。完整決策脈絡見 git log、`V1-V2-比較.md`、
> `V2-MIGRATION-MATRIX.md` 與 `SECURITY_POSTURE.md`。

## ⏯️ 目前做到哪

**2026-08-19 晚間：3D建模系統 hub 的五個子系統全部移植為 V1 的忠實版本，並通過實機驗收。**

依需求「版型功能不能更改，只把程式碼重寫成專業版本」，逐一對照 V1 原始檔移植：

| HUB | 子系統 | V1 來源 | V2 檔案 |
|---|---|---|---|
| 01 | 3D建模系統 | `modeler.html` | 另一個 agent 已移植，比對確認忠實，未動 |
| 02 | 區域位置表 | `arealist.html` | `structuremap-arealist.tsx` ＋ `.css` |
| 03 | 巡邏點清單 | `patrollist.html` | `patrol-pointlist.tsx` ＋ `.css` |
| 04 | 整合標記系統 | `b1_integrated_marker_system.html` | `structuremap-markerboard.tsx` ＋ `.css` |
| 05 | 3D模型圖 | `floor3d.html` | `structuremap-floor3d.tsx` ＋ `.css` |

HUB-04 與 HUB-05 是全螢幕工具頁，刻意不套 AppShell（V1 自帶 topbar，AGENTS.md 也把
這類頁列為不掛品牌列）。HUB-05 的 3D 算繪沿用共用的 `FloorStack3D`，只替它補了可選的
`apiRef`（resetView／topView／focusMarker），沒有另寫一套 Three.js。

**過程中收斂的三份重複實作**（今天各出過一次問題，規則只寫在一個使用處就會漏）：
- `web/lib/floor.ts`：`canonicalFloor`／`floorOrder`。V1 用 B1=99／1F=101／RF=900，V2 原本
  自己實作了兩份 B1=-1／1F=1／RF=999。`floor_order` **會寫進資料庫**，兩套編號混在同一欄
  會讓 `.order('floor_order')` 失去意義。
- `web/lib/patrol-status.ts`：V1 `patrolstatus.js` 的 `compute()` 移植，巡邏點三色狀態。
- 同檔的 `DELETED_SHIFT_PREFIX`／`isDeletedShift()`：見下方注意事項。

## 🚦 目前狀態

**六頁都已實機驗收通過**（使用者於 23:25–23:28 逐頁確認）：3D建模系統 hub、modeler
（B1F.dxf 12,407 線段群組解析與上傳成功）、區域位置表（4 樓層／280 空間，分組數相加吻合）、
巡邏點清單（4 樓層／19 巡邏點）、整合標記系統（OpenSeadragon 圖面與標記圖層正常）、
3D模型圖（Three.js 堆疊樓層與標記球體正常）。

全程 `tsc` 0 錯、`stylelint` 0 錯、`next build` 通過、`security:audit` 錯誤 0／警告 4。

**08-18 那批（V1→V2 移植收尾、CSP、XSS、兩支 DB migration）仍未實機驗收**，與先前相同。

## ➡️ 下一步

1. **決定當日班別的資料處置（最優先）**。2026-08-19 的五個班別在資料庫裡全部帶著
   `[已刪除]` 前綴，套用 `14e30d3` 之後那天的打卡矩陣會沒有任何班別欄位。看起來是
   實作刪除功能的 agent 拿正式資料測試所致（「中班 16:00–12:00」是 20 小時的班，
   也不像真實排班）。**本次只修顯示邏輯，沒有動任何資料**——要救得把名稱前綴拿掉，
   由使用者決定用 SQL 或在排班頁重建。
2. **抽共用樣式表**：`structuremap-arealist.css` 與 `patrol-pointlist.css` 有相當比例重複
   （樓層分組、統計卡、工具列、視窗都是同一套 V1 清單視覺語言）。當初刻意保持獨立是
   為了讓驗收中的頁面互不影響；現在兩頁都驗過了，可以合併。
3. **接續 08-18 那批的實機驗收**：首頁十個 widget 的趨勢圖是否全 0（RPC
   `repair_monthly_counts` 掛掉的唯一訊號）、氣象 widget、位置分析、系統健康、
   費用記錄、交接簿案件與附件、忘記密碼完整流程。
   **⚠️ 巡檢週期的「開啟新週期」會把所有設備重置為紅燈，現場立刻看得到，先不要按。**

## ⚠️ 注意事項

**這次新增的**

- **巡檢班別的「刪除」是軟刪除**：`a06f2ce` 把名稱前綴成 `[已刪除] 原名`、清空指派人員、
  保留資料列。讀 `patrol_shifts` 的地方共有四處（排班頁、打卡矩陣、首頁當班巡檢、
  `lib/patrol-status.ts`），導入時只有排班頁做了過濾。已收斂成
  `isDeletedShift()`，**新增讀取處請一律套用**。
- **`floor_order` 會寫進 `floor_spaces` 與 `locations`**，一律用 `web/lib/floor.ts` 的
  `floorOrder`，不要再各自實作。
- **`FloorStack3D` 的 effect 依賴包含所有 props**，拉一次滑桿就整個場景重建。目前資料量
  下可接受，若日後樓層或標記大幅增加，這裡是第一個要改的地方（V1 是就地更新位置）。
- **全螢幕工具頁不要套 AppShell**（HUB-04／HUB-05）：面板、工具列與 HUD 都是絕對定位
  貼齊視窗邊緣，塞進 250px 側欄的版面會擠壞。
- **量測對比時要處理 `color(srgb …)` 語法**：現代瀏覽器的 `getComputedStyle` 會回傳這種
  格式，三個分量是 0–1 浮點。用一般的數字擷取會當成 0–255 而算出近黑的假底色——今天
  因此一度回報了十一個不存在的問題。另外要往上層找第一個不透明的繪製底色，不能只看
  元素自己的 `backgroundColor`。
- **CSS 字串替換要小心子字串**：`border-color: var(--x)` 內含 `color: var(--x)`，
  批次替換文字色時會一併誤傷邊框色。

**沿用的**

- **V2 的 CSP 定義在 `tools/build-hardened-pages.mjs`**，不在 `layout.tsx`。
- **新增樣式一律用主題變數**；淺色主題的白名單已於 08-18 廢除，寫死深色沒有保險絲。
  完整規則在 `AGENTS.md` 的 Conventions。
- **手動組 HTML 一定要過 `escHtml()`**；列印優先用 React 列印區塊加 `@media print`，
  不要 `window.open` + `document.write`（資安稽核的建議，也免去彈出視窗權限）。
- **工作區在 `C:\claude-code\Inspection`**。GDrive 路徑下 `node_modules` 會壞；
  `G:\我的雲端硬碟\AI\Claude\word-cloud` 是落後三百多個 commit 的廢棄鏡像。
- **本機 Supabase MCP 看不到正式專案** `qztffronusdhgxhjjubt`，`execute_sql` 會回
  permission denied。要查正式庫請走 Supabase 主控台。
- **多個 agent 每天並行推送，且共用同一組 git identity**（`臺北農產公司
  <jnfakimo@gmail.com>`），事後只能靠 commit 訊息語言與 `Co-Authored-By` 署名分辨。
  推送前務必 `git fetch` 並 rebase。
- **測試資料刪不掉**：41 張表有 `trg_prevent_removal`，只能用狀態停用。測試時填的名稱
  請一律註明「驗收測試（勿使用）」。
- **plpgsql 建立函式時不驗證欄位參照**，新增或修改後務必實際呼叫一次；migration 結尾
  要加 `notify pgrst, 'reload schema';`。

**未處理、另行追蹤**

- 巡邏點清單每列名稱看似重複兩次，是 `note` 欄位存了與 `label` 相同的內容，屬資料非版面。
- `patrol_shift_template` 沒有「樣板 → 每日班表」的產生機制，班表得每天手動建。
- 首頁的當班巡檢 widget 因班別只有 1 小時 × 4 班，約 83% 的時間顯示「目前無進行中班別」。
- `exceljs@4.4.0` 帶進來的 `uuid@8.3.2` 有 dependabot moderate 告警。

## 🕐 最後更新

2026-08-19 · Claude Opus 5 @ DESKTOP-0CFB6UK · Git push：✅ 已推（`14e30d3`）
· 本次：3D建模系統 hub 的五個子系統全部移植為 V1 忠實版本並通過實機驗收；
  收斂 floor.ts／patrol-status.ts 兩個共用模組；修正已軟刪除班別在三處外洩前綴；
  同步 V2-MIGRATION-MATRIX.md、ARCHITECTURE_V2.md 與 modules.ts 的模組名稱
· 同日另有 agent 並行推送：Node.js 後端 runtime、天氣 SVG、ComboboxSelect、
  班別刪除功能、modeler 線寬調整
· L3 Obsidian：未更新（AGENTS.md 未登記 vault 路徑）
