# PROJECT_CONTEXT — 臺北農產 第一果菜市場 設備巡檢 / 報修派工系統

> 給後續開發者 / AI 代理的專案脈絡文件。每次接手前請先讀本檔，避免重複踩雷。

---

## 1. 專案概述

- **業主**：臺北農產運銷股份有限公司 — 第一果菜市場
- **性質**：純前端（多頁 HTML）＋ Supabase 後端的設備**巡檢 / 報修 / 派工 / 維修**管理系統，含樓層平面圖與 3D 立體模型。
- **UI 風格**：Cyberpunk 深色霓虹主題。核心色票：
  - `--bg:#020b18`、`--panel:#041428`／`#05101e`、`--border:#0c2840`／`#0a3a5a`
  - `--cyan:#00d4ff`（主色，發光）、`--green:#00ff9d`、`--amber:#ffb300`、`--red:#ff3b3b`／`#ff5470`
  - 字型：`Noto Sans TC` + `Rajdhani`（標題）
- **語言**：介面全繁體中文。

### V2 系統子頁標題設計標準

- 適用範圍：9 大系統、49 個子系統；一般頁面由 `web/components/SystemPageHeader.tsx`
  與 `AppShell` 統一產生，資料來源是 `web/lib/modules.ts`。
- 幾何：標題文字頂端距共用頂列底部 22px；系統 Logo 42×42px；系統標題 26px。
- 水平對齊：桌面內容區左右 24px，Logo 左緣與內容對齊；42px Logo 加 14px 間距後，
  一般滿寬桌面的標題文字左緣為 80px。手機內容區左右 14px，標題文字左緣為 70px。
- 色彩：標題使用 `var(--cyan)`，說明與代碼使用 `var(--dim)`，因此一般版與科技版會
  自動取得正確對比，不得改成固定 RGB／HEX 文字色。
- 內容：依序顯示系統名稱、系統代碼＋子系統名稱、子系統說明；Logo 一律使用該系統
  在模組定義內的正式 `icon`。頁面內其他功能名稱從 `<h2>` 開始。
- 全螢幕例外：平面樓層圖、3D 模型圖、立體巡檢雲臺使用圖面頂列的緊湊標題版，仍保留
  對應 Logo 與模組名稱，但不在圖面上方另占 22px 內容列。
- 交接紀錄首頁例外：`/v2/systems/handover/` 直接載入 `records`，大標題顯示「交接紀錄」、
  識別行顯示「SYS-04 · 電子交接簿」；其餘幾何與配色仍由 `SystemPageHeader` 統一控制。
- 駐衛警入口：`/v2/systems/guardpatrol/` 使用共用標題與系統定義說明；桌面四張功能卡
  寬、高、內距、圖示與文字比例縮為原設計約 80% 並置中。瀏覽器縮放／視窗變窄時，
  依可用 CSS 寬度自動改為 4／2／1 欄，1100px 以下恢復滿寬且不得產生水平溢出。
- 防回歸：`npm run test:page-headings` 會確認 9／49 數量、標準 token、Logo 存在與
  46 個一般頁首＋3 個全螢幕緊湊頁首的覆蓋。

---

## 2. 部署 / 環境

- **前端**：GitHub Pages，**從 `main` 分支自動部署**（workflow：`pages build and deployment`）。
  - 網址基底：`https://jnfakimo.github.io/word-cloud/system/<page>.html`
  - 倉庫：`jnfakimo/word-cloud`
- **後端**：Supabase（PostgreSQL + PostgREST + Auth + Storage）
  - Project ref：`qztffronusdhgxhjjubt`
  - URL：`https://qztffronusdhgxhjjubt.supabase.co`
  - 前端用 **anon key** 直連（各 HTML 內硬編 `SUPA_URL` / `SUPA_KEY`）。
  - RLS 目前多為 `allow_all_for_now`（開發階段全開）。
- **Storage buckets**：`floorplans`（樓層平面圖 PNG）、`repair-files`（報修附件）。
- **Edge Function**：`supabase/functions/line-notify/`（LINE 通知）、`supabase/functions/cwa-weather/`（中央氣象署資料代理與快取）。
- **驗證限制**：本開發環境的外連 proxy 會擋 CDN / github.io 的直接 curl（回 000/403）。
  **無法用 curl 驗證線上頁面**，改用：`node --check` 語法檢查 ＋ GitHub Actions 部署狀態（`mcp__github__actions_list`）。

