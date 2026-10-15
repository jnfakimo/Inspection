# handoff.md — 交接快照

> 標準在 `AGENTS.md`，進度與證據在 `PROJECT_PLAN.md`，業務與資料規則在 `docs/DOMAIN_RULES.md`。
> 舊版交接紀錄封存於 `docs/archive/2026-10-15-pre-unification/`。

## ⏯️ 目前做到哪

全站版型與色彩統一、戰情元件改接真實資料、正式站驗收與修正、一般版主色幅度調整、資安告警存放與保存期限，
都已合併上線（PR #62–#74）。最後完成：PR #75（`b655a19e6`，2026-10-16）——維修分析與位置分析不計入 `hidden = true` 的測試資料；
正式庫 3 筆 2026-08-25 的 E2E 測試工單與其報修案件已以 migration `20261016090000_hide_e2e_test_workorders.sql` 隱藏
（apply-database-migration run 38820368083，HTTP 201）。Pages 已部署，正式站 JS 已確認含新過濾條件。

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

1. **待公司決定**：資安證據資料表（`security_alerts`、`security_alert_deliveries`、`security_session_blocks`）的保存年限。
   目前等同永久保存，因為專案以 trigger 禁止刪改；要設年限需先決定封存方式（見 `docs/SECURITY_RECORD_RETENTION.md`）。
2. **待決定：車輛 LINE 個人通知要恢復上線還是放棄**（見 `PROJECT_PLAN.md` §20）。2026-10-08 這批從 G 槽直接部署到正式環境
   （5 支 migration、`app-api` v118、`admin-api` v53／v54、`line-notify` v31、`vehicle-line-dispatch-worker` v1），原始碼從未進 main；
   10-15 PR #71／#73 合併時，自動部署已用 main 版覆蓋 `app-api`、`admin-api` 等 8 個 function，所以正式環境的這兩支已不含 LINE 個人通知，
   `line-notify`、worker 與 6 張資料表仍是 10-08 版本。當時功能開關全關、outbox／cron 為 0，預期使用者無感，但開關現況未重查。
   原始碼備份：`G:\我的雲端硬碟\AI\Codex\_backups\g-snapshot-20261015-unpublished\snapshot-9363fb870-unpublished.zip`（146 檔，含分類清單 `manifest.tsv` 與 bundle）。
   G 槽快照分支仍在本機，repo 是公開的，**不要推到這個 repo**。
3. **產品決定**：`app-api` 報修案件列表與 `structuremap-markerboard.tsx` 的報修挑選清單是否也略過 hidden（見 `PROJECT_PLAN.md` §19；
   動到 `supabase/functions/**` 合併後會自動部署 Edge Function）。
4. 色彩統一剩餘項目都需要登入與瀏覽器：`LayoutsAdmin.tsx` 行內樣式、WS-9 兩主題／手機／A4 視覺驗收。
5. 其餘待辦見 `PROJECT_PLAN.md`：全角色權限矩陣、資安 S1–S3、`Obsidian/04` 179 節審閱、`app-api` 拆檔。
6. 日後若要隱藏新的正式測試資料：不要直接執行 `docs/runbooks/hide-test-records.sql` 步驟 2（會被保護觸發器擋下），
   比照 `20261016090000_hide_e2e_test_workorders.sql` 另寫 migration，經 CI 後以 `apply-database-migration.yml` 套用。

## ⚠️ 注意事項

- **工作位置**：G 槽已於 2026-10-16 切回乾淨的 `main`（與 `origin/main` 一致）。開發與測試仍在 C 槽另建 worktree：
  `git worktree add -b <分支> C:\Users\jnfa\Documents\Codex\<資料夾> origin/main`，再以 junction 連 `node_modules` 到 C 執行副本；
  移除 worktree 前**先單獨刪掉 junction**（PowerShell `(Get-Item <路徑>\node_modules).Delete()`），避免連帶刪到執行副本的 `node_modules`。
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

2026-10-16 · Claude Code @ DESKTOP-0CFB6UK · G 槽切回 main、快照內容備份與分類、清理 19 個 worktree 與 3 條已合併分支（分支 `codex/handoff-snapshot-triage`）
