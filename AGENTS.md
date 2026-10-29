# AGENTS.md — 北農巡檢系統（現行標準）

> 所有 AI 工具（Claude Code、Codex、OpenCode、Antigravity）共用的工程、版型、色彩與驗證正本。
> 2026-10-15 重寫：只放「現在有效的標準」。流水帳與歷史決策已封存在
> `docs/archive/2026-10-15-pre-unification/`；業務／資料／權限細則在 [`docs/DOMAIN_RULES.md`](docs/DOMAIN_RULES.md)。
> 規格來源與進度：[`PROJECT_PLAN.md`](PROJECT_PLAN.md)；目前交接快照：[`handoff.md`](handoff.md)。

## 1. 開工順序與協作規則

1. 依序讀：本檔 → `PROJECT_PLAN.md` → `handoff.md` → 要改的目錄是否另有 `AGENTS.md`。
2. 同一批次只允許一個 AI 寫入。換手前先在 `handoff.md` 寫明誰接手；接手者先重查要改檔案的 hash／`git status`。
3. 以資訊工程師角色主動完成定位、修正、測試與驗證，不把使用者當試錯工具；未驗證項目明寫「未驗證」與原因。
4. 工作樹常有大量未提交的既存修改：只動本次相關檔案，禁止 `git add .`／`-A`、`reset --hard`、force-push；
   commit／push／deploy 只在使用者當次明確要求時做。
5. 不寫入、不 commit：token、API key、service-role key、cookie、session、密碼、私有 signed URL。
6. 所有使用者看得到的文字是繁體中文；程式碼、指令、檔名維持原文。
7. **Claude Code 自動檢查**（`.claude/settings.json`、`.claude/hooks/`，2026-10-29 加入）：Claude Code 會在動手前攔截 `git add .`／`-A`、`git commit -a`、force push、`reset --hard`、`clean -f`、stage 機密檔，以及寫入機密樣式（service-role JWT、API key、私鑰）；
   改 `web/` 的 ts／tsx／css 後自動跑色彩 token、系統頁標題、按鈕規格、下拉空白列檢查，結束前若改過 `web/` ts／tsx 會跑 `tsc`（缺 `node_modules/typescript` 時略過並標示未驗證）。
   被攔截不是故障：改用逐一列出檔案等正確作法；確屬假資料的機密樣式在該行加 `allow-secret-pattern`。**Codex、OpenCode 不會執行這些 hook**，第 4、5 條仍須自行遵守，CI 是最後防線。
   修改 hook 後執行 `node .claude/hooks/hooks.test.mjs`。

## 2. 專案概要與環境

- **產品**：臺北農產公司第一果菜市場的設備巡檢、報修派工、電子交接簿、市場分析與行政系統。
- **V2（現行）**：Next.js（`web/`），以 `/Inspection/v2/` 為 base path，後端為 Supabase（PostgreSQL + RLS + Edge Functions：
  `app-api`、`admin-api`、`audit-event`、`line-notify`…）。**V1** 是 `system/*.html` 靜態頁（維護模式，不再新增功能）。
- **正本與驗證環境**：`G:\我的雲端硬碟\AI\Codex\北農巡檢系統` 是唯一原始碼正本。G 槽（Google Drive）的
  `node_modules` 不完整（缺 `tsc`、`@electric-sql/pglite` 損壞），**測試與 typecheck 在核准的執行副本跑**：
  `C:\Users\jnfa\Documents\Codex\2026-10-09\Inspection-G-runtime`。流程：G → C 單向 robocopy
  （排除 `node_modules`、`.next`、`.git`）→ 在 C 執行 `npm test`／`npm run typecheck:v2` → 不回寫 G。
  C 內不在 G 的舊檔（例如已刪除的 CSS）會被守門測試掃到，同步後要先清掉。
- 不啟停使用中的 server（C runtime 的 Node 監聽 127.0.0.1:3000）、不 build、不連 production，除非使用者明確授權。

## 3. 資訊架構：1 個主入口、13 大系統、68 個子系統

唯一正本：`web/lib/modules.ts`（`m()` 有頁面的子系統、`mp()` 只有權限沒有頁面的項目）。
新增大系統流程見 `docs/DOMAIN_RULES.md`「權限四層與系統清單的唯一正本」。

