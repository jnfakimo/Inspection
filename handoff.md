# handoff.md — 交接快照

> 標準在 `AGENTS.md`，進度與證據在 `PROJECT_PLAN.md`，業務與資料規則在 `docs/DOMAIN_RULES.md`。
> 舊版交接紀錄封存於 `docs/archive/2026-10-15-pre-unification/`。

## ⏯️ 目前做到哪

最新（2026-10-28）：**公務車「臨時直接派車」已合併（PR #102，合併 commit `33c7796fb`）。** 長官臨時急需用車時，派車管理員／系統管理員在「派車申請」頁按「臨時直接派車」，
代為建單並直接指派車輛與司機，免課長與部門經理核准；不新增子系統，原五步驟不變。
RPC `vehicle_direct_dispatch` 在單一交易內先以 `approved` 建單、再走既有 `approved -> assigned`，所以管理員檢查、司機名單、同車時段重疊約束、LINE 派車通知、司機接單與回報都照舊生效。
單據標記 `dispatch_source='direct'`，**臨時急用事由必填**，來源與事由建立後不可改，流程歷程註明免核准；列表、詳情與派車報表（Excel、A4、畫面）都標示「臨時直派」。一般單仍須兩層核准才能派車。預計出發時間仍須晚於目前時間（既有 guard 未放寬）。
migration `20261028090000_vehicle_direct_dispatch.sql` 已以 `apply-database-migration.yml --ref feat/vehicle-direct-dispatch-20261028` 套用到正式庫，並以唯讀查詢讀回：4 個新欄位、函式、守門 trigger、來源檢查約束皆在，anon 不可執行、authenticated 可執行，原 18 筆單皆為一般單。
測試：`npm run test:vehicle-approval`（PGlite 9 組情境，含突變驗證）。**未驗證**：登入後實際畫面與手機版、真實派車後司機收到 LINE 通知（Pages 約 10 分鐘快取，Ctrl+F5）。
使用前提：派車管理員名單內要有人（派車管理員子系統），否則沒有人看得到按鈕。

後續介面調整（皆為純前端，已合併並部署，Hardened Pages 四階段成功）：
- PR #104（`421ddfb3b`）：派車報表（Excel、A4、畫面）用 `statusText` 標示「（臨時直派）」，靜態檢查要求三處都用它。
- PR #105（`73a474961`）：派車申請頁沿用電子交接簿版型——`HandoverSheetHeader` 表頭＋五項待辦指標、流程五步驟圓角卡片、分段頁籤、表格收進 `hs-sheet`；工具列移除與頁首重複的兩顆新增按鈕。
- PR #106（`a963f25b1`）：「新增派車申請」與「臨時直接派車」視窗改為 `VehicleFormSection` 分區卡片（用車人、用車時段、行程、臨時急用事由、指派車輛與司機等），沿用 `handover-create-modal` 標題列。
- PR #107（`28dcd285f`）：臨時直接派車的「用途」與「臨時急用事由」改為下拉＋「其他」（`VehicleSelectOther`），事由預設「長官臨時指派用車」（選項在 `VEHICLE_DIRECT_REASON_OPTIONS`）；用車日期仍用 `LocalizedDateInput` 的日曆選擇器，外觀加日曆圖示。
- **未驗證**：以上畫面只用專案實際 CSS 組靜態樣張在桌面／手機看過，登入後的真實頁面與視窗未驗證；「新增派車申請」的用途仍是原本的輸入加建議清單，未改成下拉。
- 彈窗開啟時焦點落在右上「×」造成藍框，是全站 `AdminModal` 共用行為，未更動。
- `test:handover-source-parity` 在 Windows 本機因 CRLF 雜湊不符會失敗（未含本批改動時同樣失敗），CI（Linux）不受影響。

