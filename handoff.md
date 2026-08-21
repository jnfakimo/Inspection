# 交接檔 handoff

> 這份只放「下次接手需要知道的事」。完整決策脈絡見 git log、`V1-V2-比較.md`、
> `V2-MIGRATION-MATRIX.md` 與 `SECURITY_POSTURE.md`。

## ⏯️ 目前做到哪

**2026-08-21：把 08-20 交接檔列的四項待辦全部處理完。其中第 1 項查證後發現早已完成
（交接檔過時），第 4 項查出來的問題比原本描述的嚴重得多。**

### 四項待辦的結果

| 項目 | 結果 |
|---|---|
| 1. 跑完工費用 migration | ✅ **早就跑過了**，交接檔過時。函式、權限、schema cache 全部到位 |
| 2. 驗證位置分析與費用開始累積 | ⏳ **仍待實機驗證**，需要有人真的按一次「送出完工」 |
| 3. 認證信件改繁中 | 🔧 六封範本已寫好進版控，**待貼進主控台** |
| 4. `b1_integrated_marker_system` 無窮遞迴 | ✅ 已修（`ec59ab6`），成因與原本的推測不同 |

### 第 1 項：migration 早已套用

`record_repair_completion_cost` 已在正式庫，線上定義與 migration 檔逐行相同、權限正確
（anon 不可執行）、PostgREST 也找得到。實際呼叫一次會執行到守門條件才停，代表欄位參照
沒問題。應該是 08-20 交接檔寫完之後、當天收工之前有人手動在 SQL Editor 補跑的。

### 第 4 項：不是那一頁的問題，是 `floor-utils.js` 的陷阱

`floor-utils.js` 的 `canonicalFloor` 是在**每次呼叫時**才去查 `window.canonicalFloor`
（實作在 `theme.js:17`），而頁面寫的
`function canonicalFloor(f){ return window.FloorUtils.canonicalFloor(f); }`
是最上層函式宣告，**會蓋掉 theme.js 那份全域**，於是「頁面 → FloorUtils → 頁面 → …」
無限彈跳。

**不是偶發**——那兩頁的 `canonicalFloor` 每一次呼叫都必定 stack overflow，樓層比對、
「（本層）」標示、樓層篩選從上線第一天起就沒成功過一次，只是被 catch 成空畫面，
現場不會回報成故障。`guardpatrol` 08-07 由 `23886f7` 修過，但只改了那一頁，
陷阱留在 `floor-utils.js`，另外兩頁繼續踩。

已改成「載入當下」就把實作綁進區域變數，頁面再怎麼覆蓋全域都繞不回來，整類問題根除。
九處 `?v=` 快取版號一併更新。**V2 沒有這個問題也沒被移植過去**：`web/lib/floor.ts`
是自足實作的 ES module，整個 V2 找不到 `window.canonicalFloor`。

### 另外做的

- **3D 模型圖掛上共用頂列導覽**（`1e8bae8`），比照 3D建模系統，動作取自
  `lib/shared-actions`。同一需求今早被 `c18b122` 做過又被 `2276cf8` 以「需求是誤會」
  還原——**那個判斷是錯的**，使用者要的就是 V2 這頁。已在 AGENTS.md 記下具名例外。
- **3D 模型圖再三項**（`28a19ef`）：未選取的樓層不再著色、右下角 HUD 標示現在看的是
  哪一層、底部補上操作說明。
  - 樓層著色改了兩次才對。第一次（`1e8bae8`）只改外框沒設底色，關閉狀態吃到
    `globals.css` 的全域 `.dot{...background:var(--green)}`，變成深綠底。
  - 操作說明**沒有照抄 V1**，理由見下方注意事項。

## 🚦 目前狀態

本機與 `origin/main` 同步在 `28a19ef`，工作區乾淨。本次四個 commit：
`1e8bae8`、`25fbb38`、`ec59ab6`、`28a19ef`。

