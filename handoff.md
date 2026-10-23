# handoff.md — 交接快照

> 標準在 `AGENTS.md`，進度與證據在 `PROJECT_PLAN.md`，業務與資料規則在 `docs/DOMAIN_RULES.md`。
> 舊版交接紀錄封存於 `docs/archive/2026-10-15-pre-unification/`。

## ⏯️ 目前做到哪

最新（2026-10-24）：**資安前三項修補與 ISO 導入基礎，由 Codex 接手完成本機實作；尚未提交／推送／部署。**
使用者選擇先建立巡檢系統符合要求的基礎，接著明確指定修正 Next.js、certifi、主分支與部署管制。
G 槽已保留既有 `.claude/` 與本批修改並 fast-forward 至 `9da92415f`。Next.js 更新 16.4.3；certifi 更新 2026.10.19 並設下限。
main 保護已在線上設定並讀回：PR、8 個必要檢查、strict、enforce_admins、禁止 force push／刪除；不強制第二人 review。
網站與 Edge Functions 的同 SHA CI／CodeQL／Commercial readiness gate 已寫入工作樹；CI 新增 Python 服務檢查與 gate／掃描器回歸。
**重要**：線上目前已有新的必要檢查名稱，但新 workflow 尚未發布；須依本回合後續授權提交分支／建立 PR，待檢查全通過再合併，不能取消保護來繞過。
隔離測試在 `C:\projects\Inspection-security-audit-20261024`，使用獨立相依與 venv；未啟停既有 3000 服務。Next 型別、靜態建置、136 HTML 發布產物稽核及 Python 正式相依 audit 均通過。
原始證據在 `C:\AI\_logs\inspection-security-20261024`；完整狀態見 `docs/ISO27001_BASELINE.md`。正式部署版本尚未更新／驗證，其他密碼、手機與 CSP 風險維持待辦。

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

2026-10-20 · Claude Code（Sonnet 5.5）@ DESKTOP-0CFB6UK · 收工：水果組第二批（PR #92）與上頁／登入導向（PR #94）已上線；本交接更新見分支 `codex/handoff-produce-documents`（PR #93）。Git push：✅ 已推（4441bf36a，其後的回填 commit 見 PR #93）