最新（2026-10-24）：**資安前三項修補與 ISO 導入基礎已透過 PR #95 合併及發布網站。**
使用者選擇先建立巡檢系統符合要求的基礎，接著明確指定修正 Next.js、certifi、主分支與部署管制。
G 槽保留既有未追蹤 `.claude/`；本批合併 commit 為 `83eb3b2b52f5ba358356bd100ef4481e44d60533`。Next.js 更新 16.4.3；certifi 更新 2026.10.19 並設下限。
main 保護已在線上設定並讀回：PR、8 個必要檢查、strict、enforce_admins、禁止 force push／刪除；不強制第二人 review。
網站與 Edge Functions 的同 SHA CI／CodeQL／Commercial readiness gate 已發布；CI 新增 Python 服務檢查與 gate／掃描器回歸。
PR #95 的 8 項必要檢查全通過後才合併；合併版 CI `40042849592`、CodeQL `40042849517`、Commercial readiness `40042849539`、Hardened Pages `40042849467` 全成功。Pages 線上簽章來源指向相同 commit，登入頁 HTTP 200。此批未修改 Edge Functions，不需重新部署。
隔離測試在 `C:\projects\Inspection-security-audit-20261024`，使用獨立相依與 venv；未啟停既有 3000 服務。Next 型別、靜態建置、136 HTML 發布產物稽核及 Python 正式相依 audit 均通過。
原始證據在 `C:\AI\_logs\inspection-security-20261024`；完整狀態見 `docs/ISO27001_BASELINE.md`。Python 訊號服務仍是未接正式設備的本機原型，未找到本機常駐程序或正式 venv；遠端若有獨立執行環境仍須確認 certifi 版本。其他密碼、手機與 CSP 風險維持待辦。

最新（2026-10-20）：**頂端列「上頁」改為回到上一個動作、登入後不進戰情儀表板**（PR #94，已合併並部署，CI／CodeQL／Pages 皆成功）。
「上頁」回到本分頁上一個站內頁面（軌跡存 `sessionStorage`，`web/components/useAppBackHref.ts` 與 `web/lib/app-navigation.ts`；不使用 `history.back()`、不記登入類頁面與含憑證字樣的查詢字串），沒有上一個才依階層回父層；
從 `sessionStorage` 取回的路徑必須先過 `safeInternalPath` 白名單才能當連結目的地（否則 CodeQL `js/xss` 會失敗）。登入目的地若是根路徑（戰情儀表板）一律改進 `/systems/`（`resolvePostLoginDestination`）。
**未驗證**：登入後實際逐頁點「上頁」；「請到開放系統」是理解為登入後落在只列有權限系統的入口，若使用者另有意思需再確認。

最新（2026-10-20）：**水果組第二批上線**（PR #92）：存貨交接明細表（HOL-2-09）、果菜報廢報告表（HEM-2-11）、果菜產地運回放行單，頁面加上四個頁籤（值勤紀錄／存貨交接明細／報廢報告／運回放行單）。
存貨交接：填表人員送出（內容鎖定）→ 小組長 → 組(副)長，另記「已送核算小組」「已呈業務部」，A4 橫式一式三份列印；報廢報告：拍賣員、檢驗員先輸入姓名，小組長 → 組(副)長 → 主(副)任依序簽核、不限當日；
放行單：系統流水號 `F1-民國年-序號`（例如 F1-115-00001）加可手填紙本單號，開立後不可改、只能作廢並留原因，三聯列印。小組長＝水果組內填表人以外的任一位同仁；組(副)長、主(副)任沿用第一批的批核資格。
品名與供應代號自由輸入，由近一年歷史提供建議；明細以 jsonb 存放、不實體刪除，草稿可作廢。
migration `20261022090000_produce_handover_documents.sql` 先以 `apply-database-migration.yml --ref codex/produce-documents` 套用到正式庫（讀回：5 張表、10 個函式、4 條讀取政策、RLS 全部強制），再合併；Pages 部署與 CI、CodeQL 皆成功。
資料庫測試抓到並修正「副主任可登記存貨交接送出」的漏洞（plpgsql 的 `if not (a = b or c)` 遇 NULL 不成立，須用 coalesce）。**登入後實際畫面、列印分頁與三聯排版未驗證。**

