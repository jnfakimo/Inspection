# 交接檔 handoff

> 這份只放「下次接手需要知道的事」。完整決策脈絡見 git log 與 `SECURITY_POSTURE.md`。

## ⏯️ 上次做到哪

八大系統的資料一致性修正與資安整備，共 38 個 commit、13 支 migration，全部已部署。

- **八大系統逐一檢視**，方法一致：盤點資料表寫入點 → 查該系統的 RLS 政策與 guard
  trigger → 只修真正的缺陷。SYS-05 設備與 SYS-06 圖臺檢視後判定業務邏輯無須修改
  （SYS-06 只修了 RLS 權限錯置）。
- **主要修正**：SYS-02 的 12 種狀態轉移收斂為單一交易（原本 41 處寫入不接回傳值）；
  SYS-07 修好「司機回報後車輛里程從未真正更新」的長期 bug；SYS-04 案件異動與歷程
  原子化；SYS-03 排班儲存原子化並解決兩人同時編輯互相覆蓋。
- **資安整備**：`xlsx-js-style@1.2.0` 自全站移除、SheetJS 升級 0.20.3（消除
  CVE-2023-30533 與 CVE-2024-22363）、修 2 處 XSS、臨時密碼改剪貼簿複製、CSP 收斂。

## 🚦 目前狀態

**SYS-02 與 SYS-07 已完成實機驗收，其餘六個系統尚未驗。**

2026-08-17 完成 SYS-07 行車回報驗收，含負向對照。先以測試司機身分直接
`update official_vehicles`（舊程式碼的做法），確認回傳 0 列、不報錯、里程不變——
原本的靜默失敗確實重現；再改走 `complete_vehicle_trip`，里程如實更新。
測項全過：里程 50000.0 → 50123.4、申請單轉 completed、歷程留下「司機完成行車回報
｜實際 2 人｜123.4 km｜加油 1200.00 元」、重複送出被擋（22023）、三項驗證分支
（異常未填內容／上次加油費用為負／本次加油費用為負）皆回正確訊息且五次失敗後
狀態零殘留（交易回滾正常）、較舊回報不會把里程往回寫（單據記 49900→50100，
車輛維持 50123.4）。

2026-08-17 完成 SYS-03 排班驗收。回填結果逐筆對照來源 JSON **全部正確**（4 個範本、
8 筆有來源資料的班別完全吻合；`2026-07-12 晚班` 在 JSON 中本就沒登記，留空正確）。
`save_patrol_shift_template` 的 update 與 insert 兩個分支皆執行成功——欄位缺失造成的
42703 已不復存在，班別範本儲存確認可用；不存在的 template_id 正確回 02000。
`save_patrol_shift` 的 insert 與 on-conflict 更新分支皆正確。局部合併經 26 個節點
逐一比對確認：只新增指定節點，既有內容一字未改。權限把關亦通過——非管理員呼叫
兩支函式皆回 42501，`patrol_staff_config_apply` 未授權給 authenticated、無法直接呼叫。

**踩到的坑**：`patrol_shift_template` 的 `start_time`/`end_time` 與 `patrol_shift_staff`
JSON 裡的 `workTimes.templates.<班別名>` 是**兩組獨立的值**，不會互相同步。測試時誤以為
相同而用範本時間覆寫了 workTimes（早班 08:00-12:00 被寫成 09:00-10:00），已還原。
呼叫 `save_patrol_shift_template` 時務必分別帶入正確的 `p_work_start`/`p_work_end`。

**驗收方法上的重要發現**：正式庫唯一登記的司機黃建發是 `role='admin'`，
`is_admin()` 對他回 true，用他測**驗不到這次修的 bug**——舊程式碼對他本來就會通過。
必須用 `rbac_role='mgmt_supervisor'` 的帳號才測得出來（它是唯一同時滿足
「有 sys_vehicle 權限」與「is_admin() 為 false」的角色）。日後重測 SYS-07 請沿用此條件。

2026-08-17 實測 `2026-08-17-003` 走完整條維修流程（建立報修 → 派工 → 接單 → 開始維修
→ 完工回報 → 使用單位驗收 → 主管結案），七個步驟全部成功且每一步都留下歷程，
兩張表狀態同步無誤。`create_repair_dispatch` 與 `repair_order_transition` 確認生效。

驗收過程中發現並修好一個既有故障：`audit-event` 持續回 502，導致使用者操作的稽核
軌跡靜默遺失。根因是該函式對 LINE API 的呼叫沒有逾時上限，加上 `theme.js` 以全域
置換 `window.fetch` 的方式讓**每一次資料讀取**都觸發伺服器端的告警偵測路徑。已加上
5 秒逾時並把 LINE 推播移至背景（`EdgeRuntime.waitUntil`），修正後 502 完全消失。

