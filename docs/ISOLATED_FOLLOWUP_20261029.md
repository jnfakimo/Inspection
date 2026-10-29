# 剩餘低風險與隔離補驗續報（2026-10-29）

基準：`a37286ba5617841762b1210ab4b7b344f40c8158`，修正分支 `codex/inspection-security-handover-20261028`。正本為 G:/我的雲端硬碟/AI/Codex/北農巡檢系統，執行副本 C:/projects/Inspection-publish-20261028。

本輪只在合成資料與隔離服務驗證。正式資料、數字／固定密碼與 CAPTCHA 政策不變，沒有合併 main、部署正式 Pages／Edge／SQL，也沒有發送外部通知。

## 新發現與修正

| 發現 | 修正與反例證據 |
| --- | --- |
| Storage 備份只檢查根目錄內的項目，沒有拒絕 storage 根目錄本身是符號連結／Windows junction | inventory 先 lstat 根目錄，拒絕符號連結與非目錄，避免循連結驗證備份根目錄外的資料。Windows junction 反例修正前未拒絕、修正後通過；不修改正常備份或雜湊政策。 |
| LINE 發送函式只取回應狀態與接受編號，未取消不用的 body 串流 | 在回傳前 cancel 串流，不讀取供應商本文；取消失敗不改變既有接受／錯誤分類，避免因清理失敗觸發重送。修正前 cancel 次數為 0 的反例失敗，修正後通過。 |

新增及調整測試：Storage 根目錄連結反例、LINE 串流取消及取消失敗、SQL outbox 至 HTTP 的整合測試。舊群組 LINE 測試以「本文仍可讀」代表未讀取，與新的取消生命週期不符；已改為禁止讀本文並確認 body 已釋放，沒有放寬狀態或資訊保護斷言。整合測試已接入 `test:vehicle-line-notifications` 與 `npm test`。

## 本輪驗證

| 項目 | 證據與結果 |
| --- | --- |
| deepmerge 上游與已安裝補丁 | npm 最新仍 4.3.1，官方公告仍無修補版；npm audit：0 critical/high/moderate，7 low；hash guard 與 6 項污染／Expo 相容性測試通過。保留警示，不改版本號或忽略公告。 |
| 備份／LINE 新反例 | 兩個可重現失敗均已修正；近端測試 8/8 通過，含三項 Storage 與五項訊息適配器測試。 |
| 通知整合 | 5 個情境（Node test 含父測試共 6/6）通過：503→409 接受、斷線→200、逾時→200、429 不自動重試、409 無接受編號維持 uncertain。真正執行 SQL migration/RPC（PGlite）、worker、sendLineTextMessage 與僅綁定 127.0.0.1 的 HTTP 接收端。 |
| 通知去重與授權 | 401 不認領／不發送；尚未到期不重試；重試保留同一 retry key、收件人、訊息本文；結案不再認領。測試 fetcher 僅將固定 LINE URL 導向 loopback，沒有連 LINE 或使用真實通知憑證。 |
| 瀏覽器失敗情境 | 真實隔離 Auth＋Chromium 9/9：新增無 BroadcastChannel、localStorage 拋 SecurityError，均拒絕恢復且沒有建立 SDK session；既有跨分頁、到期、身分不符、登出與全關閉亦通過。 |
| 派車列印 XSS | 取實際 printReport 與 escHtml 在 VM 執行，將合成惡意欄位輸出 HTML 後交 Chromium 解析；動態欄位保持文字，沒有 img/script/onerror 注入節點或程式執行。不是正式資料或真實印表機驗收。 |
| 啟用信成功／失敗分支 | 實際核准後寄信分支在 VM 使用合成供應商回應：2/2 通過；activation_email_sent、使用者訊息與稽核一致，失敗不洩露供應商錯誤。沒有建立帳號／變更密碼；不是外部 SMTP 寄達驗收。 |
| 程式及掃描 | LINE worker Deno 型別檢查通過；Semgrep 3 條規則、603 個檔案、0 命中；Gitleaks 無秘密。完整 npm test 全鏈通過（exit 0）；雲端 CI／CodeQL 另以本輪提交回條及 Actions 結果確認。 |

## 獨立 PostgreSQL 叢集復原

從隔離復原庫 v5 備份全庫邏輯內容與叢集角色，在新資料卷、全新 initdb 叢集還原；沒有復用來源叢集角色，也沒有對來源執行還原。新叢集 `network=none`、沒有公開連接埠、不裝載 pg_cron，使用與來源相同 PostgreSQL 17 映像。