最新（2026-10-20）：**水果組電子交接簿上線**（PR #90，SYS-04 子系統 `fruit`，一市場）。三班沿用業管組（01-09／09-17／17-01），現場移交事項為自由文字；
交班與接班雙方本人確認、未完成事項續帶；批核三階：組(副)長 → 市場副主任 → 市場主任（後一階須在前一階之後，當日或隔日皆可）。
副主任與主任沿用業管組同一市場的同一批人（`business_market_approval_allowed`），組長為水果組內的單位主管。
migration `20261021090000_produce_handover_fruit.sql` 已套用到正式庫（讀回：4 張表、17 個函式、7 個角色預設拒絕），Pages 與 Edge Functions 已部署，main 的 CI、CodeQL 皆成功。
**尚未做**：在權限頁把組員、組(副)長、副主任、主任設為「允許」水果組（預設拒絕，不設則看不到入口）；登入後實際畫面與 A4 列印未驗證。

最新（2026-10-20）：**業管組電子交接簿批核改為四階並上線**（PR #88）。一市場：市場副主任（莊宗坤）→ 市場主任（簡文財）→ 營業部副理 → 營業部經理，
市場主任須在同日副主任批核後才能批核；二市場先維持原三階（副主任的上下級資料尚未備妥）。按「批核」改為先開本日報表預覽，在預覽內填說明並確認批核。
migration `20261020090000` 已套用到正式庫（HTTP 201），`app-api` 與 Pages 已部署，main 的 CI、CodeQL 皆成功。

最新：PR #83（繁中 404 頁發布到網站根目錄、設備頁載入防呆，正式站已實測不存在網址顯示繁中頁）、PR #84（戰情、會議室、公文、駐警打卡、
維修分析、後台告警／通知／權限、AuthGate 的非同步載入防呆，自 G 槽快照整合 Codex 的修正）。

最後完成：**公務車個人 LINE 派車通知正式啟用**（2026-10-16）。PR #78 上線程式與資料庫，PR #80 整合 Codex 的綁定防呆邏輯並加入派車申請頁入口；
LINE webhook Verify 成功，022443 完成本人綁定並收到個人測試訊息後，管理員已開啟「啟用個人通知」與「指派通知」。
「取消指派通知」維持關閉，「測試模式」維持開啟。派車指派給已綁定的司機時，worker 排程約 5 分鐘內送出個人通知。

## 🚦 目前狀態

- **已上線（main，正式站已部署）**：
  - 單一 token 檔 `web/app/tokens.css`、全站單一主色（一般版 `#0371ac`）、守門檢查 `npm run test:color-tokens`。
  - 一般版小字對比 ≥ 4.5:1（報修案件、設備主檔、業管組交接簿實測 0 處不足）。
  - 系統入口三層版型統一（13 個入口已實測）。
  - 電視牆與後台版面預覽 32 種元件：27 種讀真實資料，5 種顯示「尚未介接資料來源」。
  - 市場看板跑馬燈（登入版與公開版）只顯示 `event='board_notice'` 的公告。
  - 資安告警：本體在 `security_alerts`（RLS 強制、僅管理員、append-only）；通知中心副本只放提示與告警編號，
    超過 90 天由 `redact_expired_security_notices()` 清除內容（`platform-log-alert` 每日臺灣時間 03 點呼叫，不實體刪除）。
- **水果組電子交接簿**（一市場）：值勤紀錄、班次交接、三階批核、A4 預覽與列印；第二批的存貨交接明細、報廢報告、運回放行單（表 `produce_stock_handovers`、`produce_scrap_reports`、`produce_document_signatures`、`produce_release_slips`）。資料表 `produce_handover_*` 以 `group_code`／`market_code` 區分，
    啟用清單在資料庫 `produce_group_enabled` 與前端 `web/lib/produce-handover.ts` 的 `PRODUCE_ENABLED_MARKETS`（有測試比對，須同步改）。業管組的表與函式沒動。
- **未驗證**：其餘約 50 個子系統頁的逐頁畫面（共用元件與守門測試已涵蓋）。
- **未實測**：保存期限函式要等到有超過 90 天的副本才會有實際清除量；可在 03 點後看 `platform-log-alert` 日誌確認沒有錯誤。