`tsc` 0 錯、`next build` 通過、`stylelint` 0 錯、`build:pages` 完成、
`scan:pages` 通過（38 頁、73 段內嵌程式）、`security:audit` 錯誤 0／警告 4（與先前一致）。

08-20 交接檔寫完之後另有 agent 推了 26 個 commit（工單完工按鈕、費用紅字、報修統計
圖卡改單一定義、日期欄位在地化、氣象地圖、巡邏打卡版面、3D 模型圖樣式），與上述四項
無關。

## ➡️ 下一步

1. **把認證信件範本貼進主控台（最優先，我做不到）**。主控台 → Authentication → Emails，
   主旨與內文對照表在 `supabase/templates/README.md`。只想先處理實際會寄的，就只做
   **Reset Password**。貼完務必實際跑一次忘記密碼，確認收到繁中信且連結能走完設定新密碼。
2. **驗證費用與位置分析開始累積資料**（從 08-18 延到現在）。`cost_records` 目前
   **零筆** `note = '完工回報自動產生'`，代表這條路徑上線後從未真正被走過。
   建一筆帶場域位置的報修 → 派工給自己 → 進「處理中」→ 送出完工時填零件費與工時費 →
   確認回應**沒有**出現「但費用未寫入費用系統」，兩頁各多一列。名稱註明「驗收測試（勿使用）」。
3. **驗收 `ec59ab6` 的 V1 樓層修正**。整合標記系統的樓層下拉是否正確標出「（本層）」、
   設備頁的樓層篩選是否真的篩得動。**先 Ctrl+Shift+R**。
4. **決定 3D 模型圖的滑鼠鍵位要不要對齊 V1**。V1 是左鍵平移、右鍵旋轉；V2 用
   OrbitControls 預設，是左鍵旋轉、右鍵平移。本次只把說明文字寫成 V2 的實際行為，
   沒有改行為。要一致的話應該覆寫 V2 的 `controls.mouseButtons` 去對齊 V1，
   **不是改文案**。

## ⚠️ 注意事項

**這次新增的**

- **查正式庫改用 `npx supabase db query --linked --project-ref qztffronusdhgxhjjubt "<SQL>"`**。
  走 Management API，CLI 已登入可直接用，比開主控台快很多。Supabase MCP 對正式專案
  仍是 permission denied（已再次確認），舊交接檔寫「只能走主控台」可以作廢。
- **`supabase migration list` 與 `db push` 不可信**。正式庫 `schema_migrations` 只到
  `20260817120000`，之後全是手動在 SQL Editor 跑的、沒進歷史表。`db push` 會想把
  十幾支已跑過的重跑一遍。
- **絕對不要跑 `supabase config push`**。`config.toml` 沒有 `[auth]` 段，CLI 會用預設值
  補滿整份 auth 設定再推上去，`site_url`、Redirect URLs 白名單、JWT 效期全部會被蓋掉，
  直接弄壞正式環境登入。要改認證設定走主控台，或用 Management API 只 PATCH 需要的欄位。
- **信件範本裡不能寫 HTML 註解**。Go 樣板引擎不認得 HTML 註解，寫在註解裡的
  `{{ .TokenHash }}` 一樣會被代入**真實 token** 隨信寄出。初稿犯過這個錯。
- **`recovery.html` 的連結必須維持 `{{ .ConfirmationURL }}`**，不可換成 token_hash 形式。
  登入頁靠網址 hash 的 `#type=recovery&access_token=...` 手動 `setSession`（`d1265ce`
  才修好），換掉會讓整條流程再斷一次，而且畫面只顯示「重設連結已失效」。
- **`npm run build:pages` 會把 `system/*.html` 全部改寫成 CRLF**，`git status` 會冒出
  三十幾個假變動。`git diff` 正規化後無內容差異，**提交前用 `git diff --stat` 確認
  真正改了哪幾個檔**，不要整包 `git add`。
- **3D 模型圖的頂列導覽是使用者明確要求的例外**，AGENTS.md 已記名。請勿再以
  「全螢幕工具頁不掛導覽」為由還原。V1 的 `floor3d.html` 不在例外內，維持不掛。
