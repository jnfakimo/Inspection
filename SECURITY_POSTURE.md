# 資安現況說明（供弱點掃描對照）

本文件說明本系統的資安控制現況，以及部分掃描項目為何屬於「架構決策 + 補償控制」
而非未修補的缺失。最後更新：2026-08-16。

## 架構前提

- 前端為**無建置流程的多頁靜態 HTML**，託管於 GitHub Pages。
- 後端為 Supabase（PostgreSQL + PostgREST + Auth + Storage + Edge Functions）。
- 瀏覽器以 **anon key** 連線；anon key 依設計為公開值，**實際存取控制在資料庫的
  RLS，不在於這把金鑰是否可見**。
- GitHub Pages **無法設定 HTTP 回應標頭**，所有安全標頭只能以 `<meta>` 形式提供。

## 已實作的控制

| 控制項 | 現況 |
| --- | --- |
| Content-Security-Policy | **37/37 頁面**皆有，含 `default-src 'self'`、`object-src 'none'`、`base-uri 'self'`、`form-action 'self'` |
| 子資源完整性 SRI | **18/18 外部 script** 皆有 `integrity` 與 `crossorigin` |
| 資料列層級授權 RLS | **54 張資料表、164 條政策**，逐列授權（如「僅申請人／指派司機／管理者可異動」），非 `using(true)` 樣板 |
| SECURITY DEFINER 函式 | **33/33 皆設定 `set search_path`**，杜絕搜尋路徑挾持提權 |
| 業務流程強制 | 關鍵狀態轉移由資料庫 trigger 強制（如派車核可限同單位主管且不得自核、僅被指派司機可接單且限用車當日） |
| 儲存桶權限 | `repair-files`、`handover-attachments`、`vehicle-dispatch-files` 為 private；`floorplans` 為公開讀取但寫入需 `sys_equipment` 權限 |
| 實體刪除防護 | **41 張資料表**設有 `trg_prevent_removal`，禁止 DELETE/TRUNCATE，一律改用狀態停用 |
| 反向頁面劫持 | 所有 `target="_blank"` 皆含 `rel="noopener"`（0 例外） |
| 稽核軌跡 | `audit_logs` 記錄操作者、來源頁面、User-Agent；寫入政策綁定 `operator_id = active_user_id()`，無法偽造他人身分 |

## 掃描可能標記，但屬架構決策的項目

### 1. CSP 的 `script-src` 含 `'unsafe-inline'`

**原因**：本系統為無建置流程的多頁靜態架構，每一頁的業務邏輯皆以內嵌
`<script>` 撰寫。移除 `'unsafe-inline'` 需為所有內嵌區塊產生 nonce 或 hash，
而 GitHub Pages 只能以 `<meta>` 提供 CSP，nonce 每次建置都會變動，無法沿用。

**補償控制**：

- `object-src 'none'`、`base-uri 'self'`、`form-action 'self'` 已阻斷常見的
  CSP 繞過與表單劫持路徑。
- 外部腳本來源限縮於四個明列網域，且**全部**受 SRI 保護，CDN 遭竄改不會生效。
- 程式碼中**未使用** `eval()` 或 `new Function()`。
- 使用者可控內容輸出至 DOM 前皆經 `escHtml()` 跳脫（見下節）。

**改善路徑**：若需完全移除，應由 `tools/build-hardened-pages.mjs` 在建置階段
為每個內嵌區塊計算 SHA-256 並寫入 CSP `script-src`。屬中大型工程，尚未執行。

### 2. `floorplans` 儲存桶為公開讀取

**原因**：樓層平面圖與 DZI 圖磚由 `b1plan.html`、`floor3d.html` 的
OpenSeadragon／Three.js 直接載入，需匿名可讀。內容為建物平面圖，不含個資。

**補償控制**：寫入權限綁定 `has_system_access('sys_equipment')`；其餘三個
含個資與現場照片的儲存桶皆為 private。

### 3. 前端原始碼包含 Supabase anon key

**原因**：Supabase 的 anon key 設計上即為公開值，等同於「這個專案的公開端點
識別碼」。真正的授權判斷在 RLS 與 Edge Function。

**補償控制**：全表 RLS 已啟用且逐列授權；未經登入的 anon 角色在所有業務資料表
皆無讀寫權限。金鑰集中於 `system/supabase-config.js` 一處，便於輪替。

## 已知待處理項目

### xlsx-js-style@1.2.0（高）

`admin.html`、`guardpatrol.html`、`vehicle-dispatch.html` 三頁使用
`xlsx-js-style@1.2.0`。該套件為 SheetJS 0.18.x 的第三方分支，**已無維護、無升級
版本**，因此繼承同一組漏洞：

- CVE-2023-30533（Prototype Pollution，影響 SheetJS < 0.19.3）
- CVE-2024-22363（ReDoS，影響 SheetJS < 0.20.2）

原版 SheetJS 已於 2026-08-16 升級至 0.20.3（`analytics`、`arealist`、
`equipment` 三頁），但該分支提供官方 CE 版沒有的儲存格樣式功能，**無法直接換版**。

**風險評估**：兩個漏洞的利用前提皆為「解析攻擊者提供的惡意 xlsx 檔」。本系統的
匯入功能僅開放給具備對應權限的內部人員，檔案來源為內部作業文件，非公開上傳。

**改善路徑**：改用 `exceljs@4.4.0`（已在 `package.json` 相依中，且 `equipment.html`
已部分採用）。屬程式改寫而非換版。

### 臨時密碼處理（已改善）

批次匯入使用者時產生的臨時密碼，原本直接渲染為畫面文字，存在截圖、旁觀與
畫面殘留的外洩風險。2026-08-16 已改為暫存於記憶體並提供複製按鈕，不再寫入 DOM
文字，且每次匯入開始時清空。

**仍存在的殘留風險**：密碼在複製期間存在於瀏覽器記憶體與系統剪貼簿。建議管理者
複製轉交後立即以其他內容覆蓋剪貼簿，或改用「重設密碼」功能由當事人自行設定。