## ➡️ 下一步

1. **待公司決定**：資安證據資料表（`security_alerts`、`security_alert_deliveries`、`security_session_blocks`）的保存年限。
   目前等同永久保存，因為專案以 trigger 禁止刪改；要設年限需先決定封存方式（見 `docs/SECURITY_RECORD_RETENTION.md`）。
2. **車輛 LINE 個人通知（已正式啟用）**——後續可選：開啟「取消指派通知」、關閉「測試模式」、關閉 LINE 官方帳號自動回應、請其他司機完成綁定：
   (a) ✅ 2026-10-16 已確認：webhook URL 正確、Use webhook 開啟、Verify 成功（`LINE_CHANNEL_SECRET` 相符）；官方帳號 ID `@ltb9602a`。自動回應訊息仍開啟（使用者決定暫不關閉）。
   (b) ✅ 022443 已完成本人綁定。其他司機可在「個人資料設定 → LINE 派車通知」或「公務車 → 派車申請」頁（僅駕駛名冊人員顯示）自行綁定。
   (c) ✅ 2026-10-16 管理員已送出個人測試訊息（LINE API 接受），022443 確認收到。
   (d) ✅ 已開啟「啟用個人通知」「指派通知」（伺服器讀回一致）。尚未開啟「取消指派通知」；「測試模式」仍開啟，可視需要關閉。其他司機各自完成綁定才會收到。
3a. **業管組批核後續**：(a) 二市場要啟用副主任這一關時，先在人員帳號設好「二市場副主任 → 簡文財同級的二市場主任」的直屬主管關係，
    再補一支小 migration 在 `business_deputy_director_effective_date(p_market)` 加 `market_2` 的啟用日，並同步前端 `BUSINESS_DEPUTY_DIRECTOR_EFFECTIVE_DATES`（有測試逐市場比對）；
    (b) 副主任階段目前「該市場所有主管」都有資格（含簡文財），若要限定只有莊宗坤能批，需另加「指定名單」；
    (c) 登入後實際畫面與 A4 列印分頁（一市場多一個批核欄位）尚未驗證。
3c. **PR 與驗收狀態**：PR #93（本檔的更新）若仍開著就合併；水果組（第一、二批）與「上頁」都**尚未經人實測**——請先在權限頁把水果組設為「允許」，再請組員、組長各走一遍
    值勤紀錄、存貨交接、報廢報告、放行單與列印；使用者曾反映看不到四個頁籤，正式站程式已確認含頁籤，疑為瀏覽器快取，請 Ctrl+F5 後仍無再查。
3b. **水果組／蔬菜組後續**（紙本表單 5 張在 `C:\Users\jnfa\OneDrive\Desktop\巡檢系統\蔬菜水果組交接簿`）：
    (a) **先在權限頁開放**水果組給組員、組(副)長、副主任、主任，並請現場實測；
    (b) ✅ 存貨交接明細、報廢報告、運回放行單已於第二批上線（PR #92）；請現場實測紙本格式與三聯列印，並確認小組長（填表人以外任一位同仁）的認定是否合用，需要改成管理員指定名單時另做；
    (c) 待售品交接（區與柱）使用者決定**先不做**；
    (d) 二市場水果組目前**沒有任何人員帳號**、尚未啟用：要啟用須先建人員與主管鏈、二市場副主任與主任，再改 `produce_group_enabled` 與 `PRODUCE_ENABLED_MARKETS`；
    (e) 蔬菜組：值勤紀錄與班次交接與水果組相同，之後以 `group="vegetable"` 加入（需放寬 `user_handover_module_key_check`、兩支 Edge Function 的子系統清單、modules.ts、入口圖卡）；圖示 `handover-vegetable-icon.png` 已備、尚未使用。
3. **產品決定**：`app-api` 報修案件列表與 `structuremap-markerboard.tsx` 的報修挑選清單是否也略過 hidden（見 `PROJECT_PLAN.md` §19；
   動到 `supabase/functions/**` 合併後會自動部署 Edge Function）。
