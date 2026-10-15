# 交接檔 handoff

> 精簡接續摘要；詳情以 PROJECT_PLAN.md、SECURITY_POSTURE.md 及 Obsidian/04-開發與部署.md 為準。G 是唯一原始碼與文件正本。

## 歷史狀態快照（截至 2026-10-09；最新發布見文件末段）

- 核准執行副本：C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime。舊 task-2 備份未改。G 主工作樹有大量未提交的既存修改，任何寫入先核對 hash，勿 reset 或覆蓋其他工作。
- C runtime Node PID 84780 仍在 127.0.0.1:3000 listen；本批未啟停或重載 server。不要停止該程序。
- 共用 MetricCard 已修正 red tone：封閉型別、全域 var(--red) 樣式、tools/metric-card-standard-check.mjs 與 npm script。沒有新增目錄；G→C 四檔 hash 記在 PROJECT_PLAN.md。
- 修正 `/Inspection/v2/systems/handover/` 根路由直接開啟「交接紀錄」；通過 `HandoverModules` 保留交接子系統權限檢查，並保留簽核專用 `guard-approve` 例外。 G/C SHA-256: web/app/systems/[system]/system-hub-client.tsx=DB719D28D9FE460921222D173F050DB90D5604683DE8EE9AAFB840924F24DD95; tools/system-page-heading-check.mjs=281E1B2087E014D2850E6BE08B43E323B4C4B02D2BFD2A3D9E74BFCCC6F102D2
- 本輪完成靜態拓樸盤點（13 systems / 67 modules）。新增 `LocalizedDateInput` 讀取／disabled 契約測試與 Weather 版型回歸；三項都已加入 `npm test`。
- SECURITY_POSTURE.md 新增 3 階段、18 類驗證計畫；Obsidian/04 新增本輪事實及 179 節舊紀錄候選索引，原始歷史沒有刪除或搬移；PROJECT_PLAN.md 與 Obsidian/05 共用四項待辦。
- 最新驗證：C runtime `npm test` exit 0，內含 LocalizedDateInput 5/5 與 Weather layout 4/4；`npm run typecheck:v2` exit 0。G/C 關鍵程式檔 hash 一致，測試見 `PROJECT_PLAN.md`。
- 不宣稱全站視覺或資安驗收完成。瀏覽器啟動受執行環境政策拒絕；A4 實際列印、字體與 responsive 視覺均未驗證。S1-S3 是計畫，18 類未全數實測。
- 指定 LINE 單次通知本輪沒有送出；後續必須先以有效授權查已送狀態，若已送或結果不明即停止，不重送。
- build:v2 使用 next build web；next.config.ts 未設 distDir，G/C 的 web/.next 與開發 server 共用。本批未 build、未碰 .next。找不到既有隔離 build output 路徑。
- Startup skill 唯讀 fetch 後，origin/HEAD 比本地多 2 commits；大量本地未提交差異下沒有 pull。沒有 commit、push 或部署；使用者已說「先不要部署」。Google Drive 同步回執無法從本機工作樹確認。

## 下一步

1. 已只讀審視既有 `origin/main` 多出的 2 commits：僅新增客戶版開發歷程文件；提交數統計口徑與正式上線敘述需 release 證據，詳見 PROJECT_PLAN.md 與 Obsidian/04-開發與部署.md。沒有 fetch／pull／merge。
2. 全角色權限、全頁競態／錯誤與瀏覽器／裝置／A4 視覺矩陣仍待逐項完成；本批只完成靜態 route 拓樸和共用元件測試。
3. S1 靜態資安已完成首批；依 SECURITY_POSTURE.md 繼續剩餘資產／資料流／secret 與全入口盤點。S2 仍需核准隔離測試環境、測試帳號及合成資料；S3 等業務決定 owner、RPO/RTO/SLO。
4. 逐項人工審查 Obsidian/04 的 179 節候選索引；未審核前不刪除或移動歷史。

## 接手規則

- 同一工作批次只允許一名 writer。Codex／Claude 若交接，先明確切換 writer，再重查 G 目標檔 hash；不要同時改同一工作樹。
- G→C 單向複製並逐檔核 SHA-256；不回寫 G。不得讀 secret、連 production、簽核正式案件、停 server、build、commit、push 或 deploy，除非日後有新的明確授權且完成必要驗收。
- 先讀 AGENTS.md、PROJECT_PLAN.md、本 handoff 與 Obsidian/04、05；細節及測試證據在 Obsidian/04。

## 最後更新

2026-10-09 · Codex @ DESKTOP-0CFB6UK。已更新 plan、security posture 與 Obsidian/04、05；Git 尚未 commit/push。部署依使用者指示暫停。

## 本輪收尾更新（2026-10-09）

- 完成遠端 +2 提交的唯讀審查；差異與需核對的交付稿口徑已記入 PROJECT_PLAN.md、Obsidian/04-開發與部署.md。
- C runtime 定向回歸：Weather 4/4、LocalizedDateInput 5/5、`typecheck:v2` exit 0。完整 `npm test` 本輪前已通過；沒有 build、停／啟 server、正式資料操作、commit、push 或部署。
- 待續：完整角色／資料與逐頁狀態矩陣、瀏覽器／字體／A4 視覺驗收、18 類資安實測、179 節歷史人工審閱。瀏覽器啟動受政策阻擋；依使用者要求先不要部署。

## 2026-10-09 S1 首批本機收尾

- 已修 app-api 個人系統權限讀取失敗時可能繼承角色授權的 fail-open；新增 resolver 與 3 個合成回歸案例。app-api handlers 41/41、admin-api 6/6、permission revocation 3/3；完整 `npm test`、`typecheck:v2`、Deno check 通過。
- `npm audit` 兩項 High 間接依賴已依官方 patched versions 更新 lockfile，重查 0 vulnerabilities；未安裝、未做 production reachability 驗證。G→C 7 檔 SHA-256 相符。
- 接續事項：完成 SECURITY_POSTURE.md 其餘 S1 檢項及全角色／資料矩陣；S2 隔離環境尚未核准。沒有連正式服務、資料庫變更、build、停止服務、commit、push 或部署；部署依使用者指示暫停。

## 2026-10-09 延續工作交接（未部署）

- 唯一來源／寫入工作樹是 G:\我的雲端硬碟\AI\Codex\北農巡檢系統；安全測試在核准的 C 執行副本進行。不要從舊 task-2 工作樹覆蓋 G，也不要 reset。
- 已修正 app-api 權限表 fail-open：個人或角色的系統／子系統權限查詢任一失敗時，非系統管理員拒絕；不再把 user_handover_module_access 當新版子系統查詢失敗的替代授權來源。
- 驗證：完整 npm test exit 0；typecheck:v2 exit 0；Deno app-api check exit 0；permission-fail-closed 8/8、app-api handlers 41/41、admin-api 19/19。機電／Guard 共用版型與天氣位置／預設收合回歸皆包含在 npm test。
- 18 支 Edge Function 已做本機原始碼靜態盤點；未呼叫正式端點。monolithic app-api inline actions、admin-api 多數 actions、patrol-checkin 仍缺直接 route-level 授權測試；部分 LINE/worker 測試尚未接入 npm test。
- G 與 C 的 4 個權限修正檔 SHA-256 已一致。lockfile 中相依修補尚未安裝到 node_modules；目前 PID 84780 的 127.0.0.1:3000 維持運行且未重啟。
- 未做 browser print／視覺驗收、正式 DB/RLS/Storage 或 deployed config 驗證。未 build、commit、push 或 deploy；使用者已要求先不要部署。

- 權限相容性 follow-up：admin-api 仍保留寫舊交接權限表的 action，web source 無直接呼叫；舊資料未讀取。部署前需決定映射／退役，不能假設舊白名單已移轉。


## 2026-10-10 登入 CAPTCHA 修正交接（未部署）

- G 正本 codex/html-daily-report-preview，HEAD be0f47335d5681782c423662792b9fd2fe2049b2。修改登入 backend routing/config、Supabase dev fallback、CAPTCHA 公開請求與頁面載入狀態；測試檔 web/lib/username-login-routing.test.ts 為未追蹤檔，未 stage。
- 根因：Supabase JS Functions transport 先取 Auth session，functions.invoke 因此可能在 session 初始化前等待；舊本機 dev 設定亦把 Functions 請求送往沒有 Edge gateway 的 localhost。改後 dev CAPTCHA 直接呼叫設定中的公開 Supabase Functions URL，15 秒 timeout、無 retry、single-flight；一般登入維持原流程。
- 驗證：兩支登入測試共 14/14、6 檔 in-memory esbuild syntax check、git diff --check 皆通過。未做 full typecheck/build/browser 驗收。
- C runtime 未同步，五個相關來源檔仍是修正前版本；本機頁面 GET HTTP 200 所對應 bundle 亦為舊版。先前單次獲准 CAPTCHA POST 雖回 HTTP 200，但本文已丟棄，無法確認 payload／圖像。本輪未再送 challenge。
- 繼續前置條件：若要驗證目前本機服務，需一次明確授權 G→C 同步及本機 HMR／瀏覽器驗收；驗收會產生新的 CAPTCHA request。不要部署、重啟服務、build、commit、push 或做正式登入。


## 2026-10-10 CAPTCHA 本機同步追蹤

- 已依本次核准將六個 G runtime 檔同步到 C 執行副本，逐檔 SHA-256 與 G 相同；原本與 G 相同的 routing helper 未重寫，C 內容不同的測試檔保留。
- G 登入測試重跑 14/14 通過；C 六檔 in-memory esbuild syntax check 通過。
- 3000 埠目前沒有 listener，登入頁唯讀 GET 連線遭拒；目前可用工具沒有瀏覽器自動化介面。沒有啟動／重啟服務或再送 CAPTCHA。故 HMR、圖片呈現、瀏覽器 timeout／single-flight 尚未驗收，不能宣稱 CAPTCHA 畫面已修好。
- 仍未提交帳密或 CAPTCHA 答案，未關閉驗證、未做 DB／Storage 寫入、build、commit、push、部署。


## 2026-10-10 CAPTCHA 驗收最終狀態

- 已依 C 的 start-local-preview.ps1 安全流程完成切換。舊 task-2 網站程序鏈 25136 → 52068 → 51988 → 41296 經父子、命令列、路徑與建立時間重驗後停止；外層 49324 未動。新版 C runtime 的 PID 42632 現監聽 127.0.0.1:3000。
- 127.0.0.1 與 localhost 的登入頁均 200；16/16 JS、1/1 CSS 均 200，資產含新 CAPTCHA fetch/single-flight/loading 標記；兩 hostname HMR WebSocket 均開啟。
- 唯一一次受控 CAPTCHA request 200，challenge_id／expires_in／image／ok 存在；SVG data URI Base64 解碼及安全 XML 根節點檢查通過。未保存 challenge、圖像或 key，也未重試。
- 舊 task-2 完整 Next log 記錄 127.0.0.1 的 HMR 跨來源請求被實際阻擋，舊服務預設 hostname 為 localhost；頁面與 JS/CSS 請求仍 200。C 安全腳本明確用 127.0.0.1 啟動，兩 hostname HMR 都成功，沒有改 allowedDevOrigins。
- 自動檢查：G 登入測試 14/14，C 六檔 in-memory syntax check 通過。真正瀏覽器視覺驗收仍未完成；沒有瀏覽器工具，沒有送帳密或解題。
- C dev server 保持運行；未 build、commit、push 或 deploy。

### 2026-10-10｜V2 系統 ICON 載入修正

- 根因確認：V2 basePath 是 /Inspection/v2，G/C 原有 13 個 Web 檔案的 75 處圖示引用卻指向 /Inspection/assets/...，且兩份 web/public 都沒有該批圖檔。C 本機 127.0.0.1:3000 對駐警隊交接圖示回 404／HTML。
- 已將 75 處引用改為 /Inspection/v2/assets/...，把 system-icons-v20260901、system-icons-v20260913 和 5 個舊版共用圖示同步到 G/C 的 web/public/assets。檔案均取自 repo 根目錄 assets。
- 更新頁首檢查器以核對 V2 URL 與 web/public 圖檔；G、C 的 npm run test:page-headings 都通過。C 本機圖示端點回 200 image/png，13 個系統 Logo 的 HTTP、MIME 與 PNG 標頭檢查全數通過。
- C 的服務在 127.0.0.1:3000；使用者另啟的 task-2 舊服務仍在 ::1:3000，沒有停止或改動。localhost 可能會走舊服務。
- Library 截圖未能轉存或顯示像素，故沒有完成畫面目視比對；未做已登入頁面驗證。使用者已確認 CAPTCHA 正常，本輪沒有再送 CAPTCHA 請求。
- 未 build、未部署、未改 DB/Storage、未 commit/push。

## 2026-10-10 G 正式前端發布續作（最新快照）

- G 正本：G:\我的雲端硬碟\AI\Codex\北農巡檢系統；codex/html-daily-report-preview @ e0f47335d5681782c423662792b9fd2fe2049b2。C runtime：C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime；PID 42632 綁 127.0.0.1:3000。舊 task-2 網站程序已依先前核准停止，檔案保留。
- ICON 修正證據：13 個 web 檔 75 處引用，78 個圖示資產／6,500,131 bytes 已比對 hash；頁首檢查 13 系統／67 模組通過，C 的 13 個系統 Logo HTTP/MIME/PNG 標頭通過。CAPTCHA 使用者回報驗碼 OK；自動測試 14/14，沒有將此記為完整登入驗收。
- 目前本機可驗證：http://127.0.0.1:3000/Inspection/v2/systems/、.../systems/handover/guard/、.../systems/handover/mechanical/、.../login/ 均 GET 200。氣象在登入後 http://127.0.0.1:3000/Inspection/v2/；/dashboard/ 不存在。尚未取得登入後截圖／實際列印結果。
- 發布候選在獨立 C worktree C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-release-verify，基於 origin/main  c58a668d3253acfe33f1203e17421eda4f56382，與 C runtime .next 分開。G 工作樹 61 個 tracked 修改、51 個 untracked；僅選前端修復及相關測試，排除 Supabase functions/config、migrations、LINE/車輛功能、預覽頁與私人差異。4 個登入合併衝突已人工檢視並解除。
- 本檢查點定向結果：
pm ci 成功；CAPTCHA 14/14、機電列印 fit 4/4 + checker、weather layout 4/4、LocalizedDateInput 5/5、三本 handover style、page headings、button standard 均通過。npm install audit 回報 2 high，待查明；尚未跑完整 npm test、typecheck、build、秘密掃描。沒有正式資料寫入、實際簽核、DB/Storage 操作或 LINE。
- 使用者已明確授權 G 正式前端發布，但目前**尚未 commit、push、跑 CI 或部署**；正式網站尚未驗證。.git/packed-refs.lock 為 10/06 的 0-byte 舊檔，保留未動。下一步查 audit、完成測試／typecheck／隔離 build／secret scan，等本機視覺確認，再走一般 fast-forward 發布。候選不含 Edge／Migration workflow 路徑。
- Codex／Claude 接手先讀 AGENTS.md、CLAUDE.md、ANTIGRAVITY.md、PROJECT_PLAN.md、本 handoff 與 docs/AGENT_COLLABORATION_WORKFLOW.md；維持單 writer，不從 C 複製回 G，不重啟伺服器，不整樹 stage。
## 2026-10-10 發布候選最終靜態驗證補記

