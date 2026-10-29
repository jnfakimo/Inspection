# 隔離環境剩餘驗證與修正報告（2026-10-29）

結果：**pass（下列已執行項目）**。未連線或寫入正式資料，未更動密碼政策，驗證完成當時尚未提交或推送；本次依使用者明確授權，程式與報告一併提交至修正分支 codex/inspection-security-handover-20261028。未合併或部署正式環境。本輪基於修正分支 a069ffc3c，該版本既有 CI 結果不能代替本輪新變更驗證。

## 範圍與隔離

- 原始碼正本：G:/我的雲端硬碟/AI/Codex/北農巡檢系統；執行副本：C:/projects/Inspection-publish-20261028。
- 使用原有隔離 Supabase 與全新復原資料庫 inspection_recovery_20261029_v5；測試前端僅 127.0.0.1:8766，API 僅本機橋接至專用 Docker 網路。
- Auth、REST、Storage、Edge、Kong 使用復原副本；獨立資料卷、唯讀程式掛載。Docker 對外新連線阻擋、cron 不啟用；Playwright 拒絕非測試 origin 與 WebSocket。
- 以復原副本管理員名稱標記驗證 Edge 確實讀到新庫；原隔離來源標記不變。未重設任何現有密碼。
- 失敗中間演練與備份保留；不再使用的 v4 容器已停止，未刪除資料。v5 可供續驗。

## 發現及修正

| 問題 | 修正 | 驗證 |
|---|---|---|
| 備份驗證只檢查 manifest 內列出的檔案，但 --all 會枚舉其他 NDJSON | 拒絕清單外檔案、重複表、錯誤總數、非法名稱、非一般檔案與符號連結 | 修正前可重現；新增反例測試與完整備份測試通過 |
| 還原將 generated 欄位直接 INSERT，會失敗；保留 identity 後序號可能碰撞 | 明列可寫入欄位，generated 由資料庫重算；保留 identity，於交易及表鎖內向前同步序號，不倒退 | PGlite 與真實 PostgreSQL 17 驗證原 ID 15、計算值 50、新 ID 16；高序號不回退測試通過 |
| 水果／業管日期切換尚未完成即可列印舊資料或空白報表 | 以市場、日期與載入成功狀態共同限制預覽／列印；載入失敗不輸出列印區 | 延遲、失敗、重試 6 項瀏覽器情境通過 |
| 機電快速切換日期時過期回應可能覆蓋新資料 | 加入載入世代檢查，忽略過期回應；目前日期未就緒不開預覽／輸出每日報表 | 同組延遲、失敗、重試 3 項及舊回應故意晚到的競態測試通過，三班資料與課長簽核 PDF 正確 |

還原工具仍預設 dry-run，實際執行仍需明確 project ref、--execute 及相符 --confirm；本輪未呼叫雲端 Management API 執行還原。機電日期區間列印使用自己的讀取／錯誤檢查流程，保持可用。

## 完成的驗證

| 項目 | 結果與界線 |
|---|---|
| 備份回歸 | npm run test:backup：10/10，另備份／還原一致性檢查通過 |
| 實際 PostgreSQL 17 還原 SQL | identity、generated 欄位與序號校正通過；探測交易 rollback，未留下測試表 |
| 隔離全庫及資料卷恢復 | 初始核對 49 public users、50 Auth users、1 Storage object、3 水果交接歷程、127 張啟用 RLS 表均相符 |
| 復原後登入及 API | 真實原密碼登入 200、Edge 個人資料 200、REST 200；不是偽造 token 或 mock |
| 復原擴充檢查 | 6/6：副本標記、交接歷程、跨單位 RLS 0 筆、私有附件 SHA-256 一致、匿名附件拒絕、並行讀取 |
| 並行讀取 | 4 路共 40 次，40 次 HTTP 200，無 5xx 或身分混用；含橋接 p95 140 ms，不是正式負載容量承諾 |
| 帳號 Excel 匯入／匯出 | 5/5：大於 5MB 拒絕、錯誤表頭拒絕、合法主管建立／既有帳號跳過／跨單位主管拒絕、下載內容正確且無密碼、測試新帳號停用保留稽核 |
| 三種日報載入防護 | 9/9：機電、水果、業管各延遲／失敗／重試，失敗時不輸出錯誤報表 |
| 過期回應反例 | 機電 2026-10-28 回應故意晚於 2026-10-27，仍保留 27 日的 37.50 元與課長簽核，1/1 通過 |
| A4 PDF | 2026-10-27 三班既有合成資料；機電、水果、業管各 2 頁。六頁逐頁檢視無裁切重疊，機電費用 37.50、課長簽核、水果 3/3、業管 4/4 正確；業管測試點檢表原本 0/27，如實顯示，不代表 27 項現場工作已執行 |
| 本機郵件 | Auth 復原信由本機 Mailpit 捕捉 1 封，未開連結／變更密碼；原密碼仍可登入。不是外部郵件或啟用流程完整驗收 |
| 程式檢查 | typecheck:v2、webpack 隔離 build、handover-source-parity、mechanical-print-fit、handover-style、handover-report-fixtures、git diff --check 通過 |
| 資安檢查 | security:audit：0 錯誤、3 既有人工覆核警告；security:secrets、Gitleaks 通過；行動 test:security-deps 6/6 |