| 代碼 | key | 大系統 | 子系統數 |
|---|---|---|---|
| SYS-01 | admin | 後台管理系統 | 11 |
| SYS-02 | workorder | 報修／派工／完工 | 6 |
| SYS-03 | guardpatrol | 駐衛警巡邏系統 | 6 |
| SYS-04 | handover | 電子交接簿 | 8 |
| SYS-05 | equipment | 設備建置系統 | 8 |
| SYS-06 | structuremap | 專案關係與設備圖臺 | 6 |
| SYS-07 | vehicle | 公務車派車管理 | 5 |
| SYS-08 | meetingroom | 會議室預約系統 | 4 |
| SYS-09 | officialdocs | 公文傳送系統 | 1 |
| SYS-10 | marketanalytics | 市場營運分析系統 | 6 |
| SYS-11 | dashboard | 戰情儀表板 | 0（入口即頁面） |
| SYS-12 | marketboard | 市場公開看板 | 2 |
| SYS-13 | vehicletracking | 公務車定位追蹤系統 | 5 |

## 4. 版型：三層固定結構

| 層級 | 路徑 | 結構 | 關鍵尺寸 |
|---|---|---|---|
| 主入口 | `/v2/systems/` | AppShell 頂列 → `.system-grid` 系統卡 | 卡片 300px 寬、Logo 88px |
| 系統入口 | `/v2/systems/<system>/` | AppShell → `SystemPageHeader` → `.module-grid` 子系統卡 | 卡片 **269×200px**；≤1100px 2 欄、≤600px 1 欄 |
| 子系統頁 | `/v2/systems/<system>/<module>/` | AppShell → `SystemPageHeader` → 功能區 | 見下 |

共同規則（`tools/system-page-heading-check.mjs` 與 `test:module-card-standard` 把關）：

- **頂列**只保留 首頁、個人資料、登出；系統切換由入口頁與後台側欄承擔。最右側依序為 使用者（單位｜姓名）、連線狀態、
  **在線人數**（綠色膠囊「N 人在線」，使用者 2026-10-28 要求新增）、Asia/Taipei 時鐘 `YYYY-MM-DD HH:mm:ss`，全部來自共用元件，不得另做。
  在線人數由 `useOnlineCount`（`web/lib/use-online-count.ts`）每分鐘呼叫 `presence_heartbeat` 取得，只拿到人數、看不到是誰；
  `user_presence` 表不開放直接讀寫，登出時呼叫 `presence_leave`；`npm run test:online-presence` 把關。品牌列由 `theme.js`／AppShell 自動產生。
- **系統標題**由 `AppShell` 自動插入 `SystemPageHeader`：距頂列 22px、26px、`var(--cyan)`（=`--primary`）、Logo 固定
  42×42px 且來源只能是 `modules.ts` 的 `icon`；內容區左右內距桌面 24px／手機 14px。工作區不得再手寫系統級 `<h1>`，
  功能區標題只用 `<h2>` 以下。
- **內容寬度**只有一個來源 `--content-width`（`tokens.css`，桌面 85% 置中、≤760px 滿版）。子系統頁不得各自設定寬度或
  `max-width`；`test:page-headings` 會擋 `.operations-page`、`.v1list-page` 重新加上寬度。
- **系統入口卡片**一律 269×200px 並置中，窄版恢復彈性寬度、禁止水平溢出。維修／派工入口另有 7 張統計小卡與 3 張流程主卡，
  駐衛警入口 4 張、交接紀錄入口 7 張，規格同上。
- **三個全螢幕圖資工具頁**（`structuremap/floor2d`、`structuremap/floor3d`、`guardpatrol/map3d`）是唯一版型例外：
  不套 AppShell，使用 `data-system-page-heading="compact"` 緊湊頂列，仍須顯示系統 Logo、主題色與模組名稱。
- **登入頁**：白色登入卡以 430px 基準縮放 80%（實際 344px），`100svh` 不得出現捲軸；帳號申請卡排除縮放。
- **手機版**：頁首操作按鈕靠右（`AdminHeader` 的 800px 斷點已涵蓋全站，不要逐頁加）；表格 ≤640px 自動卡片化
  （`.responsive-table`）；不得用 `style={{}}` 排版（media query 蓋不過）；圖示 ≤320px 且 Logo ≤200KB。
- **跨系統一致性**：不得為某個系統自訂另一套頁首、卡片尺寸、按鈕或顏色。需要新版型先改共用元件／本檔，再改頁面。

## 5. 色彩與主題（單一正本：`web/app/tokens.css`）

- **兩個主題**：科技版（`:root`，深色）與一般版（`:root[data-theme="light"]`，預設）。切換鈕是右下角浮動圖示，由根
  `layout.tsx` 掛載，兩版共用 localStorage 鍵 `siteTheme`。新頁面不必也不該自己做切換。
