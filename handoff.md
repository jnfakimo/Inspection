# 交接檔 handoff

> 這份只放「下次接手需要知道的事」。完整決策脈絡見 git log、`V1-V2-比較.md`、
> `V2-MIGRATION-MATRIX.md` 與 `SECURITY_POSTURE.md`。

## ⏯️ 目前做到哪

**2026-08-20：把 08-18 那批積了三天的實機驗收全部跑完，七項裡查出四項有問題並修掉；
另外依現場需求做了三項功能，以及一項基礎建設（edge function 自動部署）。**

### 驗收結果（08-18 那批，七項全數完成）

| 項目 | 結果 |
|---|---|
| 首頁十個 widget | ✅ 趨勢圖有資料（`repair_monthly_counts` 正常）、氣象正常、當班巡檢正常 |
| 交接簿案件＋附件 | ✅ 通過（先修好 `5d666e0`） |
| 忘記密碼流程 | 🔧 **整條走不完**，已修 `d1265ce` |
| 位置分析 | 🔧 **資料來源從未被寫入**，已補介接 `9ee0819` |
| 系統健康 | 🔧 **V2 完全沒有錯誤回報**，已補 `fa1f07a` |
| 費用記錄 | 🔧 **完工費用從未介接**，已補 `19a0b27` |
| 設備巡檢 | ✅ 通過 |

**四項問題裡有三項是同一種病**：模組健在、查詢正確、畫面正常，但**資料來源從第一天起
就沒有任何程式會寫入**。這種缺陷 `tsc`／`build`／`security:audit` 全都驗不到，只有實機
會現形，而且現場人員只會看到「空白」不會回報成故障。

### 今天修掉的線上故障

- **排班頁掛了 16 小時**（08-19 16:35 起）。`a06f2ce` 讓範本查詢加了 `.neq('status','inactive')`，
  但正式環境的 `patrol_shift_template` 沒有 `status` 欄位——schema 檔宣告過，那張表卻建得
  更早，`create table if not exists` 對既有表是 no-op，該檔之後也沒重跑。`db611dd`＋手動 DDL。
- **忘記密碼整條中斷**。`lib/supabase.ts` 設了 `detectSessionInUrl:false`，登入頁偵測到
  `type=recovery` 後只切畫面、沒呼叫 `setSession`，`updateUser` 因此失敗；而
  `friendlyError` 的 `/session/i` 規則把 `Auth session missing` 翻成「重設連結已失效」，
  **訊息把人指向完全錯誤的原因**。`d1265ce`。
- **交接簿新增案件帶附件會炸**。`7a3bcfb` 改走 API 時刪掉 `const client = getSupabase()`，
  但附件迴圈還在用 `client`。`5d666e0`。

### 依現場需求做的功能

- **時間欄位統一 30 分鐘級距下拉**（`2372ac2`）。一次換掉全部八處，新增共用元件
  `web/components/TimeSelect.tsx`，已寫進 AGENTS.md 慣例。
- **排班範本可套用到日期區間**（`ac08eaa`）。補上「範本→每日班表」一直缺的產生機制。
- **排定人員只帶駐警隊**（`ac08eaa` 起共四個 commit）。過程中修正了三件事：關鍵字是
  「駐警」不是「駐衛」、單位判斷要以 `dept_id` 為準、已指派但非駐警隊的人仍要能取消。

## 🚦 目前狀態

本機與 `origin/main` 同步在 `59be2b4`。今天共 21 個 commit（含另外兩個 agent 的
`7a3bcfb`、`0085621`、`6de59af`）。

全程 `tsc` 0 錯、`next build` 通過、`stylelint` 0 錯、`deno check` 通過、
`security:audit` 錯誤 0／警告 4（與先前一致）。

**edge function 自動部署已實測生效**（`be91131`）。今天早上同一個坑踩了兩次——前端改
呼叫新 action、後端還是舊版，現場會看到「不支援的動作」。現在 `supabase/functions/**`
有變更就跟著 push 自動部署，當天下午的三次改動全部自動上線（app-api 已到 v17）。

## ➡️ 下一步

1. **跑 `supabase/migrations/20260820150000_repair_completion_cost.sql`（最優先）**。
   完工回報的費用欄位已經上線，但 RPC 還不在正式環境，按下「送出完工」會完工成功、
   費用寫不進去（會回一句「但費用未寫入費用系統」）。跑完**務必實際按一次**——
   plpgsql 建函式時不驗證欄位參照，語法過了不代表跑得動。
2. **驗證兩個新介接開始累積資料**。位置分析與費用統計都要等新資料進來才看得到成效，
   歷史資料回填不了。建一筆帶場域位置的報修、跑一次帶費用的完工，確認兩頁各出現一列。
