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
| 公務車派車 | `/v2/systems/vehicle/` | 模組入口與資料列表 | `vehicle-dispatch.html` |
| 會議室預約 | `/v2/systems/meetingroom/` | 模組入口與資料列表 | `meetingroom.html` |

## 交付順序

1. 維修／派工：報修、派工、工單、附件、分析。
2. 駐衛警巡檢與電子交接簿：現場操作優先，支援手機與離線提示。
3. 後台與設備主檔：帳號、權限、場域、設備履歷。
4. 圖臺、派車、會議室與通知／稽核。

