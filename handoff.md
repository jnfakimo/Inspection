# handoff.md — 交接快照

> 標準在 `AGENTS.md`，進度與證據在 `PROJECT_PLAN.md`，業務與資料規則在 `docs/DOMAIN_RULES.md`。
> 舊版交接紀錄封存於 `docs/archive/2026-10-15-pre-unification/`。

## ⏯️ 目前做到哪

全站版型與色彩統一、戰情元件改接真實資料、正式站驗收與修正、一般版主色幅度調整、資安告警存放與保存期限，
都已合併上線（PR #62–#73）。最後完成：PR #73——通知中心的資安告警副本只留指標、90 天後清除內容；
migration 已透過 `apply-database-migration` 套用到正式資料庫，Edge Functions 已部署。

## 🚦 目前狀態

- **已上線（main，正式站已部署）**：
  - 單一 token 檔 `web/app/tokens.css`、全站單一主色（一般版 `#0371ac`）、守門檢查 `npm run test:color-tokens`。
  - 一般版小字對比 ≥ 4.5:1（報修案件、設備主檔、業管組交接簿實測 0 處不足）。
  - 系統入口三層版型統一（13 個入口已實測）。
  - 電視牆與後台版面預覽 32 種元件：27 種讀真實資料，5 種顯示「尚未介接資料來源」。
  - 市場看板跑馬燈（登入版與公開版）只顯示 `event='board_notice'` 的公告。
  - 資安告警：本體在 `security_alerts`（RLS 強制、僅管理員、append-only）；通知中心副本只放提示與告警編號，
    超過 90 天由 `redact_expired_security_notices()` 清除內容（`platform-log-alert` 每日臺灣時間 03 點呼叫，不實體刪除）。
- **未驗證**：其餘約 50 個子系統頁的逐頁畫面（共用元件與守門測試已涵蓋）。
- **未實測**：保存期限函式要等到有超過 90 天的副本才會有實際清除量；可在 03 點後看 `platform-log-alert` 日誌確認沒有錯誤。

## ➡️ 下一步

1. **使用者執行**（2026-10-16 預覽已確認：3 筆 E2E 工單、對應 3 筆報修案件皆 closed；報修案件已 `hidden = true`、工單仍 `hidden = false`，執行步驟 2 預期 `hidden_orders = 3`、`hidden_requests = 0`）：在 Supabase SQL Editor 依 `docs/runbooks/hide-test-records.sql` 隱藏正式資料中的測試工單
   （先跑預覽確認名單；Claude 的 Supabase 帳號沒有此專案權限，無法代為查詢）。
2. **待公司決定**：資安證據資料表（`security_alerts`、`security_alert_deliveries`、`security_session_blocks`）的保存年限。
   目前等同永久保存，因為專案以 trigger 禁止刪改；要設年限需先決定封存方式（見 `docs/SECURITY_RECORD_RETENTION.md`）。
3. G 槽快照分支 `codex/g-worktree-snapshot-20261015`（151 個檔案，含 22 個 Edge Functions 與 5 個 migration）：
   尚未推送、尚未審查；repo 是公開的，**不要推到這個 repo**。本機備份在 `C:\Users\jnfa\Documents\Codex\backups\g-worktree-snapshot-20261015.bundle`。
   合併進 main 前必須逐項對照 main 的較新版本。
4. 其餘待辦見 `PROJECT_PLAN.md`：全角色權限矩陣、資安 S1–S3、`Obsidian/04` 179 節審閱、`app-api` 拆檔。
5. **待審閱／合併**（未 commit，在工作樹 `C:\Users\jnfa\Documents\Codex\wt-followup-20261016`，分支 `codex/ui-followup-20261016`，基底 `3a8f38229`）：
   維修分析與位置分析不再計入 `hidden = true` 的列（`workorder-extras.tsx`、`LocationAnalysisAdmin.tsx`）、新增 `npm run test:hidden-record-filter`、
   `PROJECT_PLAN.md` 修正 WS-4／WS-7 過時狀態並新增 §19。`app-api` 報修案件列表與標記挑選清單刻意未過濾，見 §19。