4. 色彩統一剩餘項目都需要登入與瀏覽器：`LayoutsAdmin.tsx` 行內樣式、WS-9 兩主題／手機／A4 視覺驗收。
4a. ✅ 設備營運／能源面板已上線到中央監控頁（PR #86，使用者決定）。目前只接上監控告警；4 項能源讀值、設備運轉狀態、工單／巡檢／結案追溯標示「待介接」，
    待有資料來源（電表／水表、設備運轉訊號）後再接入 `EquipmentOperationsEnergy` 的 `energy` 與 `trace` 屬性。
5. 其餘待辦見 `PROJECT_PLAN.md`：全角色權限矩陣、資安 S1–S3、`Obsidian/04` 179 節審閱、`app-api` 拆檔。
6. 日後若要隱藏新的正式測試資料：不要直接執行 `docs/runbooks/hide-test-records.sql` 步驟 2（會被保護觸發器擋下），
   比照 `20261016090000_hide_e2e_test_workorders.sql` 另寫 migration，經 CI 後以 `apply-database-migration.yml` 套用。

## ⚠️ 注意事項

- **業管組批核資格依 `users.supervisor_id` 組織鏈**：已啟用副主任關卡的市場，副主任＝該市場主管、主任＝其直屬上司、副理與經理各再往上一層；未啟用的市場維持原三階。
  改人員的「直屬主管」會直接改變誰能批哪一階；一市場需維持 莊宗坤 → 簡文財 → 營業部副理 → 營業部經理。系統管理員可批核任一階（二市場沒有副主任階段）。
- **工作位置**：G 槽已於 2026-10-16 切回乾淨的 `main`（與 `origin/main` 一致）。開發與測試仍在 C 槽另建 worktree：
  `git worktree add -b <分支> C:\Users\jnfa\Documents\Codex\<資料夾> origin/main`，再以 junction 連 `node_modules` 到 C 執行副本；
  移除 worktree 前**先單獨刪掉 junction**（PowerShell `(Get-Item <路徑>\node_modules).Delete()`），避免連帶刪到執行副本的 `node_modules`。
- **本次水果組的做法**：worktree 建在 G 槽 `G:\我的雲端硬碟\AI\Codex\Inspection-fruit-handover`；驗證則 robocopy 到 C 槽 `...\Codex\2026-10-21\Inspection-fruit-verify`（排除 node_modules、.git），
  `node_modules` 以 junction 連 `Inspection-G-runtime`；跑 `npm test` 時要設 `HANDOVER_TEST_PGLITE_PATH` 指向 runtime 的 `@electric-sql/pglite/dist/index.js`，且須把雜湊鎖檔的 16 個檔案換成 LF 版本（`git show :<path>`）才會通過。
- **新增畫面時先跑 `npm run security:audit`**：它不在 `npm test` 內，只有 CI 的 static-audit 會跑；原生 `datetime-local`、`time`、`date` 欄位會被擋，一律用 `LocalizedDateTimeInput`／`TimeSelect`／`LocalizedDateInput`（時間 30 分鐘級距，預設值要先捨去到級距）。
- **plpgsql**：`IF` 條件內不能含 `CASE … THEN`（會把 CASE 的 THEN 當成 IF 的 THEN），先算進變數；migration 不可含 `DELETE FROM`／`DROP TABLE`，所以明細存 jsonb、草稿用狀態作廢。
- **git**：G 槽 `.git` 偶爾留下 0 位元組的 `config.lock`，會讓 `git switch -c`、`git config --add`、`push -u` 失敗；確認沒有 git 程序在跑再刪。建分支後務必 `git status -sb` 確認真的在新分支上（這次曾因此把 commit 做在舊分支，再用 `git branch -f` 搬回）。
- **生圖**：`draw` 技能要用有 `openai` 套件的 Python（`%LOCALAPPDATA%\Microsoft\WindowsApps\python3`），Programs 底下的 Python312 沒有。
- **驗證**：在上述副本執行 `npm run typecheck:v2` 與 `npm test`；G 槽的 `node_modules` 不完整，不能在 G 跑。Edge Function 另用 `deno check <入口檔>`（本機已安裝 deno），跑完會改動 `deno.lock`，不要提交。
- **資料庫 migration**：用 `apply-database-migration.yml`（workflow_dispatch，可指定 `--ref` 為 PR 分支）。該流程拒絕含 `DROP TABLE`、`DELETE FROM`、`TRUNCATE` 的 migration，
  且必須以 `BEGIN;`／`COMMIT;` 包住；保存期限等需求請用 UPDATE 清除內容，不要實體刪除。套用順序：CI 通過 → 套用 migration → 合併。
