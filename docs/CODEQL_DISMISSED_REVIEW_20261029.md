# CodeQL 已排除告警複核與修正（2026-10-29）

## 範圍與判定

複核分支：`codex/inspection-security-handover-20261028`。基準提交：`2c94842781370bd29965bded1431e6f14044b526`。
GitHub 上 8 筆告警均於 2026-08-25 以 `won't fix` 排除，但基準提交的分析仍包含這 8 筆命中；不能用「開啟告警 0」當成已修正證據。
本輪逐一讀取排除理由、實際程式與 SARIF 資料流，再以隔離測試驗證修正。沒有修改 CodeQL 規則、排除路徑或告警的全儲存庫排除狀態。

| 告警 | 原理由摘要 | 複核結論與修正 |
| --- | --- | --- |
| #15 `js/bad-tag-filter` | 建置／稽核腳本只處理受信任 HTML，最多漏驗 | 不是直接對使用者輸出 HTML 的 XSS，但漏驗會削弱發布守門，不能視為無風險。`scan-all-pages` 改用 parse5 真正元素與屬性，保留 script 的 src 檢查。 |
| #12 `js/incomplete-multi-character-sanitization` | 同上 | 同一處以 regex 移除 script 不完整；移除這個做法，以 DOM 解析讀取連結與內嵌程式。 |
| #14 `js/bad-tag-filter` | 稽核工具不是安全邊界 | `commercial-readiness-audit` 尚有 script regex，會漏掉合法特殊結束標記。改以共用 parse5 解析器檢查程式語法／外部程式完整性；既有 raw-text 解析保留。 |
| #6 `js/clear-text-storage-of-sensitive-data` | Supabase SDK 預設 localStorage；靜態站無 httpOnly，接受架構風險 | 理由不符合現況：SDK 已使用 sessionStorage，是自訂巡檢橋接額外持久保存 access／refresh token。V1 與同類 V2 均改為僅保存使用者與期限中繼資料，權杖由仍開啟的同來源登入分頁透過 BroadcastChannel 即時傳遞。載入各版本時清除其舊橋接權杖欄位。 |
| #4 `js/bad-code-sanitization` | `System.Collections.Hashtable.c` | 註解無法構成風險判斷。資料流實際為固定 namespace 寫入獨立 JS，未證實可利用注入；仍以專用 JS 字串序列化補上 `<`、`>`、`&`、Unicode 行分隔字元跳脫，避免未來嵌入 HTML 改變風險。 |
| #5 `js/bad-code-sanitization` | `System.Collections.Hashtable.c` | 註解同樣無效。輸入是固定格式 provenance hash，未證實可利用；採相同安全字串序列化並驗證 round-trip，不更動來源程式本文或來源驗證政策。 |
| #2 `js/stack-trace-exposure` | meeting-booking-check 僅 CRON／管理員可呼叫，細節供維運 | 外層 catch 也包住驗證前初始化，不能假設錯誤都經過授權。改回固定繁中訊息＋隨機事件編號；日誌只記服務與事件編號，不記原始例外內容。 |
| #3 `js/stack-trace-exposure` | patrol-timeout-check 同上 | 同樣可能在授權前進入 catch；採同樣最小錯誤回應，既有授權與業務流程不變。 |

## 隔離驗證證據

執行副本：`C:/projects/Inspection-publish-20261028`。私有證據根目錄：`C:/projects/Inspection-supabase-e2e-20261028/evidence/`；測試帳密、session、資料庫與完整私有測試腳本不提交。