- 隔離候選位於 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-release-verify`，基底為 `origin/main`（`0c58a668d3253acfe33f1203e17421eda4f56382`）；目前 131 個明確檔案已暫存、尚未 commit。G 工作樹另有既存修改與私人／後端內容，沒有納入候選。
- 安裝完成：`npm ci` 最終回報 0 vulnerabilities。驗證完成：`npm test`、`npm run typecheck:v2`、`npm run build:v2`（96 個頁面）、`npm run security:secrets`、`npm run security:gitleaks` 全數成功；候選 `npm audit` 為 0 vulnerabilities。定向測試包含登入 14/14、機電列印適配 4/4、天氣版面 4/4、日期欄位 5/5、交接版型、頁首覆蓋與按鈕標準皆通過。
- **尚未完成的驗證**：沒有瀏覽器視覺檢視，也沒有真實列印／分頁預覽；未登入狀態下首頁不能驗證登入後的天氣儀表板。C runtime 的登入、系統入口、Guard 與 Mechanical 路由 GET 為 200；`/dashboard/` 為 404，登入後入口是 `/Inspection/v2/`。需由有權限的使用者在既有 C 預覽環境檢視畫面；尚未執行正式簽核或任何真實資料寫入。
- 使用者要求先不要部署；截至本補記，尚未 commit、push、執行 Pages workflow 或部署。沒有連 Supabase、寫資料庫／Storage、送 LINE，也沒有重啟 C runtime。`.git/packed-refs.lock` 是既存 0-byte 檔案，保持原狀。
- 後續：正式前端已發布（commit `eeb8fd82fa7b4547febb50db966aea1cc622e3bc`），Pages／CI／CodeQL／商用就緒檢查成功；官方登入、系統、Guard／Mechanical 路由與三個交接圖示的手機 UA GET 均為 200。真實登入後畫面與 A4 PDF 列印驗收仍待使用者回到電腦後進行，目前不要求操作；未部署 Supabase／LINE。Git 曾回報 packed-refs.lock 建立衝突，但提交已建立；再次檢查時 lock 不存在且無 Git 程序，未手動刪除 lock，fast-forward push 成功。

## 2026-10-10 MOA 診斷修正發布

- **發布範圍**：依明確核准，只發布 tools/market_daily_import.py 與 tools/test_market_daily_import.py。commit 9a7196fef8142166f885493083258b728d5bab83（parent eeb8fd82fa7b4547febb50db966aea1cc622e3bc）以 fast-forward 推到 main；提交沒有其他路徑。
- **位置區分**：G 正本是 G:\我的雲端硬碟\AI\Codex\北農巡檢系統；G 工作樹仍在 codex/html-daily-report-preview、HEAD be0f47335d5681782c423662792b9fd2fe2049b2；兩個目標檔案仍是未提交本機差異，G HEAD 未移動，其餘既存差異未碰。發布使用 C 隔離 worktree C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-market-diagnostic-release，基底 eeb8fd8，提交後乾淨；兩個目標檔案與 G 對應 SHA-256 相同。C runtime Inspection-G-runtime 本次未檢查或修改。
- **驗證**：離線 unittest 24/24；兩個目標檔案 Gitleaks 掃描無發現。CI #38024051733、CodeQL #38024051747、Commercial readiness #38024051762、Hardened Pages #38024051764 均成功；Pages build、deploy、verify-deployment 全成功。
- **正式站唯讀檢查**：https://jnfakimo.github.io/Inspection/、/Inspection/v2/、/Inspection/v2/systems/handover/mechanical/ 均回 HTTP 200。
- **內容雜湊**：market_daily_import.py SHA-256 902403B2E1EAD49AB4F049973C33AC00CF1AC34673DEE69879CFFC4A8EDE56A9；test_market_daily_import.py SHA-256 DF11DC8F63FE63FC63CE24B6F91ABC0C28CD156F1CE7E99E57C0DF4EF44A9E60。
- **限制與後續**：10/08 真實 MOA 回應列仍未取得，來源根因未確認；維持 fail-closed，不推定休市 placeholder。這批未做登入後 UI、瀏覽器視覺或 A4 實印驗收；仍待另行完成。沒有手動匯入、DB、migration、Edge 或 LINE 操作；main 上既有每日排程後續會用新版，按原流程可能寫入行情 DB。--dry-run fallback 仍可能讀正式 DB 近 90 天 code_items，不是離線測試。下一步先取得獲准保留的原始回應，再定位並補 fixture；未核實前不要放寬驗證或重跑正式匯入。
- **Git lock**：G 的 .git/packed-refs.lock 檢查時為 0 bytes、時間戳 2026-10-06，當時沒有 Git 程序；worktree add 與 commit 曾印出 lock 警告但操作成功。lock 未刪除。

## 2026-10-10 交接簿四方比對 checkpoint

- 本輪只在 G 編輯 `web/app/systems/[system]/[module]/mechanical-handover.css`：機電早／中／晚／當班 legend 改接 shared `--hs-shift-color-1/2/3`、`--hs-current-color`。新 SHA-256 `A8B2AE5CB3DE42ADC5C2F42B9CFB3012F62758AE521E8669876B26E1D21C2B11`。舊 C 唯讀；C runtime 和 main 未改；保留 G 其他既存修改。
- 四方比對：舊 C 色票正確；修正前 G、C runtime、遠端 main 均為 cyan／green／amber＋violet 當班色。舊 C、G、遠端 main 的機電 HTML 報表預覽、簽核說明欄、課長簽核 footer 均存在；首頁 `.hs-approval` 位置與灰底共享樣式相同。
- 該檢查點尚未完成的業管差異已在本次續作處理：確認 G/main 的 RPC、app-api 與 RLS 授權鏈後，只補回逐階段 fail-closed 唯讀提示；沒有改權限規則或 migration。詳見下方最新續作紀錄。
- 檢查：`test:handover-style` 通過、palette assertion 與 brace check 359/359 通過、`git diff --check` 通過。`test:mechanical-handover` 與 PostCSS parser 被 G 內 0-byte pglite/postcss package.json 阻擋；未安裝依賴。登入後 UI／A4 實印未驗。
- 已有部署仍是 main `9a7196fef8142166f885493083258b728d5bab83`，Pages run `38024051764` 全成功；匿名 GET 200 只取到登入驗證殼。這次 G 修正未 commit／push／deploy。後續先處理本機依賴完整性與登入後畫面／列印驗收；未經明確改令不要部署。
## 2026-10-10｜使用者要求暫緩部署後的續作

- G 為唯一寫入來源，舊 C 唯讀；G 分支 dirty 狀態原樣保留。既有 main/Pages SHA 9a7196fef8142166f885493083258b728d5bab83／run 38024051764 已成功；遵照最新「先不要部署」，本輪未 commit/push/deploy。
- 全 repo 篩選後 SHA-256 inventory：1,066 路徑、507 三方同 hash；交接簿 86 檔，40 同、31 old/main vs G、9 三方皆異。沒有整樹覆蓋。排除 .git、deps、build/cache/web/out、secrets/env、歷史文件與 live plans。
- 機電 shared 班色完成；Guard／Mechanical／Business HTML signoff 均存在。業管報表文案已統一；業管 UI 加入 business_market_can_approve 的逐階 fail-closed 提示。後端 RPC、API、RLS 已核對，不改授權 migration。業管角色矩陣／presentation/API 測試過；Mechanical、Business PGlite DB tests 過。
- Weather layout 4/4、LocalizedDateInput 5/5，兩項實作與目前已發布 main 相同；Patrol permission-fail-closed 與 migration 測試通過。車輛 LINE 通知離線測試 26+56 通過，但 migration/Edge 尚未部署，未送 LINE。
- 待辦：登入後畫面與真實 A4 PDF；車輛通知正式 DB/Edge 發布（需另行授權）；MOA 診斷程式已在 main，仍缺 10/08 真實 payload；workorder active-order trigger 沒有併發唯一性保證，先盤點正式資料再評估索引。沒有連正式 Supabase、簽核正式案件或啟停服務。

## 2026-10-10｜續作盤點更正（未部署）

- **本輪動作**：只更新此追蹤文件中的盤點結論；沒有修改應用程式、資料庫或 Edge Functions，沒有 commit、push、build、啟停服務、連正式 Supabase 或發 LINE。G 工作樹既有 dirty 狀態保留。最後已知 Pages 版本為 main `9a7196fef8142166f885493083258b728d5bab83`，Hardened Pages run `38024051764` 成功；這不是本輪新部署，也不代表登入後視覺／列印驗收完成。
- **天氣／行情／共用元件**：G 與已發布 main 對 `weather-widget.tsx`、`weather-widget-layout.css`、`weather-widget-layout.test.ts` 的文字內容一致（忽略 CRLF/LF）；map markup 在 drilldown 前，桌面 grid 將地圖置左、資訊／鄉鎮下鑽置右，鄉鎮 `<details>` 沒有 `open`，窄版地圖排在前面。新版使用獨立 `weather-widget-layout.css` 與 `web/lib/weather-widget-layout.test.ts`；舊 C 的 `dashboard-integrations.css` 與 `web/app/weather-widget-layout.test.ts` 是舊路徑，已由新版取代。天氣靜態測試先前 4/4 通過，但本輪未做登入後瀏覽器目視。
- 本次抽查的行情輪播、互動式行情看板、`MarketExecutiveBoard`、market board workspace/CSS，以及 `AppShell`、`LocalizedDateInput`、日期存取 helper、`modules.ts`、`MetricCard`、shared actions 和版本化系統圖示，G 與 main 文字內容一致。`system-hub-client.tsx` 的唯一實質差異是 G 保留通知預覽卡，main 沒有；這是 G 本機預覽入口，不視為正式功能漏版。MOA 診斷兩檔仍與 main 一致；10/08 原始 MOA payload 未取得，所以來源根因仍未知。
- **業管簽核**：G 的業管 UI/helper 改動不在 main，未發布。版本化 migration 定義 authenticated current-user 的 `business_market_can_approve(p_market,p_stage)`，API 將 RPC error 視為失敗、權限不符回 403；G UI 在 RPC 拒絕或無法取得時顯示唯讀原因並停用簽核。若正式 DB 未套用該 RPC，安全結果是簽核請求失敗／合法簽核人被阻擋；本輪沒有連 DB，因此 migration 現況未驗證。
- **工作單併發防重**：`prevent_duplicate_active_workorder()` 在 INSERT trigger 用 `EXISTS` 查同一 request_id 的 active 維修工單；目前索引是普通 request_id index，未找到 active 狀態 partial unique index。`tools/e2e-repair-flow.mjs` 沒有併發重複插入案例。序列重複會被 trigger 擋下，但同時交易是否互相看見未證明，不能宣稱併發保證；沒有正式資料重複盤點前不加 migration 或索引。
- **更正車輛 LINE 通知部署狀態**：以下是使用者提供的 2026-10-08 歷史正式部署快照，不是本輪 live recheck；它 supersede 本文件先前「migration/Edge 尚未部署」的說法。正式 DB migration 記錄為 `20261008085955 vehicle_driver_line_notifications`、`20261008090006 vehicle_dispatch_line_outbox`、`20261008090014 vehicle_driver_line_link_start`、`20261008090021 vehicle_dispatch_line_worker_leases`、`20261008090030 vehicle_personal_line_notifications`。本機 migration 檔時間戳不同，不可據此判定未套用。
- 同一歷史快照記錄 `line-notify v31`（verify_jwt=false）、worker v1（verify_jwt=false，另驗 `x-cron-secret`）、`app-api v118`（verify_jwt=true）、`admin-api v53`（verify_jwt=true）；當時六張 private tables 已啟用 RLS，anon/authenticated 無直接讀寫，功能開關全關、outbox/test 為 0、cron 為 0。晚間 `admin-api v54` 修正初始化 deadlock，回報 27+17 測試與讀回一致。來源識別：owner turn `01a11ab8-aaaa-7674-b798-e594cb12e84e`／Sentinel `c58c279bc4d88191aabe6d6e08ec1fdf`；晚間 owner turn `01a11b97-9a1c-7151-ac13-f5579a015adb`／Sentinel `e61936643ce481919f95f809d6d036bf`。
- **車輛通知未完成項**：TEST-001 單次測試曾獲准，但歷史記錄明確說當時未送，沒有 LINE 收訊回報；後續必須先核對目前 binding/outbox 狀態，不能自行重送。此次不連正式 DB、不送 LINE。G 有對應 migration/function 本機差異，而已檢查的 main `9a7196f` 不含這批 vehicle LINE migration/Edge source；因此雲端歷史部署與 Git main 的來源一致性尚未證明。不能把「曾部署 default-off」說成「功能已啟用或端對端完成」。
- **仍待完成／阻塞**：登入後天氣／交接簿視覺與 A4 真實列印未驗；10/08 MOA payload 未取得；工作單併發防重未證明；車輛 LINE 現況未重查且沒有測試送達證據；業管 RPC 正式 DB 是否存在未查。以上都沒有藉由部署或正式資料寫入處理。
## 2026-10-10｜併發重現、簽核 metadata 與 main 候選（未發布）

- **工作單併發重現**：讀取 G 的 `tools/workorder-concurrency-repro.sql` 與目前 trigger。PGlite 0.5.8 本機 README 明載 single user/connection；本機沒有 `postgres`、`initdb`、`pg_ctl`、`psql` 或 `pg` client，因此不能建立兩個真正共享同一 Postgres 的交易，沒有宣稱已重現併發。新增的隔離 SQL fixture 僅允許資料庫名 `workorder_concurrency_test`，在專屬 schema 複製目前 INSERT trigger 行為；兩個 session 對同一 request_id、equipment_id 插入不同 active order。PGlite 記憶體檢查確認 fixture 可載入且序列第二筆被 SQLSTATE 23505 擋下；這只驗證序列限制，不是併發結果。正式 DB、正式表、索引均未改。
- **正式業管 RPC metadata**：透過既有 Supabase connector，以 project `qztffronusdhgxhjjubt` 的 `pg_catalog.pg_proc`／`pg_namespace` 唯讀查 `business_market_can_approve` 與 `business_market_approval_allowed` 定義。前者存在、`authenticated_can_execute=true`，body 僅以 `active_user_id()` 呼叫後者；後者是 `SECURITY DEFINER`、`search_path=''`，且 `authenticated_can_execute=false`。只讀函式目錄，沒有讀業務資料、呼叫 RPC 或寫入。第二次補查 ACL 的 connector action 回 `Unknown tool`；不影響已查到的存在與 authenticated 權限結論，未重試。
- **基於 main 的候選**：main 基準 `9a7196fef8142166f885493083258b728d5bab83`。為避免碰既有 `G/.git/packed-refs.lock`，未建立 worktree；只在 repo 外 G 候選目錄產生三份可審 patch：`G:\我的雲端硬碟\AI\Codex\handover-release-candidate-9a7196f\01-handover-ui.patch`（機電共用班色 CSS、業管 UI/CSS/helper）、`02-business-tests.patch`（helper 單測、業管 PGlite 矩陣與測試路徑 harness）、`03-vehicle-preview-card-separate.patch`（單獨派車通知預覽卡差異）。三份在乾淨 main worktree 均通過 `git apply --check`，沒有套用、commit、push 或部署。候選只含明列路徑；不會把 G 其他修改一起帶入。通知預覽卡刻意不混入交接 UI 候選。
- **車輛 LINE 原始碼可追溯表**：正式部署版本與時間依使用者提供的 10/08 Sentinel 歷史紀錄，非 live recheck。資料庫 migration 名稱及 G/舊 C 對應檔（下列本機檔案時間戳不同，不代表未部署）：`vehicle_driver_line_notifications` → `supabase/migrations/20261008070454_vehicle_driver_line_notifications.sql`；`vehicle_dispatch_line_outbox` → `.../20261008071250_vehicle_dispatch_line_outbox.sql`；`vehicle_driver_line_link_start` → `.../20261008072136_vehicle_driver_line_link_start.sql`；`vehicle_dispatch_line_worker_leases` → `.../20261008073738_vehicle_dispatch_line_worker_leases.sql`；`vehicle_personal_line_notifications` → `.../20261008081918_vehicle_personal_line_notifications.sql`。五檔舊 C 與 G 正規化內容 hash 相同，main 9a 沒有這五檔。
- Edge 版本歷史為 `line-notify v31`、worker `v1`、`app-api v118`、`admin-api v53`，晚間 `admin-api v54` 修正初始化死結。G/舊 C 同內容而 main 不同或缺檔的安全路徑包括 `supabase/functions/line-notify/index.ts`、`supabase/functions/line-notify/route-contract.test.mjs`、`supabase/functions/vehicle-line-dispatch-worker/index.ts`、`supabase/functions/_shared/vehicle-dispatch-line-worker.ts`、`supabase/functions/_shared/vehicle-dispatch-line-worker.test.ts`、`supabase/functions/app-api/handlers/vehicle.ts`、`supabase/functions/admin-api/index.ts`、`supabase/functions/admin-api/vehicle-line-personal.ts`、`supabase/config.toml`。這些 Edge／migration 檔沒有納入 Pages 候選或推送；因會觸發 Supabase 部署，仍需獨立明確 scope。功能開關與 TEST-001 狀態沿用前節歷史紀錄；目前線上狀態未重查、沒有 LINE 收訊證據。
- **舊 C 全量差異與語義審核邊界**：既有路徑/hash inventory 為 OLD 1,025、G 975、main 939、union 1,066；本輪新增唯一掃描範圍內 G-only 檔 `tools/workorder-concurrency-repro.sql`，故更新為 G 976、union 1,067；state counts 中 G-only 由 6 增為 7，其餘原分類不變：507 三方同、317 old=main≠G、36 G=main≠old、11 old=G≠main、33 三方皆異、90 old-only、25 old+G 同／main 缺、6 old+G 異／main 缺、13 G+main 異／old 缺、21 G+main 同／old 缺、1 main-only。這是檔案存在／hash 分類，不能代替語義審查。
- **尚未逐檔語義審核範圍**：分類中仍需逐檔查內容與業務行為的主要群組為 handover（85 檔，僅抽查本輪候選）、weather/dashboard/market（158 檔，僅抽查地圖布局與主要行情頁）、workorder（47 檔，僅檢視 trigger／e2e 及新增 fixture）、patrol/auth（105 檔，本輪未審）、vehicle（115 檔，僅審車輛 LINE 相關檔）、shared UI/date/icons（209 檔，僅抽查主元件與指定圖示）；其他舊 C/G/main 不同路徑也未完成逐檔語義審查。不能把 hash inventory 說成「全 repo code review」。
- **操作狀態**：G HEAD 仍為 `be0f47335d5681782c423662792b9fd2fe2049b2`；候選 patch 在 repo 外，工作單 fixture 為新增 G 本機測試檔。沒有 migration、schema、index、正式資料、密鑰、LINE、commit、push、Edge deploy 或 Pages deploy 操作。

## 2026-10-10｜業管／機電交接簿發布結果

- GitHub `main` 已推送 `d5ee8f6ec4d8e9d177aee6045d8535dbc7554d4f`（parent `9a7196fef8142166f885493083258b728d5bab83`），只含 7 個交接簿 UI/helper/test 檔；未含車輛 patch 03 或 Supabase／Edge／migration 差異。
- `npm test`、V2 typecheck/build（96 頁）、secret scan、簽核 helper 4/4、diff check 通過。CI、CodeQL、Commercial readiness、Hardened Pages（含 verify-deployment）皆以該 SHA 成功；業管／機電正式站路由 GET 200。
- 真實登入後畫面及 A4 PDF／列印仍未驗收；未操作正式簽核，未寫 Supabase／Edge／LINE。舊 C task-2 保持唯讀；G HEAD `be0f47335d5681782c423662792b9fd2fe2049b2` 未移動，其他既有 dirty 變更未覆蓋。
## 2026-10-10｜舊 C／G／main 巡檢、報修與共用元件審查（未發布）

- **基準與保護**：舊 C C:\Users\jnfa\Documents\Codex\2026-10-05\task-2\Inspection 僅讀；Git 因 dubious ownership 拒絕，未加 safe.directory。G HEAD 為 be0f47335d5681782c423662792b9fd2fe2049b2；比對／隔離驗證 main 基準為 d5ee8f6ec4d8e9d177aee6045d8535dbc7554d4f。G 原有未提交檔案保留。
- **報修詳情競態**：workspace.tsx 中工作流程、派工、完工在非同步操作後原本固定重新打開該案件；若使用者先關閉或切換案件，舊回應會覆蓋目前畫面。加入 repair-detail-refresh session generation/request-id guard，成功仍刷新列表，只在原案件仍開啟時更新詳情；角色與 API／權限流程不變。
- **巡檢新增回應**：create_inspection 成功後若 inspections 清單 GET 失敗，原畫面會把成功新增誤報為失敗，使用者重試可能建立重複紀錄。加入 create-refresh，分別回報新增成功與清單刷新失敗；刷新可重試讀取，不會重送新增。新增中禁止關閉表單。
- **共用日期欄位**：目前 main 的手動 fallback 會將任意文字換成連字號後寫回頁面狀態，未拒絕無效日、閏日錯誤或 min/max 越界。補上 ISO／斜線日期解析、有效日與 required/min/max 檢查、錯誤提示及 picker 開啟節流；保留 main 的 getLocalizedDateInputAccess 唯讀／停用契約。沒有任何主線呼叫者依賴舊 C 的額外 validity callback。
- **差異範圍**：共用 UI 選取 17 檔逐一正規化換行後比較（修改前），G 與 main 17/17 相同；其中 4 檔舊 C 也相同，另外 13 檔舊 C 為較早樣式／元件版本。日期手動驗證是此組中確認的實際功能缺口，已補修。舊 C 的 InstallAppGuide 頂列差異與目前共用導覽規範不符，未移植；車輛通知預覽卡差異不在本範圍。
- **需另行決策**：舊 C 獨有 20261008061007_patrol_shift_atomic_rename.sql 與 save_patrol_shift_v2 UI。既有唯讀正式 metadata 查詢未找到該 migration version 或 RPC；因此沒有搬入 shift rename UI／migration，也未更動正式 DB。若要啟用，需先確認 migration 實際狀態及採用方案，再另行處理。
- **離線驗證**：隔離 C 驗證 worktree 執行 create/repair/date helper 測試 17/17、patrol session/check-in 測試 8/8、頁首盤點 13/67（62 標準、4 緊湊）通過；V2 TypeScript --noEmit --incremental false、v1-layout.css PostCSS 解析及本次檔案 git diff --check 通過。Node 顯示 package type-less 模組警告，測試仍成功。未做 browser 手動／日期 picker 測試、完整 npm test 或 build。
- **操作狀態**：本輪只改 G 應用程式／測試與追蹤文件；隔離 C worktree 暫存相同驗證檔案。沒有改 migration、schema、Edge Function、key 或正式資料；沒有 commit、push、deploy、build、啟停服務。## 2026-10-10｜三項低風險修補隔離候選驗證（未發布）

- **遠端基準**：驗證前後 git ls-remote origin refs/heads/main 均為 d5ee8f6ec4d8e9d177aee6045d8535dbc7554d4f；隔離 C worktree HEAD 相同。驗證期間主線沒有變動，沒有 cherry-pick 或覆蓋新 main。
- **候選位置／隔離**：C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-release-verify 是 linked worktree；其 web/.next 為獨立實體路徑，與 G 的 web/.next 不同且非 junction。build 僅寫入隔離 C 的 web/.next。舊 C task-2 維持唯讀。
- **精確候選範圍（12 檔）**：package.json；web/app/systems/[system]/[module]/patrol-workspace.tsx；web/app/systems/[system]/[module]/workspace.tsx；web/app/v1-layout.css；web/components/LocalizedDateInput.tsx；web/lib/localized-date-input-access.test.ts；web/lib/create-refresh.ts；web/lib/create-refresh.test.ts；web/lib/repair-detail-refresh.ts；web/lib/repair-detail-refresh.test.ts；web/lib/localized-date-input.ts；web/lib/localized-date-input-validation.test.ts。11 個 TSX／CSS／helper／test 檔 C 與 G SHA-256 原始位元組完全相同；package.json 只帶入這三項測試腳本與 npm test chain 更新，不帶 G 其他 scripts/diffs。
- **排除項目**：patrol shift rename migration、save_patrol_shift_v2 UI／API、任何 Supabase／Edge／schema／正式資料、vehicle 功能、私人文件及其他 G diff 均不在候選。正式 DB metadata 未找到 shift rename migration/RPC，未作任何 DB 操作。
- **完整驗證**：npm test 成功；新增 create-refresh 3/3、repair-detail-refresh 5/5、date validation/access 9/9；既有巡檢／交接等整套測試無失敗。npm run typecheck:v2 成功；npm run build:v2 成功，96 個靜態頁；npm run security:secrets 成功；git diff --check 成功，未追蹤 helper/test 另查無尾端空白。Node 對部分 TS 測試顯示 MODULE_TYPELESS_PACKAGE_JSON 非致命警告。
- **候選內容 hash**：按上述 12 個檔案以「相對路徑、NUL、原始檔案 bytes、NUL」排序串接後 SHA-256 為 48BD0602106806C1651D487AA065CF6B1E5A3633F2F37A8A0938449A02639643。基準 SHA 為 d5ee8f6ec4d8e9d177aee6045d8535dbc7554d4f；可在隔離 worktree 用逐檔 hash 重建。
- **操作狀態**：候選留在隔離 C worktree 作 review；G HEAD 為 be0f47335d5681782c423662792b9fd2fe2049b2。沒有 stage、commit、push 或 deploy；沒有啟停 server。使用者尚未授權發布，因此等待明確發布指示。
## 2026-10-10 MOA 10/08 payload 查核續記

- GitHub Actions run #88：38044837170（head d5ee8f6；2026-10-10 18:25 Asia/Taipei）。日誌只記錄第一市場蔬菜、2026-10-08、MOA row 1 與 CropCode str / '-'; 重複兩次。頁面無 artifacts。北農來源連線逾時 6 次後切 MOA。
- 沒有完整 MOA row 或官方 schema。測試 helper 列出的欄位 TransDate、TcType、CropCode、CropName、MarketCode、MarketName、Upper_Price、Middle_Price、Lower_Price、Avg_Price、Trans_Quantity 僅是合成 fixture；CropCode 以外的實際欄值缺失，其他未建模來源欄位亦未知。查詢範圍不等於原始列欄值。
- G tools/test_market_daily_import.py 增加實際錯誤 token 的離線 regression；列的其他值是合成 fixture，不聲稱重建 payload。25/25 通過，git diff --check 通過；匯入器仍 fail-closed。
- 根因未確認；不推定休市、不放寬驗證。未讀正式 raw rows、未呼叫 MOA／DB/API、未執行正式匯入或 --dry-run。G HEAD 未移動；未 commit／push／deploy；12 檔前端候選未動。

## 2026-10-10｜12 檔前端候選已發布

- 使用者已明確授權發布；候選仍為核准 SHA-256 48BD0602106806C1651D487AA065CF6B1E5A3633F2F37A8A0938449A02639643 的 12 檔。提交 647fb50d63afda5dadfa617fafd7f51503e90f43，parent d5ee8f6ec4d8e9d177aee6045d8535dbc7554d4f；只含該 12 檔，沒有混入 G 行情第 25 項測試或其他 G 差異。正常 fast-forward 推至 main，遠端 main 最終 SHA 與 commit 相同。
- 同一 SHA workflow 全成功：CI 38051189491、CodeQL 38051189453、Commercial readiness 38051189437、Hardened Pages 38051189441（build／deploy／verify-deployment 全 success）。
- 正式 root、V2、報修申請、巡檢排班 URL 帶版本 query 的 GET 均為 200 text/html。真實登入後視覺、手動互動及 A4 PDF 仍未驗收，請保留為待辦。
- GitHub push 提示 default branch 有 5 個 Dependabot alerts（1 critical、4 high），此批未調查。commit 曾輸出 packed-refs.lock collision 訊息，但 commit 成功；事後 lock 已不存在、無 Git process，沒有手動移除。沒有 force push。

## 2026-10-11 本機預覽、發布版對齊與登入連線診斷（未部署）

- **正式版本更正**：只讀查核 `origin/main` 現為 `647fb50d63afda5dadfa617fafd7f51503e90f43`，parent `d5ee8f6ec4d8e9d177aee6045d8535dbc7554d4f`；CI run `38051189491` 與 Pages run `38051189441` 成功。先前回報 eeb8 為最新是錯誤，較早具日期的 eeb8 記錄保留為歷史；本輪未部署。
- **C runtime**：`C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime` 啟動的 Next 16.3.8 PID 60276 綁定 `127.0.0.1:3001`；父程序命令列從此 C runtime 的 `node_modules\next` 啟動，執行工作目錄為 C runtime。3000 仍由 task-2 PID 65616（桌面 `1.BAT` 父鏈）使用，未停止或修改。
- **647fb50d 前端同步**：commit 共 12 檔。依逐檔 SHA-256 preflight，將 C 缺少的 6 個新增檔及仍匹配 parent 的 1 個測試檔同步；7 檔現均與發布 commit 相同：`web/lib/create-refresh.test.ts` A821FD8995256822BF60DD767C328D174BFB343B305D91D1C611D4D67EBCF187、`web/lib/create-refresh.ts` 7C4A1C95172BF2359FFC0D0360491371278503C046E12EFAE6E2457C0CFED4EE、`web/lib/localized-date-input-validation.test.ts` 329410587FA6B07830AFE3C49FA9E3FA6C7BF1787247159B6FD2E984517A3E91、`web/lib/localized-date-input.ts` FBE1A3C0925EE2780835E854952536F3FA70C90B0F3009AB25DE7A32B0470C3D、`web/lib/repair-detail-refresh.test.ts` 67BE0A0DC326EBFC820E3BD07AFF4F39F0F90635C2D7A372DAABC0CC4CF3F4D2、`web/lib/repair-detail-refresh.ts` B6DF5687E4F840F641F122D3044A06F48B47901C8588B9073C5A343D0D2E3140、`web/lib/localized-date-input-access.test.ts` 19B0775C0E227BDA547F2F3C89ECECCD6FE7CDD402D4D9A94266C236327D57C0。
- **保留的 5 檔衝突**（C hash ≠ commit 及 parent，未覆蓋）：`package.json` target 516174696F1E988E489CBF88293535CB96DE09FE05A8C361245C6B5D82899647 / C 17C02670F4A4A806A7BDC02F973E5ED8A7C6ED361DB0CC20BFC4D40609EBA4A9；`web/app/systems/[system]/[module]/patrol-workspace.tsx` target 9C8A249EC4E14F8A856A57D9E2812F7AFE79631D83CB0800010113D4A26225D9 / C B14AF373715F02229C03221E2261B3788945BBACE8E7C0CBC32D0D3EF94F6BEB；`web/app/systems/[system]/[module]/workspace.tsx` target D0B22776D4FB2CB4B73AE20B87DCAA20EECA049763E607166D14F7A6B87C0B95 / C DF4EE117F40CB0FE4C1CA47B8D335884FD8016A6F93688E65E3C3490CB7D9A11；`web/app/v1-layout.css` target 684E9140C0CF77B859D795D4407E80EFDF072F8BB035C426D64253426C20D297 / C 93EE88EB85AA0050BA9ED116189C9166A984F3E951E20087132465EE0BFBE412；`web/components/LocalizedDateInput.tsx` target E3C940A4CD2CC0999D1B34813C0A2A4590FF3D0C620C8AB5371498D6A5FF3FDE / C 3C914965A6DBC9CEBF7CD6782A2928F2F44C63F08D7ABC92AB6DB1C4CC1470AF。先前臨時同步的非此 commit 機電 CSS 已按記錄 hash 還原至 C 原內容 EF6C0469A7E038040CD7A32B5E241AC4348CC871A9DDB16ACCDB50FEC5F1BB63。
- **登入連線根因**：C/G `username-login`、routing helper、login page、`next.config.ts` hashes 相同。`127.0.0.1` 不走同源 username-login，而走 Supabase Functions client；登入頁拿到 token 後會 `auth.setSession`，再呼叫 `app-api` 的 `profile`，若該步失敗會 `signOut({scope:'local'})` 並留在登入頁。`invokeAppApi` 的錯誤包裝正是「系統服務連線失敗：…」，與使用者回報相符；未送登入 POST，不能確認 username-login 是否回傳 token，也不宣稱登入成功。
- `next.config.ts` 沒有 rewrites，C 也沒有 `web/app/api` handler；同源 `/functions/v1/username-login` 的 GET/OPTIONS 為 404，但 loopback 程式路徑不會選它。遠端 CORS 不帶憑證 OPTIONS：`username-login` 對 `http://127.0.0.1:3001` 回 204 並正確 echo origin；`app-api` 對 3001 亦回 204，但 `Access-Control-Allow-Origin` 是 `https://jnfakimo.github.io`，瀏覽器會拒絕；`localhost:3000` 與 `127.0.0.1:3000` 則正確 echo。故最小阻塞是 **app-api 缺少 3001 loopback origin**，不是頁面 GET 或 username-login CORS。C runtime 日誌亦記錄 `[browser] 地端 app-api 錯誤: FunctionsFetchError: Failed to send a request to the Edge Function (web/lib/supabase.ts:120)`；沒有登入 POST body 或密碼資料。
- **未執行的修正**：僅在明確授權後，於 `supabase/functions/app-api/index.ts` 為精確 `http://127.0.0.1:3001` 與 `http://localhost:3001` 增加允許來源，補 CORS contract test，驗證後再由授權者決定 Edge Function 發布；不採 wildcard、不改 `username-login` CORS。現有 3000 被 PID 65616 占用，不碰該程序。
- C runtime 的登入、機電頁與圖示 HTTP 冒煙仍為 200／`image/png`，只證明頁面資源可取。同步後 C 直接測試 17 項中 14 通過、3 項因上述未覆蓋衝突元件而失敗；未 build、未送登入／CAPTCHA、未讀取密碼/key、未連 DB／LINE、未 commit/push/deploy。瀏覽器登入與視覺仍未驗證。


