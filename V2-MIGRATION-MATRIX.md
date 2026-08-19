# V2 全站遷移矩陣

V1（`system/*.html`）保留不刪除；V2（`web/app`）逐模組轉移，完成驗證後再將 V2 設為主要入口。

## 遷移原則

- V1 與 V2 共用既有 Supabase 資料與權限，不建立第二套資料。
- V1 在遷移期間持續可用，V2 頁面保留「V1 進階作業」備援連結。
- 每個模組需完成：列表、建立／編輯、狀態流程、附件（如適用）、權限、手機版與錯誤提示。

## 現況

| 系統 | V2 路由 | V2 狀態 | V1 備援 |
|---|---|---|---|
| 後台管理 | `/Inspection/v2/systems/admin/` | **十一個模組已完整搬移**（見下方） | `admin.html`、`rbac.html` |
| 維修／派工 | `/Inspection/v2/systems/workorder/` | **五個模組已完整搬移**（見下方） | `workorder.html`、`dispatch.html` |
| 駐衛警巡檢 | `/Inspection/v2/systems/guardpatrol/` | **六個模組已完整搬移**（見下方） | `patrolcheckin.html`、`patrolshifts.html` 等 |
| 電子交接簿 | `/Inspection/v2/systems/handover/`、`/v2/handover-pilot/` | **三個模組已完整搬移**（見下方） | `handover.html` |
| 設備建置 | `/Inspection/v2/systems/equipment/` | **八個模組已完整搬移**（見下方） | `equipment.html`、`materials.html` |
| 專案關係／圖臺 | `/Inspection/v2/systems/structuremap/` | **六個模組已完整搬移**（見下方） | `b1plan.html`、`floor3d.html` 等 |
| 公務車派車 | `/Inspection/v2/systems/vehicle/` | **五個模組已完整搬移**（見下方） | `vehicle-dispatch.html` |
| 會議室預約 | `/Inspection/v2/systems/meetingroom/` | **四個模組已完整搬移**（見下方） | `meetingroom.html` |

> 路由前綴為 `/Inspection/v2/`（`web/next.config.ts` 的 `basePath`）。
> 八個系統的模組現在都有專屬元件，不再有只靠 `app-api` `module_data`（唯讀通用查詢）
> 撐場的模組。後台管理新增的巡檢週期、費用統計、位置分析、系統健康四個模組走
> `web/components/AdminWorkspace.tsx` 的元件對照表，不經 `module_data`，因此
> `MODULE_SOURCES` 未新增對應設定。

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

2026-08-19 依需求把 3D建模系統 hub 的五個子系統全部改為 V1 頁面的忠實移植，
各自獨立成檔：`structuremap-arealist.tsx`（區域位置表）、`structuremap-markerboard.tsx`（整合標記系統）、`structuremap-floor3d.tsx`（3D模型圖）、
`patrol-pointlist.tsx`（巡邏點清單，屬 SYS-03）。剩下的專案關係圖仍在
`structuremap-workspace.tsx`，2D 平面樓層圖仍在 `structuremap-viewers.tsx`：

| 模組 | V2 功能 |
|---|---|
| 區域位置表 | V1 `arealist.html` 的移植：樓層分組摺疊清單（每層獨立分頁）、統計卡、使用狀態篩選、空間 QR 與列印、XLSX 匯入匯出與範本、單筆與全部停用（皆先檢查是否已被標記引用） |
| 整合標記系統 | V1 `b1_integrated_marker_system.html` 的移植：全螢幕 OpenSeadragon 圖面、放置標記模式（可從設備／空間／報修清單帶連結放置）、五種標記類型與三張表連結、詳細彈窗、旋轉與標籤工具、深連結 `?marker=`、巡邏點三色狀態 |
| 平面樓層圖 | OpenSeadragon 檢視器，標記疊層可點選，支援點圖面重新定位並寫回 x／y |
| 3D模型圖 | V1 `floor3d.html` 的移植：全螢幕、立體控制（間距、平移、四行讀數、重置／俯視／真實比例）、逐層顯示開關、標記類型與標籤、巡邏點三色狀態、深連結 `?marker=`。算繪沿用共用的 `FloorStack3D` |
| 3D建模系統 | V1 `admin.html#modelhub` 的子系統導覽頁：五張 HUB 圖卡＋空間標記覆蓋率統計 |
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