---

## 3. 技術棧（全部走 CDN，無建置步驟）

| 用途 | 函式庫 |
|---|---|
| 後端 SDK | `@supabase/supabase-js@2` |
| 2D 平面圖深縮放 | OpenSeadragon 4.1.0（DZI 磚圖 / Storage image） |
| 3D 立體樓層 | Three.js r128 |
| XLSX / CSV 匯入匯出 | SheetJS `xlsx@0.18.5`（`aoa_to_sheet` / `sheet_to_json` / `writeFile`） |
| 圖表 | Chart.js |
| QR Code | qrcodejs |
| 平面圖產製（離線） | Python：ezdxf（解析 DXF）、matplotlib（渲染）、PIL（bloom/tiling） |

---

## 4. 頁面清單（`system/*.html`）

> 根目錄另有 `index.html`／`admin.html`／`app.html`／`maintenance.html` 為舊入口，實際系統在 `system/`。

**入口 / 核心**
- `index.html` — 系統入口　`login.html` — 登入　`setup.html` — 系統初始化
- `app.html` — 巡檢系統　`admin.html` — 後台管理（左側選單為各子系統樞紐）

**報修派工管理系統（P1–P6，企業級 14 模組規劃的已完成部分）**
- `workorder.html` — 報修系統（新增報修、派工、案件流程）
- `dashboard.html` — 戰情儀表板　`analytics.html` — 統計分析
- `equipment.html` — 設備建置與生命週期（XLSX 匯入匯出、保養、履歷、合約、文件、成本、中央監控介接）　`rbac.html` — 權限管理 RBAC
- `vehicle-dispatch.html` — 公務車派車管理（申請、主管核可、車管派車、司機行車與里程／加油回報）
- `notices.html` — 通知中心　`api.html` — 整合 API 文件
- `maintenance.html` — 舊維修管理（已被 `workorder.html` 取代，導覽一律指向報修系統）

**場域 / 樓層 / 3D**
- `locations.html` — 場域位置管理（市場→樓層→區域→細節階層樹，可收合）
- `arealist.html` — **區域位置表**（各樓層平面空間名稱；兩欄「樓層／空間名稱」；XLSX/CSV 整筆匯入匯出）
- `b1plan.html` — 樓層平面圖（B1/1F/2F/3F，OpenSeadragon 自由平移縮放旋轉）
- `b1_integrated_marker_system.html` — **整合標記系統**（在平面圖上放置設備/空間/報修點/一般標記，隨圖縮放旋轉）
- `floor3d.html` — 3D 立體樓層模型　`inspection3d.html` — 3D 巡檢地圖
- `modeler.html` — 3D 模型建模系統（上傳 DXF → 產生平面圖 + 3D）
- `handover.html` — 電子交接簿

---

## 5. 資料庫 SQL（`system/sql/`）— 執行順序

所有 SQL 皆設計為 **idempotent（可重複執行）**：用 `create table if not exists`、`add column if not exists`、`drop policy if exists` 後再 create。

於 Supabase SQL Editor 依序執行：

1. `schema.sql` — 核心表（equipment / inspection_records / repair_requests / maintenance_orders …）
2. `locations_schema.sql` — markets / locations / departments（自動 seed 第一、第二市場）
3. `work_order_schema.sql` — 報修派工擴充（req_no/wo_no 自動編號、case_status_log、roles、role_permissions、notifications、repair-files bucket）
4. `floor_models.sql` — 樓層平面圖模型表（供 b1plan / floor3d / marker 讀底圖）
5. `handover_schema.sql` / `handover_cases.sql` — 電子交接簿
6. `floor_spaces.sql` — **區域位置表**（各樓層平面空間名稱）
7. `plan_markers.sql` — **整合標記**（外鍵參照 equipment / floor_spaces / repair_requests，故須在 6 之後）
8. `material_master.sql` — 材料與備品主檔
9. `equipment_lifecycle.sql` — 設備生命週期、保養、履歷、合約、文件、成本與中央監控介接
10. `patrol_shifts.sql` / `checkin_logs.sql` — 駐衛警班別與簽到紀錄
11. `rls_hardening.sql` / `rls_hardening_login_fix.sql` — 正式環境權限
12. `auth_profile_recovery.sql` — 修復 Auth 已註冊但 `users` 清單缺資料的帳戶同步
13. `dashboard_layouts.sql` — 動態戰情儀表板版面、不可變版本、發布／還原 RPC 與預設版面
14. `weather_integration.sql` — 中央氣象署 API 快取（API 金鑰只放 Edge Function Secret）
15. `vehicle_dispatch.sql` — 公務車主檔、派車申請、四階段流程與不可覆寫歷程
16. `permanent_data_protection.sql` — **最後執行**；禁止實體刪除/清空並建立人員異動快照

