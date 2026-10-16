# handoff.md — 交接快照

> 標準在 `AGENTS.md`，進度與證據在 `PROJECT_PLAN.md`，業務與資料規則在 `docs/DOMAIN_RULES.md`。
> 舊版交接紀錄封存於 `docs/archive/2026-10-15-pre-unification/`。

## ⏯️ 目前做到哪

最後完成：PR #78（`875b7215d`，2026-10-16）——**公務車個人 LINE 派車通知重新上線**。五支 migration 已以 apply-database-migration 套用到正式庫，
`admin-api`、`app-api`、`line-notify`、`vehicle-line-dispatch-worker` 已部署，前端（個人設定綁定、後台開關）已上線，worker 排程每 5 分鐘執行。
所有個人通知開關仍是預設關閉，尚未送出任何訊息。之前：PR #75（統計不計入隱藏測試資料、隱藏 3 筆 E2E 工單）、PR #77（G 槽快照分類與 worktree 清理）。

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
2. **車輛 LINE 個人通知啟用步驟（需使用者／管理員操作）**：
   (a) ✅ 2026-10-16 已確認：webhook URL 正確、Use webhook 開啟、Verify 成功（`LINE_CHANNEL_SECRET` 相符）；官方帳號 ID `@ltb9602a`。自動回應訊息仍開啟（使用者決定暫不關閉）。
   (b) ✅ 022443 已完成本人綁定。其他司機可在「個人資料設定 → LINE 派車通知」或「公務車 → 派車申請」頁（僅駕駛名冊人員顯示）自行綁定。
   (c) 管理員在「系統設定 → LINE 推播 → 公務車個人 LINE 通知」開「測試模式」→ 儲存 → 發送個人測試訊息，確認 022443 收到。
   (d) 確認後再開「啟用個人通知」「指派通知」「取消指派通知」。其他司機各自完成綁定才會收到。
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

2026-10-16 · Claude Code @ DESKTOP-0CFB6UK · 車輛 LINE 綁定整合 Codex 防呆邏輯並加入派車申請頁入口（PR #80）；下一步為 (c) 發送測試
