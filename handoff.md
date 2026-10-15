# handoff.md — 交接快照

> 標準在 `AGENTS.md`，進度與證據在 `PROJECT_PLAN.md`，業務與資料規則在 `docs/DOMAIN_RULES.md`。
> 舊版交接紀錄封存於 `docs/archive/2026-10-15-pre-unification/`。

## ⏯️ 目前做到哪

2026-10-15 全站版型與色彩統一、戰情元件改接真實資料、正式站驗收與修正都已合併上線（PR #62–#71），主色幅度調整在分支 `codex/primary-70`。
最後完成：一般版主色改採調整幅度的 70%（`#0371ac`）、看板只顯示後台發布的看板公告（ISO 27001 最小揭露）、G 槽未提交檔案提交到本機快照分支。

## 🚦 目前狀態

- **已上線（main，正式站已部署）**：
  - 單一 token 檔 `web/app/tokens.css`、全站單一主色、守門檢查 `npm run test:color-tokens`。
  - 一般版小字對比 ≥ 4.5:1（報修案件、設備主檔、業管組交接簿實測 0 處不足）。
  - 系統入口三層版型統一（13 個入口已實測）；後台入口與三個舊版入口已改用共用頁首與統一卡片色。
  - 電視牆與後台版面預覽 32 種元件：27 種讀真實資料，5 種顯示「尚未介接資料來源」。
  - 市場看板跑馬燈（登入版與公開版）只顯示 `event='board_notice'` 的公告；資安告警、監控異常、派車提醒與個人通知不會出現。
- **未驗證**：其餘約 50 個子系統頁的逐頁畫面（共用元件與守門測試已涵蓋）。

## ➡️ 下一步

1. **使用者執行**：在 Supabase SQL Editor 依 `docs/runbooks/hide-test-records.sql` 隱藏正式資料中的測試工單
   （先跑預覽確認名單；Claude 的 Supabase 帳號沒有此專案權限，無法代為查詢）。
2. G 槽快照分支 `codex/g-worktree-snapshot-20261015`（151 個檔案，含 22 個 Edge Functions 與 5 個 migration）：
   尚未推送、尚未審查。要保存到 GitHub 前先確認 `design/` 內約 14 MB 圖資是否適合進版本庫；合併進 main 前必須逐項對照 main 的較新版本。
3. 評估資安告警改存專用資料表並限制 RLS 與保存期限（目前只靠查詢條件避免外洩）。
4. 其餘待辦見 `PROJECT_PLAN.md`：全角色權限矩陣、資安 S1–S3、`Obsidian/04` 179 節審閱、`app-api` 拆檔。

## ⚠️ 注意事項

- **工作位置**：G 槽工作樹在分支 `codex/g-worktree-snapshot-20261015`，不要在 G 直接開發。
  日常工作用乾淨副本 `C:\Users\jnfa\Documents\Codex\wt-merge-main-20261015`（git worktree，`node_modules` 以 junction 連到 C 執行副本）。
- **驗證**：在上述副本執行 `npm run typecheck:v2` 與 `npm test`；G 槽的 `node_modules` 不完整，不能在 G 跑。
- **交接簿雜湊鎖檔**：改到 `tools/handover-release-manifest.json` 列出的 16 個檔案時，必須同步更新雜湊（以 `git show :<path>` 的 blob 計算 SHA-256）。
  Windows 的 CRLF 工作副本會讓本機比對失敗，比對前先 `rm` 後以 `git -c core.autocrlf=false checkout -- <path>` 取回 LF 版本。
  加入暫存區時若檔案原本是 CR／LF 混用，用 `git hash-object -w --no-filters` 加 `git update-index --cacheinfo`，避免整檔被改換行。
- **合併**：這個 repo 不允許 GitHub auto-merge，合併需使用者明確指示；合併 main 會自動部署 GitHub Pages，
  動到 `supabase/functions/**` 會同時自動部署 Edge Functions。
- **部署後快取**：GitHub Pages 有約 10 分鐘快取，驗收時網址加 `?v=<commit>` 或按 Ctrl+F5。
- **行情資料慢**：首次載入約 10–20 秒（Render Node API 5 秒逾時後才改走 Supabase），偶爾日期查詢會回 503，重試即可。
- **大量讀取保護**：短時間連開多個資料頁可能被強制登出；驗收時一頁一頁慢慢看。
- 一次只有一個寫入者；commit、push、合併、部署都需使用者當次授權；不寫入任何 secret。

## 🕐 最後更新

2026-10-15 · Claude Code @ DESKTOP-0CFB6UK · Git push：見 PR（分支 `codex/primary-70`）
