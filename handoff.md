# 交接檔 handoff

> 這份只放「下次接手需要知道的事」。durable 的技術規範寫在 `AGENTS.md`，
> 完整脈絡與踩坑細節寫在 `Obsidian/`，這裡不重複。

## ⏯️ 目前做到哪

**2026-09-11～09-13：app-api 依業務拆檔完成第 2 階段（公務車、會議室）；同時修好多項正式環境問題。**

本次已上線且驗證（細節與 commit／workflow 證據見 `Obsidian/04-開發與部署.md` 9/12、9/13 三筆）：

- app-api 拆檔：`handlers/vehicle.ts`、`handlers/meeting.ts`，共用 `validate.ts`／`audit.ts`／`context.ts`。
- 權限查詢失敗即拒絕；FindTag probe 改回內建 XML 解析器（CI 恢復綠燈）。
- 行情匯入批次表 `market_import_batches`；9/13 蕹菜代碼變更已以官網為準修正。
- 市場公開看板 503 修正（`market_source_date_ranges` 改走索引）；`tsconfig.json` BOM 移除。
- 三本交接簿共用版型、駐衛警→駐警隊命名、四層授權（角色×子系統）、圖面打卡點大小拉桿。

## 🚦 目前狀態

- 正式站正常：最後推送 `d4163fce7`，CI／Edge／Pages／migration 全綠，`market_board_public` 回 200。
- **app-api 拆檔做一半**：已拆 2／8 個業務，其餘仍在 `index.ts`。

## ➡️ 下一步

1. 繼續 app-api 拆檔：巡檢 → 設備 → 報修 → 公文 → 市場 → 交接簿。**每階段前先請 Codex 暫停修改 app-api**；
   做法見 `AGENTS.md`「app-api 依業務拆檔」，每階段須逐行比對純搬移、附 handler 單元測試、deno check 與 `typecheck:api`。
2. 每日行情匯入遇「代碼集合有變」時自動通知並列出品項（目前只會失敗）。
3. 評估北農官網連線逾時頻繁（近 12 次 5 次失敗）的重試或排程調整。

## ⚠️ 注意事項

- **共用 repo 背景維護反覆失敗**（Codex 資料夾 `.git`：`packed-refs.lock` 殘留、partial clone 缺物件）。
  不影響 commit，但工作樹操作常被 `.git/worktrees/Inspection-guard/index.lock` 擋住——先確認沒有 git 行程再刪自己的鎖；
  不要動 Codex 資料夾本身。暫存還原（stash pop）也可能被鎖擋下而未還原，務必確認 `git stash list`。
- **每日行情匯入「代碼集合有變」是刻意的防重複計量保護**：先比對官網彙總與資料庫 `item_key` 找出品項，
  確認後以 migration 原地更新並寫稽核，不可刪資料。
- **Windows 寫檔勿帶 BOM**（deno 讀 tsconfig 會失敗）；Bash heredoc 會吃反斜線，含反斜線的內容改用檔案寫入。
- 冒煙測試所需的公開 anon key 從 `web/lib/config.ts` 讀取（舊 migration 中的 JWT 已移除）。
- 前次（9/5）自架站台登入修復的詳細交接已原文歸檔至 `Obsidian/10-地端移轉與驗收.md` 附錄；地端移轉進度以該文件為準。

## 🕐 最後更新

2026-09-13 21:17 · Claude Opus 5 @ DESKTOP-0CFB6UK
· Git push：待推