- 核對 50 public users、51 Auth users、1 Storage metadata、127 張 RLS 表一致；這是隔離測試帳號變更後的當次筆數，不沿用先前 49/50 的快照。
- Auth 密碼雜湊、資料庫角色屬性及密碼雜湊一致；重新啟動同一獨立資料卷後，角色成員關係、授權者及 ADMIN／INHERIT／SET 選項亦相符。
- 以原測試帳號密碼對還原後 Auth 雜湊執行 PostgreSQL crypt 核對通過，未改密碼；這不是新 GoTrue 端點的登入證明。
- 還原加 SQL 核對約 7.37 秒，不含服務全鏈驗收，不能稱完整 RTO。重啟核對後 PostgreSQL 正常退出 0，所有本輪臨時叢集皆停止，資料卷及失敗演練證據保留。
- 初次映像沒有 runuser，改由 Docker 指定 postgres 執行；另以不同 bootstrap 超級使用者還原角色時，PostgreSQL 17 的 `GRANTED BY` 管理權檢查失敗。最終使用與來源一致的 supabase_admin 初始化，僅略過角色備份中建立該已存在 bootstrap 角色的一行，保留 ALTER ROLE、角色成員關係與授權者。沒有忽略其餘還原錯誤，最終指令採 ON_ERROR_STOP／exit-on-error。

這補足「不同 PostgreSQL 叢集的角色及邏輯資料還原」，仍不是異機硬體重建，也沒有把正式排程備份擴充為完整 Auth 備份。附件檔案與 Auth／REST／Storage／Edge 聯合服務的既有隔離驗證仍見前報，本輪獨立叢集不冒充那些服務已重新部署。

## 四項設計掃描警告覆核

- layout 的內嵌 JavaScript 來自固定常數；主題值只傳 setAttribute，不串接為程式碼。維持發布產物 CSP hash 防線，正式 IIS CSP 尚未讀回。
- 派車 document.write 的動態字串使用 escHtml，數值欄位先轉數字；上述真實輸出解析反例通過。
- client-ip 的 http URL 僅供 URL 類別解析 IPv6，沒有發出 HTTP 請求。正式代理覆寫來源標頭仍需正式主機證據。
- CodeQL 回歸測試的 HTTP Request 是 VM fixture，沒有網路請求。警告保留，不新增抑制。

## 仍不能結案的項目

| 待辦 | 本輪能補到的界線／仍缺證據 |
| --- | --- |
| deepmerge 7 low | 已補丁與回歸，上游尚無修補版；仍追蹤更新及實機相容性。 |
| 密碼 R-01/R-04 | 使用者要求維持，不能列為已改善；風險接受與遷移由權責人決定。 |
| 行動裝置背景定位／離線／升級重裝、BLE/NFC、QR 外部掃碼 App | 桌面瀏覽器與 Node 加密測試不能取代實體 iOS/Android。 |
| 正式 IIS 443 路徑、代理覆寫標頭、正式 CSP、遠端 certifi | 需要正式主機與網路證據；本輪沒有接觸正式環境。 |
| LINE／Google／簡訊／郵件外部全鏈與印表機 | 已補本機通知 HTTP／SQL 故障重試、寄信分支與列印注入；未發送外部訊息、未操作真實印表機。 |
| 正式備份、異機復原、RPO/RTO、角色及金鑰災難復原 | 已補同主機獨立資料卷／叢集／角色還原及重啟；正式備份、另一實體主機與服務全鏈仍待驗。 |
| ISO 制度／風險核准／內稽 | 技術測試與提交不能取代組織簽核，也不等同 ISO 27001 認證。 |

私有證據根目錄 `C:/projects/Inspection-supabase-e2e-20261028/evidence/`：remaining-mobile-audit-20261029.json、remaining-boundaries-before.log／after.log、remaining-line-final.log、remaining-browser-capabilities.json、remaining-vehicle-print-xss.json、remaining-activation-mail-contract.json、independent-cluster-v3-20261029.json、independent-cluster-restart-20261029.json、remaining-full-tests-final.log、remaining-deno.log、remaining-semgrep.log、remaining-gitleaks.log。帳密、Auth session、角色備份及資料庫 dump 全留私有隔離目錄，不提交 Git。

上游來源：[deepmerge 官方安全公告](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)。