- **所有顏色用 token**。核心 token 只在 `tokens.css` 定義，且兩個主題都要有值；其他 CSS／TSX 不得重新宣告。
- **全站只有一個品牌主色 `--primary`（舊名 `--cyan`）**。系統之間不用顏色區分，只靠 Logo 與名稱；
  綠／黃／紅／紫只表示狀態語意。`modules.ts` 的 `tone` 欄位已停用，不得再用它改卡片顏色。
- 角色對照：

| 用途 | token |
|---|---|
| 頁面底／卡片／次卡片 | `--bg`／`--panel`（`--surface`）／`--panel2`（`--surface-soft`、`--surface-muted`、`--surface-deep`） |
| 邊線 | `--line` |
| 主文字／次要文字 | `--text`（`--ink`）／`--dim`（`--muted`） |
| 品牌主色、其上文字 | `--primary`（`--cyan`）、`--on-primary` |
| 實心色塊上的白字 | `--on-solid` |
| 狀態色 | `--green`（正常）、`--amber`（注意）、`--red`（異常）、`--violet`；文字用 `--green-text`、`--danger-text`、`--info-text` |
| 淡底／邊框 | `--info-soft`／`--info-border`、`--ok-*`、`--warn-*`、`--danger-*`、`--accent-*`、`--pink-*` |
| 當班標示（交接簿專用） | `--live`、`--live-ink`、`--live-solid` |
| 中性色階（科技版自動反轉） | `--n-0`…`--n-900` |
| 陰影／遮罩 | `color-mix(in srgb,var(--shadow-ink) 16%,transparent)`、`--scrim` |
| 固定白底（驗證碼、QR、列印預覽） | `--paper`、`--paper-ink` |

- **允許的色碼例外**（`tools/color-token-check.mjs` 白名單）：`@media print` 與紙本報表（`.hs-report*`）固定白底黑字、
  選擇器含 `data-theme` 的主題專屬覆寫、`.theme-toggle`、第三方 vendor CSS、資料視覺化檔案（圖表系列色、3D／圖面標記、
  條碼 SVG，名單在該檢查的 `ALLOW_TSX`）。**其他地方寫 hex 會讓 `npm test` 失敗。**
- 需要新顏色：先找語意 token；沒有就在 `tokens.css` 兩個主題一起新增並在上表補一列。
- 淡底用 `color-mix(in srgb, var(--primary) 8%, transparent)`，不寫 `rgba()` 深色調色盤。低透明（≤0.15）tint 與黑／白遮罩可用 `rgba()`。
- 在「建場景／開圖當下」讀 `data-theme` 的程式（three.js、OpenSeadragon）必須監看屬性並重建，見 `docs/DOMAIN_RULES.md` 圖資章節。
- 改完樣式先用 `data-theme="light"` 檢查文字對比 ≥ 4.5:1，再切科技版檢查。

## 6. 共用元件標準（不得另做第二套）

- **按鈕**：`.primary-btn`（主要）、`.secondary-btn`（中性／返回）、`.danger-btn`（刪除／停用），緊湊版加 `.compact`；
  幾何、hover、disabled、focus 全在 `web/app/button-standard.css`。`.btn`、`.btn-primary`、`.btn-danger` 為舊名別名。
- **表單欄位**：一般 input／select 桌面、平板、手機一律 `--form-control-height: 42px`（`control-standard.css`，僅 screen）。
  例外：textarea、checkbox／radio、file／hidden／range／color、原生日期時間欄位、列印版。
- **日期／時間**：一律 `@/components/LocalizedDateInput`、`LocalizedDateTimeInput`、`TimeSelect`（30 分鐘級距，24 小時制）；
  禁用原生 `date`／`datetime-local`／`time`（`security:audit` 會擋）。格式 `YYYY-MM-DD`、`YYYY-MM-DD HH:mm`。
  **例外：公務車派車管理系統（SYS-07）的時間一律用「上午／下午」12 小時制**（使用者 2026-10-28 指定）：
  共用元件加 `hour12`（只改選項文字，值仍是 24 小時制 `HH:mm`），顯示用 `@/lib/clock-format`；
  逾期判斷、表單預設值等比較邏輯一律用 24 小時制字串。其他系統不受影響。
- **下拉選單**：允許空值的欄位第一列用 `BlankSelectOption` 產生真正空白值；人員清單一律經 `selectableActiveUsers()`；
  表格篩選用 `<input list><datalist>` combobox，選項顯示在地化標籤。
