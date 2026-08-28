# 交接檔 handoff

> 這份只放「下次接手需要知道的事」。durable 的技術規範已寫進 `AGENTS.md`
> （V2 手機版版型規範、樓層平面圖的圖檔與效能、系統子頁標題規範等節），
> 完整脈絡與踩坑細節寫在 `Obsidian/04-開發與部署.md`，這裡不重複。

## ⏯️ 目前做到哪

**2026-08-28：一整天處理現場回報的「系統很慢」與手機版版型，並把圖資效能做了治本。
本機 commit 89 筆（含其他 session）。**

### 圖資效能（治本，四步完成）

平面圖／3D 原本的流程是「下載 4096px 原圖 → `getImageData` → 逐像素重畫 → `toBlob`」，
實測桌機 250～450ms、手機 3～6 倍，且每次切樓層都重跑。改為**上傳時就備好成品圖**：

1. 建模系統 `saveModel()` 產生並上傳 `desktop/`、`light/`、`light/mobile/`、`tech/`、`tech/mobile/`
2. 建模頁新增「⟳ 補產生衍生圖」，為既有樓層補課（不必重傳 DXF）
3. 已執行，35 張衍生圖全部落地（`floorplans` 物件 13 → 48）
4. **四個檢視器**（平面圖、3D 樓層圖、駐衛警立體雲台、整合標記圖臺）改為直接開成品圖

選圖規則收斂成 `web/lib/floorplan-storage.ts` 的 `signFloorPlanVariants()`，四頁共用。

### 其他效能

- **系統圖示 13.6MB → 2.18MB**：24 個被引用的圖示以 1024～1254px 原尺寸進版控（單檔 1～1.5MB），
  但最大顯示只有 88px。縮到 320px（Sprite 依格數換算）；入口頁圖示 2.63MB → 769KB。

### 功能修復

- **公文條碼掃描**：iOS 上「有權限卻沒有影像」是 `decodeFromStream` 重複指派 `srcObject`；
  另補「拍照辨識」（系統相機對焦後的靜態影像），使用者確認可用。
- **日期欄位在 iOS 沒有日曆**：`showPicker()` 對不可見元素會丟例外。觸控裝置改為把原生
  `<input type="date">` 變成覆蓋整個欄位的透明層。使用者實機確認可用，全站約 20 處受益。

### 手機版版型

- **49 個子系統頁首操作按鈕一律靠右**（一條全站規則，並刪掉先前六條分頁專用宣告）
- 巡檢排班、巡邏打卡、逾時推播、派車申請、公務車主檔、駕駛人員、派車紀錄、會議室四頁、
  完工回報等頁的欄位排列收斂

## 🚦 目前狀態

本機與 `origin/main` 同步在 `e030200`，工作區乾淨。`npm run typecheck:v2`、`build:v2`、
完整 `npm test`、`security:audit`（錯誤 0／既有警告 4）全部通過。

**工作區已改為 `C:\claude-code\Inspection`**，Google Drive 上那份已停用（見注意事項）。

## ➡️ 下一步

1. **四個圖資頁實機驗收**：平面樓層圖、3D 模型圖、駐衛警立體雲台、整合標記圖臺。
   看進場速度、圖面是否正常、切換一般版／科技版是否正確。3D 若某層空白，
   代表那層成品圖有問題，可在建模頁重按「補產生衍生圖」。
2. **P0 公文傳送流程跨角色端到端驗收**（`Obsidian/05-待辦清單.md` 唯一未結的 P0）：
   程式與 migration 都已上線，缺登入後實際跑一輪。
3. **追查「上傳回報成功但檔案沒落地」的根因**（見注意事項），目前只有防線沒有解答。

## ⚠️ 注意事項

**這次新增的**

- **工作區改為 `C:\claude-code\Inspection`**。`G:\我的雲端硬碟\AI\Codex\北農巡檢系統` 已停用：
  Drive 同步一天內弄壞 `.git` 兩次（生出重複檔 `refs/heads/main (1)` 讓 fetch 噴
  `bad object`；`packed-refs.lock` 卡 0 bytes）。那份是 `blob:none` partial clone，
  本機獨有的舊部署分支缺 blob 搬不過來，且掛著兩個 worktree，所以**保留不刪**，
  根目錄放了 `讀我-此資料夾已停用.md`。