## SYS-01 後台管理（2026-08-18 完成）

原有七個模組（人員帳號、角色權限、場域位置、操作稽核、資安告警、通知中心、戰情版面）
均為專屬元件。本次補上 `admin.html` 有而 V2 缺少的四個模組，各自獨立成
`web/components/admin/` 底下的元件：

| 模組 | 資料來源 | V2 功能 |
|---|---|---|
| 巡檢週期 | `inspection_cycles` | 開啟新週期（結束現有週期、設備重置紅燈）、週期歷史 |
| 費用統計 | `cost_records` | 新增費用記錄；設備／類型／日期區間篩選、合計、各設備排名與占比；匯出 .xlsx |
| 位置分析 | `inspection_records`＋`repair_requests` | 市場→樓層→區域→細部位置的樞紐下鑽，可收合；巡檢數、異常數、異常率、報修數、最近巡檢 |
| 系統健康 | `client_error_logs` | 類型與期間篩選、錯誤訊息中文化（規則逐條沿用 V1）、技術原文收合、詳細內容 |

費用寫入直接走 `cost_records`：其 insert／update 政策要求 `has_system_access('sys_workorder')`
且必須是管理者或具 dispatch 權限，伺服器端把關存在，依 `ARCHITECTURE_V2.md` 的判斷準則
不另包 Edge Function。巡檢週期沿用 V1 的兩步驟寫入（無對應的 security definer 函式），
但插入失敗時明確提示「目前沒有進行中的週期」，不讓中間狀態被誤認為正常。

`admin.html` 的 3D 建模導覽頁（`page-modelhub`）原本刻意不搬，理由是五個目的地在 V2 都已是
SYS-06 與 SYS-03 的模組，再做一頁只會多一層轉跳。**2026-08-19 依需求推翻此決定**：
SYS-06 的 `models` 模組改為該導覽頁（`structuremap-modelhub.tsx`），版型與功能對齊 V1，
五張卡的版型、文字與操作目的維持 V1。HUB-01 已於 2026-08-19 改接
`/Inspection/v2/systems/structuremap/modeler/`：DXF 仍在瀏覽器解析與產生原圖／行動版 PNG，
Storage 上傳由 RLS 授權，模型清單與 `floor_models` 更新則經 Node.js `app-api` 完成 JWT、
啟用帳號、RBAC、限流、RLS 與稽核檢查。其餘四張卡仍保留原目的地，待各自獨立驗收後再切換。

原本掛在 models 模組的 `floor_models` 通用維護表格維持移除；正式建模入口改為上述 V2
專用頁。V2 的立體樓層檢視器與巡檢工作區繼續共用同一份 `floor_models` 貼圖來源。

移植過程中一併收斂了三份不相容的 `floorOrder`：V1 的 arealist／patrollist 用
B1=99／1F=101／RF=900，而 V2 自行實作的兩份用 B1=-1／1F=1／RF=999。`floor_order`
會寫進 `floor_spaces` 與 `locations`，兩套編號混在同一欄會讓 `.order('floor_order')`
失去意義。現統一由 `web/lib/floor.ts` 提供，採 V1 的編號。

巡邏點的三色打卡狀態抽成 `web/lib/patrol-status.ts`（V1 `patrolstatus.js` 的 compute()
移植），整合標記系統與 3D模型圖共用。

## SYS-03 駐衛警巡檢（2026-08-18 完成）

六個模組皆有專屬元件：打卡矩陣在 `operations-workspace.tsx`，其餘五個在 `patrol-workspace.tsx`。

