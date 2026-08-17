# V2 全站遷移矩陣

V1（`system/*.html`）保留不刪除；V2（`web/app`）逐模組轉移，完成驗證後再將 V2 設為主要入口。

## 遷移原則

- V1 與 V2 共用既有 Supabase 資料與權限，不建立第二套資料。
- V1 在遷移期間持續可用，V2 頁面保留「V1 進階作業」備援連結。
- 每個模組需完成：列表、建立／編輯、狀態流程、附件（如適用）、權限、手機版與錯誤提示。

## 現況

| 系統 | V2 路由 | V2 狀態 | V1 備援 |
|---|---|---|---|
| 後台管理 | `/v2/systems/admin/` | 入口與資料列表 | `admin.html`、`rbac.html` |
| 維修／派工 | `/Inspection/v2/systems/workorder/` | **五個模組已完整搬移**（見下方） | `workorder.html`、`dispatch.html` |
| 駐衛警巡檢 | `/v2/systems/guardpatrol/` | 入口與模組列表 | `patrolcheckin.html`、`patrolshifts.html` 等 |
| 電子交接簿 | `/v2/systems/handover/`、`/v2/handover-pilot/` | 現場試用版與模組入口 | `handover.html` |
| 設備建置 | `/Inspection/v2/systems/equipment/` | **八個模組已完整搬移**（見下方） | `equipment.html`、`materials.html` |
| 專案關係／圖臺 | `/Inspection/v2/systems/structuremap/` | **六個模組已完整搬移**（見下方） | `b1plan.html`、`floor3d.html` 等 |
| 公務車派車 | `/Inspection/v2/systems/vehicle/` | **五個模組已完整搬移**（見下方） | `vehicle-dispatch.html` |
| 會議室預約 | `/Inspection/v2/systems/meetingroom/` | **四個模組已完整搬移**（見下方） | `meetingroom.html` |

> 路由前綴為 `/Inspection/v2/`（`web/next.config.ts` 的 `basePath`）。上表其餘各列的
> 「模組入口與資料列表」意指走 `app-api` 的 `module_data`——那是唯讀通用查詢，
> 只有列表沒有寫入。44 個模組全部都有 `MODULE_SOURCES` 設定，因此「有畫面」不等於
> 「已搬移」，判斷是否完成請看該模組有沒有專屬元件與寫入路徑。

## SYS-07 公務車派車（2026-08-17 完成）

`web/app/systems/[system]/[module]/vehicle-workspace.tsx` 承接五個模組：

| 模組 | V2 功能 |
|---|---|
| 派車申請 | 列表、搜尋、狀態篩選、分頁；新增申請；詳細頁含流程歷程；核可／退回／派車／接單／取消；司機行車回報 |
| 公務車輛 | 列表與搜尋；新增／編輯車輛（車號、車名、廠牌型號、座位、里程、狀態、備註） |
| 駕駛人員 | 名單、啟用／停用、從啟用中人員新增 |
| 派車管理員 | 同上（共用同一介面） |
| 派車紀錄 | 全域流程歷程，含申請編號與車號、狀態變更、操作人員 |

狀態轉移一律走既有資料庫函式，不在前端拼裝寫入：`vehicle_request_action`（核可／退回／
派車／接單／取消）與 `complete_vehicle_trip`（行車回報）。兩者皆為 security definer，
guard trigger（approval／assignment_and_driver／time_window）照常觸發，因此畫面上的
按鈕僅是操作提示，實際權限與流程判斷以資料庫回傳的錯誤為準。

注意：`sys_vehicle` 權限目前只開放給 `mgmt_supervisor` 與 `sysadmin`（見 `role_permissions`），
因此一般司機在 V2 進不了此系統。這是既有的權限設定問題，不是本次搬移造成的。

## SYS-08 會議室預約（2026-08-17 完成）

`web/app/systems/[system]/[module]/meeting-workspace.tsx` 承接四個模組：

| 模組 | V2 功能 |
|---|---|
| 會議預約 | 列表（今日與未來／我的預約／全部）、搜尋、狀態篩選、分頁；新增預約（含每週週期）；會議時段內報到；取消自己的預約；對他人預約提出變更申請 |
| 會議室主檔 | 列表與搜尋；新增／編輯（名稱、容量、樓層、狀態、備註），限管理者 |
| 變更申請 | 列表與狀態篩選；原預約申請人可同意讓出或婉拒 |
| 預約提醒 | 提醒與逾時通知紀錄，含發送狀態與 LINE 回應 |

寫入全部走既有伺服器端入口：`create_meeting_booking_series`（逐次檢查衝突後原子建立，
週期上限 52 次）、`cancel_own_meeting_booking`、`create_meeting_booking_change_request`、
`respond_meeting_booking_change_request`（同意時於單一交易取消原預約並改建立申請人的預約，
並自動婉拒同一時段其餘待審申請），以及 `app-api` 的 `meeting_check_in`、`meeting_save_room`。

前端只做即時提示：時段限 00／30 分（下拉選單直接限制）、結束需晚於開始、未登記電話時
聯繫電話必填且至少 4 碼。過去時段、時段衝突、報到時間區間等仍以資料庫與 API 的回應為準。

## SYS-05 設備建置（2026-08-17 完成）

