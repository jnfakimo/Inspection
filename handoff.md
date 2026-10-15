# handoff.md — 交接快照

> 目前狀態與下一步。標準在 `AGENTS.md`，進度與證據在 `PROJECT_PLAN.md`。
> 舊版 994 行交接紀錄封存於 `docs/archive/2026-10-15-pre-unification/handoff.md`。

## 最後更新

2026-10-15 · Claude Code。主題：全站版型與色彩統一（13 系統／67 子系統）。**分支 `codex/theme-unification` 已合併 origin/main（`294b97168`）並 push；尚未合併進 main、未部署、未開 PR。**

## 這一批做了什麼

- 新增 `web/app/tokens.css`：全站色彩／字型／尺寸 token 唯一正本（科技版 `:root`、一般版 `:root[data-theme="light"]`）。
- `globals.css`、`v1-layout.css`：移除重複的主題定義，`globals.css` 開頭 `@import './tokens.css'`。
- 26 個 CSS 檔的硬編碼 hex 改成 token（506 處）；紙本／列印區刻意保留固定色。
- 移除 `.system-card`／`.maintenance-card`／`.quick-grid a` 的 amber／green／violet 變體（單一主色決策）。
- `tools/color-token-check.mjs` 新增並納入 `npm test`（`npm run test:color-tokens`）。
- 因 token 搬家而調整的檢查：`font-token-check`、`input-select-standard-check`、`metric-card-standard-check`、
  `handover-style-check`、`handover-report-style-fixtures.test`。
- TSX 小改：`handover-workspace.tsx`（`var(--danger-text)`）、`LayoutsAdmin.tsx`（`var(--on-primary)`）、
  `AuditAdminV2.tsx`；`settings.module.css` 的局部 `--ink`／`--muted` 改名為 `--settings-ink`／`--settings-muted`。
- 文件：重寫 `AGENTS.md`、`PROJECT_PLAN.md`、`handoff.md`；新增 `docs/DOMAIN_RULES.md`；舊版在 `docs/archive/2026-10-15-pre-unification/`。
- `package.json` 新增 `test:color-tokens` 並接在 `test:button-standard` 之後。

## WS-8 後續變更（內容寬度、派車頁行內樣式）

- 派車頁 `vehicle-workspace.tsx` 行內樣式全部改為 class（規則在 `admin-workspace.css`），移除對應的 `!important`。
- `tokens.css` 新增 `--content-width`；`v1-layout.css`、`operations.css`、`v1-listpage.css` 移除各頁自訂寬度；
  `tools/system-page-heading-check.mjs` 新增寬度斷言；`AGENTS.md`、`PROJECT_PLAN.md`（第 8 節）、`handoff.md` 同步。
- 已在 C 執行副本驗證：`typecheck:v2` 與 `npm test` 皆 exit 0。這批尚未 commit。

## 驗證狀態

- 已驗證：全部變更（含單一主色、三份新文件）同步到 C 執行副本後，`npm run typecheck:v2` 與完整 `npm test` 皆 exit 0。
- 未驗證：任何瀏覽器畫面（兩主題對比、手機寬度、A4 列印）。瀏覽器啟動曾被環境政策阻擋。

## 怎麼驗證（重要）

G 槽 `node_modules` 不完整，不能在 G 跑 `npm test`／`tsc`。

```bash
# 1. G → C 單向同步（PowerShell；排除相依套件與建置輸出）
robocopy "G:\我的雲端硬碟\AI\Codex\北農巡檢系統" "C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime" /E /R:1 /W:1 /MT:8 /NFL /NDL /NP /NJH /XD node_modules .next .git _pgbackup _pginfo Clipping 創作庫 知識庫 dist_floorplans scratch outputs _site __pycache__ design archive
# 2. 在 C 執行
cd C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime && npm run typecheck:v2 && npm test
```

注意：robocopy 不會刪除 C 內「G 已不存在」的檔案；若守門測試抱怨 C 內的陌生檔案，先確認不在 G 再刪除（上次是
`web/components/CommandCenterNavigation.css`）。

## 下一步（接手者從這裡開始）