| 模組 | V2 功能 |
|---|---|
| 巡邏打卡 | 依班別排程的樓層×班別矩陣、日期切換、樓層／班別／狀態篩選、選點打卡、當日與期間匯出 .xlsx |
| 巡邏點清單 | V1 `patrollist.html` 的移植（`patrol-pointlist.tsx`）：統計卡、樓層分組摺疊清單、最近一次簽到時間、單點 QR 與**整批列印**、定位連結至整合標記系統。當日打卡的視角由同系統的「巡邏打卡」模組負責，本頁為唯讀彙總 |
| 巡檢排班 | 當日班別與班別範本雙表，走 `save_patrol_shift`／`save_patrol_shift_template`，人員以姓名指派 |
| 逾時推播 | 直接查 `patrol_timeout_notifications`，期間／班別／狀態篩選，含 LINE 與 FCM 回應 |
| 設備巡檢 | 走 `app-api` 的 `inspections`／`create_inspection`，異常必填說明 |
| 立體巡檢雲臺 | 與 SYS-06 共用 `FloorStack3D`，只顯示巡檢點並依當日打卡著色 |

本次補上兩項：

- **QR 標籤**（對應 V1 `patrollist.html` 的 `openQr`／`printAllQr`）。以零相依的
  `qrcode-generator` 動態載入，建置後確認切成 20 KB 獨立 chunk，不在任何頁面的初始載入。
  QR 內容仍指向 V1 的 `patrolcheckin.html?marker=…`——實際簽到流程（含 MFA 與
  `patrol-checkin` Edge Function）在 V1，現場已張貼的標籤也是這組網址，改指 V2 會讓
  新舊標籤指向不同地方。
- **當班即時統計修正**。原本「已打卡／待打卡」用打卡筆數粗算、「逾期未打卡」恆為 0，
  與矩陣裡逐格算出的狀態對不起來。改為沿用 V1 `renderDutyStats` 的語意：只有所選日期是
  今天且此刻落在某班別時段內才統計，逐點算出 ok／pending／overdue，否則顯示「目前無進行中班別」。

`patrolcheckin.html` 本身刻意不搬：它是掃 QR 後直接進入的單頁簽到流程，含 MFA 驗證，
不是後臺作業畫面，改寫成 V2 路由只會讓現場標籤失效。

## SYS-04 電子交接簿（2026-08-18 完成）

三個模組在 `handover-workspace.tsx`：

| 模組 | V2 功能 |
|---|---|
| 交接紀錄 | 列表（日期區間、班別、狀態、關鍵字）、詳細檢視、接收交接；新增交接單含當班設備運轉概況與每日報修概況自動帶入、異常與待辦逐項清單、草稿／送出 |
| 未結事項 | 案件列表（狀態、類別、日期區間）、**新增案件**（異常大／小類、案件編號自動編碼、發生時間驗證）、**附件上傳與檢視**、指派／進度／狀態異動與重新開啟 |
| 設備概況 | 交接當下的設備狀態總覽，含保養逾期標示 |

本次補上：交接單的設備與報修概況自動帶入（對應 V1 的 `fetchEqStatus`／`fetchRepairStatus`，
狀態集合與 V1 相同）、異常與待辦的逐項清單（V1 以換行串成單一欄位存放，此處沿用同一格式，
兩版互讀不會走樣）、交接單詳細檢視、案件建立與 `handover_case_attachments` 附件。

附件所在的 `handover-attachments` 是私有 bucket，開啟一律以 `createSignedUrl` 產生 5 分鐘
簽章網址；上傳成功但索引寫入失敗時會把已上傳的物件收回，不留下查不到的孤兒檔案。

送出交接沿用 V1 的規則：交接人必須是登入者本人、不得與接班人相同、過去班次不可補單
（資料庫的 `handover_shift_end_at` 亦會擋，前端先行提示）。

## 交付順序

1. 維修／派工：報修、派工、工單、附件、分析。
2. 駐衛警巡檢與電子交接簿：現場操作優先，支援手機與離線提示。
3. 後台與設備主檔：帳號、權限、場域、設備履歷。
4. 圖臺、派車、會議室與通知／稽核。