輔助 / 修補：`dept_rebuild.sql`、`org_update.sql`、`repair_request_timeout_fix.sql`。
`dept_rebuild.sql` 現為安全增量同步，不會清空人員部門或刪除既有部門。

**永久保存原則**：正式資料只能新增、修改或設為 `inactive`，不可重建資料庫、
`TRUNCATE` 或實體 `DELETE` 人員與業務歷程。所有人員異動會寫入 `users_history`。

**⚠️ 新增/改欄位時**：若表已存在，`create table if not exists` 不會補欄位 → 必須另外寫 `alter table ... add column if not exists`（見 `plan_markers.sql` 的 `repair_id` 範例）。

### 動態戰情儀表板擴充規則

- `dashboard-builder.html` 提供拖拉、縮放、顯示／隱藏、草稿、發布與歷史版本還原。
- `dashboard-layout.js` 是圖塊註冊表與預設版面的唯一來源；日後新增圖塊時，在此註冊一次，後台元件庫與前台會同步識別。
- 舊版面缺少新註冊圖塊時，`DashboardLayout.normalize()` 會自動以預設位置補入，無須重建資料表；管理員下次發布時即寫入新版本。
- 資料庫只保存允許的 `widget_key`、標題、位置、尺寸及設定，不保存或執行任意 HTML、JavaScript 或 SQL。
- `weather_taiwan` 圖塊透過 `cwa-weather` Edge Function 讀取中央氣象署資料；完整啟用步驟見 `system/WEATHER_SETUP.md`。

---

## 6. 關鍵慣例 / 已知雷點

- **樓層命名不一致**：區域位置表匯入資料常見「B1F/1F」，平面圖系統用「B1/1F/2F/3F」。
  跨系統比對樓層時請用正規化：`B1≈B1F`、`1F≈1`、`RF≈頂樓`
  （參考 `b1_integrated_marker_system.html` 的 `canonicalFloor()`）。
- **市場**：主要使用 `market1`（第一市場）、`market2`（第二市場）；其他舊市場只停用、不刪除。
- **標記座標**：`plan_markers` 存 OpenSeadragon viewport 正規化座標（x,y），才能隨圖縮放/旋轉對位。
- **平面圖對位**：B1/1F/2F/3F 用同一 world frame 與像素網格疊放，故可上下層對齊。
- **報修表單**（workorder 新增報修）現況：聯絡人/單位/電話自帳號自動帶入、手機必填、無「設備」欄、故障位置為自由文字、故障位置照片必填、希望完成日期為「點選年月日」。

---

## 7. 開發 / Git 流程（多代理並行）

- **本專案常有多個 AI 代理同時對 `main` 推送** → 直接 push 易被 non-fast-forward 打回。
- 標準流程：
  1. `git fetch origin main && git reset --hard origin/main`（或 rebase）取最新
  2. 編輯 → `node --check`（或 vm.compileFunction 驗證內嵌 JS）
  3. `git commit` → `git rebase origin/main` → `git push origin main`
  4. 同步指定開發分支：`git branch -f <branch> HEAD && git push origin <branch> --force-with-lease`
- 指定開發分支：`claude/system-implementation-gjoi5k`
- **勿在未經允許下開 PR。**