- **交接簿雜湊鎖檔**：改到 `tools/handover-release-manifest.json` 列出的 16 個檔案時，必須同步更新雜湊（以 `git show :<path>` 的 blob 計算 SHA-256）。
  Windows 的 CRLF 工作副本會讓本機比對失敗，比對前先 `rm` 後以 `git -c core.autocrlf=false checkout -- <path>` 取回 LF 版本。
  加入暫存區時若檔案原本是 CR／LF 混用，用 `git hash-object -w --no-filters` 加 `git update-index --cacheinfo`，避免整檔被改換行。
- **在 shell 的 `node -e` 內寫含反斜線的 regex 會被吃掉**（`\s` 變成 `s`），斷言會變成永遠通過。regex 請用編輯工具寫進檔案，並加反例斷言證明它會失敗（CodeQL 的 `js/useless-regexp-character-escape` 會抓到）。
- **合併**：這個 repo 不允許 GitHub auto-merge，合併需使用者明確指示；合併 main 會自動部署 GitHub Pages，
  動到 `supabase/functions/**` 會同時自動部署 Edge Functions。
- **推送新分支**：G 槽 repo 是 partial clone，`remote.origin.fetch` 只對應 `main`，所以 `git push -u` 推得上去卻綁不了 upstream（「is not a branch」）。
  先加該分支的 refspec 再綁：`git config --add remote.origin.fetch +refs/heads/<分支>:refs/remotes/origin/<分支>`，接著 `git branch --set-upstream-to=origin/<分支>`。
  不要改成 `+refs/heads/*` 萬用字元，會把所有分支都抓下來。
- **部署後快取**：GitHub Pages 有約 10 分鐘快取，驗收時網址加 `?v=<commit>` 或按 Ctrl+F5。
- **行情資料慢**：首次載入約 10–20 秒（Render Node API 5 秒逾時後才改走 Supabase），偶爾日期查詢會回 503，重試即可。
- **大量讀取保護**：短時間連開多個資料頁可能被強制登出；驗收時一頁一頁慢慢看。
- 一次只有一個寫入者；commit、push、合併、部署都需使用者當次授權；不寫入任何 secret。

## 🕐 最後更新

2026-10-28 · Claude Code（Sonnet 5.5）@ DESKTOP-0CFB6UK · 公務車臨時直接派車：PR #102 合併、migration 已套用並讀回；PR #104–#107 介面調整已合併部署（見上）。本批交接更新在分支 `docs/handoff-vehicle-ui-20261028`，尚未開 PR。G 槽工作樹的 `handoff.md` 另有 Codex 未提交的 2026-10-24 重構紀錄（分支 `refactor/inspection-account-review-20261024`），合併時兩邊都要保留。

2026-10-24 · Codex · 使用者決定預設密碼暫不更動；在 `fix/inspection-security-followup-20261024` 恢復原本帳號核准密碼流程，風險 R-01／R-04 維持未結案。隔離副本完整 `npm test`、V2 型別檢查、`deno check admin-api`、138 頁 hardened 建置通過；`security:audit` 0 錯誤、3 個既有警告。其他已完成的行動儲存、CSP 與 IP 格式檢查仍保留；正式主機 443／445 不通，行動實機、代理覆蓋、恢復演練與組織核定仍需證據。`node-forge` 無修補版，`zod` 上游尚未提供相容修補；都維持待追蹤。以下上一筆是當時狀態，不能當作目前結案證據。

