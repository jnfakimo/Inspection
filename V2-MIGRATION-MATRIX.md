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
| 維修／派工 | `/v2/systems/workorder/` | 報修新增已可在 V2 送出；其餘列表基礎版 | `workorder.html`、`dispatch.html` |
| 駐衛警巡檢 | `/v2/systems/guardpatrol/` | 入口與模組列表 | `patrolcheckin.html`、`patrolshifts.html` 等 |
| 電子交接簿 | `/v2/systems/handover/`、`/v2/handover-pilot/` | 現場試用版與模組入口 | `handover.html` |
| 設備建置 | `/v2/systems/equipment/` | 模組入口與資料列表 | `equipment.html`、`materials.html` |
| 專案關係／圖臺 | `/v2/systems/structuremap/` | 模組入口；2D／3D 尚待原生化 | `b1plan.html`、`floor3d.html` 等 |
| 公務車派車 | `/Inspection/v2/systems/vehicle/` | **五個模組已完整搬移**（見下方） | `vehicle-dispatch.html` |
| 會議室預約 | `/v2/systems/meetingroom/` | 模組入口與資料列表 | `meetingroom.html` |

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

## 交付順序

1. 維修／派工：報修、派工、工單、附件、分析。
2. 駐衛警巡檢與電子交接簿：現場操作優先，支援手機與離線提示。
3. 後台與設備主檔：帳號、權限、場域、設備履歷。
4. 圖臺、派車、會議室與通知／稽核。