### 業主的長期指示（standing instructions）
- **「有關連一併修正」**：改動某系統時，所有相關系統要一起更新（例：改導覽名稱、共用資料表、樓層對應）。
- **一次只用一個 AI**（避免並行衝突）。
- **全站系統狀態列為必要功能**：所有現有頁面及日後新增頁面都必須載入 `system/theme.js`。共用狀態元件固定置於表頭最右側，且順序與形式統一為「部門單位｜登入者姓名」→「系統連線狀態」→「台北時間 `YYYY-MM-DD HH:mm:ss`」。表頭功能按鈕必須緊接在登入者資訊左側，由右向左依頁面既定順序排列，不可用自動邊距在按鈕與登入者資訊之間產生大段空白。登入資料優先讀取 `sessionStorage` 的 `user_department`、`user_dept_id`、`user_name`；只有部門編號時由共用元件查詢 `departments` 並組成完整部門路徑。共用元件會優先掛入 `.topbar-right`、`.nav-right`、`.navbar`、`.topbar` 或 `#topbar`；不得保留或自行建立不同位置、順序、格式的重複使用者／狀態／時鐘欄位。
- **全站表頭功能按鈕由共用元件管理**：`system/theme.js` 固定建立「首頁」→「戰情儀表板」→「維修/派完工」→「駐衛警巡檢」→「後台」五個按鈕，不另行顯示「完工回報」按鈕。「維修/派完工」固定連至 `https://jnfakimo.github.io/word-cloud/system/admin.html?v=8f9d41c#repairs`，使用 `assets/system-icons/maintenance-icon.png`。共用按鈕不得使用 `system/icons/nav-*` 圖示，不得重新生成、重繪、修改或替換既有 PNG，也不得再以 emoji 或文字符號建立另一套。頁面專用功能按鈕可保留在共用按鈕左側。此 ICON 樣式、順序及共用元件實作列為鎖定規範，未經使用者明確要求變更此標準，不得再更換。
- **修正完成後直接發佈**：每次完成並驗證使用者要求的修正後，只提交該次相關檔案並直接 push 到 `origin/main`；不納入任何無關的既有工作區變更。

---

## 8. 快速接手檢查清單

- [ ] `git fetch origin main && git reset --hard origin/main`
- [ ] 需要新表/欄位？在 `system/sql/` 寫 idempotent SQL，並提醒業主到 Supabase 執行
- [ ] 改完頁面用 `node --check` 驗證內嵌 JS
- [ ] 新增或修改頁面時，確認已載入 `theme.js`，且頂部可見「系統連線狀態＋部門單位與登入者姓名＋日期時間」共用元件
- [ ] 部署後用 `mcp__github__actions_list` 確認 `pages build and deployment` 為 success（無法 curl 線上頁）
- [ ] 有跨系統關聯時，落實「有關連一併修正」

---

## 9. 收工紀錄

### 2026-07-15｜2026-07-15-V0012 主程式版本

**本次完成**

- 暫停巡檢與設備材料管理功能：移除首頁、後台、五大系統及跨頁快速入口；`app.html`、`materials.html` 直接網址改至封存提示頁，既有資料不刪除。
- 建立全站共用表頭資訊元件（`system/theme.js`）：固定顯示「部門單位｜登入者姓名」→「系統連線狀態」→「台北日期時間」。
- 登入者只有 `dept_id` 時，自動查詢 `departments` 並組成完整部門路徑；未設定部門與未登入狀態皆有明確提示。
- 統一後台、戰情儀表板、報修系統、完工回報及其他頁面的狀態元件位置與形式；表頭功能按鈕緊接登入者資訊左側，不保留大段空白。
- 全站 HTML 已更新 `theme.js?v=20260715-5`，避免瀏覽器沿用舊版快取。
- GitHub Pages 發布來源為 `main`，本次功能與版型已部署完成。

**驗證結果**

- `node --check system/theme.js` 通過，`git diff --check` 通過。
- 掃描正式頁面確認共用元件皆由 `theme.js` 載入。
- 使用本機 Edge 無頭模式驗證表頭版型；「後台」按鈕與登入者資訊間距為 20px，排列順序正確。
- 線上 `admin.html`、`dashboard.html`、`workorder.html`、`repair.html` 均已載入快取版本 `20260715-5`。
- 敏感資料掃描未發現新增的 GitHub Token、OpenAI Key、私鑰或明文密碼。

**已知注意事項／踩坑**