1. WS-8 續：依 `PROJECT_PLAN.md` 第 8 節處理行內版面樣式最多的檔案（`LayoutsAdmin.tsx`、`business-handover.tsx`、`vehicle-workspace.tsx`），改為 class。
2. 若能開瀏覽器：一般版／科技版各看一輪代表頁（入口、系統入口、子系統表格頁、交接簿、列印預覽）。
3. 清掉 `modules.ts` 的 `tone` 欄位與 `mobile/page.tsx` 的 `tone` 類別。
4. 集中圖表／標記色盤，縮小 `color-token-check.mjs` 的 `ALLOW_TSX`。

## 接手規則

- 一次只有一個寫入者；換手先在這份檔案寫明，並重查 `git status` 與要改檔案的 hash。
- 只動本次相關檔案；不 `git add .`、不 reset／force-push；commit、push、deploy 需使用者明確授權。
- 新增顏色先改 `tokens.css`（兩主題一起），不要在元件裡寫 hex；要例外先改守門檢查並說明理由。
- 不讀或寫入 secret、不連 production、不停啟使用中的 server。

## 本批備份

- 遷移前的 CSS 備份在本機暫存區（工作階段結束後可能消失）；正式還原依據是 Git 差異與
  `docs/archive/2026-10-15-pre-unification/` 內的舊文件。

## 合併 origin/main（2026-10-15）

- 在乾淨 worktree `C:UsersjnfaDocumentsCodexwt-merge-main-20261015` 建立 `codex/theme-unification`，合併 origin/main 的 36 個 commit（PR #55–#61）。G 槽工作樹與其 167 個未提交修改沒有被動到。
- 19 個衝突檔的解法：先取 main 版本，再用腳本重新套用本批轉換（token 遷移、單一主色、內容寬度、派車頁 class、測試斷言）。main 的修改全部保留。
- `package.json` 以 main 為準，只補回目標檔存在的 `test:metric-card-standard`、`test:font-tokens`、`test:color-tokens`；`test:module-card-standard`、`test:css-source-balance`、`test:request-sequence`、`test:async-load-safety` 的檔案只在 G 槽未追蹤，沒有加入。
- main 原本的 `PROJECT_PLAN.md`、`handoff.md` 封存為 `docs/archive/2026-10-15-pre-unification/*.origin-main.md`。
- 已知問題（main 既有，未處理）：`Obsidian/04-開發與部署.md` 第 1995 行有殘留的 `<<<<<<< HEAD` 合併標記。
- G 槽目前仍在 `codex/html-daily-report-preview`；之後要在 G 繼續工作，需先處理 G 的未提交修改再切到 `codex/theme-unification`。

## 2026-10-15 統一化後續（分支 codex/unification-followups）

- 修正科技版亮色實心底配白字的對比問題（登入按鈕與 9 處標籤、徽章），新增 `--primary-solid`／`--on-primary-solid`／`--on-bright`，並加入守門規則。
- 移除 `tone` 欄位；清除 Obsidian 殘留合併標記；Dependabot 2 項無修補版本，列為已知風險。
- 交接簿雜湊鎖檔 `tools/handover-release-manifest.json` 已隨 `business-handover.css`、`handover-sheet.css` 更新。
- 下一步：登入後頁面的畫面驗收（需使用者登入瀏覽器）、`LayoutsAdmin.tsx` 行內樣式、整理 G 槽未提交修改。

## 2026-10-15 第三輪（分支 codex/unification-round3）

- 按鈕：建模頁、業管組點檢切換收進共用按鈕標準。當班徽章改深綠底。圖表色盤集中到 `web/lib/chart-palette.ts`。
- 已刪除 `.git/packed-refs.lock`。G 槽盤點報告在 `docs/G_WORKTREE_INVENTORY_20261015.md`，未刪除任何檔案。
- 待使用者決定：電視牆模擬數字的處理方式；G 槽 57＋92 個檔案的保留方式。
- 待登入：`LayoutsAdmin.tsx` 行內樣式。

## 2026-10-15 戰情元件改接真實資料（分支 codex/dashboard-live-data）

- `DashboardWidgetContent.tsx` 全部改寫：27 種讀真實資料、5 種顯示「尚未介接資料來源」，行內樣式改為 `web/components/dashboard-widgets.css`。
- 元件清單、統計口徑、資料載入各只有一份（見 AGENTS.md 共用元件標準）。
- 未驗證：電視牆與後台版面預覽的實際畫面（需登入）；市場元件需要帳號有讀取行情看板的權限，否則會照實顯示錯誤。