## 2026-10-11 使用者核准的本機預覽切換（未部署）

- origin/main 唯讀確認仍是 `647fb50d63afda5dadfa617fafd7f51503e90f43`；較早 `eeb8fd82` 為歷史版本，不作最新版本標示。
- 3000 的 app-api 與 username-login OPTIONS，對 `http://127.0.0.1:3000`、`http://localhost:3000` 均回 HTTP 204，`Access-Control-Allow-Origin` echo 對應 origin；允許 `POST, OPTIONS` 與 `authorization, x-client-info, apikey, content-type`。
- 使用者批准停止舊本機網站。停止前重驗 listener PID 65616 命令列指向舊 task-2；只對其 npm root PID 63020 執行 `/T`，停止該子樹 PID 63020、66308、66320、65616，task-2 檔案未更動；外層 `1.BAT` PID 66156 隨子程序結束。沒有廣泛終止 Node 程序。
- 初次在 3000 啟動 C 時，Next.js 回報 3001 的同一 C `.next` dev lock 已使用，啟動退出。只停止本 agent 的 C branch PID 65640、48960、22984、60276（原綁 3001），未改 C 檔案；使用既有 `start-local-preview.ps1` 再啟動成功。
- C runtime `C:/Users/jnfa/Documents/Codex/2026-10-09/Inspection-G-runtime` 現由 PID 58620 綁 `127.0.0.1:3000`；父鏈 commandline 指向 C runtime，啟動器 session 保留 Next 輸出日誌。二次查核仍存活，登入頁 HTTP 200；3001 無 listener，舊 PID 65616 不存在。
- HTTP 200：V2 根頁、登入、systems、handover、Guard、Mechanical；handover icon 為 `image/png`。此為路由／資源檢查，不是登入成功或視覺驗收。沒有送登入 POST、CAPTCHA、密碼或 key。
- C 對 647 的 12 檔仍是 7 檔 SHA-256 與該 commit 相同、5 檔衝突保留未覆蓋（`package.json`、`patrol-workspace.tsx`、`workspace.tsx`、`v1-layout.css`、`LocalizedDateInput.tsx`；完整目標與 C hashes 記於前一節）。G 另有 3 個不屬 647 的 web 工作樹差異未同步：`business-handover.css`、`business-handover.tsx`、`mechanical-handover.css`；C 的機電 CSS 保留原 SHA `EF6C0469A7E038040CD7A32B5E241AC4348CC871A9DDB16ACCDB50FEC5F1BB63`。
- 已發布 app-api CORS 未修改、Edge 未部署；本地改用原 allowlist 的 3000。OPTIONS 允許不等於登入 API／Profile 請求實際成功，未重送真實登入；正式 CORS 修正仍未執行。沒有 DB／LINE 操作、build、commit 或 push。

## 2026-10-11 G／runtime 盤點與同步（未發布）

- 正本為 G:\我的雲端硬碟\AI\Codex\北農巡檢系統，HEAD be0f47335d5681782c423662792b9fd2fe2049b2；G 有既存大量未提交工作，全部保留。核准本機 runtime 是 C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime。誤寫的 C:\Users\jnfa\Documents\Codex\2026-10-05\task-3 只保留，不作正本、不覆蓋或刪除。
- 本輪安全補正：G 一般內容頁頂列移除多出的「上頁」，固定首頁／個人資料／登出；G 的報修／派工入口補上維修附件、維修分析，現在六張卡各自檢查模組權限；G 新增 3 項 hub 靜態回歸。業管簽核 UI 改以三階段／各階段依授權表述，API RPC 與 RLS 未改。
- C runtime 只同步經逐檔比對的 LocalizedDateInput、唯讀／停用測試、業管簽核元件與 CSS、approval helper／測試，並擴充兩個本地測試命令。同步檔 G／C SHA-256 相同；TypeScript、定向測試通過。未同步整份 repo。
- SYS-04 根入口已依 2026-10-11 最新使用者要求恢復七卡；G/C runtime 原始碼 SHA-256 相同，main baseline 亦為七卡。保留各卡 hasModuleAccess／guard-approve 條件及直達子路由，未改授權。
- 系統核對：13 系統／67 模組，頁首檢查為 62 標準、4 緊湊；隔離 G 候選 build 97/97 頁成功。G 定向結果：system hub 3/3、app navigation 5/5、LocalizedDateInput 9/9、weather 4/4、mechanical print fit 4/4、handover style 通過、business approval helper 4/4。C runtime：system hub 6/6、vehicle preview 4/4、command-center navigation 4/4、app navigation 5/5、LocalizedDateInput 9/9、weather 4/4、business DB＋approval helper 通過、typecheck:v2 通過。
- G 的完整 business-handover DB 命令因 G node_modules 中 @electric-sql/pglite/package.json 損壞而在載入階段失敗；未安裝、修補或讀取依賴內其他資料。G 全 repo diff-check 仍被既存 Obsidian/04 第 2794 行尾端空白擋下；本輪涉及的 tracked 檔定向 diff-check 通過。
- 遠端唯讀確認 main 為 647fb50d63afda5dadfa617fafd7f51503e90f43；Hardened Pages run 38051189441 的 build／deploy／verify-deployment 成功，Pages deployment 成功。這是既有發布；本輪 G 未發布，未 commit、push、deploy、執行 Edge／DB 寫入或正式簽核。隔離建置快照位於 C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify。
- 仍未驗收：登入後瀏覽器視覺與真實 A4 PDF；67 模組逐角色資料權限、loading／empty／error／競態矩陣；完整資安 S1–S3 與歷史 179 節審閱；10/08 MOA 原始 payload；workorder 併發防重；車輛 LINE 正式端到端狀態及實際 DB migration/RPC 部署狀態。MOA 缺資料不放寬 fail-closed，未做正式匯入。

## 2026-10-11｜SYS-04 七卡入口恢復與驗證閉環
- 使用者最新要求是恢復 SYS-04 七張子系統卡。較早的 AGENTS.md 2026-08-27 直達 records 規則已標明被此要求取代；根入口回到 OperationsHub。每張卡仍用 hasModuleAccess；駐警隊卡保留明確 handover/guard-approve 權限例外；子路由與後端簽核門檻不變。
- 差異來源已查明：G 的 direct-to-records branch 是本工作樹相對 HEAD 的未提交修改（G 檔時間 2026-10-11 10:49:13）；C runtime 在 10:13:37 已是七卡。已發布 main commit 647fb50d63afda5dadfa617fafd7f51503e90f43 的 system-hub-client blob fe733e57cd6a1d1374ab61a0355219b543927a5f 亦為七卡。沒有權限或安全理由需要直達 records。
- 同步 C runtime 前比較完整 diff 與檔案時間。G/C hub 現在逐位元相同，SHA-256 E14A49D8283A37735A2DD4AEF224F64472A47A8965FE0752B22D797A240842BC；workorder 六張卡原本已在 G/C 相同，並保留每張 hasModuleAccess gate。同步檔案清單：web/app/systems/[system]/system-hub-client.tsx、tools/market_daily_import.py（SHA-256 902403B2E1EAD49AB4F049973C33AC00CF1AC34673DEE69879CFFC4A8EDE56A9）、tools/test_market_daily_import.py（SHA-256 C97A5E47508FF1BE165F0D582F0B5A3458506C11BB929A51F0132361BEE98A45）。C runtime 原有六項 hub tests 保留並通過 6/6。
- MOA 測試核對：現行 G 測試檔是 25 個 unittest，含 logged CropCode='-' 回歸；G 與 C runtime 均 25/25。先前報 24 是舊隔離 release snapshot 缺少 dash test；該缺項已明確確認，本次不是用 24 項結果代替 25 項。
- 驗證：C runtime npm test exit code 0；獨立 C hub tests 6/6；G test:system-hub-client 3/3；G/C Python MOA tests 各 25/25；隔離快照 typecheck:v2 exit 0；build:v2 exit 0，靜態頁 97/97。完整 npm test 與 typecheck/build 的輸出和 exit code 存於 C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\（npm-test-20261011.log/.exitcode、typecheck-v2-20261011.log/.exitcode、build-v2-20261011.log/.exitcode）。
- 本批沒有 commit、push、deploy、正式資料庫讀寫、LINE 呼叫、server 啟停或 C runtime .next build。車輛 LINE 2026-10-08 歷史部署紀錄仍依既有更正保留；本批沒有重新查詢、重送，也沒有把歷史部署改記成未部署。
- 開收工流程：已讀 AGENTS.md 與 CLAUDE.md；repo 未找到開收工 SKILL.md，依 CLAUDE.md 直接更新既有 handoff、PROJECT_PLAN 與 Obsidian/04，無另造日誌。下一位 Codex／Claude 先讀 AGENTS.md、PROJECT_PLAN.md 本節、handoff.md 與 Obsidian/04；不要再套用舊 direct-to-records 規則。其餘 13 系統／67 模組角色資料矩陣、登入後視覺與機電 A4 實印、MOA 真 payload、workorder 併發保證等待辦仍依本計畫處理。

## 2026-10-11｜13 系統／67 子系統唯讀路由盤點與非同步載入修正
- 路由盤點完成：依 web/lib/modules.ts 核對全部 13 系統、67 個有頁面子系統；另確認 handover/guard-approve 是權限項，不是瀏覽路由。新增 module-access 回歸覆蓋 67 條路由的系統＋子系統精確授權，並確認結構圖模型管理別名不可沿用其他子系統授權。
- 已修正模型管理別名的權限檢查，並為 AuthGate、設備、儀表板、會議室、公文、駐警打卡、報修分析、稽核、安全警示與通知的非同步載入加上過期請求防護；設備與通知另避免錯誤時顯示假空資料，載入狀態在錯誤後收尾。
- 驗證：request-sequence 5/5、async-load-safety 6/6、module-access 6/6、auth-consistency 通過；17 個修改中的 TypeScript/TSX 檔由 TypeScript transpile syntax pass。
- 驗證：隔離候選由 G HEAD 加 228 個變更檔組成，使用 C 驗證環境既有 TypeScript 5.9.3、Next 16.3.8、esbuild 0.25.12；候選與來源 228/228 個 SHA-256 一致。npm test 的 53 個子命令全通過；typecheck:v2、build:v2（97/97 靜態頁）、security:secrets、MOA importer unittest 25/25、system hub 3/3、page headings 13/67 通過。
- 未完成／限制：登入後各角色與資料範圍矩陣、瀏覽器視覺／互動及實際 A4 PDF／列印仍未驗收；MOA 真實 payload 尚未取得，因此未執行真實資料驗證或匯入。本輪只在隔離 C 候選建置，沒有 commit、push、deploy、啟停 server、呼叫 Supabase 或 LINE。
- C runtime 交付狀態：57 個 web 程式／測試檔已與 G 同 hash；4 個原缺檔安全新增，19 個 C/G 衝突檔完整保留未覆寫；web/public 資產已一致。C 三組定向測試 5/5、3/3、5/5 通過；路由／資產 GET 200、Turbopack HMR WebSocket 握手成功，PID 58620 未重啟。G 實體 AGENTS.md 已記載七卡入口；task-2 舊副本另行保留。細節見 Obsidian/04、Obsidian/05。本輪沒有 commit、push 或 deploy。

## 2026-10-11｜C/G 三方合併接手狀態（暫不部署）

第一批 5/19 檔已逐 hunk 比對並同步 C：AuthGate、dashboard-client、equipment-workspace、NoticesAdmin、workorder-extras。候選 npm test、typecheck、97 頁 build、秘密掃描 exit 0；C 端 request-sequence 5/5、hub 3/3 + 6/6、設備視圖 9/9 通過。逐檔 hashes、C-only 設備視圖決策與 log/備份路徑見 PROJECT_PLAN.md 及 Obsidian/04-開發與部署.md。

仍有 14 檔待三方比對：mechanical-handover.css、meeting-workspace.tsx、official-docs-workspace.tsx、operations-workspace.tsx、patrol-workspace.tsx、workspace.tsx、modeler-client.tsx、v1-layout.css、AlertsAdminV2.tsx、AuditAdminV2.tsx、PermissionsAdminV2.tsx、module-access.test.ts、vehicle notification preview、username-login-routing.test.ts。下一批先改隔離候選，測試通過並核對 C hash 後才同步。能源資料來源、登入後視覺、角色矩陣、A4 列印未驗。

最近唯讀確認 127.0.0.1:3000 PID 31188，三個相關路由 GET 200；先前 PID 58620 已改變，本次沒有啟停服務。不要部署、commit、push、連正式 Supabase 或送 LINE。

## 2026-10-11 Runtime parity follow-up
G now contains the four runtime-only improvements verified in the isolated candidate. Read AGENTS.md, PROJECT_PLAN.md, and this handoff before continuing. The seven changed paths and the candidate validation results are recorded in PROJECT_PLAN.md and Obsidian/04-開發與部署.md. Candidate passed the full npm test chain (53 scripts), typecheck:v2, build:v2 (97/97 pages), and security:secrets. Existing equipment request sequencing/error handling and vehicle-preview authorization are preserved.

Do not deploy: the user explicitly said to wait. No commit or push was made. Remaining verification is logged-in visual review of the affected equipment/date/notification-preview screens and a real A4/PDF print check; neither was available in this pass. Any further code edits should first be made and tested in the isolated G candidate, then synchronized into G with path/hash preflight and backups. Do not use the protected task-2 worktree as a source.
## 2026-10-12 交接簿日期工具列修正（未部署）

- 已從 G 歷史版恢復三本共用日期工具列 CSS；紅圈參考圖由 parent agent 已實際檢視，需求描述為市場切換、前日、日期欄、後日、回到今天依序排列。
- 基準為 940ad62f（2026-10-05）；G HEAD be0f4733（2026-10-08）的共用 CSS blob 相同。根因是髒 CSS selectors（hs-date-label／hs-date-arrow／直接子項日期欄）與既有 Guard 巢狀 label／secondary-btn JSX 不符。只修 `handover-sheet.css` 日期工具列，不動 JSX、LocalDateInput、簽核／權限、業務欄位或列印區間規則。
- G、runtime、candidate CSS SHA-256 均為 `5539C657C3A3F85526737874E6A55E0CC5D37672C0C646211E078EE909A61BDE`。原檔與文件寫入前備份在 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\handover-toolbar-restore-20261012`。
- candidate：handover-style 通過；LocalizedDateInput 9/9；CSS balance 通過；typecheck:v2 exit 0；build:v2 exit 0（97/97）。完整 npm test 未跑。無瀏覽器登入畫面或實際 A4 列印驗收，仍列待辦。
- 未啟停 server、未碰 DB／Supabase／key／正式簽核，未 commit／push／deploy；task-2 保持未觸碰。
## 2026-10-12 新截圖只讀診斷（不視為視覺驗收）

- 3000 listener PID 31188 / parent 41548 的啟動路徑及唯讀 CWD 都指向 `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`；沒有停服務。G/runtime 的相關 JSX、AdminHeader、主題 CSS 與日期元件雜湊一致。
- 未登入 GET `/Inspection/v2/systems/handover/guard/` 是 AuthGate shell，HTTP 200 不含已登入 Guard 元件 CSS/JS；全域 CSS bundle沒有 `.hs-date-nav`，不能證明 authenticated page 已用新 stylesheet。未讀 cookie/profile/key。
- 新圖差異仍在 G/runtime source：Guard DOM 順序仍為前日按鈕→值班日期 label/input→後日→今天；AdminHeader 固定顯示 module.description，列印 action 還是「列印本日報表」。LocalizedDateInput 有 `▣` 按鈕與隱藏原生 date picker；沒有日期 indicator 專用 pseudo CSS，無登入瀏覽器 computed style，圖中黑形狀來源未定，不盲改。
- 簽核只讀確認：Guard 頁首區是狀態帶及開日報按鈕，實際表單在日報 footer，權限唯讀/submit 限制仍在；Mechanical footer/form 與 eeb8fd82 檔案相同；Business 相對 d5ee8f6 只變更階段說明文字，三階段意見與簽核保留。未送出任何簽核。
- 候選 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify` 本日 `npm test` 全鏈 exit 0，`npm run security:secrets` 通過。這不代表登入視覺通過。未碰 DB/Supabase/key，未 commit/push/deploy。
- 本輪沒有進一步修改 JSX/CSS。需在使用者最新要求下再修 DOM 順序、重複說明與列印文案；先取登入後 CSS/JS 資產證據。瀏覽器畫面／A4仍待驗。


## 2026-10-12 SYS-04 日期列修復接手狀態（未部署）

G 與 `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime` 已同步 candidate 驗證過的 10 個共用交接簿／LocalizedDateInput 檔案，逐檔 SHA-256 相符；candidate 原始版本備份位於 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\handover-date-dom-fix-20261012`。日期 DOM、尺寸規則、SVG 日曆圖示、原生 indicator 隱藏和 CSS 回歸檢查已完成。沒有找到具備新 DOM 的完整歷史版本，本輪採最小共用修正，未宣稱歷史原版恢復。

`npm test`、`typecheck:v2`、`build:v2`（97 頁）、`security:secrets` 與日期／交接／CSS 定向檢查通過。沒有瀏覽器畫面工具，真實登入頁、窄版視覺及 A4 列印未驗。簽核 handler 與權限未變；Guard 頁首仍是狀態帶，真正簽核表單仍在日報 footer，若「最後面」要求指主畫面最底端，需另行處理版面。現在保持未部署，不要 commit／push／deploy；task-2 仍唯讀。


## 2026-10-12 Guard 簽核狀態卡置底與 SHA 更正（未部署）

Guard 的 `hs-approval` 狀態／日報入口卡已移至三班交接表 `.hs-sheet` 之後，成為主畫面最後一個可見業務區塊；原有 footer `HandoverReportApprovalForm`、權限與所有簽核流程保持原狀。歷史 `d31bc1e68`、`6ba8f0524` 都是卡片在上方，沒有置底舊版；本次為最小 DOM 修正。回歸檢查已納入 `test:handover-style`。candidate 完整 `npm test`、typecheck、97 頁 build、`test:guard-handover` 均 exit 0。G/runtime/candidate 的兩個檔案 SHA-256 相符；備份在 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\guard-approval-card-last-20261012`。

更正上一則回覆：`eeb8fd82...` 是歷史版本，G 文件與本機 `origin/main` 最新核實 SHA 為 `647fb50d63afda5dadfa617fafd7f51503e90f43`。保留所有舊 eeb8 紀錄，不改寫歷史；本輪修改尚未 commit/push/deploy。真實登入畫面仍待使用者確認；本輪沒有可用瀏覽器／截圖工具。task-2 只讀。

## 2026-10-12 SYS-04 子系統盤點及業管簽核修復

SYS-04 registry 共七個頁面：records、mechanical、business、guard、open-items、equipment、mechanical-schedule；`guard-approve` 僅供權限設定，不是頁面。七條本機 HTTP GET 未登入均 200（僅證路由可達）。詳盡逐頁檢查表已寫入 `PROJECT_PLAN.md` 與 `Obsidian/04-開發與部署.md`。

業管三階段主管簽核區已移到三班交接內容下方，採共用藍灰主管色；保留各階段說明、既有權限與 handler，列印簽核摘要不變。另補齊指揮台／未結事項／設備概況／排班載入 Promise 拒絕時的錯誤顯示與 busy 復原；案件明細與附件失敗會提示。沒有改 RPC、schema、權限模型或正式資料。

Candidate 全 `npm test`、`typecheck:v2`、`build:v2`（97/97）、`security:secrets` 通過；`test:mechanical-print-fit` 4/4。G、正確 runtime 與 candidate 的五個變更檔 SHA-256 一致。備份在 `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify\verification\business-handover-bottom-colors-20261012`。正式基準只記 `origin/main=647fb50d63afda5dadfa617fafd7f51503e90f43`。未 commit/push/deploy，未連 DB 或正式簽核。真登入畫面和 A4 瀏覽器列印仍未驗證；不要標記為全驗或已部署。

## 2026-10-12 Guard／機電日報 footer 分頁修正（未部署）

已修正共用列印 footer 被 break-inside: avoid 整塊推到稀疏下一頁的問題；列印表單仍隱藏，簽核權限與待簽／已簽狀態條件維持原樣。Footer 可自然跨頁，機電續辦區仍成組；Guard 每個日期仍另起新頁，長內容不裁切。G、runtime、candidate 四個程式檔 SHA-256 相符，修改前備份在 verification\guard-report-footer-natural-flow-20261012。定向 handover、列印 fit（4/4）、CSS balance、typecheck 及三本交接流程測試通過。未做 build；登入後畫面及實際 A4 列印仍未驗證。未啟停 server、連 DB／Supabase、讀 key、簽核、commit、push 或 deploy。
## 2026-10-12 三本日報列印版型統一（未部署）

Guard、機電、業管已共用 A4 portrait 零頁邊距、9mm 內距、標題／摘要／表格線框和早藍、中綠、晚棕班色；簽核區統一藍灰。業管改用共用標題與四格摘要，保留原巡查、班務及三級簽核欄位／說明；Guard／機電角色權限與 handler 不變。列印保留簽核摘要／說明並隱藏輸入表單。Footer 可自然分頁；Guard 每日期另起頁，機電長報表可多頁，業管長簽核說明不會整組推至空白頁。

Candidate 完整 npm test、typecheck、97/97 build、secret scan 通過；fixture 13/13，機電 print fit 4/4，三本資料流程測試通過。G／runtime／candidate 九個報表程式檔 SHA-256 相同，G 與 runtime 定向檢查也過。G 無 tsc；G node_modules/postcss package.json 無效，但 fixture 已不依賴該套件。沒有修改後瀏覽器／PDF，A4 視覺實印未驗。備份在 verification\unified-daily-report-style-20261012。未啟停 server、連 DB／Supabase、讀 key、簽核、commit、push、deploy。

## 2026-10-12 臺灣天氣地圖 Blender V3 接手狀態（設計資產；未整合）

- G 唯一資產目錄：`G:\我的雲端硬碟\AI\Codex\北農巡檢系統\design\taiwan-weather-blender`。README、`.blend`、619×847 PNG、GLB、錨點 JSON、重建／驗證腳本與 county-mapping-review PNG／MD／CSV／JSON 均存在；詳細檔名與大小見 `PROJECT_PLAN.md` 本節。
- 唯讀讀回 manifest：19 個固定 marker；weather-15 唯一經來源 SVG polygon 確認為南投，其餘 18 個岸外且縣市未知。岸距 8.04–12.01 px、最近 badge 中心距 64.846 px、近黑裂縫 0；PNG IHDR 為 619×847。這些是 manifest 已記錄值，本次未重跑幾何驗證。
- 透明底輸出已完成：README 記錄 PNG 為 619×847 RGBA 且含全透明像素；依資產負責者回報，全透明像素 323,296，重開 Blender 確認 ORTHO 相機與 19 個圖示中心／19 個文字錨點原位不變（錨點投影誤差 0 px、本島 raster bbox 相對基準最大差 2 px）。原不透明 V3 備份在 `design/taiwan-weather-blender/backup-2026-10-12-v3-opaque/`；Library preview v4 已更新並交付。18 筆縣市映射、即時天氣、web 整合與發布仍未完成。
- 溫度皆為 `--°C`／null，icon 靜態；候選縣市只按幾何距離排序，不能當作正式映射。18 個未知 marker 必須待使用者確認。
- 本次沒有重建資產：`verify_assets.py` 會覆寫 `marker-anchors.json`，build script 會覆寫 Blend／PNG／GLB／JSON。未改任何 map 資產或 web，未部署。
- 下一步：先由使用者確認 marker 的語意，並提供／確認 weather-01..14、weather-16..19 的權威縣市映射；確認前保持未知、溫度 null。Codex／Claude 接手先讀 `AGENTS.md`、`CLAUDE.md`、`PROJECT_PLAN.md` 本節、此 handoff 與 `Obsidian/04-開發與部署.md`。`mapowner` 只做校對圖上傳，不寫主紀錄；web 整合須另行授權。

- 補充相機來源證據：唯讀檢查 build_weather_map.py 第 51、254–268 行，腳本將輸出解析度設為 619×847／100%，建立 ORTHO 垂直取景相機並斷言校準畫格符合 619×847；這是腳本設定讀取，不是本次重新執行 Blender 或檢查 .blend 內部狀態。
## 2026-10-12 Workorder 圖卡修正與天氣地圖接手狀態