- `querySelector('.topbar-right,.navbar,...')` 會依 DOM 出現順序選取，不會依選擇器書寫順序；共用元件必須用逐項 `||` 查詢，優先掛入 `.topbar-right`，否則會造成按鈕與登入者資訊間出現大空白。
- 修改 `theme.js` 後必須同步提高所有 HTML 的查詢版本參數，否則 GitHub Pages/CDN 或瀏覽器可能仍顯示舊版。
- 舊頁面的 `#navUser`、`#topClock`、`#clock` 與連線燈由共用元件隱藏；新增頁面不可再建立另一套可見資訊列。

**下一步**

- 以實際登入帳號抽查各部門階層名稱是否完整顯示，特別是第一層／第二層部門路徑。
- 以手機與平板實機檢查窄版表頭換行；必要時只調整共用 `theme.js`，不要逐頁覆寫。
- 巡檢或設備材料管理修正完成後，恢復功能前須同步檢查首頁、後台、五大系統、登入導向及直接網址。

### 2026-07-15｜2026-07-15-V0013 主程式版本

**巡檢系統重新開放**

- 重新啟用 `app.html` 巡檢主程式，以及 `guardpatrol.html` 駐警隊巡檢系統。
- 恢復首頁「駐警隊巡檢系統」卡片、後台表頭與側欄入口、五大系統巡檢按鈕及跨系統快速入口。
- 恢復巡檢登入導向、巡檢記錄與週期管理、3D 駐警巡檢、班別排程、巡邏點清單及 QR 簽到返回流程。
- `materials.html` 設備材料管理維持封存，不因本次巡檢開放而恢復。
- 巡檢相關頁面持續載入全站共用 `theme.js?v=20260715-5`，表頭狀態元件規範不變。

**驗證結果**

- 巡檢主程式內容與封存前版本一致，僅保留最新版共用狀態元件快取參數。
- 巡檢相關頁面已移除 `inspection-archive.js`，且登入導向不再指向 `inspection-archived.html`。
- 13 個主要頁面的內嵌 JavaScript 語法檢查通過；本機瀏覽器確認駐警巡檢未登入時正確導向 `login.html?redirect=guardpatrol.html`。

### 2026-07-15｜2026-07-15-V0014 主程式版本

**巡檢功能範圍修正**

- 關閉的是 `app.html`「設備巡檢系統」，全站表頭、共用導覽與跨系統快速入口不再顯示「巡檢」按鈕。
- `guardpatrol.html`「駐衛警巡檢系統」維持啟用；首頁系統卡片、後台側欄、3D 巡檢、班別排程、巡邏點清單及 QR 簽到功能全部保留。
- 巡檢權限帳號的預設登入頁改為 `guardpatrol.html`；只有直接要求 `app.html` 時才導向設備巡檢關閉提示頁。
- 關閉提示文字明確區分兩套系統，並提供「駐衛警巡檢系統」入口，避免誤認為駐衛警功能也被關閉。
- `materials.html` 設備材料管理仍維持封存。

### 2026-07-15｜2026-07-15-V0015 主程式版本

**全站共用表頭圖示統一**

- `system/theme.js` 新增共用表頭功能按鈕元件，固定顯示「戰情儀表板」→「報修系統」→「完工回報」→「後台」。
- ICON 以業主三張截圖及 `admin.html` 既有表頭為準：戰情儀表板與後台使用藍色 `assets/system-icons/admin-icon.png`；報修系統與完工回報使用黃色 `assets/system-icons/maintenance-icon.png`。
- 本次只引用上述既有圖檔，未重新生成、重繪或修改任何 ICON；後續不得改用 `system/icons/nav-*`、emoji、文字符號或重新產生的圖片。
- 共用元件會自動移除舊的重複全站導覽，保留頁面專用功能按鈕，並標示目前所在頁面。
- 此四個 ICON 樣式、順序與共用元件實作已定版；未經使用者明確要求變更此標準，不得再更換。
- 27 個 HTML 頁面統一更新為 `theme.js?v=20260715-6`，避免瀏覽器沿用舊快取。
- 已以瀏覽器驗證 `repair.html`、`equipment.html` 與代表性表頭：四個按鈕順序、截圖指定彩色 ICON、登入者、連線狀態及台北時間排列正確。

### 2026-07-15｜2026-07-15-V0016 主程式版本

**登入頁整體縮放與狀態列溢出修正**