6. 色彩統一剩餘項目都需要登入與瀏覽器：`LayoutsAdmin.tsx` 行內樣式、WS-9 兩主題／手機／A4 視覺驗收。`tone` 欄位與圖表色盤已完成。

## ⚠️ 注意事項

- **工作位置**：G 槽工作樹在分支 `codex/g-worktree-snapshot-20261015`，不要在 G 直接開發。
  日常工作用乾淨副本 `C:\Users\jnfa\Documents\Codex\wt-merge-main-20261015`（git worktree，`node_modules` 以 junction 連到 C 執行副本）。
- **驗證**：在上述副本執行 `npm run typecheck:v2` 與 `npm test`；G 槽的 `node_modules` 不完整，不能在 G 跑。Edge Function 另用 `deno check <入口檔>`（本機已安裝 deno），跑完會改動 `deno.lock`，不要提交。
- **資料庫 migration**：用 `apply-database-migration.yml`（workflow_dispatch，可指定 `--ref` 為 PR 分支）。該流程拒絕含 `DROP TABLE`、`DELETE FROM`、`TRUNCATE` 的 migration，
  且必須以 `BEGIN;`／`COMMIT;` 包住；保存期限等需求請用 UPDATE 清除內容，不要實體刪除。套用順序：CI 通過 → 套用 migration → 合併。
- **交接簿雜湊鎖檔**：改到 `tools/handover-release-manifest.json` 列出的 16 個檔案時，必須同步更新雜湊（以 `git show :<path>` 的 blob 計算 SHA-256）。
  Windows 的 CRLF 工作副本會讓本機比對失敗，比對前先 `rm` 後以 `git -c core.autocrlf=false checkout -- <path>` 取回 LF 版本。
  加入暫存區時若檔案原本是 CR／LF 混用，用 `git hash-object -w --no-filters` 加 `git update-index --cacheinfo`，避免整檔被改換行。
- **在 shell 的 `node -e` 內寫含反斜線的 regex 會被吃掉**（`\s` 變成 `s`），斷言會變成永遠通過。regex 請用編輯工具寫進檔案，並加反例斷言證明它會失敗（CodeQL 的 `js/useless-regexp-character-escape` 會抓到）。
- **合併**：這個 repo 不允許 GitHub auto-merge，合併需使用者明確指示；合併 main 會自動部署 GitHub Pages，
  動到 `supabase/functions/**` 會同時自動部署 Edge Functions。
- **推送新分支**：G 槽 repo 是 partial clone，`remote.origin.fetch` 只對應 `main`，所以 `git push -u` 推得上去卻綁不了 upstream（「is not a branch」）。
  先加該分支的 refspec 再綁：`git config --add remote.origin.fetch +refs/heads/<分支>:refs/remotes/origin/<分支>`，接著 `git branch --set-upstream-to=origin/<分支>`。
  不要改成 `+refs/heads/*` 萬用字元，會把所有分支都抓下來。
- **部署後快取**：GitHub Pages 有約 10 分鐘快取，驗收時網址加 `?v=<commit>` 或按 Ctrl+F5。
- **行情資料慢**：首次載入約 10–20 秒（Render Node API 5 秒逾時後才改走 Supabase），偶爾日期查詢會回 503，重試即可。
- **大量讀取保護**：短時間連開多個資料頁可能被強制登出；驗收時一頁一頁慢慢看。
- 一次只有一個寫入者；commit、push、合併、部署都需使用者當次授權；不寫入任何 secret。

## 🕐 最後更新

2026-10-16 · Claude Code @ DESKTOP-0CFB6UK · 本批變更尚未 commit／push（分支 `codex/ui-followup-20261016`）；上一批見 PR #74（分支 `codex/handoff-security-store`）