| 驗證 | 結果／證據檔 |
| --- | --- |
| 完整 `npm test` | pass；`codeql-full-tests-20261029.log` |
| 新增回歸＋商用稽核測試 | 13/13；`codeql-regression-20261029.log`；已接入 npm test |
| 巡檢 session 與打卡回歸 | 10/10；含舊永久權杖遷移、登出競態、閒置逾時 |
| V2 型別與兩支 Edge Function Deno 型別 | pass；`codeql-typecheck-20261029.log`、`codeql-edge-typecheck-20261029.log` |
| 隔離 V2 webpack 建置 | pass；`publish-frontend-build.log` |
| 未簽署稽核產物建置、全頁掃描、商用稽核 | pass；`codeql-artifact-20261029.log`、`codeql-scan-pages-20261029.log`、`codeql-commercial-20261029.log`；商用稽核 136 頁、0 錯誤／警告 |
| Gitleaks | pass，未發現秘密；`codeql-gitleaks-20261029.log` |
| Semgrep | pass，3 條規則、602 個實際檔案、0 命中；`codeql-semgrep-20261029.log`。初次因預設日誌權限失敗，改用私有獨立日誌位置後完成，未停用規則。 |
| security:audit | 0 錯誤、4 警告：3 個既有人工覆核項目，以及新測試的本機 HTTP Request fixture（不發送網路）；`codeql-security-20261029.log` |
| 真實隔離 Auth＋獨立 Chromium | 6/6；`codeql-session-browser-20261029.json` |

瀏覽器 6 項：V2 實際跨分頁恢復與舊永久權杖移除、V2 逾時拒絕、V2 關閉所有來源分頁後拒絕；V1 實際跨分頁恢復且永久儲存無權杖、V1 登出後拒絕、V1 關閉所有來源分頁後拒絕。V2 使用實際 AuthGate 頁面；V1 使用載入實際 SDK／設定檔的最小測試頁。使用獨立測試 Auth 密碼登入，沒有偽造 JWT；測試阻擋非本機請求，專用 Docker 子網的外連拒絕規則保留。

錯誤外洩回歸在 Node VM 轉譯實際 Deno handler，於驗證前注入含虛構秘密的 Error／物件／字串，確認 HTTP 500 回應與日誌均不含原文。這是隔離 handler 測試，不是正式 Edge 端點故障注入。HTML 回歸覆蓋特殊 script 結束標記、引號內大於符號、假連結、script src 與錯誤語法；JS 字串回歸覆蓋關閉標籤、引號與 Unicode 分隔字元。

## 行為與證據界線

- 密碼與 CAPTCHA 政策、角色／RLS 不變。未接觸正式資料、未部署 Pages／Edge／SQL、未合併 main。
- V1 兩小時期限、V2 十分鐘閒置政策保留。所有來源分頁關閉或瀏覽器不支援 BroadcastChannel 時，新掃碼分頁需重新登入；沒有將永久權杖當成相容性備援。
- 此修正降低長期持久保存 bearer token 的風險，不能防止同來源 XSS 或惡意擴充功能讀取仍有效的 sessionStorage／記憶體。V1、V2 的舊資料各自在載入該版本時遷移，未載入的舊版本鍵值不宣稱已由遠端清除。
- 靜態站改成 httpOnly cookie 需另行設計伺服器端工作階段；本輪沒有偽稱已完成。實際手機掃碼 App 的來源分頁保留行為與不支援 BroadcastChannel 的裝置仍需實機驗收。
- GitHub CI／新 CodeQL 結果須以修正後提交的執行紀錄及 SARIF 確認；本文件提交前不預稱雲端通過。分支修正不表示 main／正式環境已套用。

參考：[CodeQL JavaScript 字串安全說明](https://codeql.github.com/codeql-query-help/javascript/js-bad-code-sanitization/)、[MDN BroadcastChannel 同來源與儲存分區限制](https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API)。

### 登出競態補強

後續覆核發現「恢復中登出」即使拒絕巡檢，SDK setSession 仍可能留下登入狀態。V1 恢復期間不採納 SIGNED_IN 來重建橋接，V1／V2 恢復未獲接受時均清除本分頁 SDK session。兩版本回歸直接驗證晚到回應不復活橋接且呼叫本機 signOut；隔離瀏覽器 6 項重新通過。