3. **Supabase 認證信件改繁中範本**。重設密碼信目前是 Supabase 預設的全英文，
   位置在主控台 Authentication → Emails。這是使用者唯一會收到的系統信。
4. **`b1_integrated_marker_system` 的無窮遞迴**。系統健康裡反覆出現
   「Maximum call stack size exceeded」，08-14 在整合標記系統連續 6 次以上、08-17 在
   設備建置系統也有。V2 版本是昨天移植的，要確認成因有沒有一起被搬過去。

## ⚠️ 注意事項

**這次新增的**

- **`users.department` 只是副本**，真正的來源是 `dept_id` → `departments`。兩者會不同步，
  今天因此撞了兩次（排班的人員清單、頁首的單位）。`59be2b4` 已在 `profile` 的源頭補上
  回退，新程式碼**請一律以 `dept_id` 為準、副本只當後備**。
- **驗收剛推的修正前先 `Ctrl+Shift+R`**。GitHub Pages 的 CDN 會快取 HTML，舊 HTML 指向舊
  的 JS chunk。今天因此一度誤判「修正沒生效」。改 edge function 則不需要，重整即可。
- **位置與費用的綁定都是選填**。場域位置主檔或費用未必當下就填得出來，強制必填會擋住
  現場報修與完工。寧可統計不完整，也不能讓人做不了事。
- **完工的費用寫入失敗不回滾流程**。完工是現場事實，費用可以事後補登，但把完工擋下來
  會讓工程師卡在現場。
- **V2 的錯誤回報已補上**（`fa1f07a`）。除了全域例外，`invokeAppApi` 還會過濾出
  「基礎設施型」錯誤主動回報（欄位不存在、函式不存在、權限被拒、schema cache）——
  今天三個故障都是被 catch 起來顯示成畫面訊息，全域監聽器永遠看不到。
- **畫面文案不得夾雜資料庫欄位名**（`2adde01`），動作與狀態碼一律經對照表轉中文
  （`38ce96e`）。兩條都已寫進 AGENTS.md。

**沿用的**

- **V2 的 CSP 定義在 `tools/build-hardened-pages.mjs`**，不在 `layout.tsx`。
- **新增樣式一律用主題變數**；淺色主題的白名單已於 08-18 廢除，寫死深色沒有保險絲。
- **手動組 HTML 一定要過 `escHtml()`**；列印優先用 React 列印區塊加 `@media print`。
- **工作區在 `C:\claude-code\Inspection`**。GDrive 路徑下 `node_modules` 會壞；
  `G:\我的雲端硬碟\AI\Claude\word-cloud` 是落後三百多個 commit 的廢棄鏡像。
- **本機 Supabase MCP 看不到正式專案** `qztffronusdhgxhjjubt`，`execute_sql` 回
  permission denied。要查正式庫請走 Supabase 主控台，或用 `npx supabase` CLI
  （Management API 可用，今天用它查過 edge function 版本）。
- **多個 agent 每天並行推送，且共用同一組 git identity**。推送前務必 `git fetch` 並 rebase。
- **測試資料刪不掉**：41 張表有 `trg_prevent_removal`，只能用狀態停用。測試時填的名稱
  請一律註明「驗收測試（勿使用）」。
- **plpgsql 建立函式時不驗證欄位參照**，新增或修改後務必實際呼叫一次；migration 結尾
  要加 `notify pgrst, 'reload schema';`。

**未處理、另行追蹤**

- 08-19 五個班別的指派人員已永久遺失（當時前端直寫、沒寫稽核）。`f387ed9` 已補上稽核，
  往後刪錯救得回來。
- 巡檢與報修的歷史資料無法回填場域位置，位置分析短期內仍會很稀疏。
- 設備巡檢最新一筆停在 2026-06-22、首頁「已打卡」為 0——巡檢流程目前尚未進入日常使用，
  判讀空畫面時要把這件事考慮進去。
- `exceljs@4.4.0` 帶進來的 `uuid@8.3.2` 有 dependabot moderate 告警。
- `patrol_shift_template` 的範本現在可以套用到日期區間，但仍需人工觸發，沒有排程自動產生。

## 🕐 最後更新

2026-08-20 · Claude Opus 5 @ DESKTOP-0CFB6UK · Git push：✅ 已推（`59be2b4`）
· 本次：完成 08-18 那批七項實機驗收（四項查出問題並修復）；新增時間下拉、排班範本
  區間套用、駐警隊人員過濾三項功能；補上場域位置綁定、完工費用介接、V2 錯誤回報
  三項缺失的資料來源；建立 edge function 自動部署並實測生效
· 同日另有 agent 並行推送：前直寫改走 app-api/admin-api、場域結構圖與交接現場版的
  前直寫收斂、技術規範稽核殘留
· L3 Obsidian：未更新（AGENTS.md 未登記 vault 路徑）
