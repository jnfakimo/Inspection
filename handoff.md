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

**可運行，但整批改動都沒有經過實機驗證。** 這是目前最大的風險。

- 正式站已部署至 `02e79bd`，`Hardened Pages deployment` 通過，線上已確認無舊版函式庫殘留。
- 10 支 migration 全數套用至 `qztffronusdhgxhjjubt`。
- 收工前發現並修好一個線上故障：`patrol_shift_template.assigned_user_ids` 在正式庫
  不存在，導致 `save_patrol_shift_template` 執行階段失敗（班別範本儲存實際上是壞的）。
  已補欄位、回填既有資料，並加 `20260817100000` 驗證六支新函式的 100 餘個欄位，
  確認無其他同類問題。

## ➡️ 下一步

1. **實機驗收**（唯一緊急項）。優先順序：SYS-02 完整維修流程 → SYS-07 行車回報
   （順便確認車輛里程真的更新）→ 六頁 Excel 匯出（ExcelJS 產出的檔案與原本不同，
   排版需目視）→ admin 批次匯入（`.xlsx`／`.xls`／`.csv` 各一次）。
   驗收清單：https://claude.ai/code/artifact/4ffb8e70-be6d-4bcf-989e-f272f72fe2d2
2. **驗收後回報結果**，有任何一項不如預期就把畫面訊息或 Console 內容留下。

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

2026-08-17 · Claude Opus 5 @ DESKTOP-0CFB6UK · Git push：✅ 已推（`22cb93f`）
· L3 Obsidian：未更新（AGENTS.md 未登記 vault 路徑）