2026-10-24 · Codex · ISO 後續強化當時狀態：分支 `fix/inspection-iso-hardening-20261024`；帳號核准不設初始密碼，行動權杖／GPS 加密與 7 天期限，V2 CSP script hash，IP 格式檢查，ISO 風險工作底稿。隔離 Android／iOS bundle、V2 138 頁建置通過；正式主機、行動實機、代理覆蓋、恢復演練與組織核定仍無證據。`node-forge` 無修補版，維持待追蹤。合併／部署狀態以後續 GitHub 檢查及正式讀回為準。

2026-10-20 · Claude Code（Sonnet 5.5）@ DESKTOP-0CFB6UK · 收工：水果組第二批（PR #92）與上頁／登入導向（PR #94）已上線；本交接更新見分支 `codex/handoff-produce-documents`（PR #93）。Git push：✅ 已推（4441bf36a，其後的回填 commit 見 PR #93）


## 2026-10-28 GitHub 修正分支整合

Codex 依使用者要求準備發布本次資安及交接簿修正，以 origin/main 939227464 為基準，保留線上人數、巡檢市場與派車新增功能。行動相依修補、掃描器狀態、報修狀態 migration、主管簽核鏈與機電提示、主管選單排除本人納入；原帳號審核可讀性重構留在原工作樹。密碼政策不變。發布至 codex/inspection-security-handover-20261028，未合併 main、不觸發正式資料庫／前端／Edge 部署。既有隔離驗證及未驗證邊界見 docs/HANDOVER_CLOSEOUT_VERIFICATION_20261028.md 與 SECURITY_FOLLOWUP_20261028.md。整合版檢查結果另記於 docs/GITHUB_PUBLISH_20261028.md。


## 2026-10-29 主管選單補驗完成

pass：以獨立 Chromium 與真正隔離 Auth／API 完成主管選單 9 項核對，包含排除本人／跨單位／一般人員、儲存後重開、主管選填、一般人員必填、系統管理員欄位及 390px 手機操作。原主管鏈已還原，未發現需新增產品程式修正。解除先前選單 UI 待驗項目；密碼政策及正式資料不變，未新增正式部署。詳細證據見 docs/SUPERVISOR_SELECTOR_VERIFICATION_20261029.md。其他實機／正式環境與組織證據待辦不受影響。

## 2026-10-29 剩餘風險與隔離驗證（Codex）

已修正備份清單漏驗、generated／identity 還原，以及機電／水果／業管日報日期載入競態。備份 10/10、真實 PG17 還原 SQL、復原服務延伸 6/6、帳號匯入匯出 5/5、三日報防護 9/9、A4 六頁視覺與本機收信通過；型別、隔離 build、來源雜湊、版型及資安檢查通過。正式資料／密碼政策未動，本輪未 commit／push／deploy。

剩餘：deepmerge 7 low 維持補丁追蹤；實機、正式主機與代理、外部通知、正式備份 Auth／異機恢復及組織核准未驗證。測試證據與明確限制見 docs/ISOLATED_REMAINING_VERIFICATION_20261029.md。原始碼正本 G，執行副本 C:/projects/Inspection-publish-20261028；復原前端 127.0.0.1:8766。

### 2026-10-29 GitHub 修正分支交付

Codex 依使用者明確授權，將上述備份／還原、三日報競態修正及驗證報告一併提交至 codex/inspection-security-handover-20261028；僅包含本輪 16 個相關檔案，不納入私有測試帳密、session、資料庫或匯出檔。正式資料與密碼政策不變，未合併 main、未部署；推送結果以遠端提交紀錄為準。既有隔離驗證保留，雲端 CI／CodeQL 另以本次提交核對。


## 2026-10-29 CodeQL 8 筆已排除告警複核

Codex 完成逐筆排除理由與基準 SARIF 複核：修正 HTML 稽核漏檢、V1/V2 永久橋接權杖、兩支排程錯誤外洩，並補強建置字串序列化。原 #4/#5 排除註解無效，但固定 namespace/hash 未證實可利用。完整 npm test、型別、隔離建置、12 項回歸、真實隔離 Auth 瀏覽器 6 項、Gitleaks、Semgrep 均通過；security:audit 0 錯誤、4 警告（3 既有＋1 本機測試 fixture）。詳見 docs/CODEQL_DISMISSED_REVIEW_20261029.md。

