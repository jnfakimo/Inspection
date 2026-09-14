# 圖臺 GLB 模型架構

V2 的「3D 模型圖」、「平面樓層圖」、「立體巡檢雲臺」與「報修 3D 圖」共用同一批 GLB。檢視器不簽署、不下載 PNG，也不以 PNG 作失敗備援。

## 網站模型位置

- manifest：`web/public/models/market-bim/manifest.json`
- 樓層模型：`web/public/models/market-bim/market-bim-{樓層}.glb`
- 目前範圍：B1F、1F、2F、3F、4F、5F、6F
- 網站路徑：`/Inspection/v2/models/market-bim/`

manifest 的每層資料至少要有 `id`、`name`、`model` 與 `bounds.min/max`。`B1F` 進入前端後會正規化為 `B1`，與既有 `plan_markers.floor_id` 對應。

## 顯示方式

- 3D：透視相機，可旋轉、平移、縮放、調整樓層間距，並可逐層開關。
- 平面圖：同一份 GLB、正交相機與正上方俯角；可旋轉平面、平移、縮放，一次顯示一層。
- 控制點：沿用 `plan_markers` 的 0–1 相對座標，依 manifest bounds 對齊 GLB；文字標籤可獨立開關。
- 線條：GLB 網格即時產生青螢光色邊線，不需預先烘焙圖片。

## 舊模型如何轉換

PNG 只有像素，無法可靠還原牆、柱、樓板高度，因此不能直接轉成真正 BIM GLB。舊資料若只有 PNG，需找回 DXF、IFC 或 RVT 原始檔重新轉換。

目前模型的標準流程為：

1. Revit 匯出 IFC。
2. 以北農導覽機專案的 `tools/ifc_extract.py` 擷取幾何快取。
3. 以 `tools/ifc2kiosk.py` 依樓層輸出 GLB。
4. 更新七個 GLB 與 manifest 後執行型別檢查及正式建置。

更換模型時必須整批核對檔名、bounds、樓層代號與控制點對齊；若 GLB 或 manifest 載入失敗，頁面會顯示錯誤，不會悄悄改顯示 PNG。