`web/app/systems/[system]/[module]/equipment-workspace.tsx` 承接八個模組。八者結構高度相似，
因此以「欄位規格驅動」的方式共用同一套列表與表單引擎，各模組只描述自己的資料表、清單欄位
與表單欄位，避免八份幾乎一樣的程式碼：

| 模組 | 資料表 | V2 功能 |
|---|---|---|
| 設備主檔 | `equipment` | 列表、搜尋、分頁；新增／編輯 33 個常用欄位（識別、位置、規格、原廠與代理商、保固、保養、負責人） |
| 保養排程 | `equipment_maintenance_plans` | 依設備篩選；保養項目、類型、週期與間隔、負責人、上次／下次日期、狀態 |
| 維修履歷 | `equipment_maintenance_records` | 履歷類型、故障內容與原因、處理方式、更換零件、停機時數與各項費用 |
| 維護合約 | `equipment_contracts` | 廠商與聯絡人、合約編號與起訖、SLA 時數、金額、服務內容、狀態 |
| 設備文件 | `equipment_documents` | 文件類型、版本、有效與到期日、目前版本旗標、檔案網址（可直接開啟） |
| 年度成本 | `equipment_annual_costs` | 年度、來源、四類費用與自動合計 |
| 中央監控 | `equipment_monitor_events` | **唯讀**＋事件確認。事件由外部系統寫入，不提供人工新增 |
| 材料主檔 | `materials` | 材料編號與名稱、分類（下拉）、規格、廠牌型號、供應商、單價、狀態 |

寫入直接走資料表，與 V1 相同。這些表的 RLS 已同時要求 `has_system_access('sys_equipment')`
與 `has_app_permission('create')`／`('update')`，伺服器端把關存在；依
`ARCHITECTURE_V2.md`「第 3 條的實際落差」的判斷準則，再包一層 Edge Function 只會多一次
轉發而不會提高安全性，因此不另建 API action。

`created_by`／`updated_by`（設備文件為 `uploaded_by`）由前端於新增與更新時蓋章。

## SYS-02 維修派工（2026-08-17 補完最後兩個模組）

報修／派工／工單三個模組原本即有專屬實作（`workspace.tsx`）。本次補完剩餘兩個：

| 模組 | V2 功能 |
|---|---|
| 維修附件 | 附件索引：依類型與關鍵字篩選，帶出報修編號、故障說明與工單號；`repair-files` 是私有 bucket，以 `createSignedUrl` 產生 5 分鐘有效的簽章網址開啟 |
| 維修分析 | 九張報表＋五個 KPI，可選期間與快捷區間，匯出 .xlsx |

維修附件刻意唯讀：上傳本來就內含於報修建立與完工回報流程，此模組定位是索引；
且 `repair_attachments` 只有 select 與 insert 政策，沒有 update／delete。

維修分析的彙總方式（MTTR、平均派工時間、SLA 準時判定、各項排行）逐項沿用 V1
`analytics.html` 的公式，確保兩邊數字一致；另補上 V1 沒有的「急迫度分布」。
匯出統一為 .xlsx，ExcelJS 以動態 import 載入並經建置確認切成獨立 chunk，
不會出現在任何頁面的初始載入。

## SYS-06 專案關係與設備圖臺（2026-08-17 完成）

四個資料模組在 `structuremap-workspace.tsx`，兩個檢視器在 `structuremap-viewers.tsx`：

| 模組 | V2 功能 |
|---|---|
| 區域位置表 | `floor_spaces` 新增與編輯，樓層自動正規化並推導 floor_order |
| 整合標記 | `plan_markers` 屬性維護：名稱、類型、座標、顏色、關聯設備、狀態 |
| 平面樓層圖 | OpenSeadragon 檢視器，標記疊層可點選，支援點圖面重新定位並寫回 x／y |
| 立體樓層模型 | Three.js 堆疊樓層，貼圖化，標記以球體標示，可調層距與切換標記顯示 |
| 模型管理 | `floor_models` upsert（floor_id 為主鍵），bbox 以 JSON 編輯並驗證格式 |
| 專案關係 | `locations` 的樓層／區域結構檢視。**唯讀**——維護入口在後台的場域位置模組 |

檢視器的資產來源統一改為公開儲存桶 `floorplans` 的絕對網址（即 `floor_models.image_path`，
目前為 B1.png～RF.png）。V1 用的是相對路徑 `plans/tex/...`，那掛在 `/Inspection/system`
底下；V2 位於 `/Inspection/v2`，改走 Storage 才不受站台路徑影響。已確認該桶匿名可讀。

平面圖採 OpenSeadragon 的 `{ type:'image' }` 單張影像模式，與 V1 `b1plan.html` 現行作法
一致（該頁的 `.dzi` 圖磚是另一條未啟用的路徑）。`plan_markers` 的 x／y 視為 0–1 相對座標。

`three` 與 `openseadragon` 皆以動態 import 載入，建置後確認切成獨立 chunk（337 KB／267 KB）
且沒有任何頁面的初始 HTML 引用它們。

**尚未驗證**：兩個檢視器的實際算繪需登入後才看得到，目前僅確認路由、bundle 切分、
貼圖網址可取得與型別／建置通過。

## 交付順序

1. 維修／派工：報修、派工、工單、附件、分析。
2. 駐衛警巡檢與電子交接簿：現場操作優先，支援手機與離線提示。
3. 後台與設備主檔：帳號、權限、場域、設備履歷。
4. 圖臺、派車、會議室與通知／稽核。