- `system/login.html` 整體畫面固定以 70% 顯示，包含登入卡片與共用狀態列，避免高 DPI 或瀏覽器縮放時版面超出視窗。
- 新增正常文件流的 `.topbar` 容器承載共用狀態元件，不再使用右上角浮動 fallback，並限制水平溢出。
- 保留 `theme.js?v=20260715-6` 共用彩色 ICON 快取版本；登入導向仍維持 `app.html` 設備巡檢關閉、`guardpatrol.html` 駐衛警巡檢啟用。

### 2026-07-15｜2026-07-15-V0017 主程式版本

**新增帳號表單三欄版型**

- `system/admin.html#users` 的新增帳號欄位依資料長度調整：姓名與初始密碼較短，登入帳號與聯絡電話為中等寬度，電子郵件與第一層部門使用較長欄位。
- 欄位順序固定為「姓名、登入帳號、電子郵件」→「初始密碼、聯絡電話、第一層部門」→「第二層部門、角色」。
- 桌面版每列最多三個欄位，中等寬度自動改為兩欄，手機版改為單欄；既有欄位 ID、部門連動、角色權限與建立帳號流程不變。

### 2026-07-15｜2026-07-15-V0018 主程式版本

**後台維修流程入口整併**

- 後台左側原有「報修 & 維修」、「派工系統」、「維修完工」三個選單整併為單一「維修/派工/完工系統」入口。
- 右側入口頁新增「報修 & 維修」、「派工系統」、「維修完工回報」三張流程圖卡，分別連結 `workorder.html`、`dispatch.html`、`repair.html`。
- 沿用既有彩色維修 ICON，不重新生成圖示；原後台報修與維修案件總覽保留在圖卡下方。
- 三張圖卡於桌面版並排顯示，窄螢幕自動改為單欄，既有報修、派工與完工功能網址及資料流程不變。

### 2026-07-15｜2026-07-15-V0019 主程式版本

**首頁維修系統入口同步**

- `system/index.html` 的「維修管理系統」圖卡更名為「維修/派工/完工系統」。
- 圖卡入口由 `workorder.html` 改為後台整合入口 `admin.html#repairs`，先顯示報修、派工與維修完工三張流程圖卡。
- 沿用既有維修 ICON、圖卡色彩與說明文字，其餘首頁系統圖卡不變。

### 2026-07-15｜2026-07-15-V0020 主程式版本

**帳號管理 XLSX 報表視覺化**

- `system/admin.html#users` 的帳號匯出改為三工作表結構：「帳號清單」、「統計摘要」、「權限矩陣」。
- 帳號清單新增機構標題、台北匯出時間、帳號總數、啟用/停用摘要、資安提醒、欄寬、列高、自動篩選、交錯列色及狀態色彩。
- 統計摘要集中呈現帳號啟用率、角色分布、第一層部門分布及各功能授權人數；權限矩陣以綠色「是」與灰色「否」提高辨識度。
- 初始密碼仍依資安規範保持空白；批次匯入改為依欄位名稱定位資料，因此可同時讀取新版排版報表、舊版匯出檔與既有匯入範本。
- XLSX 引擎改為與 SheetJS 0.18.5 API 相容的 `xlsx-js-style@1.2.0`，以支援字型、底色、框線、對齊及數字格式輸出；其他 XLSX 匯入、範本及費用報表流程維持相容。

### 2026-07-28｜login.html 版面修正、dashboard.html 巡檢即時統計對齊

**注意：本篇與上一篇（V0020）之間有 13 天、約 200 個 commit 的落差未記錄**（IPCAM 即時監控、駐衛警排班/LINE 推播、巡邏點清單等大量功能都是在這段期間加入的，本次收工前才第一次同步到）。往後接手者請以 `git log` 為準，不要假設本檔案的版本號是連續的。

**本次完成**