- **指標卡**：`MetricCard`，`tone` 為封閉集合 `cyan|green|amber|violet|red`（狀態語意，不是系統識別色）。
- **狀態碼不得露出**：英文 enum 一律經 `Record<string,string>` 標籤表轉繁中；資料庫欄位名不得出現在畫面。
- **電子交接簿**（機電課、業管組、駐警隊）共用 `handover-sheet.css`／`.tsx` 的 `hs-*` 版型，各簿只放自己特有的區塊，
  不得重新定義 `hs-*` 外觀或自備圖示表；紙本列印區（A4）才可各自覆寫。`test:handover-style` 把關。
- **報修統計卡**只在 `app-api` 的 `repairRequestSummary()` 定義一次，前端不得另算。
- **戰情元件不得顯示模擬數字**：元件清單正本是 `web/lib/dashboard-widget-catalog.ts`（後台戰情版面設定與電視牆共用），
  統計口徑在 `web/lib/dashboard-metrics.ts`（戰情儀表板、電視牆、版面預覽共用），資料載入在 `web/lib/dashboard-live-data.ts`。
  沒有資料來源的元件標 `dataSource: 'unavailable'`，畫面只顯示「尚未介接資料來源」；`desc` 必須寫實際顯示的內容。
  `test:dashboard-metrics` 會擋下計時器／亂數產生的數字，以及缺少實作的元件。

## 7. 資料、權限與安全（摘要；細則見 `docs/DOMAIN_RULES.md`）

- 資料只增、改、停用：不 reset 資料庫、不 truncate、不實體刪除人員（`status='inactive'`）。RLS 於 production 強制啟用。
- **看板只顯示明確標記給看板的公告**（`notifications.event='board_notice'` 且不指定收件人；登入版與公開版相同）。
  通知中心的資安告警、監控異常、派車提醒與個人通知屬內部資訊，依最小揭露與知悉必要原則（ISO/IEC 27001 A.5.15、A.8.3）
  不得投到看板或任何大螢幕；要讓內部資訊可被看見，必須由具權限者另行發布為看板公告。`tools/board-notices-check.mjs` 把關。
- **資安告警只在 `security_alerts` 留內容**：通知中心只放提示與告警編號，不複製 IP、資源、事件數；副本保存 90 天。
  證據資料表（`security_alerts`、`security_alert_deliveries`、`security_session_blocks`）維持 append-only，不得解除防刪除 trigger。
  詳見 `docs/SECURITY_RECORD_RETENTION.md`；`npm run test:security-notice-minimal` 把關。
- **權限判斷失敗即拒絕**：權限表查詢失敗一律不放行（`test:permission-fail-closed`）。
- 新 API 寫進 `supabase/functions/app-api/handlers/<業務>.ts`，不再加進 `index.ts`；每支 handler 附 `*.test.ts`。
- 讀取稽核由根版面的 `access-audit.ts` 統一攔截 fetch，頁面不得自行補呼叫；`security_action` 回應必須強制登出。
- 新增／改動資料表欄位：`create table if not exists` 不會 alter，必須補 `alter table … add column if not exists`。
- 樓層命名 `B1F` 與 `B1` 要以 `canonicalFloor()` 對齊。

## 8. 驗證指令

| 目的 | 指令 |
|---|---|
| 全部 | `npm test`（於 C 執行副本） |
| 型別 | `npm run typecheck:v2` |
| 色彩 token 守門 | `npm run test:color-tokens` |
| 版型／標題 | `test:page-headings`、`test:module-card-standard`、`test:button-standard`、`test:handover-style`、`test:login-layout` |
| 表單／字型 | `test:input-select-standard`、`test:font-tokens`、`test:css-source-balance` |
| 資安 | `security:audit`、`test:permission-fail-closed`、`test:schema-contract` |
| Claude Code hook | `node .claude/hooks/hooks.test.mjs` |

未在瀏覽器實測的視覺項目（A4 實際列印、字體、responsive、科技版對比）一律標「未驗證」。

## 9. Git、部署與紀錄

- 預設分支 `main` 由 GitHub Pages／workflow 部署；commit、push、deploy 是三個獨立動作，只在當次明確授權時執行。
- Edge Functions 由 `.github/workflows/deploy-edge-functions.yml` 在 push 後自動部署（此為機制說明，不構成授權）。
- 不主動開 PR。保留無關的工作樹修改。
- 完成工作並驗證後，在 `Obsidian/04-開發與部署.md` 追加日期、變更摘要、驗證結果；待辦變更同步 `Obsidian/05-待辦清單.md`；
  進度寫入 `PROJECT_PLAN.md`，交接寫入 `handoff.md`。Obsidian 與文件不得寫入任何 Secret。
