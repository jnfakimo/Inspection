# 2026-10-28 GitHub 修正分支發布驗證

## 發布範圍

以 `origin/main` 的 `939227464` 為基準整合至 `codex/inspection-security-handover-20261028`，保留最新線上人數、巡檢市場限制與派車流程功能。這次發布程式碼至 GitHub 修正分支，不合併 main、不部署正式前端或 Edge、不修改正式資料；密碼政策維持不變。

- 主管帳號可選填上級，支援多階簽核；保留在職、角色、單位與原主管下屬保護，拒絕本人／下屬循環。編輯主管選單排除本人。
- 修復報修工作流程的狀態約束，以及機電三班尚未勾稽時的日結錯誤提示。
- 更新行動端 node-forge、Expo CLI 的 Zod，為 deepmerge 加入可驗證來源的修補與攻擊／相容性回歸。
- 掃描器啟動失敗或中止必須回報失敗；派車 E2E 補齊兩階簽核及越權拒絕。
- 原工作樹的帳號審核可讀性重構及其他無關檔案不納入。測試帳密、token、資料庫與本機環境檔不發布。

## 整合後本機驗證

執行副本：`C:\projects\Inspection-publish-20261028`。原始日誌留在隔離測試目錄 `C:\projects\Inspection-supabase-e2e-20261028\evidence`。

| 檢查 | 結果與證據 |
|---|---|
| 完整 npm test 測試鏈 | 所有項目通過。首輪因 Windows CRLF 導致既有 release-manifest 雜湊不符而中止；將未修改的八個檔案還原為 HEAD 原始位元組後，從失敗項目接續至測試鏈結尾，exit 0。沒有放寬 manifest 或略過測試。見 publish-npm-test.log、publish-test-remainder.log |
| V2 型別 | exit 0；publish-typecheck.log |
| 隔離前端建置 | next build web --webpack，exit 0；publish-frontend-build.log；僅使用本機 Supabase 設定 |
| 資安設計檢查 | 0 錯誤、3 個既有檢視警告；publish-security-audit.log |
| 專案密鑰掃描與 Gitleaks | exit 0；publish-secrets.log、publish-gitleaks.log |
| Semgrep | exit 0；publish-semgrep.log。首次本機共用日誌路徑權限失敗，改用本次隔離日誌／設定路徑後實際完成掃描 |
| 手機回歸 | 資安 6 項、加密儲存 4 項及型別檢查全部通過；先前全新安裝與 Android／iOS 打包證據見 SECURITY_FOLLOWUP_20261028.md |

GitHub CI 將使用此修正分支手動觸發；執行結論以該分支 commit 對應的 Actions 結果為準，以上本機結果不冒充遠端 CI。

## 操作證據與保留限制

先前隔離 Supabase 的水果三班／三階、業管三班／四階、機電三班／日結、存貨／報廢與主管鏈操作證據，見 [交接簿驗證](HANDOVER_CLOSEOUT_VERIFICATION_20261028.md)。這些是整合前相同修正的實際操作紀錄；本次最新 main 整合版完成上表回歸，未再跑整套登入後 E2E。早期報告中「尚無 Docker／測試後端」是當時狀態，後續已建立隔離環境並完成相關操作，見 [隔離驗證](ISOLATED_SUPABASE_VERIFICATION_20261028.md)。

最後一次主管選單排除本人修正已通過型別、建置與帳號合約檢查，但瀏覽器工具當時無法重連，未補驗該選單實際互動。手機實機定位／藍牙、正式 IIS、災難恢復演練及 ISO 組織制度證據仍未驗證。deepmerge 上游 npm audit 低風險公告仍保留，不宣稱全部風險歸零或取得 ISO 認證。

未來正式部署需要另行授權並先套用兩支已在隔離環境驗證的 migration：`20261028160000_restore_repair_workflow_statuses.sql`、`20261028170000_allow_supervisor_approval_chain.sql`，再部署相容的 API／前端及讀回查驗。單純推送此修正分支不會套用正式 SQL。
