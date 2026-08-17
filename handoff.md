# 交接檔 handoff

> 這份只放「下次接手需要知道的事」。完整決策脈絡見 git log 與 `SECURITY_POSTURE.md`。

## ⏯️ 上次做到哪

八大系統的資料一致性修正與資安整備，共 31 個 commit、10 支 migration，全部已部署。

- **八大系統逐一檢視**，方法一致：盤點資料表寫入點 → 查該系統的 RLS 政策與 guard
  trigger → 只修真正的缺陷。SYS-05 設備與 SYS-06 圖臺檢視後判定業務邏輯無須修改
  （SYS-06 只修了 RLS 權限錯置）。
- **主要修正**：SYS-02 的 12 種狀態轉移收斂為單一交易（原本 41 處寫入不接回傳值）；
  SYS-07 修好「司機回報後車輛里程從未真正更新」的長期 bug；SYS-04 案件異動與歷程
  原子化；SYS-03 排班儲存原子化並解決兩人同時編輯互相覆蓋。
- **資安整備**：`xlsx-js-style@1.2.0` 自全站移除、SheetJS 升級 0.20.3（消除
  CVE-2023-30533 與 CVE-2024-22363）、修 2 處 XSS、臨時密碼改剪貼簿複製、CSP 收斂。

## 🚦 目前狀態

**SYS-02 已完成實機驗收，其餘七個系統尚未驗。**

2026-08-17 實測 `2026-08-17-003` 走完整條維修流程（建立報修 → 派工 → 接單 → 開始維修
→ 完工回報 → 使用單位驗收 → 主管結案），七個步驟全部成功且每一步都留下歷程，
兩張表狀態同步無誤。`create_repair_dispatch` 與 `repair_order_transition` 確認生效。

驗收過程中發現並修好一個既有故障：`audit-event` 持續回 502，導致使用者操作的稽核
軌跡靜默遺失。根因是該函式對 LINE API 的呼叫沒有逾時上限，加上 `theme.js` 以全域
置換 `window.fetch` 的方式讓**每一次資料讀取**都觸發伺服器端的告警偵測路徑。已加上
5 秒逾時並把 LINE 推播移至背景（`EdgeRuntime.waitUntil`），修正後 502 完全消失。

- 正式站已部署至 `02e79bd`，`Hardened Pages deployment` 通過，線上已確認無舊版函式庫殘留。
- 10 支 migration 全數套用至 `qztffronusdhgxhjjubt`。
- 收工前發現並修好一個線上故障：`patrol_shift_template.assigned_user_ids` 在正式庫
  不存在，導致 `save_patrol_shift_template` 執行階段失敗（班別範本儲存實際上是壞的）。
  已補欄位、回填既有資料，並加 `20260817100000` 驗證六支新函式的 100 餘個欄位，
  確認無其他同類問題。

## ➡️ 下一步

1. **接續實機驗收**。SYS-02 已完成，剩下依序：
   - **SYS-07 行車回報**（最值得測，那裡修了「車輛里程從未真正更新」的實質 bug）。
     測前先挑一台停用中的車並抄下目前里程——該測試會真的改動里程，且
     `official_vehicles` 在禁止刪除的保護名單內。
   - 六頁 Excel 匯出（ExcelJS 產出的檔案與原本不同，排版需目視確認）
   - admin 批次匯入（`.xlsx`／`.xls`／`.csv` 各一次，三種格式都要）
   - SYS-04 交接簿、SYS-03 排班（先測班別範本，那裡曾因欄位缺失而故障）
   驗收清單：https://claude.ai/code/artifact/4ffb8e70-be6d-4bcf-989e-f272f72fe2d2
2. **SYS-02 補測兩項**：「等待料件 → 繼續維修」（唯一只動工單、不動報修單的轉移），
   以及在 `dispatch.html` 再跑一次同樣流程（兩頁共用同一支函式，行為應一致）。

其餘原列待辦（RBAC 角色確認與圖臺 RLS 收斂、4 支未納管 Edge Function、SYS-02 派工
建單原子化）皆已於 2026-08-17 完成。CSP 的 `unsafe-inline` 經評估決定以
`SECURITY_POSTURE.md` 說明架構限制與補償控制，不硬改。

進度總表：https://claude.ai/code/artifact/8d04ce86-47af-49fd-8b11-0ca5d915f574

## ⚠️ 注意事項

- **plpgsql 建立函式時不驗證欄位參照**——`create or replace function` 成功不代表
  函式可執行。新增或修改資料庫函式後，務必實際呼叫一次，或比照
  `20260817100000` 的做法加欄位驗證。
- **新增資料庫函式的 migration 結尾要加 `notify pgrst, 'reload schema';`**，否則
  前端會拿到 `Could not find the function ... in the schema cache`（已踩過一次）。
- **測試資料刪不掉**：41 張表設有 `trg_prevent_removal`，禁止 DELETE/TRUNCATE，
  只能用狀態停用。測 SYS-07 會真的改動車輛里程，請挑停用中的車並先記下原值。
- **`supabase functions deploy` 不帶參數會部署 `supabase/functions/` 底下所有函式**。
  已移除函式的原始碼因此留在 `docs/removed-edge-functions/`，不要搬回去。
- 刻意不做的事及理由（150 個寫入點改走 API、後端改寫 FastAPI/Node、匯入改
  ExcelJS）記在進度總表與 `SECURITY_POSTURE.md`，日後有人問起可查。

## 🕐 最後更新

2026-08-17 · Claude Opus 5 @ DESKTOP-0CFB6UK · Git push：✅ 已推
· L3 Obsidian：未更新（AGENTS.md 未登記 vault 路徑）