- `system/login.html`：狀態列（尚未登入／連線狀態／時間）原本用 `position:fixed` 浮動定位，未定義 `--surface`/`--border` 等主題變數，導致淺色/深色主題切換時顯示成脫節的白色浮框，且在瀏覽器非 100% 縮放（實測 150%）時會造成版面橫向溢出。改為新增 `<header class="topbar">`，讓狀態列改走一般文件流，跟後台/戰情儀表板等其他頁面的做法一致，從機制上排除 fixed 定位在縮放下的量測誤差類問題。
- `system/dashboard.html`：「駐衛警巡檢即時」卡片原本用 `PatrolStatus.computeMatrix()` 加總當天*所有班別*的巡邏點狀態，跟 `guardpatrol.html`「當班即時統計」用 `PatrolStatus.compute()` 只算*當班*的邏輯不一致，數字對不上。已改成呼叫 `PatrolStatus.compute()`，只統計目前進行中的班別，無進行中班別時顯示「目前無進行中班別」，文字格式與 `guardpatrol.html` 統一為「當班即時統計｜班別 起訖時間」。

**驗證結果**

- `login.html`：本機起靜態伺服器，程式量測 `document.documentElement.scrollWidth` vs `innerWidth`，在 375px（手機）、1280px、1880px、1917px 寬度下皆無橫向溢出；深色/淺色主題下狀態列色彩與卡片一致。無法在本環境重現使用者回報的 150% 縮放場景，已改走一般文件流從機制上排除該類問題，待業主實機於 150% 縮放下複驗。
- `dashboard.html`：以 Node `vm.Script` 對三段內嵌 `<script>` 做語法檢查通過；邏輯以 `git diff` 逐行比對 `guardpatrol.html` 的 `renderDutyStats()` 確認欄位語意一致。因需要真實登入憑證與 Supabase 資料，未能在本環境用真實資料驗證畫面數字，待業主於線上比對兩頁數字是否一致。

**已知注意事項／踩坑**

- 本專案常有多個 AI/人工同時對 `main` 推送（本次收工前 `git fetch` 就發現本機落後 origin/main 約 200 個 commit）——**下次開工務必先 `git fetch origin main` 比對，不要假設本機是最新的**。
- `dashboard.html` 目前已內嵌 IPCAM 即時監視器（HLS 直播），有長串卡頓修復歷史，最新一次是同日稍早的 `c7e574f fix: recover stalled dashboard camera stream`；本次未再改動 IPCAM 相關程式碼，如果之後還有「影像卡住」回報，先確認是不是這次強化後的新狀況。

**下一步**

- 請業主實機確認 `login.html` 在 150% 瀏覽器縮放下不再跑版、`dashboard.html` 的「駐衛警巡檢即時」數字與 `guardpatrol.html`「當班即時統計」一致。
- 補齊 V0020 之後這段時間的重大功能（IPCAM、駐衛警排班/LINE 推播等）到本檔案，避免版本紀錄持續斷層。

### 2026-07-15 ～ 2026-08-04｜V0020 之後開發歷程補記（回填）

**說明**：上一篇提到 V0020（2026-07-15）到 2026-07-28 之間有 13 天、約 200 個 commit 未記錄。本篇以 `git log 5eda944..da3fa32 -- system supabase`（173 個 commit）為準回填，依主題整理重大功能與已知踩坑；細節可自行 `git show <hash>` 查閱。其中兩段期間已有較完整紀錄，本篇不重複，只互相參照：
  - 2026-07-19～07-20 駐衛警巡檢排班／LINE 推播 → 詳見 `PROJECT_NOTES.md`「2026-07-20 收工」
  - 2026-08-01～08-04 RBAC 權限、登入稽核、樓層動態清單、DXF 座標清理 → 詳見 `PROJECT_NOTES.md`「2026-08-04 收工」

**IPCAM 監視器整合（07-26～07-28）**

- `dashboard.html` 新增內嵌 IPCAM 即時監視器，串流架構在兩天內反覆換過至少五種做法：直接內嵌／JPEG 輪詢 → 透過 Supabase 代理 → 本機 RTSP→HLS 橋接 → 公開 tunnel（最終版，`0e4ccd5`），過程中疊了大量頻寬壓縮、CORS、自動重連、行動裝置 HTTPS 相容性修正。
- 最終穩定狀態：走公開 IPCAM tunnel，遇到直播卡死由 `c7e574f`（07-28）的自動偵測復原機制處理。**這塊改動密集，之後若再回報「影像卡住/看不到」，先確認是不是同一條 tunnel 斷線，不要又重新換一次串流架構。**

**樓層平面圖／3D 修正（07-17、07-27）**

