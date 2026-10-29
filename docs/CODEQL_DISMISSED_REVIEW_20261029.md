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

## GitHub CodeQL 複驗與剩餘告警 #59

程式提交：`f4d9e09cf32e32f28279aa80a2bdffd9415a1a3f`（含主修正 `c2d4905b48c7467f56c68a5d8c159e996592a904`）。[CodeQL 執行 40797879167](https://github.com/jnfakimo/Inspection/actions/runs/40797879167) success；分析 ID `2050262611`、CodeQL 2.27.3、error 為空。SARIF 實際結果由基準的 8 筆降為 **1 筆**：原 #2/#3/#4/#5/#6/#12/#14/#15 均不在新結果內。

新結果是 [#59](https://github.com/jnfakimo/Inspection/security/code-scanning/59)，規則 `js/clear-text-storage-of-sensitive-data`，指向 V1 `write()`。逐一追蹤 SARIF 四條路徑，來源為舊巡檢紀錄的 getItem，流入 JSON.stringify 的欄位只有 `user_id` 與 `valid_until`；輸出物件以白名單重建，另外只有固定 version，沒有 access_token／refresh_token。它將含敏感資訊的舊紀錄整體標成敏感來源，沒有區分遷移後的非認證欄位。因此本輪將其判為「對 bearer 憑證持久儲存風險的誤報」，不是尚未移除的權杖副本。

證據：`codeql-f4d9e09cf.sarif`、13 項回歸中的 V1 舊紀錄遷移與永久儲存欄位驗證，以及真實 SDK 跨分頁瀏覽器驗證。身分 ID 仍是可識別帳號的中繼資料，沒有宣稱匿名；只持有這個 ID／期限不能建立有效工作階段，還要取得活躍同來源分頁的真實 Auth 憑證並由 Auth 驗證。

**#59 保持 open，沒有修改告警狀態、降級或加入掃描排除。** 原 8 筆的歷史 dismissed 狀態也保留，因此 GitHub 全域清單不能用來推論新分析仍有 8 筆。結論是原 8 筆已修正／補強，新分析 1 筆已完成人工資料流覆核，不能寫成 CodeQL 零告警。

[CI 執行 40797876205](https://github.com/jnfakimo/Inspection/actions/runs/40797876205) 對應上述程式提交，六項工作全部 success：Application tests and API build、static-security、mobile-vehicle-tracker、signal-service-security、iis-powershell-compatibility、gmail-repair-linux。此節文件提交不改產品程式。

## 2026-10-29 #59 再複核與排除決策

使用者本輪明確要求再確認，若為誤報則附完整理由排除。本輪重新讀取 GitHub 告警／instances 與分析 2050262611 的 SARIF；#59 僅有修正分支的 instance，程式仍為 f4d9e09cf（後續 8f6193ca2 僅文件）。本次新增測試與文件，不修改產品程式、掃描規則或排除路徑。

### 資料流與敏感性判定

四條 SARIF 路徑的共同來源是 `system/supabase-config.js:119` 的 getItem，sink 是第 116 行的 write。兩條路徑是 user_id 經遷移白名單進入序列化（其中一條包含物件欄位步驟）；一條是 valid_until 經遷移寫回；另一條是同一使用者登入時保留原 valid_until。所有 sink 都明確重建 `{version:1,user_id,valid_until}`，沒有擴展原物件，也沒有 access_token、refresh_token、密碼、電子郵件或額外巢狀欄位。

此告警的敏感來源標記沿著舊紀錄傳遞到了非認證欄位；從實際四條路徑與輸出白名單判斷，是對「仍在持久保存認證秘密」的誤報。user_id 是帳號識別中繼資料，不能兌換工作階段、不能作為 API 授權，也不是密碼／API key。valid_until 是本機 UX 期限，不能作為後端授權證據。二者不是匿名資訊，也沒有宣稱加密；持有它們不會獲得 bearer 憑證。

恢復登入需要本分頁既有的真實 Auth session，或仍開啟且身分相符的同來源分頁回覆暫存憑證，再交給 SDK setSession。送出者在讀取 session 前後檢查中繼資料與使用者一致；恢復端也檢查身分與期限，未接受的恢復會清除本分頁 SDK session。後端 Auth／RLS 不以 localStorage 身分作為授權依據。

### 本輪可重現驗證

- `npm run test:codeql-dismissed`：16/16 pass。新增三個 #59 專項測試，直接執行實際 V1 橋接程式：追蹤遷移／登入／更新的每筆 setItem，逐筆確認恰好三個白名單欄位，額外敏感欄位均未寫入；僅中繼資料且無活躍 session 時不呼叫 setSession；既有登入身分與中繼資料不同時不借用該 session。
- 真實隔離 Supabase Auth＋Chromium：7/7 pass。重驗先前六項，另新增「活躍來源分頁仍開啟時，竄改 user_id 為另一個身分，新分頁恢復失敗且 SDK session 為空」。V1、V2 的永久儲存均未留下權杖。
- 證據：私有 evidence/codeql-59-recheck.sarif、codeql-59-dataflow.json、codeql-59-regression.log、codeql-59-browser.json。實際測試帳密與 session 未提交；專用 Docker 子網外連 REJECT 規則已核對，瀏覽器僅允許測試 loopback 來源。

### 排除方式與重新檢視條件

決策：僅 #59 使用 GitHub `false positive` 理由排除，完整註解包含上述資料流、測試與風險界線，並連回本報告。這取代上一節「先保留 open」的階段性決定。排除操作以 GitHub 回讀的 dismissed_reason、dismissed_comment 與 dismissed_at 核對；不更動其他告警、不以全域掃描排除遮蔽程式。

若 write 白名單將來加入憑證／敏感個資、使用展開運算複製原物件、允許單憑中繼資料還原登入，或恢復端移除 Auth／身分核對，必須重新開啟 #59 複核。原始 SARIF 命中仍可能為 1；已排除不等於掃描結果變成 0。

同來源 XSS／惡意擴充功能讀取有效 sessionStorage 或記憶體，是獨立架構風險；此排除不代表整體瀏覽器認證完全無風險，也不適用於舊 #6 的真實永久 bearer token 儲存問題。正式資料、密碼／CAPTCHA 政策未變，未部署或合併 main。
