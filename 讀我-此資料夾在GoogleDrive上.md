# ⚠️ 這個資料夾在 Google Drive 上，git 與 npm 都會被同步機制弄壞

**最後更新**：2026-08-28（原本寫「已停用，請改用 `C:\claude-code\Inspection`，
但實際上仍在這裡開發，內容已依現況改寫）

## 現況

**這個資料夾仍是開發用的工作區**，與 `origin/main` 同步。
`C:\claude-code\Inspection` 是同一個 repo 的**完整 clone**（非 partial），
兩邊都能推送，靠 GitHub 對齊。

## Drive 會做什麼壞事（都實際發生過）

1. **把 `.git` 裡的檔案改名成 `xxx (1)`**。2026-08-27 是 `refs/heads/main (1)`，
   讓 `git fetch` 噴 `fatal: bad object refs/heads/main (1)`；08-28 是 47 個
   loose object 被改名，`git fsck` 報 181 行 `bad sha1 file`。
   **物件內容其實完好，改回原檔名就修好了**（08-28 已全部還原、驗證連通性無缺物件）。
2. **留下 0 bytes 的 `.git/packed-refs.lock` 與一堆 `next-index-*.lock`**，
   之後每一個 git 指令都會印
   `Another git process seems to be running in this repository, or the lock file may be stale`。
   確認沒有 git 程序在跑之後直接刪掉鎖檔即可。
3. **弄壞 `node_modules`**。08-28 實測：`node_modules/.bin/` 的執行檔不見了、
   `node_modules/typescript/package.json` 內容毀損（`ERR_INVALID_PACKAGE_CONFIG`）。
   **`npm run typecheck:v2`／`build:v2`／`npm test` 在這個資料夾跑不起來。**

## 所以實務上怎麼做

- **編輯、git commit／push：在這裡做沒問題**（git 本身可用，只是要留意上面兩種殘骸）。
- **要跑 npm 的驗證（typecheck／build／test／security:audit）：到
  `C:\claude-code\Inspection` 跑**。那份 clone 的 `node_modules` 是好的。
  流程：這裡 push → 那裡 `git pull` → 跑驗證。
- **每天開工前先看一眼**：

  ```bash
  git fsck --connectivity-only
  ```

  只出現 `dangling` 是正常的；出現 `missing` 或 `bad sha1 file` 就照下面修。

## 修復步驟（Drive 改名造成的 `bad sha1 file`）

```bash
# 1) 把被改名的物件還原回正確檔名（內容通常是好的）
find .git -name "* (*)" -type f | while IFS= read -r f; do
  base=$(printf '%s' "$f" | sed -E 's/ \([0-9]+\)$//')
  [ -e "$base" ] || cp "$f" "$base"
done

# 2) 確認沒有 reachable 物件遺失（只剩 dangling 就是好的）
git fsck --connectivity-only

# 3) 清掉滯留鎖檔（先確認沒有 git 程序在跑）
rm -f .git/packed-refs.lock .git/next-index-*.lock
```

## 這個資料夾為什麼不能刪

- 這是 `blob:none` 的 **partial clone**，本機獨有的舊部署分支
  （`codex/deploy-*`、`deploy/*`、`gh-pages` 等）缺 blob，那些 blob 在 GitHub 上也取不到，
  **無法搬到別的 clone**。
- 有兩個 git worktree 掛在這個 `.git` 上：
  `G:\...\北農巡檢系統-staging`（`codex/staging-test`）與
  `C:\Users\jnfa\.codex\worktrees\6f38\北農巡檢系統`。
- `.git/objects/` 底下還留著幾十個 Drive 複製出來的 `xx (1)` 目錄。
  git 不會去讀（目錄名不是合法的兩碼十六進位），`fsck` 也不再報錯，屬於無害的殘骸；
  要清理請先確認裡面每個物件在正本目錄都有對應且 `git cat-file -e` 通過。

**在確認以上內容都不需要之前，不要刪除這個資料夾。**
