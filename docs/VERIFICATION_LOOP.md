# 自動化驗證 feedback loop

目標：agent 改了什麼，就在最早的時間點被對應的測試告知「壞了」，而不是等 CI 隔天才紅。
「改哪個檔 → 跑哪些測試」只有一份對照表：[`tools/affected-tests.mjs`](../tools/affected-tests.mjs)，四層共用。

## 四層

| 層 | 時機 | 實作 | 失敗時 |
|---|---|---|---|
| 1 | 改檔當下（秒級） | `.claude/hooks/post-edit-check.mjs` | exit 2，輸出交回 Claude 當場修 |
| 2 | 結束前（分鐘級） | `.claude/hooks/stop-typecheck.mjs`：補跑第 1 層沒跑成的測試＋`tsc` | block 一次；續跑後只警告 |
| 3 | `git push` 前 | `.githooks/pre-push.mjs`：這次推送變更檔案的對應測試 | 擋下推送 |
| 4 | 每次開工 | `.claude/hooks/ci-status.mjs`（SessionStart）：讀 main 上各 workflow 最近一次結果 | 把紅燈清單交給 Claude |

CI 的完整 `npm test`、gitleaks、semgrep、每日排程（台灣時間 05:00）與 synthetic probe 維持原樣，是最後一道網。

## 對照規則

1. 改測試或 `tools/*-check.mjs` 本身 → 跑它自己。
2. 改 `supabase/migrations/*.sql` → 內文提到該檔名的測試（pglite 資料庫測試），加上 `tools/schema-contract-check.mjs`。
3. 改 `tools/`、`web/`、`supabase/functions/` 的程式碼 → 同目錄的 `<名稱>.test.*`，加上內文 import 該檔的測試與檢查腳本。
   `index`、`route`、`page` 這類通用名稱只看同目錄 sibling，不做反向比對。
4. 單次最多 8 個，超過會標示「已截斷」。

手動查詢：

```bash
node tools/affected-tests.mjs --files supabase/migrations/<檔名>.sql
node tools/affected-tests.mjs --base origin/main --run
```

## 結果怎麼分類

- **失敗**：測試真的失敗 → 擋。
- **缺套件／套件損壞**：視為「未驗證」，不擋、不說通過；Stop hook 會要求在回報中如實說明。
- **逾時／預算用完**：同上，Stop 時補跑。

## 注意事項

- **不要在雲端硬碟（G 槽）上 `npm ci`**：同步層會留下 0 byte 的 `package.json`，pglite 之類的套件會載入失敗。
  請在本機磁碟（例如 `C:\projects\`）的副本安裝與驗證。
- Git hook 要每個 clone 各啟用一次：`git config core.hooksPath .githooks`。
- 推送前測試閘門的緊急略過：`SKIP_PREPUSH_TESTS=1 git push …`，事後要補跑 `node tools/affected-tests.mjs --base origin/main --run`。
- `ci-status.mjs` 需要 `gh` 已登入；沒有就靜默略過。它不會改 `handoff.md`，避免多個 agent 互相覆蓋。
- 回歸測試：`node .claude/hooks/hooks.test.mjs`、`node .githooks/githooks.test.mjs`。