- `b1plan.html` 平面圖改為按需載入單張圖、修正白天模式背景色錯誤（`c027d07`）；07-27 再修正 `1F/2F/3F` 貼圖檔名錯誤（`f3bfbc7`）、自訂 Storage 模型 404 時自動退回靜態貼圖（`fc4395b`）、支援雙指縮放並讓巡邏打卡狀態即時更新（`ed23a16`）。
- 手機版 3D 巡檢：降低模型記憶體用量、修正一般版黑線顯示、改善載入卡住與相容性（07-17～07-18 一系列 commit）。
- 新增 `structure_map.html` 互動式專案關係地圖並掛上選單／側欄導航（`d3bcf27`，07-17）。

**維修／報修頁面命名整併（07-15～07-16，反覆多次）**

- 這段時間對「報修」頁面的命名與版型改了又改：`repair`→`repairs` 改名、一度改名為「maintenance mode」又被 revert、再 reapply（`e49c31d` → `9a1af87` revert → `c01d0f2` 重新套用），共用導覽也修過又被 revert 一次（`c174eb3` → `b2d2acd` revert）。
- 最終落地：Amber 主題、無後台外殼的維修入口頁（`171e675`、`89f1d8e`、`8f9d41c`），登入後會保留原本要去的報修目的地（`b289847`）。**這段命名史很亂，之後若要再動報修頁面命名，先用 `git log --oneline -- system/repair*.html system/workorder.html` 確認目前真正的檔名/入口，不要假設回到某個舊名稱。**

**全站導覽整併與版面（07-16～07-20）**

- 各頁管理模組收回父層（`e602273`）、頂部導覽加回首頁捷徑（`a03a281`、`3ab79f6`）、駐衛警與後台導覽順序調整、後台側欄版型多次微調（`c3976ee`、`bd6c5fd`、`c10788f` 等）。
- 登入頁下方新增資訊列又移除邊框調整了三次（`9a4b5db`→`82cc9a5`→`783710f`），登入卡片/Logo 縮放為 75%（`e8924fc`、`3f8a6df`）。

**圖示／視覺風格統一（07-15～07-17）**

- 系統入口與子系統圖示大規模重繪：去背、Chroma key、數學色差去背、3D 玻璃擬物化風格反覆試了多輪（登出/整理/更改密碼圖示改了至少 5 次版本），最終加上快取破壞參數（`b986464`）避免瀏覽器沿用舊圖。
- 陸續移除多處不必要的按鈕圖示以簡化介面（停用按鈕、範本按鈕、編輯使用者彈窗、3D 視角控制文字前綴等），08-03 的 `6d0b260` 也屬同一方向的收尾。

**電子交接簿（07-17、07-30～07-31）**

- 07-17 先做了標題/區塊清理；07-30 限制交接簿頁面只保留交接相關功能（`00a72f9`）；07-31 新增獨立的交接簿登入頁 `handover-login.html`（`beb4c93`），08-04 併入 RBAC 權限閘門與共用導覽捷徑（見 PROJECT_NOTES.md 08-04 收工）。

**巡檢離線打卡與逾時診斷（07-17、07-19）**

- 新增巡檢離線打卡與自動補傳（`cdd2ee0`，07-17）；新增巡檢逾時安全診斷模式並修正排程與排班同步（`fd312e1`、`ae949ff`，07-19）。

**已知踩坑：這段期間有多次「整批復原」commit**

- `3966b43` Restore site to before 2026-07-15 23:00、`09dc536` Restore project to 2026-07-15 10:30、`eb0095d` Restore handover page to 2026-07-16 20:30——都是把整頁/整站復原到某個時間點的緊急回復，代表當時有改壞過。**這類 commit 訊息本身就是「事故紀錄」，之後排查詭異行為時，可以先查附近有沒有這種 Restore/Revert commit，比單看 diff 更快找到根因。**
- 這段期間本專案已確認由 Claude 與 Codex 兩個 AI 代理在兩個不同本機 clone（`AI\Claude\word-cloud` 與 `AI\Codex\北農人臉辨識系統\word-cloud-site`）並行開發，「一次只用一個 AI 代理」的規則在這段期間顯然沒有被嚴格遵守——這很可能是命名反覆改動、IPCAM 架構反覆更換的部分原因。