- 正式站已部署至 `d2eb977`，`Hardened Pages deployment` 通過，線上已確認無舊版
  函式庫殘留；Edge Function 線上 11 支，與 `supabase/functions/` 一一對應。
- 13 支 migration 全數套用至 `qztffronusdhgxhjjubt`。
- 另一個曾經存在的線上故障：`patrol_shift_template.assigned_user_ids` 在正式庫
  不存在，導致 `save_patrol_shift_template` 執行階段失敗（班別範本儲存實際上是壞的）。
  已補欄位、回填既有資料，並加 `20260817100000` 驗證六支新函式的 100 餘個欄位，
  確認無其他同類問題。**已於 2026-08-17 實機驗證通過**（見下方 SYS-03 段落）。

## ➡️ 下一步

1. **接續實機驗收**。SYS-02、SYS-07、SYS-03 已完成，剩下依序：
   - 六頁 Excel 匯出（ExcelJS 產出的檔案與原本不同，排版需目視確認）
   - admin 批次匯入（`.xlsx`／`.xls`／`.csv` 各一次，三種格式都要）
   - SYS-04 交接簿
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
- **SYS-07 驗收留下的測試夾具**（刪不掉，已全部停用，請勿指派實際任務）：
  車輛 `TEST-0001`「SYS-07 驗收測試車（勿使用）」status=inactive、里程 50123.4；
  帳號 `SYS07TEST` status=inactive 且 auth 已停權、`vehicle_dispatch_drivers` active=false；
  派車單 `CAR-20260817-0008`、`CAR-20260817-0012` 兩張 completed（用途欄已註明為測試）。
  正式車 9390-AG 全程未被動到，里程維持 15000.0。
- **正式庫的 `is_admin()` 與 repo 原始碼不一致，漏認 `sysadmin`**。實測：
  `role='supervisor'` + `rbac_role='sysadmin'` → **false**；`role='admin'` → true；
  `rbac_role='admin'` → true。亦即線上版本等同 `role='admin' or rbac_role='admin'`，
  而 `system/sql/rls_hardening.sql:36-46` 寫的是 `rbac_role in ('admin','sysadmin')`。
  同一身分下 `active_rbac_role()` 正確回 'sysadmin'，可排除「查不到使用者列」的可能。
  影響所有以 `is_admin()` 把關的 RLS 政策與 security definer 函式。目前三位管理員
  （022443、021976、admin）的 `role` 欄都是 'admin' 所以**尚無真實使用者受影響**，
  但日後只從 rbac.html 把人升為 sysadmin 而未改 `role` 欄，該帳號會拿到系統存取權
  卻無法執行任何管理動作。尚未修，另行追蹤。
- **SYS-03 驗收留下的測試殘留**（刪不掉，已標示清楚）：班別範本
  「SYS-03驗收測試範本（勿使用）」sort_order=999；`patrol_shifts` 的
  `2099-12-31 SYS-03測試班` 一列。`system_settings` 的 `patrol_shift_staff`
  已還原為測試前的原始內容（919 字元，逐節點比對無差異）。
- **`vehicle_dispatch_no_time_overlap` 排除約束沒有把 `vehicle_id` 納入鍵值**，
  現在只有一台車所以看不出來，但加第二台車後兩台車就不能在重疊時段各自出勤；
  且 `pending_approval` 與 `completed` 都在生效狀態內（未核可的申請就會鎖住時段、
  同日已完成的行程永久占住該時段）。SYS-07 驗收建第二張測試單時撞到 23P01 才發現，
  尚未修，另行追蹤。
- **`supabase functions deploy` 不帶參數會部署 `supabase/functions/` 底下所有函式**。
  已移除函式的原始碼因此留在 `docs/removed-edge-functions/`，不要搬回去。
- 刻意不做的事及理由（150 個寫入點改走 API、後端改寫 FastAPI/Node、匯入改
  ExcelJS）記在進度總表與 `SECURITY_POSTURE.md`，日後有人問起可查。

## 🕐 最後更新

2026-08-17 · Claude Opus 5 @ DESKTOP-0CFB6UK · Git push：✅ 已推
· 本次：SYS-07 行車回報、SYS-03 排班實機驗收完成（含負向對照），未改任何程式碼
· 順帶發現兩項未修缺陷：正式庫 is_admin() 漏認 sysadmin、派車時段排除約束未區分車輛
· L3 Obsidian：未更新（AGENTS.md 未登記 vault 路徑）