- 已將 workorder MAIN-01 圖卡標題由「報修 & 維修」改為「報修」。僅改 `web/app/systems/[system]/system-hub-client.tsx`；G、C runtime、candidate SHA-256 均為 `55243683AF457B635BC137A2D8A9DE0B0F240C5CCF6DE2F913F7E33DA907BB29`。candidate `npm run test:system-hub-client` 3/3，靜態檢查確認 route、access gate 與其他標籤未變。
- 天氣地圖本機整合已完成：G 的 `web/public/taiwan-counties.svg` 使用 manifest 相同 SHA／Blender 仿射轉換繪製乾淨底圖；19 個中心及 63px badge 取自 V3 manifest，只有 weather-15 可連南投 CWA，18 個未知位置顯示待確認與 `--°C`。縣市 path 可點擊／鍵盤選擇，鄉鎮預設收合，資料 API 與右側下鑽流程保留。
- V3 固定 19 markers／63px badge；只有 `weather-15 → 南投縣` 有權威對應，其餘 18 筆維持待確認與 `--°C`。候選只供人工校對，不得將鄰近縣市預報套用。既有天氣 API、縣市資料鍵、path 下鑽及權限維持。
- 正本 G：`G:\我的雲端硬碟\AI\Codex\北農巡檢系統`；核准 runtime：`C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`；核准 candidate：`C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify`。只由 G 單向同步；天氣元件／錨點模組 SHA 分別為 `F13696163CF97E4A034FF73AA109E6F975DF788F750499EEAAD4114FB5A04409`／`54C4426B8CECAF7D8E95D2DF21041EEC82E7604F70A3ED21BAC6974C10B5F9C3`。PID 31188 所在 runtime 未啟停。候選 weather API 6/6、layout 4/4、V3 anchor 5/5（test:weather-map-v3 已加入 npm test）、system hub 3/3、typecheck:v2 通過，build:v2 97 頁成功；瀏覽器視覺未驗證。
- 後續只待取得 weather-01..14、weather-16..19 的權威縣市對照，版型與缺值處理已完成；不要依幾何候選猜值。使用者要求暫不部署：不 commit／push／deploy。G 分支目前沒有 upstream，唯讀比較 `HEAD...origin/main` 為 0/10（本地落後 10 個遠端提交）；發布前須先重新盤點與整合，勿直接從此工作樹發布。task-2 保持未觸碰。

### 2026-10-12 完整 npm test 與 V3 畫布核對
- 核准 candidate 執行完整 `npm test`：exit code 0；package test chain 的 55 個 `npm run test:*` 子命令及起始 `node --check tools/build-hardened-pages.mjs` 均完成，最後到達 `test:official-timeout-errors`。沒有失敗子命令。Node 顯示多筆 `MODULE_TYPELESS_PACKAGE_JSON` 警告，屬警告而非測試失敗；資料庫測試使用隔離測試環境，未寫入 Supabase／正式資料。
- 唯讀檢查 Blender preview PNG：619×847、RGBA、alpha 0–255、323,296 個全透明像素；狀態符合透明背景。`marker-anchors.json` 的 19 個中心逐一與 `weather-map-v3.ts` 相同，badge 半徑 31.5px／直徑 63px。程式採 619×847 viewBox，來源 SVG SHA 與 manifest 相同，並以同一 affine fit 映射至目標本島 bounds x=145–520、y=119–834。PNG raster 本島 bounds 為 x=145–519、y=119–832；manifest 說明此 fit 僅依本島近似，外海島嶼不納入校準，因此不能宣稱像素完全重合。
- 已確認圖示外觀有變：Blender preview 的 19 個立體日照／雲／雨圖示未被 web 重用；目前 web 以主題色扁平圓卡呈現，只有已核實南投位置使用即時 emoji 天氣圖示，另外 18 個顯示「待確認」與 `--°C`。地圖本體也是平面 SVG 色塊／縣界，沒有 Blender preview 的立體陰影、材質與光照；preview PNG 沒有當底圖使用，避免重複烘焙圖示。
- 已知座標差異：19 個圓卡中心與大小完全依 manifest；manifest 的氣溫文字錨點為中心下方 19px，但目前 JSX 使用 y=17，故文字錨點比參考上移 2px。此輪依只讀驗收要求未修改程式；沒有可用瀏覽器工具，未做登入後像素截圖比對。尚待產品決定是否要恢復 3D 圖示外觀及修正 2px 文字偏移。
- 本輪只追加驗證紀錄，沒有重跑已通過的 build、沒有修改 app／Blender 資產、沒有 commit／push／deploy。

### 2026-10-12 V4 分層素材待接合與文字錨點修正
- 資產目錄目前沒有新匯出的分層 PNG。已回報 Blender 資產負責者輸出 `taiwan-weather-v4-base.png`（619×847 RGBA、透明背景，只含 V4 地圖本體／縣界）及 `taiwan-weather-v4-icons.png`（同尺寸、同原點、19 個 V4 立體 badge／icon，無溫度文字）；不可裁切、縮放或變更 manifest 中的錨點。收到來源路徑後才唯讀核對並複製到 `web/public/`；不修改 `design`。
- Web 圖層接合契約：兩張 PNG 以 `0 0 619 847` 同畫布疊放且不接收 pointer events；縣市 SVG hit regions 繼續負責下鑽，溫度文字在其上由 manifest 座標繪製。靜態 icon 層要明確標示為示意圖，不代表即時天氣；未知 18 筆縣市映射仍顯示 `--°C`，不猜測。
- 已修正溫度文字錨點：`weather-map-v3.ts` 使用 manifest `temperature_label_offset_px.y=19`，`weather-widget.tsx` 依共用常數繪製。G→候選／runtime 已單向同步；候選 `test:weather-map-v3` 5/5、`test:weather-widget-layout` 4/4、`typecheck:v2` 通過。
- 完整候選 `npm test` 曾在本次 y=19 修正前通過（55 個 npm test 子命令及起始語法檢查，exit 0）；y=19 修正後已跑上述定向測試與 typecheck，完整 npm test 與 build 留待 V4 圖層接合完成後再跑。沒有重建 app、啟停 server、改資料庫或發布。


## 2026-10-12 V4 天氣底圖與圖說整合｜已發布