- **上傳回報成功但檔案沒落地（根因未明）**。補產生衍生圖前兩次回報「35 張」，實際 0 張；
  已排除專案接錯、RLS、桶限制、觸發器、Service Worker、部署未生效，並實測 Storage API
  會正確拒絕無效身分。第三次成功前唯一差異是硬重整。**不要只看 `upload()` 的 error**——
  現在的程式會要求 `data.path` 並在事後 `storage.list()` 實際數過才回報數字，這條防線要留著。
- **不要用行內樣式排版**。`style={{...}}` 優先序高於任何選擇器，media query 蓋不過去。
  今天被擋三次（`LocalizedDateInput` 的原生日期欄位、會議室彈窗按鈕列、巡檢排班外框）。
- **手機版「明明空間夠卻換行」先查 `flex-basis`**，不是 `flex-wrap`：`flex:1 1 auto` 會取
  內容寬度當基準，先佔滿一行把後面的項目擠下去。
- **`display:contents` 的容器要先改回 `display:flex` 才能分列**（巡邏打卡工具列）。
- **改版型後用建置產出的實際 CSS chunk 建靜態重現頁量測**，並**務必把基礎樣式 chunk 一起載入**
  ——只載含新規則的那一個會量到錯誤結果，今天差點誤判規則沒生效。
- **驗證線上部署用「本機建置的 chunk 檔名去線上對抓」**：V2 多數頁面的 CSS/JS 是動態載入，
  只掃 HTML 裡的 `<link>`／`<script>` 會漏掉。
- **圖示一律收在 320px 以內**再進版控（`npm test` 會擋下超過 200KB 的系統 Logo）。
  不要用 256 色量化：實測 3D 光澤圖示在 88px 顯示時色差 RMS 達 5～17，看得見色帶。

**沿用的**

- **查正式庫用 `npx supabase db query --linked --project-ref qztffronusdhgxhjjubt "<SQL>"`**。
  Storage 也可用 `supabase storage ls ss:///floorplans/ --experimental`（但 `cp` 在此版本
  不支援遠端↔本機，無法從命令列上傳）。
- **`supabase migration list` 與 `db push` 不可信**；**絕對不要跑 `supabase config push`**。
- **`users.department` 只是副本**，以 `dept_id` 為準。
- **驗收剛推的修正前先 `Ctrl+Shift+R`**（GitHub Pages 的 CDN 會快取 HTML）。
- **多個 agent 並行推送**，推送前務必 `git fetch` 並 rebase。今天撞到多次，
  `Obsidian/04-開發與部署.md` 也發生過內容衝突（兩邊都往檔尾追加，解法是兩段都保留）。
- **測試資料刪不掉**（41 張表有 `trg_prevent_removal`），名稱請註明「驗收測試（勿使用）」。
- **收工前看一眼 CI**。

**未處理、另行追蹤**

- `tools/build-floorplan-variants.py` 是衍生圖的批次備援（需 service_role key），
  主線走建模頁的按鈕，這支保留給 CI／批次重產。
- 成品圖是「烘死」的：日後若改 `renderNeon` 或 `preparePlanCanvas` 的演算法，
  要重按一次「補產生衍生圖」。
- `RF.png` 在 Storage 沒有 `mobile/` 版本（選圖邏輯會自動退回原圖）。
- 會議室的「最後可預約刻度」寫死 23:30；`exceljs` 帶進的 `uuid@8.3.2` 有 dependabot 告警。

## 🕐 最後更新

2026-08-28 20:43 · Claude Opus 5 @ DESKTOP-0CFB6UK · Git push：✅ 已推（9863551）
· 本次：圖資效能治本（上傳時產生成品圖＋四個檢視器直接開，桌機省 250～450ms、
  手機省 1～2.5 秒、3D 再乘 7 層）、系統圖示 13.6MB→2.18MB、公文掃描器與 iOS 日期日曆修復、
  49 個子系統手機版頁首靠右、工作區搬離 Google Drive
· 新規範已寫進 AGENTS.md：V2 手機版版型規範、樓層平面圖的圖檔與效能（含兩個已驗證無效的方向）
· 新增 5 條 `npm test` 斷言：頁首靠右、禁止逐頁複製該宣告、系統 Logo 200KB 上限、
  選圖邏輯必須留在共用檔案、短效連結（放寬為接受 `signFloorPlanVariants`）
· L3 Obsidian：repo 內 `Obsidian/`，本日 11 筆紀錄已寫入 `04-開發與部署.md`