同一修正分支交付；CI／CodeQL 以新提交結果另行確認，不以全域 dismissed 狀態判定修正。正式資料及密碼政策不變，未部署／合併。巡檢新分頁需有仍開啟的同來源登入分頁；全關閉時重新登入。實機掃碼與同來源 XSS 殘餘風險界線保留。

CodeQL 複驗補充：程式 f4d9e09cf，執行 40797879167 success；SARIF 原 8 筆消失，新 1 筆 #59 為舊紀錄 user_id／valid_until 遷移的資料流告警，白名單輸出無 bearer token，已附證據判讀並保留 open，未隱藏。新增競態回歸後共 13 項，巡檢 10 項及隔離瀏覽器 6 項通過。CI 40797876205 另以執行結果為準；正式與密碼政策不變。
CI 40797876205 已完成：六項工作全部 success；報告補記提交只更新文件。

## 2026-10-29 CodeQL #59 再複核

使用者授權確認誤報後排除。重新讀取 SARIF 四條資料流，永久輸出僅 version/user_id/valid_until；新增白名單與中繼資料不可登入／借用身分測試，回歸 16/16、隔離真實 Auth 瀏覽器 7/7 通過。決策採 false positive 排除 #59，理由與重新開啟條件見 docs/CODEQL_DISMISSED_REVIEW_20261029.md；GitHub 操作以回讀結果為準。本輪只改測試／文件，正式資料、密碼政策不變。


## 2026-10-29 剩餘低風險及隔離補驗續報

修正 Storage 備份根目錄 junction 漏驗與 LINE 未取消回應串流；反例修正前失敗、修正後通過。新增 SQL→worker→本機 HTTP 故障／重試 5 情境，瀏覽器能力故障共 9 項、派車輸出注入、啟用信分支、獨立 PG17 叢集／角色還原與重啟驗證通過。deepmerge 仍 7 low，上游無修補版，補丁有效；正式／實機／外部服務／組織證據仍保留待辦。詳見 docs/ISOLATED_FOLLOWUP_20261029.md。正式資料與密碼政策不變，同一修正分支交付，未部署。

## 2026-10-29 行動故障與獨立服務續驗

Codex 本輪唯一寫入者。修正行動分段失敗殘留、損壞索引阻止登出、登出與先前寫入競態；13 項行動故障／補傳／背景定位／BLE 測試通過。全新隔離 Auth／REST／Storage／Edge／Mailpit 接上獨立 PG17 後，發現並補還原 storage_vectors 附屬庫，9 項服務驗證與整組重啟通過。完整實機／正式主機／外部供應商／異機復原待驗清單見 docs/ISOLATED_FAULT_VERIFICATION_20261029.md。數字密碼政策與正式資料不變，交付同一修正分支，未部署／合併。CI／CodeQL 以本輪提交實際執行回讀為準。

## 2026-10-29 Android 模擬器原生補驗

Codex 本輪唯一寫入者。已建立 WSL／KVM Android API 35 隔離模擬器與原生 debug APK，限制測試帳號對外網路。修正跨帳號勤務恢復、登出與延遲回應競態、原生加密介面差異及中斷遷移遺留明文；保留舊 Android 密文可讀及原有金鑰。25 項儲存／生命週期、3 項畫面流程、8 項 BLE、6 項安全相容性、原生登入／更新／重開機／金鑰遺失與清理補驗通過；iOS bundle 通過，原生 iOS 未驗。audit 仍 7 low、0 moderate/high/critical；Gitleaks／Semgrep 通過。見 docs/ANDROID_EMULATOR_VERIFICATION_20261029.md，內列真正需要使用者配合的設備、唯讀權限、測試供應商及異機備份條件。正式資料與密碼政策不變，同一修正分支提交推送，未部署／合併；CI／CodeQL 以本輪提交回讀為準。