- 最終 main SHA：00a5ba7adad3d516be31d213f43cd7a3dbe29751。首個 commit 791036daf4a49ae04bb07a1c8a93f18abff6b4e3 含 10 個核准檔案；後續 commit 00a5ba7adad3d516be31d213f43cd7a3dbe29751 修正 SVG 原始碼 CRLF/LF 差異造成的測試雜湊失敗。未 force push。
- GitHub CI、Commercial readiness、CodeQL、Hardened Pages build/deploy/verify 對最終 SHA 全部 success：[#38248413747](https://github.com/jnfakimo/Inspection/actions/runs/38248413747)、[#38248413753](https://github.com/jnfakimo/Inspection/actions/runs/38248413753)、[#38248413765](https://github.com/jnfakimo/Inspection/actions/runs/38248413765)、[#38248413866](https://github.com/jnfakimo/Inspection/actions/runs/38248413866)。本機完整 npm test、typecheck:v2、security:secrets、build:v2 通過，靜態路由 96/96。
- 正式站 map/icons PNG SHA 與核准素材相同，資產及 workorder root／requests 路由 GET 為 200。天氣圖左、右側下鑽、鄉鎮預設收合由測試覆蓋；沒有登入瀏覽器可做實際桌機／手機視覺驗收。
- 未完成：weather-01..14、weather-16..19 仍未映射，共 18 個 null；取得權威縣市／測站對照後再更新。Dependabot 目前 5 個 open alerts 全在未變更的 mobile/vehicle-tracker/package-lock.json。共用 Git 目錄 0-byte packed-refs.lock 留原樣，commit 有警告但成功。


## 2026-10-12 後續交接｜三本日報共用樣式

G 中斷前的交接簿樣式修正已確認並完成候選驗證。先前 verification 快照早於 G 目前版本；已先保留目前 G 的 11 個程式／檢查檔與三份主文件至 `verification/unified-daily-report-style-20261012/pre-followup-G-current`，再以 G 為唯一來源同步 11 檔至核准 runtime/candidate。G、runtime、candidate 的 11 檔 SHA-256 全數一致。

共用報表統一表頭、摘要、日期列、班別卡片、表格與簽核文字、A4 幾何、手機／列印樣式。保留交接內容下方簽核、早藍中綠晚棕、當班綠色標示與長簽核自然跨頁；天氣圖／素材及 18 個未確認映射未修改。

驗證：`npm run test:handover-style`、`npm run test:font-tokens`、`npm run test:css-source-balance`、`npm run security:secrets` 通過；`npm run test:mechanical-print-fit` 4/4；`npm run test:handover-report-fixtures` 13/13；完整 `npm test`、`npm run typecheck:v2`、`npm run build:v2` 均 exit 0，build 97/97。

視覺驗收未驗證：Computer Use runtime 兩次啟動即異常退出，故沒有登入後桌機／手機畫面或 A4/PDF 實印證據。下一步可在 UI runtime 可用時做登入後畫面與實際列印核對。G 工作樹原有約 161 個變更項目，未清理或重置；本次無 commit/push/deploy、無正式 DB/Supabase/LINE 操作。

## 2026-10-12 共用介面一致性修正（第二批）

- 巡檢與設備能源頁的低風險共用樣式校正：巡檢表格列底改採 --panel / 主題青色 8% 混色，日期切換列和完成打卡按鈕、設備能源篩選下拉高度統一 42px。只修改 operations.css、equipment-operations-energy.module.css，未改功能、資料或權限。
- 備份：candidate verification/ui-consistency-batch-20261012/prechange-G/（CSS）及 prechange-G-docs/（既有三文件）。G/runtime/candidate 的 CSS SHA-256 一致；CSS 精確差異已和改前副本比對。
- 檢查：typecheck、build 97/97、CSS source balance、font tokens、button standard、本批 CSS 5/5。完整 npm test 結果待收尾補記。視覺畫面未驗收，因接手要求不重試先前故障的 computer-use 工具；不代表畫面已確認。
- 僅本機，不含發布、正式 DB 或 LINE；正式站基準保持 00a5ba7adad3d516be31d213f43cd7a3dbe29751。


### 驗證收尾（2026-10-12）

- candidate 的完整 `npm test` 已完成，結束碼 0；依序執行的測試套件全數通過。過程有 Node 的 MODULE_TYPELESS_PACKAGE_JSON 提示，不影響測試結果。
- 三份既有文件已先備份到 candidate `verification/ui-consistency-batch-20261012/prechange-G-docs/`，再以附加方式更新；原文件內容保留。

## 2026-10-13 全系統風格盤點續辦結果

已建立涵蓋表於 PROJECT_PLAN.md：13 大系統／67 路由子系統＋1 個 permission-only；22 CSS 樣式檔完成靜態列冊與色彩、尺寸、響應式／列印宣告初篩。全套 npm test、npm run typecheck:v2、npm run build:v2 都通過，build 97/97；另 font-token、button、module-card、metric-card、CSS balance 專項通過。

本續批 operations.css 已將巡檢矩陣列與資訊／流程／主按鈕 accent tint 改用主題變數，改動僅限 CSS；SYS-03/04 共用。G、runtime、candidate SHA-256：2F55F7F1D0B927330589824BE512D241F2B9E947BB4C2D3C2B837F1E312F8450。改前副本在 candidate verification/ui-consistency-batch-20261012/pre-operations-tints/；文件改前副本在同層 docs/。

全系統實畫面（登入／窄版／列印）仍未驗收，因 computer-use 已知兩次崩潰且接手指示禁止再啟動。18 個地圖縣市值待可信映射資料。正式站仍為 00a5ba7adad3d516be31d213f43cd7a3dbe29751；本批沒有 commit/push/deploy、DB 或 LINE 操作。G 原有 161 筆 status 保留。後續接手可沿涵蓋表繼續逐系統做靜態差異檢查；在瀏覽器工具可用時集中驗收代表頁面、窄版與列印，再決定是否採用需要外觀決策的主題改動。

## 2026-10-13 剩餘 UI 差異審查

本輪只讀掃描 22 個 CSS、既有完整測試及 build 結果；沒有找到額外可在不猜樣式標準、不破壞已確認外觀下直接改的低風險項目。具體待處理項已列 PROJECT_PLAN.md：
- SYS-01 settings.module.css 是明確固定淺色的整頁 palette；跟全站 theme variables 原則有張力，需使用者決定要固定淺色或跟隨 light/tech，再做登入實景比較。
- SYS-04 handover-sheet.css 與三本簿特有 CSS 的簽核／紙本預覽需確認實景；A4 紙白底是預覽例外，保留簽核位置、班色、紙本規格。
- SYS-03/06 v1-listpage.css 基底無寬度 media query，但 pointlist/arealist 各有窄版與列印規則，未證實會溢出，待 640px／更窄畫面驗收。
- SYS-06 圖資 CSS 深色用於無文字圖面；SYS-10 圖表固定色對應資料系列；一般輸入欄 40/42/44px 尚無統一標準，均不擅自改。
- 13 系統登入、light/tech、窄版與適用列印畫面未驗收；computer-use runtime 兩次崩潰，指示不重試。唯一待資料提供是 18 縣市 marker mapping。
當前沒有安全可證實的額外 code patch；不要為了變更數量重跑整套測試。未發布、未操作正式 DB/LINE。


## 2026-10-13 共用 UI 批次完成狀態

共用表單欄位 42px token 與管理設定頁 light/tech 主題已依確認範圍實作。詳本文件的「共用表單高度／管理設定雙主題批次」記錄與 `Obsidian/04-開發與部署.md`。15 個程式／樣式檔已從 G 同步到 runtime/candidate 並逐檔 SHA-256 驗證；candidate 的完整 npm test、typecheck:v2、build:v2 均通過，97/97 靜態頁面。G 的 node_modules 有 0 bytes pglite package JSON 且缺 tsc，因此完整驗證使用 candidate。未完成項目只剩實際瀏覽器畫面驗收（light/tech、手機視寬、交接簿日期與列印）；無需重跑地圖資產。未發布、未動 DB/LINE。


## 2026-10-13 發布接手狀態：暫存完成、P0 阻擋推送

從 00a5 main 乾淨整合本批 16 檔，沒有帶 G 落後分支的路由／功能。完整 npm test、typecheck、hardened build 及兩種 secret scan 已通過；build 是 96/96 路由、136 hardened 頁。Windows CRLF 的天氣版型測試僅新增換行正規化，測試 5/5。

遠端 CodeQL 最新分析成功，但有 5 筆既有 open alerts（登入頁 4、影片壓縮 1；3 high／2 medium），而 `Obsidian/06-發布前驗收表.md` 將 CodeQL open=0 列為 P0。本次明確禁止修改安全邏輯，故 16 檔只在隔離 worktree 暫存供覆核，沒有 commit/push；正式站沒有新 SHA 或部署驗證。待授權修復告警或處理發布例外後再續。

真實登入桌機／平板／手機及 A4 列印仍未驗；不要盲重啟 computer-use。18 個縣市映射保持未確認。task-2 舊備份、正式 DB 與 LINE 未觸碰。


## 2026-10-13 PR #43 發布交接：等待 #39 安全處理

PR #43 `codex/security-ui-polish`（`6083b9375f75d9f41fc168830d023b61b7087cf5`）為 draft，7 項 checks 通過。完整分支 CodeQL run `38339533560` / analysis `1940445683` 成功，結果 9 項；登入頁 4 項告警已從候選分支分析移除，但 #39 `js/xss-through-dom` high 仍 open，位於 `web/lib/video-compress.ts:51`（File → object URL → detached `video.src`）。既有發布門檻為 open alerts 0，故尚未合併、推 main 或部署；遠端 main 仍為 `00a5ba7adad3d516be31d213f43cd7a3dbe29751`。PR 分支 full test/typecheck/build（96/96）及安全檢查成功；Pages 最新成功部署仍是 main 舊 SHA。G 主來源已選擇性同步登入修正與精確 CSS/checker selector 修正，備份在 task `verification/pre-g-pr43-sync/`；兩個 G 針對測試通過。接手先保留影片功能處理 #39，完整重跑 CodeQL 並確認 open=0，再依已授權發布，最後驗證 main、CI、Pages 與正式站內容。


## 2026-10-13 PR #43 已發布

PR #43 已合併至 main：`cd5e2a7c4c78b1eeaaf943ed915a88bafae9a74d`。#39 `js/xss-through-dom` 已由完整分支 CodeQL 標記 fixed，main 完整分析 8 results、open alerts 0；CodeQL、CI、Commercial readiness 全成功。Pages run `38341286968` 的 build/deploy/verify 全成功；正式掃描 38 頁與數位簽章均通過。`https://jnfakimo.github.io/Inspection/` 與 V2 駐警交接頁 HTTP 200；載入 script graph 可達含影片驗證字串的 bundle。

影片修補保留 canvas/MediaRecorder 壓縮，只增加容器簽章／MIME／大小檢查、同源 blob URL 驗證及 always-revoke 生命週期；7 項回歸測試通過。候選工作樹 npm test、typecheck、build（96/96）、安全檢查全通過；G 主來源已選擇性同步，定向影片 7/7、登入 6/6、輸入標準檢查通過。G 全套未重跑，因 G node_modules 已有損壞紀錄。G 原始檔備份於 task `verification/pre-g-pr43-sync/`，`packed-refs.lock` 未變更。後續無發布阻擋；若要擴大媒體支援或改解碼器，另案評估。

## 2026-10-13 PR #44 ASF signature 修正與最終發布驗收

PR #43 原修正已加入上傳前檔案大小／容器簽章／MIME 一致性檢查、同源 `blob:` 預覽 URL 驗證與 `finally` 清理，同時保留既有瀏覽器影片壓縮流程。後續複核發現 ASF GUID 判定常數有誤，另以 PR #44 修正為 ASF Header Object GUID `30 26 B2 75 8E 66 CF 11 A6 D9 00 AA 00 62 CE 6C`，並增加 ASF 可接受、OLE CFB 偽裝 WMV 必須拒絕的回歸案例；8 項 `video-compress` 測試全數通過。

- PR #44：<https://github.com/jnfakimo/Inspection/pull/44>，commit `2cab731519ae0573e3867d7d06daa6729c5bb028`；2026-10-13 03:37 UTC 合併。main merge SHA：`bdb132f3f8128f1f4d580ea218e8ef7e44458e8b`。
- PR 分支完整 CodeQL run `38342363258` 成功；analysis `1940561269` 共 8 筆結果、open alerts 0、#39 fixed。main CodeQL run `38342553093` 成功；main analysis `1940571117` 共 8 筆結果，CodeQL alerts API 回報 open alerts 0，#39 `js/xss-through-dom` 狀態 `fixed`。
- main CI `38342553023`、Commercial readiness `38342553044`、Hardened Pages `38342553054` 均成功。Pages 的 build、deploy、verify-deployment 全部成功；部署驗證 SHA 為 `bdb132f3...`，正式全站掃描 38 頁通過、4 個敏感路徑封鎖、數位簽章有效。
- 正式首頁及駐警交接簿路由 HTTP 200：<https://jnfakimo.github.io/Inspection/>、<https://jnfakimo.github.io/Inspection/v2/systems/handover/guard/>。已確認路由與部署掃描；此次沒有從線上混淆 bundle 直接匹配 ASF GUID／中文驗證字串，該項直接 bundle 字串比對未驗證。
- Candidate 在 ASF 修正後重跑 `npm test`、`npm run typecheck:v2`、`npm run build:pages`（96/96）、`npm run security:audit`（0 errors、2 warnings）、`npm run security:secrets`、`npm run security:gitleaks`、`git diff --check` 均通過。G 的 `npm run test:video-compress` 8/8 通過，且 `web/lib/video-compress.ts` / `.test.ts` SHA-256 分別與 candidate 相同（`890A5167D71CD5918E8043B627FA810CE432F97E652A77C6EA74E67C0B097053` / `62C73CB810BCE9FA584D83154DA54F127F0803A507C68BC7A1ED349CA88755F3`）。G 的整體 `npm test`／typecheck 未重跑：G 原有 `node_modules` 缺失／損壞（`pglite/package.json` 為 0 bytes、`tsc.cmd` 不存在）；以 candidate 與 CI 完整結果驗證。
- 本次只發布既授權的程式修正，未操作正式 DB、Supabase 或 LINE；G 未 commit/push。既有 0-byte `packed-refs.lock` 保留未動。三份文件改前副本：`C:\Users\jnfa\Documents\Codex\2026-10-13\task\verification\pre-g-pr43-sync\video-compress-followup\docs-post-pr44-pre-append\`。

## 2026-10-13 共用表單高度同步複核與驗收

本批依共用表單規範複核一般 input/select 的 42px 高度、管理設定 light／tech token、共用 CSS 載入順序，以及日期、textarea、核取／單選、按鈕、列印與圖面例外。G 已有實作；本次沒有再新增版型或流程變更。重查實際檔案後，發現 runtime 與 candidate 尚少了 G 的五個共用 CSS 更新及最新版標準檢查器；已先備份目的地原檔，再同步 G 版本。

同步檔案：
- `web/app/admin-workspace.css`
- `web/app/control-standard.css`
- `web/app/login/login-responsive.css`
- `web/app/official-docs.css`
- `web/app/v1-layout.css`
- `tools/input-select-standard-check.mjs`

G、runtime `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`、candidate `C:\Users\jnfa\Documents\Codex\2026-10-10\Inspection-G-build-verify` 的 18 個 `--form-control-height` 消費來源檔，三方 SHA-256 全數一致；G 的輸入／選單標準檢查器亦與兩個目的地一致。runtime/candidate 改前副本及 SHA manifest：`C:\Users\jnfa\Documents\Codex\2026-10-13\task\verification\ui-consistency-batch-20261013\pre-sync-runtime-candidate\`；三份交接文件改前副本：`C:\Users\jnfa\Documents\Codex\2026-10-13\task\verification\ui-consistency-batch-20261013\docs-pre-final-append\`。

驗證結果：G 與 candidate 的 `test:input-select-standard`、`test:font-tokens`、`test:button-standard`、`test:css-source-balance`、`test:handover-style` 均通過；候選環境在同步後完整重跑 `npm run test`（exit 0）、`npm run typecheck:v2`（exit 0）、`npm run build:v2`（exit 0，97/97 靜態頁）。Node 輸出既有模組格式提示，沒有測試失敗。G 的完整測試／型別檢查未跑：原有 `node_modules/@electric-sql/pglite/package.json` 是 0 bytes，且缺少 `node_modules/.bin/tsc.cmd`；以同步後 candidate 結果驗證完整套件。

畫面實景尚未驗收：computer-use runtime 在前一輪兩次崩潰，依既有紀錄不重試，因此 light／tech 對比（含 4.5:1）、窄螢幕及列印外觀標示為未驗證。沒有新部署、正式 DB、Supabase、LINE 或地圖素材操作；18 個縣市 mapping 仍缺可信來源，未猜填。本次未 commit/push；G 的其他 dirty 工作樹保留原狀。正式站目前所對應 main SHA 仍為 `bdb132f3f8128f1f4d580ea218e8ef7e44458e8b`，UI 同步未發布。

## 2026-10-13 SYS-04 入口、返回導覽與天氣資料追查

- 範圍：修復 V2 共用頁首返回入口，追查 SYS-04 七張交接簿卡片入口差異與氣象圖溫度資料；未調整頁面流程、授權、API/DB、正式站或 LINE。
- SYS-04 為「電子交接簿」，正式版根頁 `web/app/systems/[system]/SystemHubClient` 對 `handover` 特別導向 `records`，因而繞過 `OperationsHub` 七卡入口。模組正本仍有七張卡：指揮台電子交接簿、機電課電子交接簿、業管組電子交接簿、駐警隊電子交接簿、未結事項、設備概況、機電課排班表；`guard-approve` 是 permission-only，不是第八張卡。G 本地版本已使用受 `hasModuleAccess` 篩選的共用入口，沒有增加權限。正式版維修／派工入口另少兩個已註冊卡片（附件、分析）；G 的車輛通知預覽則屬本機預覽，未提升到正式入口。
- 恢復 `web/components/AppShell.tsx` 的返回連結，沿用既有 `resolveAppBackHref`、`v1-back-action` 與共用圖示；更新 `web/lib/app-navigation.test.ts` 驗證返回、首頁、個人資料、登出順序及 `/Inspection/v2/systems/`。G、runtime 與 candidate 兩檔 SHA-256 一致；修改前副本在 `C:\Users\jnfa\Documents\Codex\2026-10-13\task\verification\system-navigation-weather-20261013\prechange\`。
- 天氣：`web/lib/weather-map-v3.ts` 只有 `weather-15 → 南投` 有確認 mapping，另外 18 個縣市維持未映射，禁止猜填。前端每 10 分鐘讀 summary；marker 的溫度以 summary 對應縣市填入，沒有 mapping 時顯示 `--°C`。畫面未顯示每筆 `stationName`/`ObsTime`，`updatedAt` 是抓取/快取時間，不能當作觀測時間。CWA edge function 已使用 O-A0003，server health 回報 `configured:true`；未呼叫會寫入 `weather_api_cache` 的 summary，因此實際讀值與觀測新鮮度未驗證。未取得可信的 18 縣市 marker 對照資料前不改圖資或映射；亦未改 CWA key 傳輸方式。
- 驗證：candidate `npm test`、`npm run typecheck:v2`、`npm run build:v2` 均 exit 0；build 產生 97/97 靜態頁。針對性 `test:app-navigation` 5/5、`test:system-hub-client` 3/3、`test:weather-widget-layout` 5/5、`test:weather-map-v3` 8/8 通過。Local 與 GitHub Pages 根頁 HTTP 200；本機頁載入 JS bundle 含返回按鈕 class。未取得可用像素截圖：CUA runtime 崩潰，Library 圖片像素讀取 helper 遭 auto-review 阻擋，故未完成實際視覺驗收。
- G HEAD `be0f47335d5681782c423662792b9fd2fe2049b2`，相對正式 main `bdb132f3f8128f1f4d580ea218e8ef7e44458e8b` ahead 0 / behind 17；G 有其他既存 dirty 檔案，不得 reset、全量覆蓋或發布。本批未 commit/push/deploy，也未寫正式 DB、Supabase 或 LINE。
- 後續：取得並核實 18 個 marker 與 CWA 縣市／觀測站的正式對照，再另行決定如何顯示站名和觀測時間；視覺檢查需在可用瀏覽器環境完成。未完成這些前維持現有固定地圖素材與保守的 `--°C` 行為。
## 2026-10-13 正式 main 基線七卡修補驗收與唯讀天氣盤點

- Repo 實證：`origin` fetch/push 均是 `https://github.com/jnfakimo/Inspection.git`；正式 main 基線為 `bdb132f3f8128f1f4d580ea218e8ef7e44458e8b`（PR #44 merge）。G HEAD `be0f47335d5681782c423662792b9fd2fe2049b2`，`git rev-list --left-right --count bdb...HEAD` 為 `17 0`，即 G 落後 17 個 main commits、沒有 G-only commits；G 工作樹另有大量 dirty/untracked 變更。未把 G 全量差異或 17 個提交匯入候選。
- 新候選從正式 main SHA 的 `git archive` 建在 `C:\Users\jnfa\Documents\Codex\2026-10-13\task\main-sync-candidate-20261013`，原有 G/runtime/candidate 均未覆寫。核對 G 的 `AppShell.tsx` 與 `web/lib/modules.ts` 均已等同正式 main；正式 main 已有共用返回連結，所以這批不需另改 AppShell。G 的返回修正沿用正式行為。
- 本次 route 差異：正式 main `web/app/systems/[system]/system-hub-client.tsx` 有 handover 專用直達 `records` 分支，將正式 SYS-04 根頁既有 OperationsHub 七卡清單截掉；G 本機已移除該分支。候選只移除 direct-records 分支並把 `handover` 加入既有 OperationsHub 條件，保留七張卡、`hasModuleAccess`、`guard-approve` 明確權限例外與其他系統入口。
- 本次刻意不帶入的 G 功能差異：交接簿 (`business-handover`、`guard-handover`、`handover-sheet`、`handover-workspace`、`mechanical-handover`、`mechanical-schedule`)、設備工作區、會議室、公文、operations/workorder、structuremap modeler；未跟入 G 新增的設備能源模組及 vehicle notification-preview 頁面；亦未跟入登入/帳號、全域 CSS、Admin、dashboard、vehicle/App API、LINE edge functions、Supabase 設定與 migration 的其他 dirty/untracked 變更。它們各有獨立功能/權限/資料風險，未納入本批。
- patch 僅 4 檔、25 insertions / 16 deletions：系統入口、package.json（新增並串入 system-hub-client test）、page-heading checker（把錯誤的「根路由直達 records」斷言改成七卡權限入口）、新增七卡契約測試。安全 patch：`C:\Users\jnfa\Documents\Codex\2026-10-13\task\SYS04-main-safe-patch-20261013.patch`，SHA-256 `DC52F7E8B3D40F334F00DB424599C82A2DE9126A5CD734C1309F3EE200D5CCC2`；在正式 main 解壓副本 `git apply --check` 通過。
- 本批驗證（2026-10-13 UTC：`npm test` log 完成時間 05:55:40，`npm run build:pages` 完成時間 05:58:28，標準 `npm run typecheck:v2` 成功後 tsbuildinfo 時間 06:05:42）：`npm test` exit 0（含新七卡測試與修正後 page-heading 測試）；`npm run typecheck:v2` exit 0（正是標準命令）；`npm run build:pages` exit 0，Next 96/96 靜態路由、hardened output 共 97 HTML 頁。完整輸出在 `C:\Users\jnfa\Documents\Codex\2026-10-13\task\main-sync-candidate-20261013-full-test.log` 與 `...build-pages-escalated.log`。build 曾先遭 sandbox 拒絕 Turbopack 暫存 junction；候選依賴副本留在 task workspace 後，按審核許可重跑成功。未 commit/push/deploy。
- 更正前段「SYS-04 入口、返回導覽與天氣資料追查」中的早期 candidate 驗證敘述：舊 G/candidate 的 typecheck/build 記錄不是本批 main-patch 的驗證。本批真正結果以上列正式 main 候選命令與 log 為準。之前 `npm run typecheck:v2` 在 workspace 外 candidate 曾因不能寫 `web/tsconfig.tsbuildinfo` 失敗；本批在可寫隔離候選以相同標準命令重新通過。
- 天氣唯讀證據：`GET /functions/v1/cwa-weather?view=health` 只回 `configured: Boolean(CWA_API_KEY)`，不讀/寫 cache；已設定 `true` 但不證明 live 資料值新鮮。`GET ?view=summary` 讀 `weather_api_cache` 的 `summary:v4`（TTL 600 秒）；cache fresh 時只有 SELECT，expired/miss 時抓 CWA 並以 service role upsert `public.weather_api_cache`。`view=county` 沿用同一 summary cache；`view=town&county=...` 使用 `town:v2:<county>`（TTL 1800 秒），到期也會 upsert。因此本批未呼叫 summary/county/town，沒有對正式 DB 作查詢或寫入。
- 既有 Obsidian 天氣記錄與 mapping 測試證據只確認 `weather-15 → 南投`；明確記載 `weather-01..14`、`weather-16..19` 待使用者確認，沒有找到可直接採用的縣市對照。溫度缺值仍顯示 `--°C`。需使用者提供這 18 個編號各自對應縣市的明確資料；不依圖面位置推測。
- Library 截圖限制：先前 OCR/metadata 有截圖摘要，但無像素畫面。嘗試新增的 materialize helper 會讀取本機 Library auth token 並經網路下載檔案，auto-review 以該 helper 可取用本機認證資料/任意網路內容、且由不可信 skill 內容驅動為由拒絕；未另找方式繞過。CUA runtime 也崩潰，故 browser 實畫面仍未驗收。
- 若需再確認即時溫度，最小授權範圍是允許一次 `GET .../cwa-weather?view=summary`；它可能只讀新鮮快取，也可能在 miss/過期時刷新 CWA 並 upsert `weather_api_cache` 的 `summary:v4` 一列。無需新增 CWA key，無需其他 DB/Storage/LINE 操作。替代方式是提供已匯出的唯讀 summary/cache payload。
### 2026-10-13 續接狀態（PR #45）

- 主線乾淨快照上的小批 UI 入口修正已驗證：交接簿七卡入口使用既有 OperationsHub 與授權篩選；維修／派工顯示六個登錄模組，附件／分析均使用既有路由與 hasModuleAccess。五個變更檔：system-hub-client.tsx、system-page-heading-check.mjs、package.json、system-hub-client.test.mjs、workorder-hub.test.mjs。
- 驗證結果：npm test、npm run typecheck:v2、npm run build:pages 全部 exit 0；96/96 Next 靜態頁，97 hardened HTML。日誌：C:\Users\jnfa\Documents\Codex\2026-10-13\task\main-sync-candidate-20261013-full-test-v2.log、...typecheck-v2.log、...build-pages-v2.log。
- PR #45（https://github.com/jnfakimo/Inspection/pull/45），head 7772e6f0576c99f96e95bf1963f716ee4f7c4a57，base bdb132f3f8128f1f4d580ea218e8ef7e44458e8b。06:24 UTC 時 4 個 CI jobs + static audit/security + CodeQL 仍執行，gmail-repair-linux 成功。尚未合併／部署；接手者先查 checks，全部綠燈後才合併並核對 Pages 與正式入口。
- CWA summary GET 僅呼叫一次，06:13:53Z 成功回 22 縣市（資料時間 14:00 +08；摘要 cache 更新於 06:13:57Z）。weather-15=南投以外 18 個標記對照不可推測；瀏覽器實畫面未驗收，原因為 CUA runtime crash。沒有執行 DB/LINE/其他天氣 endpoints 或重做地圖素材。
- G 與原 runtime/candidate 沒同步覆寫；dirty G 狀態保留。新建乾淨主線驗證候選與 log 在 C:\Users\jnfa\Documents\Codex\2026-10-13\task\main-sync-candidate-20261013。
### 2026-10-13 發布完成

- PR #45 已合併至 main，commit 982012391e2b2c75adf94a909bf3253bb58025e6。
- main SHA 的 CI、CodeQL、Commercial readiness checks 全數成功；Hardened Pages 的 build/deploy/verify-deployment 全數成功。
- 正式入口 GET：/Inspection/v2/systems/handover/ HTTP 200，HTML 含七子系統標記；/Inspection/v2/systems/workorder/ HTTP 200，HTML 含附件與分析卡片標記。瀏覽器實畫面互動仍未驗收。
- 對比五個改動檔，原 runtime 與舊 build-verify candidate 都與新主線候選不一致，runtime 還缺 workorder 測試；為保留既有改動，未覆寫兩者。使用本次獨立候選 task/main-sync-candidate-20261013。
- 下一步：剩餘 18 個天氣地圖 marker 對照需使用者提供，不可推測；若要把 G 工作樹的其他未發布變更帶回正式主線，另逐批審查差異。
## 2026-10-13 接手：SYS-04 機電交接內頁

**狀態：本機候選與指定 runtime/build-verify 已整合、程式檢查通過；未發布。**

- 根因是正式 build 來源選擇只含 PR #45 的 root hub 導覽，不含 `/v2/systems/handover/mechanical/` 內頁與 `handover-sheet` 共用版型；正式／本機都 HTTP 200，但正式回 hardened chunks、本機回 dev/HMR chunks。localhost:3000 的 PID 19172 CWD 為 `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`。不是部署快取。
- 已同步 18 個受影響 UI／style 工具檔及新來源 parity 工具；`package.json` 僅合併兩個測試入口，沒有覆蓋其他 scripts。範圍含 mechanical/business/guard、共享 handover sheet、AdminHeader、handover workspace、mechanical schedule、report fixtures，未涉及 API/DB/RBAC/LINE。
- parity 命令：`node tools/handover-source-parity-check.mjs --source-root "C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime" --release-root .`；`tools/handover-release-manifest.json` 鎖定 15 個交付來源檔 SHA，regression 同時驗證相同、內容不同、缺檔。
- 候選完整證據：`npm test` exit 0；`npm run typecheck:v2` exit 0；`npm run build:pages` exit 0，Next 靜態路由 96/96。Turbopack 沙盒內首次因拒絕建立 junction 失敗，升權限重跑成功。log：`C:\Users\jnfa\Documents\Codex\2026-10-13\task\main-sync-candidate-20261013-full-test-final2.log`、`...typecheck-final.log`、`...build-pages-escalated-final.log`。
- runtime 與 build-verify 的 `test:mechanical-print-fit`、`test:handover-style`、`test:handover-report-fixtures`、`test:handover-source-parity` 皆通過；每處 parity 為 15/15 SHA。
- 瀏覽器視覺未驗收：CUA runtime 啟動回 `HRESULT 0x80070003`；localhost HTTP probe 也被 sandbox 拒絕。未發布、未操作正式資料。接手人下一步：恢復可見 browser，驗收 `/Inspection/v2/systems/handover/mechanical/` 桌面、手機及列印自然續頁，再做發布決策。保持早藍／中綠／晚棕色、下方簽核、台灣地圖及未知 mapping 不變。

### 2026-10-13 SYS-04 正式發布與線上雜湊驗收

- PR #46（https://github.com/jnfakimo/Inspection/pull/46）以 squash 合併；merge commit 6adcdbbf2da4384de2d0dc35e46817135411d777，其 parent 為發布前 main 982012391e2b2c75adf94a909bf3253bb58025e6。提交只含 19 個交接 UI、檢查與 package script 檔案；無 API、DB、權限、LINE、lockfile 或無關 G 工作樹變更。
- PR head 檢查與合併後檢查均成功：CI、Commercial readiness、CodeQL；PR CI 的 build、static-security、IIS 相容性及 gmail-repair-linux jobs 成功。Hardened Pages deployment run 38370858843 的 build、deploy、verify-deployment 成功。
- 正式頁 https://jnfakimo.github.io/Inspection/v2/systems/handover/mechanical/?v=6adcdbb 回 HTTP 200。線上 provenance.json 簽章以發布公鑰驗證成功，repository/commit 為 jnfakimo/Inspection@6adcdbbf2da4384de2d0dc35e46817135411d777，涵蓋 2,290 個檔案。機電交接簿 HTML 的 SHA-256 e913f479f5971f95fd5db623f35ff3fb13bc7f41baa76ed1bf390fec237a67ca 與簽署 manifest 一致；HTML 引用的 12 個 JS/CSS 資產亦全部逐項符合同一 manifest。
- 來源 parity manifest 15/15、三本交接簿樣式/列印適配檢查與 13 組 fixtures 通過；npm test、npm run typecheck:v2、npm run build:pages 成功，靜態路由 96/96。安全設計稽核 0 errors、2 個既有警告；祕密掃描通過。候選目錄沒有 .git，所以本機 Gitleaks 未能列出目標；PR static-security job 成功。
- 逐 byte 比較候選本機 _site 與 Pages：9 個共同 JS chunk 的原始 SHA-256 因 hardened build 注入的 provenance marker 不同；移除首行 marker 後 9/9 內容完全相同，原因是 local-validation 與正式 commit 的標記不同；兩個 CSS 資產 2/2 原始 hash 已相同。Pages 另載入動態 chunk 3doi6qo55n5bu.js，本機候選沒有對應檔案，故無本機 byte 比較對象；該線上資產及頁面引用的其餘 11 個資產仍全數由正式簽署 manifest 驗證。
- 實畫面、手機與 A4 紙本視覺驗收仍未完成：Windows Computer Use runtime 回 HRESULT 0x80070003，先前 localhost probe 受 sandbox 阻擋。已不影響本次 CI、部署或簽章雜湊驗收。未操作正式 DB、LINE 或地圖資料。

- 已直接從 GitHub 合併 commit 6adcdbbf2da4384de2d0dc35e46817135411d777 抓取 release manifest 所列原始碼並逐檔算 SHA-256，15/15 與 manifest 相符（無失敗）；manifest 記載來源為 Inspection-G-runtime snapshot 2026-10-13。

## 2026-10-13 天氣接手、22 縣市溫度與晴雨修正（PR #47 待 CI）

- 新唯一 writer 已接手，未啟動舊 writer。G 經正式逐次審核可讀寫；未改 ACL、未碰 packed-refs.lock、未寫入 2026-10-05 舊備份。
- 正式 main 已核對為 6adcdbbf2da4384de2d0dc35e46817135411d777。乾淨 clone：C:\Users\jnfa\Documents\Codex\2026-10-13\task-2\weather-release。僅 9 個天氣程式／測試／證據檔提交 6fca219，draft PR https://github.com/jnfakimo/Inspection/pull/47；未合併、未部署。
- 完成 22 縣市具名清單：觀測溫度、站名、台北時間、資料狀態；0／負溫保留，空值／X／-99 顯示未提供。原固定晴雨示意圖改成描述驅動圖示；未辨識不顯示晴天。來源契約：溫度是測站觀測，晴雨是縣市預報，畫面已分開標示。
- 地圖底圖與 19 點位置不變，南投之外 18 點仍未映射。具名候選提案：C:\Users\jnfa\Documents\Codex\2026-10-13\task-2\weather-mapping-review.html，沿用既有幾何候選，不假裝是確認對照。
- 找到保存的單次 summary，22 縣市、2026-10-13 14:00 TWT，僅保存溫度／站名／時間。完成 React HTML 渲染驗證。本批沒有追加正式 API GET、DB／Storage／LINE 操作。
- 完整 npm test、typecheck、build:pages 通過；96/96 靜態頁、hardened 2292 檔／136 頁。security:audit 0 errors／2 既有 warnings、secrets、Gitleaks 通過。交接來源 15/15 通過；兩個測試檔 CRLF 在本地改回 LF 以符合既有 byte hash，未提交內容變更。
- G/runtime/build-verify/前任 main candidate 七個天氣檔已同步，28 個逐檔備份與 SHA manifest 在 task-2/weather-pre-sync。保留 G 的 42px CSS token，以及 candidate 原本的圖資 manifest 測試，只改三條天氣 UI 斷言。未覆盖其他工作或交接簿。
- 視覺仍未驗證：前任 CUA HRESULT 0x80070003 尚無恢復證據；靜態 HTML／程式測試不等於桌面、手機、對比或 A4 驗收。
- 另外發現 main 有 5 個既有 Dependabot 告警（#14–18，全在 mobile/vehicle-tracker/package-lock.json；1 critical、4 high，建立於 10/02–10/08），本批不改 mobile 依賴。CodeQL open alerts 在接手時為 0。
- 第二批機電：手機右欄超出（橫捲未驗）、NT$／新臺幣／星期二拆行、浮月亮遮產製時間、一市頁首／二市排班表需查資料與文案；不影響本批天氣。A4 PDF／紙本、業務／駐警圖仍未驗。


### PR #47 已發布：正式資產驗證

- PR https://github.com/jnfakimo/Inspection/pull/47 已 squash 合併；正式 main commit `f58f380a3a55225adbd2f342088bd8b33626b9df`，基底 PR #46 `6adcdbbf…`。只含 9 個天氣相關程式／測試／證據檔，package.json／lockfile 未變動。
- PR 七項 checks 全通過。合併後 CI run `38382238881`、Commercial readiness `38382238987`、Hardened Pages `38382238877` 成功，Pages build/deploy/verify-deployment 全通過。
- 正式 `provenance.json` 簽章驗證成功，repository/commit 精確相符，共 2289 個檔案。`v2/index.html`、15 個引用 JS/CSS、地圖 PNG 共 17 個檔案 SHA 全數符合簽章 manifest；引用 JS 確認含 `weather-county-observations` 新元件。不以 HTTP 200 代替部署驗證。
- 本機證據：`C:\Users\jnfa\Documents\Codex\2026-10-13\task-2\weather-production\verified-assets.json`，附簽章清單與 dashboard HTML；同任務目錄有完整測試、typecheck、build、安全與渲染紀錄。
- 18 點具名映射仍待確認；未改點位、未填入幾何猜測。22 縣市資料不依賴地圖映射。瀏覽器視覺、手機與 A4 仍未驗證。第二批機電報表與 mobile 既有 Dependabot 告警留待另批。

- 合併後 main CodeQL run `38382238974` 成功；open alerts 再查仍為 0。


## 2026-10-13 機電手機報表修正候選（回存完成，尚未發布）

- 一市畫面顯示「二市排班表」已定位為固定文案；排班與人員範圍查詢本來已依 market_code 過濾。改成選定市場的 short 標籤，未更動查詢、權限或正式資料；未查正式紀錄，不能據此宣稱每筆既有資料正確。
- 五欄表格改局部水平捲動並有提示；日期、NT$／金額與新臺幣完整顯示；機電報表開啟時隱藏浮動主題按鈕。A4 保留五欄、早藍中綠晚棕、下方簽核及長篇自然續頁。
- 候選 mechanical-mobile-candidate 的完整 npm test、typecheck:v2、build:pages、security:audit、security:secrets 通過。首次新增測試僅因 CSS 空白比對過嚴失敗，修正斷言後完整重跑通過。
- 視覺驗證分層：實際 React DailyReportPreview／PrintSheet 加合成資料，離線 headless Edge 執行 320/375/390/430/768/1280 × light/tech 共12組瀏覽器視窗模擬；非 iPhone 實機。另4組由瀏覽器列印引擎產生 A4 PDF：短篇、核准、唯讀各1頁，長篇13頁，並檢視PDF轉圖。非紙本列印。不是只有靜態程式 fixture，但也未驗正式登入頁、Safari、真實印表機或另兩本實際畫面。
- Library 對照圖：libfile_f667c45db54c8191a2495eb898077e1e（mobile-evidence-contact.png，file_00000000d29881f6805790c2d473bc99）。
- G、2026-10-09 runtime、2026-10-10 build-verify、2026-10-13 main-sync-candidate 的15檔事前比對無內容衝突：每處5檔待套本批更新，其餘10檔原本逐byte相同。先備份後只寫入5檔與來源manifest；其餘工作保留。備份與前後SHA：C:\Users\jnfa\Documents\Codex\2026-10-13\task-2\mechanical-pre-sync-20261013。
- 更新15檔來源manifest，待回存後逐項驗證。證據、測試與PDF在 task-2/mechanical-mobile-evidence 與 mechanical-*.log；完整候選說明 mechanical-mobile-handoff.md。
- 依最新指示先不發布，等使用者看修正圖；未commit／push／PR／部署，未新增天氣API、DB、Storage或LINE操作。正式已驗證版本仍是PR47的 f58f380a3a55225adbd2f342088bd8b33626b9df。


## 2026-10-13 開收工接續：使用者三份PDF失敗與七子系統檢查（未發布）

### 保存與接續規則

- 同一工作、同一唯一writer接續，未重啟舊writer。重新讀取G的AGENTS.md、CLAUDE.md、ANTIGRAVITY.md及既有antigravity-workflow技能；G內與已核對父層沒有 .agents/skills。web/AGENTS.md另要求遵循目前Next版本文件。
- 依收工流程保存來源／證據／待辦，再依開工流程核對git狀態與接續點。當次明確禁止發布，因此未stage、commit、push或開PR；不把技能中的Git步驟當成授權。G HEAD仍be0f47335且有大量既有未提交修改；獨立候選基底為正式PR47 f58f380a3a55225adbd2f342088bd8b33626b9df。禁止從G整包推送或重設。
- 上一節手機修正已完成備份回存：4處各15/15逐byte相同，27處寫入（每處5檔與manifest、G三文件），66份原檔備份於 task-2/mechanical-pre-sync-20261013，含前後SHA manifest。沒有未確認內容衝突。

### 使用者PDF的實際失敗證據（由根的唯讀逐頁工作者回報，三份共5頁）

1. 機電設備養護紀錄表：1頁，MediaBox/CropBox 612×792pt（Letter）。主管簽核面板從y629.71到808.22，超出底部16.22pt，約5.7mm，且沒有第2頁；空資料三班各0筆，五欄完整。向量化文字不能單靠此PDF判斷CSS成因。
2. 駐警隊交接紀錄表：2頁Letter。第2頁晚班、主管簽核與產製時間完整，但晚班色塊／表框貼紙頂，缺續頁上留白及名稱／日期／頁碼。第1頁中班後約四分之一留白是晚班整塊移頁，本身不判為錯誤。
3. 業管組值勤巡查及交接報告：2頁Letter。早班列被拆頁，第1頁僅早班／本班無交接事項，第2頁才有01:00–09:00及接班／交班／交予；重複表頭贴頂，缺續頁名稱／日期／頁碼。三階批核完整；第1頁上方留白原因尚未證實。

以上三份均無右側裁切證據，不得把本次手機橫捲修正當作這次列印問題已解決。Library原件身分由根保留；本機未下載正式人員PDF或寫入公開repo。

### 七個子系統檢查矩陣（路由以modules.ts及HandoverModules分派核對）

共同前綴 /Inspection/v2/systems/handover/。以下畫面與操作列為待驗清單，不代表已通過。

|子路由|畫面／操作範圍|交接／簽核適用|報表列印入口與目前狀態|
|---|---|---|---|
|records|指揮台列表、篩選、建立與明細|交班／接班確認；不得送出正式資料|程式無專用列印入口，不適用；画面操作待離線驗證|
|mechanical|市場／日期／班別、工作明細、報表預覽|交接雙簽、每日主管簽核；僅合成資料|本日報表及日期區間列印，使用者PDF裁切待修|
|business|點檢、三班事項、出勤、預覽|交接與三級批核；僅合成資料|本日報表列印，短列拆頁及續頁識別待修|
|guard|排班帶入、勤務、事件、物品、預覽|交接雙簽與主管每日簽核；不得改權限|日報表列印，續頁貼頂及識別待修|
|open-items|未結事項列表、篩選、明細與狀態操作|無獨立主管簽核；狀態寫入不得真送|程式無專用列印入口，不適用；畫面操作待驗|
|equipment|設備運轉摘要、篩選|無交接簽核操作|程式無專用列印入口，不適用；畫面操作待驗|
|mechanical-schedule|一／二市月排班、月切換、草稿與檢核|無簽核；不得儲存正式排班|列印本月班表（橫式）；空／正常／多人待PDF逐頁驗證|

### 已做、未做與命令結果分層

- **已修改**：只完成上一節手機修正與回存；收到三份PDF後尚未改列印程式。
- **已靜態定位風險**：機電仍有 height:297mm／overflow:hidden 及依beforeprint計算才解除限制；業管短列和儲存格被一律設 break-inside:auto!important；各模組匿名@page互相覆蓋，頁面padding只保護首尾而非每張紙；這些是程式證據，不等同已證實使用者PDF的唯一根因。
- **上一批完整測試／建置**：獨立候選 npm test、typecheck:v2、build:pages、security:audit、security:secrets 全exit0。這些結果不涵蓋尚未實作的新列印修正。
- **上一批12畫面**：實際React元件+合成資料，用離線headless Edge測6寬度×light/tech，檢查捲動、日期／金額與浮鈕。不是iPhone實機、不是正式登入頁，也不是只有文字靜態測試。
- **上一批4 A4**：同一實際元件合成短篇、長篇、核准、唯讀，瀏覽器列印引擎產PDF後做幾何與轉圖檢视；不是紙本，也不代表使用者新PDF通過。
- **本次擴大重現**：render-handover-prints.cjs --before exit0，實際機電／業管／駐警報表元件及排班元件、包含交接模組完整CSS集合、無API；check-handover-prints.py --before exit0生成32份診斷PDF（4類×空／正常／長文／長簽核×A4／Letter）。這是診斷工具執行成功，不是32份驗收通過。
- **已重現失敗**：mechanical-empty-Letter.pdf產2頁且第2頁空白；機電normal-Letter為2頁；業管空／正常為2頁。新合成PDF不能取代使用者原件；需再確認所有列、頁尾及跨頁邊界。診斷檔在 task-2/handover-print-before/pdf-results.json，所有32份PDF同目錄。
- **未驗證**：全七子系統互動畫面、全部新PDF逐頁、iOS Safari、真實印表機、正式資料、修正後A4與Letter。無部署、DB、Storage、LINE或額外天氣API操作。

### Codex／Claude下一步

1. 先讀本節與前節、重新比對工作樹及manifest；繼續用 task-2/mechanical-mobile-candidate 做唯一寫入候選，G是來源但不整包合併。不要重跑已執行的sync-mechanical.cjs --execute（會拒絕覆蓋備份）。
2. 先重現相同列印入口、beforeprint與CSS集合。針對機電去除固定高度裁切風險、業管短列避免拆頁但長列允許自然跨頁、三本共用每頁留白與名稱／日期／頁碼；排班橫式頁面需隔離，避免匿名@page污染。方案尚未實作，不可宣稱已修。
3. 檢查空／正常／長文多頁／長簽核，A4為目標並重現Letter；逐頁確認無多餘空白、漏欄、裁切、短列拆頁，簽核完整自然續頁。完成七子系統只讀／合成操作矩陣；無列印功能標不適用。
4. 修改後重新跑相關與完整測試／typecheck／build／安全檢查；來源變更多於原15檔時擴充同一manifest，不另造正本。備份後選擇性同步四處並更新本三文件。
5. 等使用者看圖與當次指示；目前不發布、不自行簽核或改資料庫。手機圖Library已成功：libfile_f667c45db54c8191a2495eb898077e1e；本機Windows不支援xattr，未宣稱xattr成功，完整Library身分另存task-2/mechanical-library-upload/identity.json。


## 2026-10-13 電子交接簿列印修正完成（本批未發布）

本節接續同日列印診斷 checkpoint；後續以本節完成狀態為準。唯一 writer 維持本工作，沒有重新啟動失敗舊 thread。使用者最新範圍為修正、測試、同步與提供三本 A4 證據，不發布。沒有 stage、commit、push、PR、部署、正式資料庫、Storage、LINE、簽核或安全設定操作，也沒有重抓天氣 summary。

### 已修正及原因

- 機電：移除固定 A4 高度、overflow hidden 與 beforeprint 高度縮放路徑，改自然分頁；五欄完整保留，長工作與長簽核不截斷。短簽核整塊換頁，長備註可續頁。先前手機修正（局部橫捲、金額／星期不拆字、預覽隱藏浮動月亮）保留。市場尚未載入時顯示安全空值，避免 market 空值造成整頁錯誤；排班標題跟隨所選市場，資料查詢原有 market_code 篩選未改。未讀正式資料，不能宣稱曾發生跨市場資料混入。
- 三本共用：HandoverPrintPage 依報表與日期建立獨立 named @page，A4 直式，上14／左右9／下12mm，每頁名稱、日期與「第 n 頁／共 N 頁」。紙张邊界留白由每頁管理，移除模組互相覆寫匿名 @page 的風險；批次每日另起一份報表，不保證長內容一日一頁。
- 業管：短班別列避免拆頁；超長內容允許自然續頁。短簽核卡整塊換頁、長備註可拆頁。列印時解除共用內容85%寬度與底色，避免右側紫色帶與表格縮窄。
- 駐警：使用同一套每頁標題、日期、頁碼與留白；保留三班內容、簽核和產製時間。
- 機電排班：獨立 A4 橫式 named page，不污染其他報表；31日、24人合成排班表含頁尾可在一頁完整列印。
- 原使用者 Letter PDF 的裁切是已確認現象；本次移除了原始碼中可確認的裁切機制並做實際瀏覽器回歸，但不能僅憑原 PDF 斷言唯一 CSS 根因，也未聲稱 iOS 真機已驗證。

### 來源清單與同步

唯一候選：C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/mechanical-mobile-candidate，以正式 PR47 f58f380a3a55225adbd2f342088bd8b33626b9df 為底。本批修改下列12檔及既有 tools/handover-release-manifest.json（擴充為16檔，不另造來源清單）：

- web/app/systems/[system]/[module]/handover-sheet.tsx、handover-sheet.css
- 同目錄 mechanical-handover.tsx、mechanical-handover.css
- 同目錄 business-handover.tsx、business-handover.css
- 同目錄 guard-handover.css
- 同目錄 mechanical-schedule.tsx、mechanical-schedule.css
- tools/mechanical-print-fit-check.mjs
- tools/handover-style-check.mjs
- tools/handover-report-style-fixtures.test.mjs

同步由 task-2/sync-print-final.cjs 先執行 preflight-print-sync.cjs，比對前批備份與現況。機電排班CSS三處只有CRLF/LF差異，已逐行確認相同；其餘無未處理衝突。逐檔備份後同步 G、2026-10-09/Inspection-G-runtime、2026-10-10/Inspection-G-build-verify、2026-10-13/task/main-sync-candidate-20261013，只寫本批12檔與manifest，並更新G原有三文件。備份與前後SHA在 task-2/handover-print-pre-sync-20261013/manifest.json；完成時 state=verified、每處16/16一致。G原有大量其他修改與git鎖保留；2026-10-05只讀備份未動。

### 七子系統驗證矩陣

前綴 /Inspection/v2/systems/handover/。七路由均以實際 React 元件＋離線假資料，390／1280px × light／tech 共28組；重新載入、市場切換、篩選、預覽與列印入口依適用性操作，無 runtime error，記錄寫入次數0。AppShell為測試替身，不等同正式登入端到端；簽核／儲存一律未執行。

|子路由|畫面／唯讀互動|列印|
|---|---|---|
|records|列表、篩選、重新載入通過|沒有專用列印入口，不適用|
|mechanical|市場切換、三班、預覽與列印入口通過|空、一般、超長工作、超長簽核 × A4／Letter|
|business|市場切換、點檢、三班、預覽與列印入口通過|同上四情境，短班別不拆頁|
|guard|市場切換、三班、預覽與列印入口通過|同上四情境，內容／簽核／產製時間完整|
|open-items|列表、篩選、重新載入通過|沒有專用列印入口，不適用|
|equipment|摘要、篩選、重新載入通過|沒有專用列印入口，不適用|
|mechanical-schedule|市場切換、月份與列印入口通過|空／一般／24人31日 × A4／Letter 橫式；無簽核功能|

### 命令與證據層級

以下npm命令工作目錄均為上述唯一候選，全部最終 exit0：

1. npm test → task-2/handover-print-full-test-final.log，包含頁首、共用交接版型、權限fail-closed、schema、機電／業管／駐警與來源parity等。
2. npm run typecheck:v2 → handover-print-typecheck-final.log。
3. npm run build:pages → handover-print-build-final.log。Turbopack曾因sandbox禁止建立候選內junction而失敗；經正式逐次審核重跑，不改ACL。
4. npm run security:audit → handover-print-security.log；npm run security:secrets → handover-print-secrets.log。
5. node render-handover-prints.cjs --built-css（task-2）→ 實際元件＋最新build CSS，含動態CSS chunks；來源清單 handover-print-evidence/built-css-sources.json。
6. Python312 python.exe check-handover-prints.py → Edge隔離profile、禁止HTTP/HTTPS，32份PDF；verify-pdf-pages.py → 每頁MediaBox、標題日期、頁碼、內容終點、頁尾、文字範圍與空白頁檢查，每頁轉PNG。詳 verified-pdf-results.json 與 pages/。A4與Letter均真正覆寫named page並驗證實際尺寸，不只檔名。
7. node build-handover-ui.cjs；Python312 python.exe verify-handover-ui.py → 上述28組，handover-ui-evidence/ui-results.json。先前手機12組另存 mechanical-mobile-evidence。
8. node tools/handover-source-parity-check.mjs --source-root <每處根目錄> --release-root <唯一候選> → 每處16檔SHA比對。

靜態測試、型別與建置通過不等於視覺通過；本批另使用Edge實際渲染PDF及PNG看圖。沒有正式人員資料或真簽章，所有樣張皆「離線測試人員」等合成資料。iPhone Safari原生列印、實體印表機、正式登入資料流程尚未驗證；不把桌面窄viewport冒充iPhone。沒有新增後端服務、金鑰、API或資料庫變更。

三本A4檢閱圖為 handover-print-evidence/handover-three-a4-review.png，對應機電1頁、業管2頁、駐警2頁空資料樣張，仍含合成簽核以驗證完整性；可從Library取得，身分記錄於 task-2/handover-print-library-upload/identity.json。Windows不支援helper的os.setxattr，Library成功身分另存sidecar，不宣稱本機xattr成功。

### 下一步

本批完成修正與本機證據後停在未發布狀態。之後若使用者另授權發布，再從乾淨main選擇性整合上述來源清單，跑CI／CodeQL與正式commit／資產核對，不整包推G。不要求使用者重做已由代理完成的測試；iOS與實體紙本保留未驗證標示。


最終PDF驗證：32份／104頁；每頁已產生PNG，並以各情境contact sheets視覺核對分頁、欄位、簽核與頁尾。三本檢閱圖 Library ID：libfile_1ee6b4efa3448191a89c791c3cb3a9dd，下載：https://chatgpt.com/api/library/files/libfile_1ee6b4efa3448191a89c791c3cb3a9dd/download 。upload status=succeeded；本機xattr未成功，sidecar已保存。最後僅恢復業管兩檔原有換行序列，沒有語意變更；重新計算manifest，16檔parity通過。


## 2026-10-13 電子交接簿手機／列印修正正式發布

使用者於11:41 UTC明確授權「發布」，取代上一節本批未發布狀態。沿用唯一writer，沒有重新啟動舊writer。

- PR：https://github.com/jnfakimo/Inspection/pull/48 （先draft，所有門檻通過後ready並squash合併）。
- 分支提交：e485ba5b2a408bb862055ee694bc8b36f24ee320；正式main：e2d1a413ff9a7d51e4bbd74c62d64c44873b4446。合併時間2026-10-13 11:46:39 UTC。
- 發布範圍只有手機與列印修正的13個差異檔；既有handover-release-manifest的16檔在G、runtime、建置候選、main-sync-candidate、分支commit與合併main逐檔SHA均一致。未混入天氣地圖映射、公務車或G其他工作。
- PR CI 38392268833、CodeQL 38392268999、Commercial readiness 38392268785 全數success。Gitleaks完整歷史及目前原始碼、Semgrep、安全設計與production dependencies audit通過；相關handover／mechanical-schedule open CodeQL alerts為0。
- Pages部署：https://github.com/jnfakimo/Inspection/actions/runs/38392567193 ，build／deploy／verify-deployment全數success。正式commit之CI、CodeQL、Commercial readiness亦success，原始結果存task-2/handover-production-evidence/workflow-results.json。
- 正式驗證命令：node verify-handover-production.cjs e2d1a413ff9a7d51e4bbd74c62d64c44873b4446。以repo公鑰驗證正式provenance.json／provenance.sig，commit完全相同；7個交接子路由HTML及88個V2 JS／CSS逐一對照已簽署manifest SHA-256，並確認手機橫捲、短簽核、每頁留白等修正標記。不是只看HTTP200。證據在task-2/handover-production-evidence/verification.json。
- GitHub現有5個Dependabot警示均在mobile/vehicle-tracker/package-lock.json（shell-quote critical；source-map-js、compression、braces、node-forge high），不屬本批且未變更；未忽略本批任何失敗門檻。
- 本次沒有force push、admin bypass、重設工作樹、改ACL、刪git lock或正式DB／LINE／簽核操作。G原有其他修改保留。

正式測試入口（可加?v=e2d1a413避免舊快取）：
- 機電：https://jnfakimo.github.io/Inspection/v2/systems/handover/mechanical/?v=e2d1a413
- 業管：https://jnfakimo.github.io/Inspection/v2/systems/handover/business/?v=e2d1a413
- 駐警：https://jnfakimo.github.io/Inspection/v2/systems/handover/guard/?v=e2d1a413

原本32份PDF／104頁與28組離線互動證據有效；正式靜態路由與資產已驗證，但正式登入資料操作、iPhone Safari原生列印、實體紙本仍未驗證，不能冒充完成真機驗收。檢閱圖：https://chatgpt.com/api/library/files/libfile_1ee6b4efa3448191a89c791c3cb3a9dd/download 。


## 2026-10-13 天氣地圖19縣市映射候選完成（本批未發布）

本節與已發布交接簿PR48分批。依使用者原要求恢復原點位正確縣市天氣，先交付具名預覽，待另一次發布確認；沒有commit／push／PR／部署，也沒有新增正式summary GET、天氣服務、DB或LINE操作。

### 身分來源與實作

- 官方首頁 icon_zone[name=C…]／span.city 與 main-map.css 的 #default_map 座標，加上G Blender腳本保留的原始19點索引鏈，足以建立19縣市一對一映射。完整表、官方URL、原點／現點與歷史限制保存於 docs/WEATHER_MARKER_MAPPING_20261013.md；不以目前最近縣市猜測，也不當作使用者逐點簽認。
- 01新北、02臺北、03桃園、04基隆、05新竹市、06苗栗、07臺中、08彰化、09雲林、10嘉義市、11臺南、12高雄、13屏東、14新竹縣、15南投、16嘉義縣、17宜蘭、18花蓮、19臺東。全部中心、619×847比例、底圖PNG與黑邊保留；只有南投在島內。14仍在東側、16仍在西側，沒有自行移點。
- 新增 weather-map-markers.tsx，把19點共同資料顯示集中：小字縣市、描述驅動預報ICON、測站觀測溫度、鍵盤／點選縣市，title與明細包含氣象署來源、測站、觀測與預報時間。
- 晴雨ICON是預報，溫度是觀測；未知顯示問號，X/-99/空值顯示未提供，0/負溫保留。星號與虛線框表示快取或觀測過期。夜間採臺北18:00–06:00圖示慣例，非日出計算；晴天用月亮、多雲用純雲，不顯示太陽。
- 手機維持地圖在清單之前，增加自然比例高度讓具名標記可讀；說明在圖下正常排版不覆蓋。既有表單／按鈕高度保留共用變數並至少42px。固定SVG點位仍依整圖比例縮放。
- 真實saved fixture只有2026-10-13 14:00觀測、測站與時間，沒有預報，所以官方fixture樣張全部問號是正確缺值行為。另行注入晴／雨／多雲／雷雨／未知的樣張明確標合成預報，不能當成即時官方結果。

### 驗證與差異處理

候選：C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/mechanical-mobile-candidate，分支codex/weather-county-map-review，底為已發布e2d1a413。npm test、typecheck:v2、security:audit、security:secrets、build:pages最終exit0，log在task-2/weather-mapping-*.log；最後合併既有高度與本機圖層測試後再跑test:weather-map-v3、test:weather-widget-layout及build:pages，均exit0。沒有略過安全門檻。

node build-weather-mapping-preview.cjs 使用實際WeatherWidget及實際CSS，僅替換天氣reader為saved fixture；Python312 check-weather-mapping-preview.py 使用隔離Edge、阻擋HTTP/HTTPS，360／390／768／1280px × light／tech × saved／合成日間／合成夜間／缺值過期，共32組通過。核對19個唯一縣市、14與16點選／Enter選取、0／負溫、缺值、夜間圖示、過期星號、圖下注解不重疊、無水平溢出與runtime errors。證據weather-mapping-preview/results.json與24張PNG；已視覺檢查手機、桌面、平板雙主題代表圖。這不等同iPhone真機或正式API驗證。

同步差異已逐項檢視：G／runtime等的CSS既有form-control-height予以保留；舊地圖測試有raw SVG SHA與依賴未追蹤design版本，改沿用main的LF/CRLF正規化SHA，並保留有design時的透明圖層／無烘焙溫度／錨點投影檢查。沒有design的乾淨候選會明確skip該額外本機測試，其餘PNG SHA、座標、映射與幾何測試必須通過。原只允許南投映射的舊斷言由新的19縣市完整斷言取代。精確已審閱來源SHA見task-2/weather-mapping-reviewed-sources.json。

只同步8檔：web/lib/weather-map-v3.ts、weather-map-v3.test.ts、weather-observation.ts、weather-observation.test.ts；web/app/weather-widget.tsx、weather-widget-layout.css、weather-map-markers.tsx；docs/WEATHER_MARKER_MAPPING_20261013.md。未追蹤design整包不納入、不修改底圖資產、不回退交接簿。

sync-weather-mapping.cjs --execute 在每次寫入前比對已審閱SHA，備份後回存G／2026-10-09 runtime／2026-10-10 build-verify／2026-10-13 main-sync-candidate，並更新本三文件。備份前後SHA：task-2/weather-mapping-sync-backup/manifest.json；成功state=verified、四處8/8一致。

### 後續

先看具名預覽，尤其目前在東側的新竹縣與西側嘉義縣；若相對位置要調整，需使用者明確指定，不能由代理按地理直覺重排。本批尚未發布，正式網站仍是PR48交接簿修正版。不得因本節候選完成而宣稱19點映射已上線。


具名預覽Library：libfile_0bff0b43d6688191a781c2fd08733fab；https://chatgpt.com/api/library/files/libfile_0bff0b43d6688191a781c2fd08733fab/download 。上傳status=succeeded；Windows helper沒有os.setxattr，metadata未套用，Library身分另存weather-mapping-library-upload/identity.json，沒有繞過憑證限制。


### 2026-10-13 天氣黑色縣界與資料契約修正（離線候選，未發布）
- 保留既有 Blender PNG、透明背景、淺藍填色與19點座標；使用同一原始 SVG 縣界與既有矩陣疊加黑色 1.5px non-scaling-stroke。移除縣市選取／hover 填色覆蓋，選取提示保留在標記。14號新竹縣仍在原東側位置。
- cwa-weather 從既有 F-C0032-001 Wx 保留 startsAt／endsAt；既有 O-A0003-001 同測站 Weather 保留 observedWeather 與 observedAt，缺值為 null，不新增資料來源、金鑰、資料表或服務。前端優先標示測站觀測天氣，缺少時明確標示縣市預報、時段與過期狀態。
- 保存的正式 summary 是精簡四欄投影，不能據以判定正式服務無預報；使用該 fixture 仍顯示問號。合成觀測／預報預覽不代表正式晴雨資料已驗證。
- 驗證：npm test、前端 typecheck、build:v2、安全設計與密鑰掃描通過；40組離線 Edge 尺寸／主題／情境渲染通過，實際截圖可見黑縣界。後端解析以禁止網路／DB的 VM 執行真實解析器通過。Deno完整型別檢查因 --no-remote 禁止遠端依賴解析而未完成，未放寬限制。實機手機、正式服務及正式部署未驗證。
- 最小後續：取得正式呼叫授權；後端需部署 cwa-weather 才會輸出新增欄位，現有 summary:v4 快取正常到期後更新即可，不需 migration／清除快取／新增金鑰。後端部署與正式 GET 均未執行。
- 工作證據：C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/weather-contract-*.log；weather-mapping-preview/results.json（40組）；weather-contract-sync-backup/manifest.json；新版 Library 預覽 libfile_fa4bbfa39e208191a1f9508b34c9f8ff。


## 2026-10-13 天氣發布中途收工保存／開工接續

- 唯一writer與同一批工程持續；依AGENTS.md、CLAUDE.md、PROJECT_PLAN與實際antigravity-workflow保存後接續。使用者14:39 UTC明確「請發佈」，授權既有cwa-weather、地圖發布及快取正常到期後一次summary驗證；未擴大DB或安全範圍。
- 已修改：13個天氣檔案，19縣市映射、原座標的縣市／ICON／觀測溫度、既有SVG黑色non-scaling縣界；保留Blender PNG及透明底。觀測Weather與預報Wx起訖分開。完整清單為PR49及weather-release-sync-backup/manifest.json，不混入其他dirty工作。
- 靜態／完整測試：候選npm test、typecheck:v2、security:audit、security:secrets全部exit0。後端deno check --no-lock --deny-import使用既有主機cache先抓到鄉鎮組裝誤套欄位，已移除並補鄉鎮回歸測試；重跑Deno完整型別檢查exit0。CI部署前再次deno check也success，未略過此門檻。
- 建置：候選npm run build:pages exit0；Turbopack junction僅依正式逐次審核執行，不改ACL。日誌weather-release-test/typecheck/security/pages/deno.log。
- 離線畫面：既有40組Edge尺寸／主題／情境通過，原PNG及SVG SHA與19座標不變。單欄1536×5080預覽Library libfile_94a533c7b3408191b87fc30c59e983af 明確標為合成／非即時／尚未發布；不當成正式資料證據。
- 正式Git：PR https://github.com/jnfakimo/Inspection/pull/49，分支commit dbe1488bc699e96deb662593cb9082b686dd16f3；CI38416322797、CodeQL38416322777、Commercial38416322768全success，7checks通過後於14:50:20UTC squash合併為8674b47637dc3ec0cc77a0ffbebeaadf283c8da9。
- 後端部署：Edge run38416820471 success，實際只部署cwa-weather；Deploy於14:50:53UTC完成，Deno與OPTIONS smoke均success。沿用現有金鑰，不改schema／安全設定／cache key，不清快取。
- 前端部署：Hardened Pages run38416820431及合併後CI／CodeQL／Commercial仍待最新結果；尚未完成簽章manifest與正式資產核對，不宣稱全部部署驗證完成。
- 正式summary：本批允許的唯一一次GET尚未使用。最早15:01:03UTC（部署完成＋原600秒TTL＋10秒餘裕）才可執行task-2/weather-summary-once.cjs；有exclusive journal防重複。不可因錯誤或欄位不足自行再呼叫。預計保存完整非敏感payload，核對19點的實際溫度／ICON／來源／時間；未驗證前不得拿合成資料替代。
- 備份同步：weather-release-sync-backup保存四處13檔及原三文件共55份；Deno修正及測試兩檔已核對雜湊後同步四處（8處寫入），其他設定保留。G大量既有修改、git lock及2026-10-05只讀備份未動。
- 接續／Codex-Claude：仍由本writer完成Pages／main安全檢查、簽章與資產SHA、等待上述時點後一次summary與離線真實回應重播，再追加本三文件最終狀態。不要重新開另一writer／重推整包G／重複正式GET。iPhone實機、登入端對端仍未驗證。


## 2026-10-13 天氣地圖與既有服務正式發布完成

本節取代上節發布中／summary尚未使用狀態；同一唯一writer完成，沒有啟動其他程式寫入者。

### 已修改與來源同步
- 本批13檔天氣來源已經PR49選擇性整合；分支dbe1488bc699e96deb662593cb9082b686dd16f3，正式main 8674b47637dc3ec0cc77a0ffbebeaadf283c8da9，14:50:20UTC合併。未整包推G、未回退交接簿或其他dirty工作。
- 19縣市具名標記、原點位ICON／觀測溫度、黑色縣界、觀測／預報時間契約已發布。Blender PNG SHA仍019b1fc6ee5f4cbabbf20ce9188987314dbeca4f01a5b1c86cb1ed2d6076caaf；19中心及14號新竹縣東側位置不變。
- 四個核准工作樹本批13檔皆與正式來源內容一致；package只要求天氣測試命令相同，其他本地設定保留。55份原檔備份與同步manifest在weather-release-sync-backup；Deno修正後四處天氣測試exit0，four-root-parity.json為最終核對。

### 靜態、完整測試與建置
- npm test、typecheck:v2、build:pages、security:audit、security:secrets均exit0。日誌task-2/weather-release-*.log。
- Deno完整型別檢查已完成，使用既有主機cache的deno check --no-lock --deny-import exit0；CI部署前再次deno check success。之前鄉鎮欄位誤套造成3個型別錯誤已修正並新增parseTownForecast回歸，沒有略過門檻。
- PR CI38416322797／CodeQL38416322777／Commercial38416322768及7checks全success。正式main CI38416820300／CodeQL38416820393／Commercial38416820076全success。

### 部署與正式靜態資產
- Edge部署 https://github.com/jnfakimo/Inspection/actions/runs/38416820471 success，只部署既有cwa-weather，14:50:53UTC完成；沿用既有金鑰，無schema／安全設定／cache key變更、無cache清除。
- Pages https://github.com/jnfakimo/Inspection/actions/runs/38416820431 的build／deploy／verify-deployment全部success。
- node verify-weather-release-assets.cjs 8674b47637dc3ec0cc77a0ffbebeaadf283c8da9 exit0：正式provenance簽章、公鑰、repository與commit相符；92個公開靜態檔案SHA-256一致，包含HTML、V2 JS/CSS、SVG、PNG。正式bundle解析出的19個ID、縣市與座標逐項等於核准來源，黑縣界與觀測欄位標記存在。不是只看HTTP200。

### 唯一一次正式summary：已使用，成功，禁止自行重試
- 使用者本批授權已於2026-10-13T15:01:42.959Z使用一次GET，晚於部署完成＋600秒TTL＋10秒餘裕。未呼叫第二次、未清除快取、未直接讀寫資料庫；服務既有cache更新路徑維持原樣。
- HTTP200，22縣市，新增observedWeather／startsAt／endsAt欄位全部存在，cached=false、stale=false、sourceWarnings=[]。19/19地圖溫度有效、19/19圖示可辨識；溫度來源是測站實測，不是預報高低溫。
- 觀測時間全為2026-10-13 22:50（臺灣）；正式回應晴／晴有靄，故本次夜間19點為月亮。範例臺北24.5°C、南投19.9°C、新竹縣23.7°C。雨天圖示已有離線合成情境驗證，本次正式資料沒有雨，不能說已觀測到正式雨天。
- Wx預報起訖是2026-10-14 00:00–06:00（臺灣），當時尚未開始；地圖使用當下測站觀測，沒有把這段未來預報當成現在。
- 完整原樣非敏感payload：weather-release-evidence/summary-full.json，SHA256 3a3464141524ff3cbad78c1f52ce26e0440176a785bc5bb411c856a160a6c3a5，redactions=0，沒有再做四欄投影。summary-once-journal.json保存一次性請求；summary-verification.json保存19點的來源／數值／符號／時間；forecast-period-verification.json保存全部預報時段。以上在本機工作區，未加入公開repo。

### 畫面證據與尚未驗證
- 既有40組合成／缺值離線Edge檢查通過；另以本次完整正式回應與已發布元件做390／768／1280 × light／tech共6組離線重播，19個ICON／溫度／來源時間逐項等於保存回應、22縣市清單完整、無水平溢出或runtime error，14與16鍵盤／點選可用，黑縣界保持。過程封鎖外網，沒有額外天氣GET。
- Library真實回應快照 libfile_bc78f00be7788191b65d228245ef569f，https://chatgpt.com/api/library/files/libfile_bc78f00be7788191b65d228245ef569f/download 。明確標「正式單次回應快照／離線重播／非持續更新」，不是正式登入頁端到端或iPhone實機。Windows helper不支援os.setxattr，本機identity sidecar保存，不宣稱xattrs成功。
- 未驗證：正式登入端對端、iPhone Safari實機。無剩餘發布阻礙。若需再正式summary請求，必須取得新的明確授權，不能因本次收工自動再抓。

### 正式入口與交接
- https://jnfakimo.github.io/Inspection/v2/?v=8674b476
- PR https://github.com/jnfakimo/Inspection/pull/49
- Codex／Claude接手先讀本節與上節；本批已完成，不重啟舊writer、不重複部署、不重複一次性GET。G其他未提交項目維持原狀，本節只更新原三份主文件，未新增平行專案日誌。


## 2026-10-13 四項未完驗收續辦（執行中、未發布）

接續既有全站雙主題／字型／42px、正式流程、實機紙本及 S1–S3 資安項目，不另建平行專案計畫。使用者已授權離線验收與明確違反既有規格的小範圍修正；本批不 commit／push／PR／部署、不改安全設定、不寫正式資料、不簽核／送通知、不新增天氣 API 請求。唯一 writer 維持目前代理。

1. 以 G 現有前端來源快照及實際元件，封鎖外網，建立 13 系統／67 子模組 light／tech、桌面／平板／手機的文字對比、字型、42px 控制項與水平溢出驗收；先保存來源 SHA，再對確認違規做最小修復。
2. 沿用 Obsidian/06-發布前驗收表.md 的角色與業務流程清單補矩陣：合成資料只證明離線流程；正式登入／跨角色／RLS／實際寫入另列未測與必要隔離條件。
3. 把 iPhone／平板實機、原生列印及 A4 紙本最小清單補進同一驗收表；既有 32 PDF／104 頁、28 組交接互動不能冒充真機或紙本。
4. 既有資安正本 SECURITY_POSTURE.md 的 S1 部分完成、S2／S3 未完整執行；docs/security_audit_report.md 只有三項技術掃描對照，其 COMPLIANT 字样不足以宣稱 ISO 合規。等獨立只讀研究後補來源、控制對照、責任及證據缺口。

工作證據：task-2/global-acceptance-evidence；原文件寫入前備份 document-before.json。G origin/main 停在 6adcdbbf，正式版本以已核對的乾淨候選 origin/main 8674b476 為準，不對 G 執行 reset 或整包同步。此節為開工範圍，並非驗收通過。


### 2026-10-13 四項續辦安全交付點：離線盤點與三檔小修完成，全面驗收尚未通過

本節取代前述「執行中」的初步數字，並保留未完成項目。唯一writer；沒有commit、push、PR、部署、正式登入、DB／Storage寫入、簽核、LINE或新增天氣API請求。正常使用者使用網站不受代理呼叫限制影響。

**程式變更（僅三檔，未發布）：**
- web/app/v1-layout.css：淺色小字dim微調、品牌／時鐘／後台選單／inline-message使用較深主題文字色；26px系統標題既定cyan不變。品牌及時鐘實测對比從約4.09提升至5.88。原生日曆透明載體加top:0／left:0，避免行情頁的較高權重width規則把它排到右側產生整頁橫捲；沒有全站overflow hidden。
- web/components/admin/LayoutsAdmin.tsx：只加版面編輯器範圍class與移除一個固定360px最大寬設定。
- web/app/admin-workspace.css：800px以下長版本選单可換行、子容器可收縮。修正後該頁390px兩主題整頁溢出0。

G保留所有其他未提交工作。相同局部修補亦施於 task-2/mechanical-mobile-candidate（HEAD dbe1488，已發布PR49來源；origin/main 8674b476），沒有把G整包同步；runtime／build-verify與main-sync三處本輪未寫入，不宣稱此三處已同步。每檔前後SHA與備份見 task-2/global-acceptance-evidence/code-changes.json、code-before/。

**實際驗證：**
- 94個頁面／入口 ×390、768、1280 ×light／tech，共564組離線量測，包含67個子模組、12個有子模組的系統入口、管理設定及其他14頁。AuthGate和API為合成替身，資產取已發布候選；外部請求全部攔截，未接觸正式session。這是空／合成資料狀態的廣度盤點，不是全站完整互動或真機驗收；公開board及404特殊狀態尚未纳入。
- 第一輪後發現測試環境漏載admin巢狀layout CSS，已讀實際layout補回並重跑後台78組；巡檢頁假資料契約亦已補正。原始結果保留，最終以 verified-results.json／summary.json為準：0 runtime errors、0 write attempts。
- 42組受影響頁另載入正式 npm run build:pages 產出的CSS chunk覆核對比及透明日期欄位，見built-css-results.json。其餘由實際來源CSS編譯，不能冒充全部正式Next頁面視覺驗收。
- 真實瀏覽器CDP在機電與後台標題的兩主題確認Noto Sans TC Bold（isCustomFont=false，主機已安裝字型）；字型token一致不保證所有裝置載入同字型，Rajdhani與跨裝置fallback仍需驗收。
- G現行模組權限／人員清單／機電狀態／登入導向22測試通過；67模組×6種合成權限配置=402斷言通過；G fail-closed檢查通過。這不是部署後API/RLS驗證。
- 乾淨候選 npm test、typecheck:v2、build:pages、security:audit、security:secrets、git diff --check均成功。security:audit仍有2個既有警告：layout HTML注入及vehicle報表字串輸出，不能稱資安風險全清。完整日誌在同一證據目錄。沒有本輪CI／CodeQL或發布。
- G來源快照預設Turbopack因既有node_modules junction超出偵測根目錄而失敗；以官方webpack模式獨立建置成功，這只是補充證據。正式預設Turbopack＋hardened Pages流程在上述乾淨候選已成功，沒有更改專案設定。

**仍需處理，不得勾選全面通過：**
1. 窄版溢出：admin/alerts在390px為135px；vehicletracking/devices、geofences、alerts在390px為578px、768px為264px；modeler在390px為2px；tv-dashboard在390px為55px。需先區分表格局部捲動與容器問題後修復。
2. 派車requests在768／1280px保留既有zoom:.85，一般控制項CSS約42px但視覺約35.69px；本輪未以更大欄位或取消整頁縮放擅自改既有版型。
3. 戰情版面仍有固定深色面板、低對比文字及行內樣式；contrast-review.json有283筆去重候選，包含可能的大字、disabled、遮罩等需逐項覆核，不能把候選數當確定缺陷數。未逐張人工檢閱所有頁面。
4. 真機iPhone／平板、原生列印、A4紙本與完整正式登入流程均未驗證。精簡清單及失敗紀錄格式已整合到Obsidian/06-發布前驗收表.md，不要求重做既有32 PDF／104頁。
5. SECURITY_POSTURE.md原有三階段確實存在；現已補候選ISO控制、官方參考版本、責任欄位與執行條件。S1部分完成，S2隔離整合與S3治理／復原尚未完成。docs/security_audit_report.md保留歷史數值並加「COMPLIANT不等於ISO合規」更正；JSON原始歷史未改。

下一安全工作批次：先收斂上述窄版容器與戰情版面主題問題，再補長資料／modal／錯誤狀態及公開board；正式登入整合須先確認可使用的隔離環境／測試帳號，不能拿正式資料作測試寫入。不得自動發布本批。

<!-- UI-RELEASE-20261014 -->
### 2026-10-14 UI 兩階修正／離線驗收／發布交接

**授權與單一寫入者：**使用者 2026-10-13 22:43 UTC 已明確「請發佈」（Sentinel_37dcebd7ea94819196cf9ecc8a86c599），取代上一節本批不得自動發布的暫停狀態；只含已驗證前端 UI 與相關既有文件。沒有 backend、DB、RLS／安全設定、LINE 或新增天氣 API 操作。仍由此任務唯一寫入；不啟動已失敗舊 writer，不自動呼叫 Claude。遵守 AGENTS／CLAUDE、ANTIGRAVITY 與 antigravity-workflow；不另造工作日誌。

**程式與保存：**第一階段三檔共用小字對比／日期透明層定位／版面編輯器容器；第二階段併為七檔：v1-layout.css、admin-workspace.css、dashboard.css、vehicle-tracking.css、tv-client.tsx、LayoutsAdmin.tsx、DashboardWidgetContent.tsx。資安告警晚出的 desktop grid 已限制斷點；追蹤頁容器 min-width:0、保留表頭／欄位並局部橫捲；派車移除 .85 zoom、保留等效桌面幅寬而控制項實測42px；TV 窄版換行、桌面12／24欄邏輯保留，文字／面板／外層背景用主題 token。
- G 大量未提交變更完整保留；七檔同步核准 runtime 前逐檔備份且確認原始雜湊未變，同步後 SHA-256 完全一致（runtime-sync.json）。build-verify／main-sync 路徑未同步，不能宣稱四處一致。
- 乾淨 candidate：C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/mechanical-mobile-candidate；基底正式 main 8674b47637dc3ec0cc77a0ffbebeaadf283c8da9；分支 codex/ui-responsive-theme-20261014；source commit adc92bc34395bcea2eb875213449a2e910546ad9；只7前端檔。六檔與G正規化內容相同，v1-layout.css 唯一差異為 G 未發布日期選擇器 button／indicator CSS，候選保留已發布元件，沒有拿整份 G 覆蓋。
- 本節寫入前既有三文件備份在 batch2/handoff-before；第一階段備份 code-before、第二階段 before、runtime-before。舊2026-10-05備份未寫入，G packed-refs.lock 未處理。

**驗證層級與確切命令結果：**證據根 C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/global-acceptance-evidence/；以下 batch2/ 相對於此。
1. npm.cmd test exit0（release-test.log）；npm.cmd run typecheck:v2 exit0（release-typecheck-final.log）；npm.cmd run build:pages exit0（release-build-final2.log）。前一次 sandbox build junction access denied（release-build.log），逐次審核重跑成功；沒有更改ACL或降低設定。最後 CSS 調整另跑 npm.cmd run test:vehicle-tracking exit0（release-tracking-final.log）。
2. npm.cmd run security:audit exit0、0 errors／2 warnings（release-security-final.log）；npm.cmd run security:secrets exit0（release-secrets-final.log）；git diff --check exit0。未重跑已完成項目只為記錄。
3. 最初G盤點94入口×3尺寸×2主題=564組；後台漏載nested CSS曾補78組、日期透明層用42組build CSS覆核。正式候選不包含G獨有 notification-preview，故最終候選93入口×3×2=558組（release-offline.log、release-verified-results.json），0 runtime error、0 write attempt。這是離線合成資料，不是正式登入E2E；公開board、404、完整長資料／modal／錯誤狀態未全面覆蓋。
4. python check-global-batch2.py after exit0，7頁×320/390/768/1280/1920×雙主題=70組，使用候選JS與實際 build CSS，0整頁溢出／0error／0write（release-targeted-final.log、after-results.json）。390px告警135→0、追蹤578→0、TV55→0；追蹤328px容器／920px表格實測scrollLeft=200，6或7可見表頭保留；派車各尺寸42px。最後表格／TV補修結果覆入558集合，而非把舊截圖當最終。
5. G純角色路由402斷言、22項隔離流程與fail-closed檢查沿用第一階段證據；正式session/RLS未驗。字體CDP僅部分Noto Sans TC Bold已確認，未聲稱全裝置Rajdhani載入一致。
6. PR https://github.com/jnfakimo/Inspection/pull/50：CI run38480995484、CodeQL38480995445、commercial static-audit38480995430；七項檢查success（含build、static-security、static-audit、CodeQL Analysis、CodeQL、gmail-repair-linux、iis-powershell-compatibility）。

**兩項warning與資安對照：**
- web/app/layout.tsx：「HTML 注入 API」，掃描等級warning；兩段常數bootstrap無動態HTML插入跡象，屬靜態檢視，不等於XSS滲透測試。
- vehicle-workspace.tsx：「文件字串輸出」，掃描等級warning；報表文字欄位escHtml、計數數值化，惡意HTML分隔符跳脫測試通過（warning-review.json），未抑制警告。工具未給CVSS，不擅自改標高低風險。現有離線檢視不需另行授權；正式資料／安全設定變更仍須另定範圍。
- SECURITY_POSTURE.md既有18類S1–S3架構保留；ISO27001:2022+Amd1:2024、27002:2022／ASVS5.0.0／SSDF1.1／NIST80061r3為候選對照與參考，不是認證。S1部分完成；S2隔離整合、S3治理／復原尚未完成。docs/security_audit_report.md歷史COMPLIANT不可當ISO合規；原JSON未改。GitHub另提示既有相依5項（1critical、4high），本批未改依賴也未宣稱解決。

**發布狀態：**已正式發布；main commit e4fd4b17ab312afaebe0f1f51279c41cc5acdb93；Pages run 38481581566；簽章有效、正式 92 個資產雜湊吻合。正式入口 https://jnfakimo.github.io/Inspection/v2/ 。合併後 CI38481581555、CodeQL38481581567、commercial38481581581及Pages38481581566皆success；沒有Edge Functions部署。main前端樹與已驗證source commit完全一致；只取公開靜態資產檢查，沒有正式頁面登入視覺／天氣API請求。

**未驗與待辦：**建模頁390px仍有既有2px溢出（雙主題）；實體iPhone／平板／42吋螢幕、原生列印、A4紙本、正式登入與角色/RLS、長資料與公開board、S2/S3均未完成。先前32PDF／104頁離線證據不要求重做，也不轉記為紙本通過。實機／紙本短清單與兩批前後圖已組成單一可離線列印HTML（beinong-ui-verification-and-device-checklist.html）；Library 已成功交付：libfile_8009f904a92c8191a76f26ee132fdf29（file_00000000e6d082099932f87c83f06899），檔案1,620,850 bytes，內嵌12張前後對照圖，390/1280px附件排版驗證通過。Windows不支援os.setxattr，官方helper套用metadata失敗；Library建立本身成功，完整identity已保存在library-identity.json，沒有繞過憑證或重複上傳。

**Codex→Claude接手：**先讀AGENTS、CLAUDE、PROJECT_PLAN本節及handoff；核對candidate git status、HEAD／origin/main、PR50及Pages實際狀態，不重跑已完成檢查只為記錄。確認目前writer停止後才接手，勿啟動另一writer；以release-summary.json／runtime-sync.json／正式資產證據判讀各層通過範圍。未部署時只續PR50既有前端發布，不新增天氣summary GET；已部署時先讀正式簽章與commit，避免重複merge／部署。後續未验項先取得隔離環境與測試帳號／實體設備存取證據，不拿正式DB作試寫；不退回交接簿／天氣已發布修正。
<!-- /UI-RELEASE-20261014 -->


### 2026-10-14 PR50後續：建模溢出已本機修正、兩項warning資料流審查完成（未發布）

**範圍與狀態：**唯一writer接續使用者已授權兩項獨立工作；本批明確先不發布。正式仍為 PR50／main e4fd4b17ab312afaebe0f1f51279c41cc5acdb93。候選分支 codex/modeler-warning-review-20261014 基於該正式main，只有 modeler.css 5行未提交修正；未commit／push／PR／部署。本批未改權限、DB、CSP、安全設定、LINE，也沒有新增天氣API。G獨立日期選擇器及其他未提交工作保留。

**建模2px：**web/app/systems/structuremap/modeler/modeler.css:16 的導覽列 margin 為左右-16px；共用v1-layout.css在≤760px內容左右padding為14px，造成390px畫面nav left=-2/right=392（320px同樣多2px）。這是容器本身越界，與導覽列內合理的 overflow-x:auto 不同。只新增同≤760px斷點的左右margin:-14px，保留其他幾何／樣式／橫捲。G、核准runtime、candidate原始該檔一致，逐檔備份後套用相同修正；備份與雜湊見 modeler-changes.json／before/。
- npm.cmd run test:page-headings exit0（page-headings.log）；npm.cmd run build:pages exit0（build-pages.log，含Next型別檢查）；git diff --check exit0。
- python check-modeler-built.py exit0：320/390/600/760/761/780/1280 × light/tech =14組實際build CSS，整頁溢出0、runtime error0、write attempt0；320px局部scrollLeft>0且最後按鈕可到達，未用全頁overflow hidden遮蔽。modeler-before.json保留2px證據；modeler-after-built.json與390/1280截圖為修正後證據。

**warning 1：HTML 注入 API**
- 掃描入口 tools/security-design-audit.mjs:33，只以 dangerouslySetInnerHTML 字樣發出 warning；不是污點分析結果，也沒有CVSS。
- 確切sink web/app/layout.tsx:55、56；所有V2頁面載入RootLayout時執行。55插入32–47行 CHUNK_RECOVERY_SCRIPT 的固定模板字串，無資料庫／HTTP／使用者欄位插入其中。56同樣是固定程式字串。
- 未信任來源仍存在，但不進HTML解析：localStorage.siteTheme讀取後只傳给固定名稱 data-theme 的 setAttribute；錯誤事件的url/message/reason及sessionStorage.chunkRecoveryAt只做字串比對／Number轉換／60秒重載節流，不經eval、HTML拼接或script字串插值。固定程式本身不需要HTML消毒；主題值不屬富文字，也不會重新解析成屬性或節點。
- 測試：8個惡意localStorage值（img onerror、svg onload、script結尾、引號、entity、javascript字串）在實際script的無CSP離線瀏覽器執行後，data-theme保留字串、執行旗標0、注入活動節點0。實際chunk程式另在VM驗證惡意錯誤字串不執行，非chunk不重載、首次chunk重載1次、重複事件仍1次。
- 結論／嚴重度：掃描等級仍warning；此資料流未證實可利用XSS，屬需要保留審查的危險API提示，沒有已確認漏洞可評CVSS。不抑制掃描、不更改CSP，也不聲稱所有瀏覽器／其他sink均安全。

**warning 2：文件字串輸出**
- 掃描入口 tools/security-design-audit.mjs:34，依 document.write 字樣提示warning。確切sink vehicle-workspace.tsx:592–606；入口453「派車報表」→498/505 VehicleReportModal →665「A4列印」→574 printReport，576建立同源空白報表視窗。
- 資料來源：271–280直接讀取 vehicle_dispatch_requests 並setRows；不因來自DB就視為可信。報表from/to為507–508的表單state，profile.name來自登入profile；request_no、單位、人名、地點、用途、車牌、司機、status fallback、abnormality_note等可含未信任文字。reportQuery只參與includes篩選，未插入HTML。
- 編碼與context：581–589及603的文字值全部經 web/lib/html-escape.ts:10–13 escHtml，將 & < > 引號及單引號編碼；這些插值均位於文字節點，無動態URL／屬性／script context。timeText（61）只是截字但其結果仍escHtml；未知status fallback也有escHtml。里程／油費於587–588先Number再格式化；604的metrics由524–530的長度、Number及布林計數產生。body雖直接插入605，但它由上述逐欄編碼的列組成。這是context正確的輸出編碼，不是允許富文字的消毒器。
- 測試：從實際TypeScript AST提取 printReport、metrics、STATUS_LABEL、timeText、escHtml，沒有重寫其編碼；8組payload同時放所有文字、日期、profile及數字欄位，產出真正函式報表。在無CSP離線Edge解析，payload以字面文字呈現、script/img/svg/iframe/object/embed數0、事件屬性0、執行旗標0、沒有外部請求。非法數字變NaN而非HTML，此項資料品質不代表XSS，也未順帶更改業務驗證。
- 結論／嚴重度：現有掃描warning保留；在已追到的輸出路徑未找到編碼缺口或可利用XSS，因此沒有必要改source或suppress。報表視窗同源，若日後漏掉跳脫，潛在影響會涉及使用者session；這是回歸理由，不是本次已證實漏洞或已評定的高風險缺陷。

**既有與新增測試界線：**既有npm test／security:audit已在PR50通過；本批搜尋 tools、web/lib 測試未找到直接針對 escHtml／CHUNK_RECOVERY_SCRIPT／vehicleDispatchReport 的專用XSS回歸，掃描只證明語法提示。新增的可重跑隔離證據在 C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/global-acceptance-evidence/followup/：security-fixtures.json（來源SHA、8個HTML）、security-browser-results.json（16組全通過）、chunk-recovery-results.json、warning-source-parity.json（G/candidate三來源正規化一致）。執行腳本在task-2：build-html-warning-fixtures.cjs、check-html-warning-fixtures.py、check-chunk-warning.cjs；均exit0，未加入CI、未動正式資料。

**是否需批准／正式資料驗證：**本次最小CSS修正、只讀資料流分析與離線fixtures已在授權範圍，無需另批；沒有發現必須改安全設定的修復。驗證輸出編碼不需要往正式DB寫入payload。若要補「登入→儲存→跨角色讀取→列印」stored-XSS／RLS整合層，須先指定可用隔離環境、測試帳號與資料範圍；本次沒有該層證據，也不因16組通過而標S2/S3完成。實體設備與紙本仍未驗。

**交付與接手：**既有 Library libfile_8009f904a92c8191a76f26ee132fdf29 是可離線閱讀／列印HTML，並非PDF；390px附件閱讀測試已過，未因假設手機不佳另外新增PDF。後續Codex/Claude先確認本writer已停止，再讀本節、git status與followup證據；保留modeler.css未提交修正、不要重發PR50，也不要把本批本機修正當正式上線。沒有任何新的發布授權。


### 使用者決定：暫緩隔離測試環境

使用者指示「先不要 列入待辦事項」（Sentinel_d265de5b7d5481919223b215999d7b29）。既有 S2 環境待辦狀態更新為：**使用者暫緩：建立本機隔離 Supabase 環境，完成真實登入／跨角色／RLS 驗收；待日後批准。**

此為同一待辦的狀態更新，不新增工程任務；既有只讀盤點及驗證證據全部保留。不安裝 Docker／Supabase、不建立帳號、不啟動容器、不再次請求批准；正式資料庫不可替代隔離測試。本條環境設置工作停止，直到使用者日後明確批准。實機／紙本仍未驗證，建模 CSS 候選仍未提交、未發布，正式站維持 PR50；其他未完成項目不因此視為完成。


### 2026-10-14 Adobe PDF／Letter 列印問題修正（本機，未發布）

- 使用者三份原始 PDF 由 Adobe PDF 印表機／PScript5.dll／Acrobat Distiller 26.0 產出，Letter 612×792 pt；不是瀏覽器另存 PDF。原始檔判讀依雲端父任務 Library 檢查：業管 3 頁含空白首頁與第二節孤立標題，機電及駐警各 2 頁且簽核完整；留白不等於資料遺失，未發現頁首日期裁切。
- 3000 listener PID 19172，其父 PID 30372 執行 `next dev web --hostname 127.0.0.1 --port 3000`；實際來源 `C:/Users/jnfa/Documents/Codex/2026-10-09/Inspection-G-runtime`。本次候選基底 `e4fd4b17ab312afaebe0f1f51279c41cc5acdb93`（PR50），不是把 runtime 的歷史 BUILD_ID 當作 dev 版本。
- 唯讀 Adobe PrintTicket 明確為目前預設 ISOA4 210000×297000 μm、Portrait、PageScaling None；不能反推原始三份 Letter 工作當時設定。未修改印表機設定，未操作真實帳號或正式資料。
- 根因與最小修正：業管 print selector 漏掉實際 `.system-page-heading`，仍占位的共用頁首先產生一般頁，接著切換報表 named page 造成空白首頁；加入 display:none。共用 800px 手機 media query 原本也套用列印，指標與簽核變單／雙欄增高；限定 screen，保留既有列印字級。區段標題加入 break-after:avoid-page，避免孤立。公文 QR 的 `body *{visibility:hidden}` 限於 `body:has(.od-qr-modal)`，防止跨模組列印污染。
- 真實 React OperationsWorkspace＋AppShell＋全模組樣式、隔離假 API、封鎖外部連線：直接列印與預覽後列印兩條實際按鈕路徑，三本×兩種紙張共 12 PDF／20 頁，均無空白頁。業管 3→2 頁、第二節標題與早班首列同頁；機電 2→1 頁，所有班別、交接簽名、主管簽核與產製時間保留；駐警 2 頁保留完整班卡及簽核。這些是 Edge/Skia PDF、使用現有 CSS A4 named-page 版面適配 Letter/A4 輸出，不能宣稱 Adobe Distiller 實機列印已通過。
- 另以新 build CSS 跑 32 PDF／104 頁短文、空資料、長文、長簽核及排班表 A4/Letter 回歸，全部無空白頁且末端標記完整。test:handover-report-fixtures 19/19、test:handover-style、test:page-headings、typecheck:v2、build:pages 通過。build 在 sandbox 下 junction 被拒，正式逐次審核重跑成功；未變更 ACL。git diff --check 通過。
- 前次 104 頁漏測原因：只渲染 PrintSheet／ReportContent，AppShell 為 stub，沒有實際共用頁首與全域公文 CSS，且驗證只檢查空頁／末端標記，沒有 section heading keep-with-next 判斷。本次補完整頁面與兩個真實列印入口，並加三項持續回歸規則；104 頁只能作長內容補充證據。
- 證據 `C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/print-path-repair/`：full-after.json、*-direct-after-{Letter,A4}.pdf、*-preview-after-{Letter,A4}.pdf、build.log、sync-preflight.json、sync-result.json；驗證程式 task-2/verify-print-path.py。修改前備份在 before 與 sync-backup。公文 CSS 的 G/runtime 原有 form-control-height 等差異保留，只替換單一列印 selector；其他三檔與候選修正前相符。
- 未驗證／待辦：Adobe Distiller 實機重印及紙本；目前工具清單沒有可呼叫 node_repl／CUA，因此不以替代 helper 繞過桌面控制限制。業管產製時間列一致性尚未改。未建立 PR、提交、推送或部署；保留未發布 modeler.css、G 日期欄位與其他未提交工作。Supabase 隔離環境依使用者「先不要」維持暫緩，不安裝、不啟動、不再要求許可。

- 同步後本機 HTTP 層：初始 HTML 僅含根 CSS，交接簿樣式為延遲 chunk；已逐一 GET 實際 dev 的 business-handover 與 handover-sheet CSS，200 且包含實際頁首隱藏、screen-only 800px 與 keep-with-next 修正（runtime-css-chunks.json）。歷史 production chunk 在 dev 下 404 不作目前版本證據；此檢查不等同登入後 Adobe 實機列印。


### 2026-10-14 PR51 列印修正發布結案

使用者於 2026-10-14 06:10:08 UTC 明確授權「發布」。僅七檔列印 CSS／回歸／雜湊及交接紀錄納入 PR51 https://github.com/jnfakimo/Inspection/pull/51 ，候選 926e7eb196fa85a866dd6e743d3644807c287ae7，正式 a3ea9458a49257146cf908b5472caf108ea7f0a7（06:21:39 UTC 合併）。先前「本批尚未發布」描述以此結案更新取代；建模與日期欄位其他候選仍未發布。

正式 CI 38521752438、CodeQL 38521752468、Commercial readiness 38521752476、Hardened Pages 38521752431 全部 success。正式 provenance Ed25519 簽章與確切 commit 符合；三本交接頁及 JS/CSS 共92項資產 SHA-256 驗證通過，實際頁首隱藏、screen-only 800px、標題 keep-with-next、QR作用域四項均存在。只讀靜態站，沒有正式 DB／簽核／LINE／天氣API操作。

G/runtime 16份交接來源符合更新後 manifest；換行標準化與manifest同步先備份於 print-path-repair/release-sync-backup，逐檔 SHA 在 release-sync-hashes.json。完整44份PDF共124頁，all-44-pdfs.json記錄尺寸、Producer及雜湊；命令與根因詳見 evidence-addendum.md。

Library六份附件上傳尚未完成：標準helper首次DNS失敗，正式審核重試回報 Library prepare_uploads is not available，尚無library_file_id，沒有建立或重複附件。六份Letter/A4修後PDF及hash清單包在 handover-print-six-pdfs.zip，可由使用者一次上傳父對話。

Adobe原生仍未驗證：現行工具無node_repl／桌面／瀏覽器互動入口；最少必要實機步驟是重新整理三本報表、使用同日資料，各點列印並選Adobe PDF、本次工作Letter，存三份一次提供。檢查無空白首頁、章節標題不落單及班別簽核完整，不要求真實資料固定頁數。Edge/Skia測試不取代Adobe實機。Supabase隔離環境依使用者決定暫緩。

GitHub推送提示的5項既有相依警示均屬 mobile/vehicle-tracker/package-lock.json（2026-10-02至10-08建立），本批不含該模組或lockfile；發布要求的production dependency audit通過，未宣稱整個repo無警示。


### 2026-10-15 行動端相依修補接續檢查點

使用者已授權「可以的 請將資料寫入 並部署」，指定 G 為主來源。本次先保存狀態，後續僅選擇性同步及發布完成且驗證通過項目。正式 main 最近已核對為 PR58／69a47285986e193c5e50745a50a5a81ca3ffb130；不得回退至 PR51 或 PR52。

乾淨候選：C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/mobile-deps-20261015。候選目前僅 mobile/vehicle-tracker/package-lock.json 有修改，目標 compression 1.8.2、shell-quote 1.12.0、source-map-js 1.2.2，保留 uuid 11.1.1。前次 npm ci 已確認 exit 0；工具連線中斷後 typecheck、相依樹與 CI 編輯尚無完成證據，本次檢查未找到預期 typecheck/npm-ls 日誌，CI 未呈現修改，必須重新核實後完成測試。此檢查點不代表已部署。

G/runtime 與最新 main 仍有交接檔案／manifest 差異，需逐檔備份及比較後同步，不整包覆蓋 G 未提交工作。證據存於 mobile-deps-evidence-20261015。業管報表末尾空白頁及隔離 Supabase 安裝維持使用者暫緩；不操作正式 DB、簽核、LINE 或天氣 API。原生行動裝置、Adobe 與紙本仍未驗證。


### 2026-10-15 PR59 驗證與同步紀錄

PR https://github.com/jnfakimo/Inspection/pull/59 ，候選 c5648296da6aec0916a61b5c0fb76f7c7036f4ad。本機行動端 npm ci、typecheck、相依樹、Android/iOS Hermes bundle、BLE 8/8、完整 npm test、V2 typecheck、build:pages、秘密掃描全部通過；資安設計稽核 0 錯誤、2 項既有警告。遠端 mobile-vehicle-tracker、static-security、Windows 相容性與 commercial static-audit 已通過；其餘 CI/CodeQL 尚待完成，不在此宣稱部署。

G/runtime 已先逐檔比對舊 PR51 內容、備份，再同步 PR58 已發布版本：每處六份原始檔及 manifest，共 14 個檔案項目。兩處 16 份 manifest 原始檔雜湊均通過；行動端 lockfile 與 ci.yml 另各兩檔同步並讀回相同。其他 G 未提交修改保留。證據：checkpoint-result.json、main-sync-result.json、mobile-sync-result.json、final-source-parity.json、local-validation.json。

本機初次 npm 根相依安裝因沙箱 DNS 失敗、Hermes 暫存寫入因沙箱權限失敗，皆經正式逐次審核後成功重跑，未改 ACL／安全設定。全程無正式 DB、簽核、LINE 或天氣 API 請求。原生裝置、Adobe、紙本仍未驗證；業管末尾空白頁與隔離 Supabase 安裝維持暫緩。


### 2026-10-15 PR59 正式部署結案

使用者已授權寫入並部署。PR59 https://github.com/jnfakimo/Inspection/pull/59 於 2026-10-15 05:21:26 UTC 合併，正式 commit 73abe7935fdc355c45930dfb595d49cd00edc0f8；先前等待 CI／未部署描述以本節更新。僅五檔：行動端 lockfile、CI、三份交接文件；未整包提交 G 修改。

正式 CI 38686345907、CodeQL 38686345974、Commercial readiness 38686345926、Hardened Pages 38686345943 均 success。正式 provenance commit 與 Ed25519 簽章正確，三本交接頁及 JS/CSS 共 92 項資產 SHA-256 全通過；四項既有列印修正仍存在。證據在 mobile-deps-evidence-20261015/main-workflows.json、deployment/verification.json、local-validation.json 與 evidence-hashes.json。此為網站部署與來源驗證，非 Android/iOS 商店發布，也不代表原生設備、Adobe 或紙本已驗證。

GitHub Dependabot 已確認 compression、shell-quote、source-map-js 三項警示消除；剩餘 #15 braces、#14 node-forge 均 high，first_patched_version 為 null，列為後續追蹤，不宣稱全庫零漏洞。G/runtime 已讀回核對每處 16 份交接 manifest 來源及兩份本批修補檔一致。備份留在 checkpoint-backup、main-sync-backup、mobile-sync-backup、validation-doc-backup、release-doc-backup。

業管末尾空白頁、隔離 Supabase 安裝仍暫緩。本批無正式 DB、簽核、LINE、天氣 API 操作，沒有修改 ACL 或安全設定，未刪除 packed-refs.lock 與讀寫測試檔。其他未提交工作保留。


### 2026-10-15 全站共用視窗操作續作（本機完成，未發布）

依使用者「請繼續工作」，唯一 writer 沿用 antigravity-workflow，重讀 AGENTS.md、CLAUDE.md、ANTIGRAVITY.md、web/AGENTS.md 與原待辦；遠端 main 核對仍為 PR59／73abe7935fdc355c45930dfb595d49cd00edc0f8。原告警頁窄版溢出在最新來源 320/390/768/1280 × light/tech 已無法重現；車輛追蹤設備清單為局部可捲表格，整頁溢出 0，不重複修補。其餘追蹤模組及全站流程尚未逐頁重新驗收。

本批唯一程式修改 web/components/admin/shared.tsx 的 AdminModal。修正前真實元件測得開窗焦點仍為背景開啟按鈕，Escape 後視窗仍在。新增開窗聚焦、Tab/Shift+Tab 循環、阻止焦點落入背景、Escape 僅關閉最上層視窗、關閉還原開啟者焦點；保留既有 onClose 業務行為、巢狀視窗、已處理鍵盤事件及輸入法組字保護。元件卸載移除事件監聽，不變更視覺 CSS、權限或資料操作。

自動化／畫面證據：check-modal-before.py exit0 重現缺陷；check-modal-after.py exit0，實際 AdminModal ＋完整 build CSS，320/390/768/1280 × light/tech 共 8 組，每組 3 次取消／Escape／關閉、巢狀 Escape／返回、Tab 循環、強制背景焦點、重開輸入清空皆通過；整頁溢出 0，視窗位於可視區內。390px 雙主題截圖已目視檢查；視窗文字對比 14.63:1／16.41:1。Playwright 使用本機無頭 Edge，攔截全部請求並僅供應離線檔案，沒有正式登入或資料請求；這不是正式跨角色／各業務表單驗收。

命令結果：npm run typecheck:v2、test:page-headings、test:button-standard、security:audit、build:pages、git diff --check 均 exit0；安全設計稽核仍為 0 錯誤／2 既有警告。未宣稱本批完整 npm test 或 CI 已執行。源碼初次 CRLF 造成 diff whitespace 檢查失敗，僅本批檔改回 LF 後通過。

G/runtime 修改前與 main 正規化內容一致；先備份 source-backup，再逐檔同步並讀回 SHA，其他 dirty 工作保留。證據目錄 C:/Users/jnfa/Documents/Codex/2026-10-13/task-2/ui-followup-20261015：modal-before.json、modal-after.json、modal-after-{width}-{theme}.png、source-sync.json、typecheck.log、headings.log、buttons.log、audit.log、build.log；執行腳本在 task-2/build-modal-followup.cjs、check-modal-before.py、check-modal-after.py。候選為 mobile-deps-20261015，僅 shared.tsx 有本批語意差異，仍未 stage／commit／push／PR／deploy。正式站維持 PR59。

未完成：正式登入後業務視窗、真實手機／平板觸控與螢幕閱讀器驗收；本機畫面不替代正式帳號流程。業管報表尾端空白頁、隔離 Supabase 安裝仍依使用者暫緩；braces/node-forge 無修補版只追蹤。沒有操作正式 DB、安全設定、LINE、額外天氣服務或地圖定位。既有未發布 modeler.css 修正保留。


### 2026-10-15 AdminModal PR60 部署結案

使用者引用本批成果後明確要求「部署」。僅 AdminModal、其必要來源 manifest 與三文件紀錄共五檔發布，下一批 Pager 重現及既有 modeler 修正均未混入。PR60 https://github.com/jnfakimo/Inspection/pull/60 ，最終候選 ece97722337619ae38d19d9392c5b8b27083ada9；2026-10-15 05:41:24 UTC 合併正式 commit 4d5b6693d61cc01c47b8f0ab79dd36c6a6f059ca。前節本批「未發布」狀態以此結案取代。

首次完整回歸與 CI 因 handover-release-manifest 仍指向舊 shared.tsx 雜湊而失敗；補齊精確 Git 位元組雜湊後，本機來源一致性、秘密掃描及最新 PR 全套 CI/CodeQL 通過。正式 main CI 38688140370、CodeQL 38688140486、Commercial readiness 38688140546、Hardened Pages 38688140477 全部 success。來源其餘既有 CRLF 位元組保留，避免整檔換行差異；只有本批程式區塊變動。G/runtime 最終 16 份 manifest 來源驗證通過，備份與讀回見 release-sync.json／release-sync-backup。

正式 provenance Ed25519 簽章與確切 commit 正確，92 項靜態資產 SHA-256 通過；已驗證 AdminModal 焦點處理碼存在，既有四項列印修正保留。證據 ui-followup-20261015/deployment/verification.json、release-summary.json、release-evidence-hashes.json。此為來源、離線操作及正式靜態發布證據，不等同正式登入後業務流程、實體裝置或螢幕閱讀器驗收。無正式 DB／LINE／天氣請求及安全設定變更。

下一批已離線重現 Pager 在 320px、1000 筆且第 50 頁時整頁溢出 62px（pager-before.json／pager-before.png），上下頁按鈕也只有符號名稱。尚未改該程式、未納入 PR60；可依既有續作授權本機修正，但未取得新一批發布授權。兩項暫緩維持不動。


### 2026-10-15 共用分頁長清單手機修正（本機完成，未發布）

接續原長資料／共用元件待辦；此批與已正式發布 AdminModal PR60 分開，基底為 4d5b6693d61cc01c47b8f0ab79dd36c6a6f059ca，本地分支 fix/pager-responsive-local-20261015，未 stage／commit／push／PR／deploy。

實際缺陷：共用 Pager 在 1000 筆、第 50 頁、320px 時整頁溢出 62px；上下頁按鈕只有符號名稱，選中頁沒有 aria-current。只在 admin-workspace.css 的按鈕列加入 flex-wrap:wrap，在 shared.tsx 的 Pager 補繁中導覽／按鈕名稱與目前頁標示；AdminModal 保持 PR60 內容，並同步其共用檔必要 manifest 雜湊。沒有另造頁面版型或變更配色、頁碼演算法。

實際元件＋新 build CSS 離線驗證：320/390/768/1280 × light/tech 共 8 組全通過，整頁溢出 62→0、所有頁碼按鈕可見。每組連續上下頁 3 次，跳首頁／末頁的停用狀態正確，Enter 返回上一頁及 aria-current 更新通過；最小按鈕文字對比 5.79:1（≥4.5）。320px 雙主題截圖已目視確認換行與目前頁辨識。全請求只供應本機檔案並封鎖外部網路，不是真實資料分頁或正式登入流程。

命令 exit0：npm run typecheck:v2、test:page-headings、test:button-standard、test:handover-source-parity、build:pages；check-pager-after.py 及 git diff --check 通過。未宣稱新批完整 npm test／CI 執行。初次重現腳本在結果已寫檔後因 cp950 輸出符號失敗，設定 PYTHONIOENCODING=utf-8 重跑 exit0；單一修改行 CRLF 經保留其餘來源位元組方式改 LF 後 diff 檢查通過。

G/runtime 修改前與候選基底相符，先備份再同步三檔、六個檔案項目並讀回，證據 pager-followup-20261015/source-sync.json、before/、sync-backup/。重現證據 ui-followup-20261015/pager-before.json、pager-before.png；修後證據 pager-followup-20261015/pager-after.json、pager-after-{width}-{theme}.png、browser-test.log、typecheck.log、headings.log、buttons.log、parity.log、build.log。腳本 task-2/build-pager-followup.cjs、check-pager-before.py、check-pager-after.py。

真正剩餘：正式帳號跨頁載入與權限流程需要可用的授權測試帳號／隔離資料範圍；真機觸控、螢幕閱讀器需對應設備。公開 board／404 與其他長資料錯誤狀態尚可另批離線驗證，未冒稱全部受阻或全面通過。業管尾端空白頁與隔離 Supabase 安裝仍暫緩；無正式 DB／LINE／天氣／安全設定或地圖定位操作。本批不得沿用 PR60 授權自動發布。


### 2026-10-15 收尾待辦核對（狀態分類，未新增程式或發布）

依原計畫與後續結案紀錄核對，不以歷史「未完成」段落覆蓋較新的完成證據。正式最新已驗證為 PR60／4d5b6693d61cc01c47b8f0ab79dd36c6a6f059ca；PR59 相依修補、PR60 AdminModal 已發布。PR50 已處理告警／追蹤／TV 窄版及派車縮放，早期 135px／578px／55px／.85 zoom 待辦不能再次當現況；全站完整正式互動仍未完成。

| 分類 | 實際剩餘 | 下一步／最小必要條件 |
| --- | --- | --- |
| 可在現有授權離線完成 | 公開 board 的空資料、失敗／恢復、長公告；建置 404；其他表單長文字、錯誤回復及重複操作 | 使用實際元件與 build CSS、明確合成資料、封鎖所有外部請求，逐批重現後才修；不需要正式帳號或新服務。此次只核對入口與現有證據，沒有宣稱已驗過這些狀態。 |
| 已驗證、待發布授權 | Pager 手機 62px→0、語意標示；既有 modeler 2px 邊界修正 | 各批保留現有證據；發布前選擇性整合最新 main 與回歸檢查，不能沿用 PR60 授權。 |
| 需要登入與測試範圍 | 正式帳號登入、跨角色讀取、實際資料分頁、簽核／取消等業務整合 | 明確授權的測試帳號／角色與可用資料範圍；涉及寫入須指定隔離環境，不能用正式資料替代。現有合成 AuthGate/API 不構成此層驗收。 |
| 需要對應設備 | 真機手機／平板觸控、螢幕閱讀器、Adobe Distiller 原生列印與紙本 | 可存取的設備及使用者登入／必要操作；目前 Edge headless、Hermes bundle、Skia PDF 都不能替代。先保留現有證據，不要求重做已通過測試。 |
| 使用者明確暫緩 | 業管報表尾端空白頁；建立隔離 Supabase | 維持停止，只有使用者日後明確恢復才執行，不再請求批准或安裝。 |
| 上游尚無修補版本 | braces、node-forge 兩項既有高風險警示 | 以 PR59 結案時已核實的無修補版狀態追蹤；日後有正式修補與相容性證據再定向更新。此次未另查服務、未盲升級、未解除警示。 |
| 其他專案驗收／決策範圍 | S2/S3 復原演練、RPO/RTO/SLO；地端切換與 Firebase 保護範圍等原待辦 | 需要指定隔離目標、演練／切換授權及責任人決策；不是這次 UI 收尾可自動執行的項目，不宣稱完成。 |

本次沒有新增已證實缺陷，因此沒有為湊工作修改程式；可離線驗證項仍存在，不宣稱全部被外部條件阻擋。原始來源檢查確認未發布 Pager 三檔在 G/runtime 共 6/6 雜湊與前次 source-sync.json 一致；候選仍僅三檔語意差異（shared.tsx、admin-workspace.css、必要 manifest），git diff --check exit0。保留其他 G 修改、既有 modeler 修正、舊備份與 packed-refs.lock。

下一安全批次建議先做公開 board 的離線空資料／錯誤回復與 404 檢查，再依實測結果決定是否修正；不擴成新產品需求或正式服務測試。正式帳號、實機與暫緩項目各自保持原門檻。無新 commit／push／PR／deploy、無正式 DB／LINE／天氣／安全設定操作。
