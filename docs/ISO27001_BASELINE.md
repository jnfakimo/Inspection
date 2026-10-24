# ISO/IEC 27001 系統導入基準

更新：2026-10-24。目標由使用者確認為「先讓巡檢系統符合要求，建立日後驗證基礎」。
本文件不是驗證證書或完整適用性聲明（SoA），不宣稱組織已符合標準。

## 範圍與證據管理

先盤點巡檢系統的開發、維運、資料處理、主機、雲端、行動裝置及委外介面。
納管法人、部門、場所、資料所有人與 ISMS 負責人仍待確認；沿用公司既有核定制度，避免另建矛盾規則。
以 ISO/IEC 27001:2022 與 Amd 1:2024 為基準，控制適用性依風險評估決定，保留納入／排除理由。

證據狀態應區分：待盤點、已發現、已提出措施、程式已修正、隔離驗證通過、正式環境已驗證、權責人結案。
掃描 0 命中不等於控制有效；流程執行失敗或結果缺漏不能判定通過。管理階層核准與剩餘風險接受不能由程式自動代替。

## 控制與證據待辦

| 項目 | 目前基礎／缺口 | 結案所需證據 |
|---|---|---|
| 範圍、政策與責任 | 技術範圍已辨識；組織資料尚待取得 | 核定範圍、利害關係人、政策、職責與量測目標 |
| 風險與 SoA | 已有技術發現，尚非完整風險評估 | 資產清冊、評估準則、風險所有人、處理及剩餘風險接受、SoA |
| 帳號及權限 | 固定初始密碼與數字密碼限制仍待改善；已有部分權限測試 | 啟用、首次設密碼、特權驗證、停權、複核及角色越權測試 |
| 弱點、安全開發及發布 | 本次修正 Next.js、certifi 與發布管制 | 修補版本、掃描／測試、PR、必要檢查、部署及正式讀回證據 |
| 資料、手機及基礎設施 | 加密儲存、CSP、代理、主機／網路現況待後續 | 分類、保存、裝置加密、信任邊界與實際環境驗證 |
| 備份與持續營運 | 已有程序；獨立匯出不含 Auth；RPO／RTO 尚待核定與實測 | 資料／附件／帳號／設定恢復演練、計時、備份及金鑰異地恢復 |
| 事件、供應商與人員 | 有部分告警程式；組織證據未取得 | 通報演練、證據保全、供應商責任／契約、訓練與離職流程 |
| 內稽、管理審查與矯正 | 本次尚未取得組織紀錄 | 客觀內稽、缺失原因與措施、管理審查、有效性與結案 |

備份既有資料見 [DATABASE_BACKUP_RECOVERY.md](DATABASE_BACKUP_RECOVERY.md) 與
[治理流程](../Obsidian/07-資料庫備份與復原流程.md)。不得把歷史平台方案、備份成功或尚未量測的復原目標當成現況。

## 2026-10-24 技術修正

1. Next.js 16.3.8 → 16.4.3；根 npm audit 由 1 個 critical 套件節點降為 0。
2. certifi 2026.7.22 → 2026.10.19；uv 設定版本下限，隔離安裝、10 項服務測試與正式相依鎖檔掃描通過。
   此結果不涵蓋可選協定與開發相依，前次辨識的 filelock 問題沒有在本批修補。
3. main 已設定 PR 與 8 項必要檢查、最新分支要求、管理員強制遵守、禁止 force push／刪除。
   必要檢查：Application tests and API build、static-security、static-audit、CodeQL Analysis (javascript)、
   iis-powershell-compatibility、mobile-vehicle-tracker、gmail-repair-linux、signal-service-security。
   單人維護階段未強制另一人核准 PR；日後依職務分離要求增設審查人。不得將此描述為雙人覆核已落實。
4. 網站及 Edge Functions 自動部署使用共同 gate，等待同一 main SHA 的 CI、CodeQL、Commercial readiness，
   發布前再次確認；其他分支／PR／舊成功／工具錯誤不得放行。手動資料庫 migration 仍沿用既有獨立核准流程。
5. `security_audit_runner.py` 不再從技術掃描推導 ISO 合規；空輸出、執行失敗、不完整回應及漏掃會回傳非成功。
   正確標示內建規則與 Python 執行環境範圍；保留歷史報告並更正結論。14 項離線回歸通過。

### 驗證及發布證據

- 隔離測試：`C:\projects\Inspection-security-audit-20261024`，使用獨立 npm 相依及 Python venv，不改動使用中的開發服務。
- Next.js 型別、靜態匯出、hardened artifact 與 Commercial readiness 均通過；9 項部署 gate 測試通過。
- 首輪 npm test 在交接簿檔案雜湊因 Windows CRLF 差異中止；確認內容僅換行差異後，將執行副本還原為 Git blob 位元組，16 檔雜湊檢查與後續測試通過；未更改 manifest 或正式程式以略過測試。
- 最後重新執行完整 `npm test` 已以 exit 0 通過，紀錄為 `next-full-tests-final.log`；YAML 語法／流程依賴、`git diff --check` 及本機 IIS 相容測試亦通過。
- 主分支保護已透過 GitHub API 寫入並讀回。PR [#95](https://github.com/jnfakimo/Inspection/pull/95) 的 8 項必要檢查全部成功後合併，版本為 `83eb3b2b52f5ba358356bd100ef4481e44d60533`。
- 合併版 [CI](https://github.com/jnfakimo/Inspection/actions/runs/40042849592)、[CodeQL](https://github.com/jnfakimo/Inspection/actions/runs/40042849517)、[Commercial readiness](https://github.com/jnfakimo/Inspection/actions/runs/40042849539) 均成功；[Hardened Pages](https://github.com/jnfakimo/Inspection/actions/runs/40042849467) 的閘門、封裝、部署及部署後全頁掃描均成功。
- 線上 `provenance.json` 的簽章標記及 commit 已讀回一致，`/v2/login/` 回應 HTTP 200。本批沒有變更 Edge Function 原始碼，因此未觸發 Edge Functions 重新部署；已發布其後續使用的安全 gate。
- Python 訊號服務文件目前定位為未接正式設備／戰情室的本機原型；本機未發現常駐程序或正式 venv。若其他主機有獨立安裝，仍須盤點其版本並更新，不能用 Git 鎖檔推論遠端執行環境已修補。
- 原始驗證紀錄：`C:\AI\_logs\inspection-security-20261024`。含相依掃描、建置、測試及分支保護讀回；不含秘密值。

## 後續步驟

確認 Python 訊號服務是否在其他主機安裝；若有，依新鎖檔更新環境並重驗 certifi。主分支目前由必要檢查及發布 gate 保護；後續改動仍須在同一 commit 通過檢查。
其餘帳號、手機、CSP、代理與組織制度控制維持待辦，未列為本批已修正。

參考：[ISO 標準說明](https://www.iso.org/standard/27001)、[2024 修訂](https://www.iso.org/standard/88435.html)。
