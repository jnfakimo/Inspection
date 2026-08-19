# CLAUDE.md

本檔由 Claude Code 進入這個 repo 時自動載入。

## 先讀這個

**這個 repo 是臺北農產運銷第一果菜市場的巡檢／報修／派工系統。**
完整的技術慣例、資料庫順序、RBAC、Git 流程一律以 **[`AGENTS.md`](AGENTS.md)** 為準——
那是所有 AI 代理（Claude Code、OpenCode、Antigravity）共用的單一事實來源，動工前請讀完。

其餘背景：`PROJECT_CONTEXT.md`（架構與上手）、`ARCHITECTURE_V2.md`、
`V2-MIGRATION-MATRIX.md`（V1→V2 對照）、`SECURITY_POSTURE.md`、
`handoff.md`（**每次收工改寫，記載目前做到哪與待驗收項目，開工必讀**）。

## 幾條最容易踩的

這些在 `AGENTS.md` 都有完整版，列在這裡是因為踩過：

- **多個 agent 會同時推送**。動工前 `git fetch`，推之前再 fetch 一次並 rebase。
  已經發生過兩個 agent 在同一小時內修同一個缺陷、方向相反的情況。
- **不要寫死承載文字的顏色**。V2 預設是淺色主題，而淺色主題的白名單保護已於
  2026-08-18 廢除，寫死深色背景沒有東西接得住。詳見 `AGENTS.md` 的 Conventions。
- **不做實體刪除**。41 張表有 `trg_prevent_removal`，只能用狀態停用。
- **未經明確允許不要開 PR**。推送依 `AGENTS.md` 的 Git workflow。
- **共用頁首的圖示、順序與元件是鎖定的**，除非使用者明確要求更改該項標準。

## 附註：repo 內與本系統無關的內容

`Clipping/`、`創作庫/`、`知識庫/`、`extract_videos.py`、`download_all_subs.py`
屬於另一個 YouTube 逐字稿知識庫專案，於 `66e070d`（2026-07-10）被誤推進本 repo，
與巡檢系統無關。尚未清理，但**不要把它們當成本系統的一部分**；本檔在 2026-08-19
之前的內容全部是在描述那個專案，導致 Claude Code 在此 repo 讀不到任何生產慣例。
