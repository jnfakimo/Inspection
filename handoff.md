# handoff.md — 交接快照

> 標準在 `AGENTS.md`，進度與證據在 `PROJECT_PLAN.md`，業務與資料規則在 `docs/DOMAIN_RULES.md`。
> 舊版交接紀錄封存於 `docs/archive/2026-10-15-pre-unification/`。

## ⏯️ 目前做到哪

2026-10-15 全站版型與色彩統一已合併上線（PR #62–#67），電視牆改接真實資料並在正式站實測通過。
最後完成的動作：正式站全面驗收與修正（分支 `codex/admin-hub-accent`，PR 流程中）；入口卡片位置分色已在 PR #68 合併上線。

## 🚦 目前狀態

- **已上線（main，正式站已部署）**：
  - 單一 token 檔 `web/app/tokens.css`，全站單一主色，守門檢查 `npm run test:color-tokens`。
  - 按鈕、內容寬度、當班徽章、圖表色盤統一。
  - 電視牆與後台版面預覽 32 種元件：27 種讀真實資料，5 種顯示「尚未介接資料來源」。
- **正式站已實測**：主入口、電視牆、維修／派工／駐衛警／公務車／交接簿／設備／圖臺／會議室入口，以及報修案件、設備主檔、派車申請、業管組交接簿（含 A4 預覽、科技版對比、375／320px 手機寬度）。
- **做一半**：分支 `codex/admin-hub-accent`——後台入口卡片統一色與文字對比、市場營運分析／市場公開看板／公務車定位追蹤入口改用共用頁首、科技版交接簿第 3、4 班編號改深色字。
- **未驗證**：其餘約 50 個子系統頁的逐頁畫面（共用元件與守門測試已涵蓋，但沒有逐頁看過）。

## ➡️ 下一步

1. `codex/admin-hub-accent` 的 PR 合併並部署後，在正式站確認後台入口與三個舊版入口。
2. **待使用者決定**：一般版三個色彩 token（主色 `#0284c7`、綠 `#059669`、次要文字 `#64748b`）當小字對比約 3.8–4.4:1，略低於 4.5:1；是否調深一階（影響全站色調）。
3. 繼續正式站畫面驗收（需使用者在內建瀏覽器登入）；一頁一頁慢慢看，避免觸發大量讀取保護而被強制登出。
4. 待使用者決定：G 槽 57＋92 個未提交檔案的保留方式（`docs/G_WORKTREE_INVENTORY_20261015.md`）、市場看板跑馬燈是否排除內部資安告警、正式資料中的測試資料（「P0 E2E 維修測試」等）是否排除。

## ⚠️ 注意事項

- **工作位置**：G 槽工作樹仍停在舊分支 `codex/html-daily-report-preview`，並有約 167 個他人留下的未提交修改，不要在 G 直接 commit。
  這次的工作都在乾淨副本 `C:\Users\jnfa\Documents\Codex\wt-merge-main-20261015`（git worktree，`node_modules` 以 junction 連到 C 執行副本）。
- **驗證**：在上述副本執行 `npm run typecheck:v2` 與 `npm test`；G 槽的 `node_modules` 不完整，不能在 G 跑。
- **交接簿雜湊鎖檔**：改到交接簿相關 16 個檔案時，必須同步更新 `tools/handover-release-manifest.json`（以 `git show :<path>` 的 blob 計算 SHA-256）。
  Windows 的 CRLF 工作副本會讓本機比對失敗，比對前先以 `git -c core.autocrlf=false checkout` 取得 LF 版本。
- **合併**：這個 repo 不允許 GitHub auto-merge，合併需使用者明確指示；合併 main 會自動部署 GitHub Pages。
- **部署後快取**：GitHub Pages 有約 10 分鐘快取，驗收時網址加 `?v=<commit>` 或按 Ctrl+F5。
- **行情資料慢**：首次載入約 10–20 秒（Render Node API 5 秒逾時後才改走 Supabase）。
- 一次只有一個寫入者；commit、push、合併、部署都需使用者當次授權；不寫入任何 secret。

## 🕐 最後更新

2026-10-15 · Claude Code @ DESKTOP-0CFB6UK · Git push：見 PR（分支 `codex/admin-hub-accent`）