- **`globals.css` 有一條全域 `.dot{...background:var(--green);margin-top:6px}`**。
  任何叫 `.dot` 的元素只設外框不設底色，就會冒出一個沒人指定過的深綠底，還被往下
  推 6px。要當狀態圓點用時，`background` 與 `margin` 都要明寫覆蓋。
- **移植 V1 的操作說明文案前先確認 V2 的實際行為**。V1 的 3D 頁是自寫控制
  （左鍵平移、右鍵旋轉），V2 的 `FloorStack3D` 用 three.js 內建 OrbitControls 且未
  覆寫 `mouseButtons`，預設剛好相反。照抄文案等於把人指向錯誤的操作方式。

**沿用的**

- **`users.department` 只是副本**，真正來源是 `dept_id` → `departments`，新程式碼一律
  以 `dept_id` 為準、副本只當後備。
- **驗收剛推的修正前先 `Ctrl+Shift+R`**。GitHub Pages 的 CDN 會快取 HTML，舊 HTML 指向
  舊的 JS chunk。改 edge function 則不需要。
- **位置與費用的綁定都是選填**，完工的費用寫入失敗不回滾流程——完工是現場事實。
- **V2 的 CSP 定義在 `tools/build-hardened-pages.mjs`**，不在 `layout.tsx`。
- **新增樣式一律用主題變數**；**手動組 HTML 一定要過 `escHtml()`**；**畫面文案不得夾雜
  資料庫欄位名**，動作與狀態碼一律經對照表轉中文。
- **工作區在 `C:\claude-code\Inspection`**。GDrive 路徑下 `node_modules` 會壞；
  `G:\我的雲端硬碟\AI\Claude\word-cloud` 是落後三百多個 commit 的廢棄鏡像。
- **多個 agent 每天並行推送，且共用同一組 git identity**。推送前務必 `git fetch` 並 rebase。
- **測試資料刪不掉**：41 張表有 `trg_prevent_removal`，只能用狀態停用。測試時填的名稱
  請一律註明「驗收測試（勿使用）」。
- **plpgsql 建立函式時不驗證欄位參照**，新增或修改後務必實際呼叫一次；migration 結尾
  要加 `notify pgrst, 'reload schema';`。

**未處理、另行追蹤**

- 08-19 五個班別的指派人員已永久遺失（當時前端直寫、沒寫稽核）。`f387ed9` 已補上稽核。
- 巡檢與報修的歷史資料無法回填場域位置，位置分析短期內仍會很稀疏。
- 設備巡檢最新一筆停在 2026-06-22、首頁「已打卡」為 0——巡檢流程尚未進入日常使用，
  判讀空畫面時要把這件事考慮進去。
- `exceljs@4.4.0` 帶進來的 `uuid@8.3.2` 有 dependabot moderate 告警。
- `patrol_shift_template` 的範本可套用到日期區間，但仍需人工觸發，沒有排程自動產生。
- `arealist`／`dashboard`／`locations` 三頁載入 FloorUtils 但沒有自己的包裝，走的是
  theme.js 的全域，本次未受影響，也沒動。

## 🕐 最後更新

2026-08-21 09:35 · Claude Opus 5 @ DESKTOP-0CFB6UK · Git push：✅ 已推（`28a19ef`）
· 本次：完成 08-20 交接檔的四項待辦——查證第 1 項早已套用、修好 V1 `canonicalFloor`
  的相互遞迴（三頁受影響、其中兩頁樓層功能從上線起就沒成功過）、六封認證信件改繁中
  並進版控（待貼主控台）；另依需求整理 3D 模型圖：掛上共用頂列導覽（並更正今早
  `2276cf8` 誤判為「需求是誤會」的還原）、未選取樓層不著色、右下角標示顯示中的樓層、
  底部補上操作說明
· 同期另有 agent 推送 26 個 commit（V2 版面與統計圖卡類），與本次四項無關
· L3 Obsidian：未更新（AGENTS.md 未登記 vault 路徑）