## 復原演練邊界

本次從**隔離合成資料**以 pg_dump 全庫（排除 pg_cron/cron）加資料卷備份，還原到同一 PostgreSQL 叢集的空資料庫與獨立服務容器，復用叢集角色。資料庫恢復及容器啟動階段記錄 11.18 秒，不含後續服務就緒、標記核對及業務驗收，**不是完整 RTO**。

這不能證明另一台實體主機重建、正式備份可解密恢復、真實 RPO、金鑰／角色重建或外部服務恢復。既有 database-backup 工具仍不備份 Auth；此次 pg_dump 演練不能宣稱已擴充正式排程備份範圍。

## 剩餘項目

- 行動 audit：0 critical／0 high／0 moderate／7 low。7 low 為 deepmerge 及其間接相依警示，已安裝唯一版本與 hash-guarded 修補驗證通過；上游仍無修補版本，不隱藏或把警示當結案。[官方公告](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)。
- 固定／數字密碼依使用者要求維持，R-01/R-04 不結案。
- 尚須實體 iOS/Android 的背景定位、離線／重裝、BLE/NFC/QR 及裝置金鑰驗證；不能以 bundle 或桌面瀏覽器取代。
- 正式 IIS 443 實際路徑與版本、正式代理清除偽造來源標頭、正式 CSP、遠端 Python certifi、外部 LINE/Google/簡訊／郵件與真實印表機未驗證。
- 完整異機復原、正式 RPO/RTO、外部通知失敗／重試全鏈路、組織風險簽核與 ISO 制度證據仍待驗；不宣稱已通過 ISO 27001 認證。

## 證據與重跑

原始證據只保留在 C:/projects/Inspection-supabase-e2e-20261028/evidence/，帳密、session、資料庫 dump、附件封存及匯出檔只在隔離私有目錄，不加入 Git。

- restore-before-fix-20261029.log、backup-regression-20261029.log、restore-postgres17-20261029.log
- recovery-drill-20261029.json、recovery-auth-20261029.json、recovery-extended-20261029.json
- import-export-20261029.json、report-readiness-20261029.json、mechanical-race-20261029.json、print-inspection-20261029.json、print-*-20261029.pdf/png、local-mail-20261029.json
- remaining-audit-20261029.json、remaining-*-20261029.log、publish-frontend-build.log

隔離重跑入口：scripts/recovery-drill.py（已有目標庫時拒絕覆蓋）、scripts/recovery-auth-check.cjs、scripts/recovery-extended.cjs、scripts/restore-postgres-probe.cjs、browser-tests/import-export.cjs、browser-tests/report-readiness.cjs、browser-tests/mechanical-race.cjs、browser-tests/print-reports.cjs、scripts/render-reports.py。帳號匯入會建立測試帳號後停用；不得改成正式網址執行。

最後來源核對：G／C 的 16 個發布清單檔案位元組驗證通過。7 個原本未修改檔案僅有換行差異，逐檔確認 G 的 HEAD blob 與 C 完全相同後，還原該 Git blob 的位元組；未改動內容、未放寬 hash 檢查。三個本輪修改元件保留未修改行的原始換行，本輪新增行使用 LF，避免整檔差異。
