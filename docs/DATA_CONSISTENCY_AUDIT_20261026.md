# 資料一致性排查報告（2026-10-26）

範圍：製作《中央戰情室暨巡檢平台操作手冊》截取 V2 正式站畫面時，發現的四個資料異常。另附排查過程中發現的一項安全問題。

方式：只讀程式碼，對正式資料庫（Supabase `qztffronusdhgxhjjubt`）只執行 `SELECT` 與系統目錄查詢。**本次沒有修改任何正式資料、函式或政策，也沒有 commit。** 文中所有 SQL 與程式都是修正草稿，標示「未執行」。

## 風險排序

| # | 風險 | 問題 | 現況 |
|---|---|---|---|
| 1 | 高 | 「重新套用全部範本」會用二市的空白範本清空一市的排定人員 | 尚未發生（2026-09-30 後沒有任何套用紀錄）。按一次就會觸發 |
| 2 | 高 | 資料庫觸發程序 `line-notify-repair` 的定義中直接寫入 service_role 金鑰 | 金鑰目前有效，期限到 2097 年 |
| 3 | 中 | 報修單狀態可以不經流程函式直接修改，已造成 6 筆報修單有狀態卻沒有工單 | 已發生，另有 5 項報修單與工單不一致 |
| 4 | 中 | 上線前的測試資料混在正式統計裡 | 設備巡檢 13/13 筆、可見報修 15/44 筆 |
| 5 | 低 | 巡檢排班範本清單與打卡矩陣把一市、二市的班別混在一起顯示（與 #1 同一個根因） | 使用者看到每個班別出現兩次 |
| 6 | 低 | 停用帳號經手的交接單，交接人顯示為 UUID 或「—」 | 指揮台 2 筆；未結事項、業管組也是同一種寫法 |

---

## 1. 班別範本「重複」與套用全部範本的覆蓋風險（對應 #1、#5）

### 現象
- 巡檢排班頁的「班別範本」中，早班 03:00–11:00、中班 11:00–19:00、晚班(隔夜) 19:00–03:00 各出現兩筆：一筆有預設人員，一筆沒有。
- 巡邏打卡矩陣每個班別都出現兩欄。

### 根因
- `patrol_shift_template` 現有 7 筆啟用中的範本：`market_1` 3 筆（各 1 位預設人員）、`market_2` 3 筆（0 位），另有 2 筆停用（`中班 16:00→12:00`、`SYS-03驗收測試範本（勿使用）`）。
- `market_2` 那組由 `supabase/migrations/20261001160000_guard_handover_market.sql:11-16` 建立。目的是讓駐警隊交接簿分市場，所以複製了一市的班名與時段，但沒有複製人員。
- 巡檢相關程式讀範本時都沒有依 `market_code` 篩選：
  - `web/lib/patrol-status.ts:109`（`getBaseData`）。`getPatrolShiftsForDate`（同檔 183 行起）會替每一筆範本產生一個班別，所以兩個市場合計 6 欄。打卡矩陣、首頁當班巡檢、3D 圖釘都共用這段。
  - `web/app/systems/[system]/[module]/patrol-workspace.tsx:195-196`：排班頁的每日班別與範本清單。
  - `supabase/functions/patrol-timeout-check/index.ts:107`：逾時推播。同名規則的 `rule.id` 都是 `shift:<班名>`，第二筆會在 156-157 行被判為 `already processed`，所以**不會重複推播**，只是多跑一輪查詢。
- **覆蓋風險**：
  - `apply_all_patrol_shift_templates_range`（正式庫現行定義）依 `order by sort_order, template_id` 逐一套用所有啟用範本。三組同名範本中，二市的 `template_id` 都排在一市之後（早班 `91cd…` < `92a3…`、中班 `8047…` < `d361…`、晚班 `991a…` < `f0b4…`）。
  - `apply_patrol_shift_template_range` 寫入 `patrol_shifts` 時用 `on conflict (shift_date, name) do update set assigned_user_ids = excluded.assigned_user_ids`，沒有寫入也沒有比對 `market_code`；接著呼叫 `patrol_staff_config_apply('date', …)` 以同一個班名寫入排定人員。
  - 結果：按一次「重新套用全部範本」，套用期間內每一天的一市早、中、晚班都會先寫入一市的人員，緊接著被二市的空白範本覆蓋成空陣列。逾時推播也會因此找不到排定人員。
  - 唯一索引 `idx_patrol_shifts_date_name` 是 `(shift_date, name)`，資料庫結構本身也分不出兩個市場的同名班別。

### 影響範圍
- 目前沒有資料受損：`audit_logs` 中 2026-09-30 以後沒有 `v2-patrol-apply-all` 或 `v2-patrol-range` 紀錄；`patrol_shifts` 在 2026-10-01～12-31 共 276 筆有效班別，全部有排定人員，且都是 `market_1`。
- 二市目前沒有任何每日班別。
- 每一天另有 4～5 筆 `[已刪除] …` 軟刪除列（例如 `[已刪除] 早班 7560b5f2`，建立於 2026-08-20、09-11）。前端已用 `isDeletedShift` 過濾，與本問題無關。

### 建議修正（未執行）
1. **立即處置**：修正上線前，請管理員不要按「重新套用全部範本」，也不要對二市範本按「套用到期間」。
2. **前端與推播**：讀範本與每日班別時一律加上市場條件，並在範本清單顯示市場欄位。
   ```ts
   // web/lib/patrol-status.ts getBaseData / getOverrides、patrol-workspace.tsx load（草稿）
   client.from('patrol_shift_template').select('*')
     .eq('market_code', market).neq('status', 'inactive').order('sort_order')
   client.from('patrol_shifts').select('*').eq('market_code', market).eq('shift_date', dateStr)
   ```
   `patrol-timeout-check` 的規則鍵也要帶市場，例如改成 `shift:${market}:${name}`。
3. **資料庫**：唯一鍵與套用函式納入市場。
   ```sql
   -- 草稿，未執行；先確認 patrol_shifts 沒有 (market_code, shift_date, name) 重複
   create unique index concurrently if not exists idx_patrol_shifts_market_date_name
     on public.patrol_shifts(market_code, shift_date, name);
   -- 新索引上線並改完函式後，再移除舊索引 idx_patrol_shifts_date_name
   ```
   `apply_patrol_shift_template_range` 的 `insert` 要寫入 `market_code = v_tpl.market_code`，並把 `on conflict` 改成 `(market_code, shift_date, name)`。`patrol_staff_config_apply` 的設定鍵目前只有班名，也要加上市場。`apply_all_patrol_shift_templates_range` 改成依市場分批套用，或增加 `p_market` 參數。
4. **測試**：在 `tools/patrol-shift-bulk-reset-db.test.mjs` 增加一個情境：兩市都有同名範本時，套用全部範本後，一市的排定人員必須保留。

---

## 2. 觸發程序內含 service_role 金鑰（對應 #2）

### 現象
`repair_requests` 上的 `AFTER INSERT` 觸發程序 `line-notify-repair`（`supabase_functions.http_request`，呼叫 Edge Function `line-notify`），在 `Authorization` 標頭中直接寫入一組 role 為 `service_role` 的 JWT，期限到 2097 年。本報告不列出金鑰內容。

### 風險
- 觸發程序定義存放在系統目錄 `pg_trigger` 中。任何能連上資料庫的角色都讀得到，包含 Dashboard 協作者、SQL Editor 使用者，以及帶有 schema 的備份或匯出檔。
- service_role 會略過所有 RLS，等同資料庫完整讀寫權。
- 本 repo 是公開的。我想確認這把金鑰有沒有出現在 repo 檔案或 git 歷史中，但這項搜尋被本機權限規則擋下，**未驗證**。

### 建議修正（未執行）
1. 在 Supabase Dashboard 輪替 service_role 金鑰（或 JWT secret）。輪替前先盤點所有使用這把金鑰的地方，包括 Edge Function secrets、GitHub Actions 的 `database-backup.yml`，以及其他 Database Webhook。
2. 重建通知觸發：Edge Function 改成驗證一組專用的共享密鑰（存放在 Function secrets 與 Vault），不要再用 service_role；或改由資料庫寫入 outbox，再由排程中的 Edge Function 處理，與派車 LINE outbox 的作法一致。
3. 用專案既有的 `.gitleaks.toml` 對工作目錄與完整 git 歷史各跑一次 gitleaks，確認沒有外洩。

---

## 3. 報修單有狀態、沒有工單（對應 #3）

### 現象
共 47 筆報修單（44 筆未隱藏）。其中 6 筆的狀態已經不是 `pending` 或 `cancelled`，卻沒有任何 `maintenance_orders`：

| 報修單號 | 狀態 | 畫面顯示 | `case_status_log` | 最後更新（UTC） |
|---|---|---|---|---|
| 2026-07-01-274 | in_progress | 維修中 | 無紀錄 | 2026-08-15 03:46 |
| 2026-07-01-079 | closed | 已結案 | 無紀錄 | 2026-08-15 03:35 |
| 2026-07-01-575 | assigned | 待工程師接單 | 無紀錄 | 2026-08-15 03:34 |
| 2026-07-01-725 | assigned | 待工程師接單 | 04:41 連續 4 次「技師接單」，`order_id` 皆為空，狀態沒變 | 2026-08-15 04:41 |
| 2026-08-03-001 | in_progress | 維修中 | 只有「建立報修」 | 2026-08-15 03:12 |
| 20260815-001 | pending_review | 待報修人驗收 | `in_progress → pending_review`「維修完成，待驗收」，`order_id` 為空 | 2026-08-15 04:41 |

另外有 5 項報修單與工單之間的不一致：
- 報修單號 `2026-07-01-156` 有兩筆不同的報修單（一筆 assigned、一筆 closed），全表只有這一個單號重複。
- `2026-07-07-001` 掛了兩張工單（in_progress、assigned）。`apply_repair_workflow` 只取最新一張，較舊那張會一直留在清單上。
- `2026-07-01-343`：報修單已 closed，工單仍是 accepted。
- `2026-07-01-245`：報修單已 closed，工單仍是 pending_review。
- `2026-07-01-891`：報修單是 pending_review，工單仍是 accepted。

### 根因
1. **2026-08-15 開發期間的非交易寫入**：6 筆中有 5 筆的最後更新落在 2026-08-15 03:12–04:41 UTC，也就是台北 11:12–12:41，正好在當天 V2 派工流程開發的 commit 之間：`0616849ab`（11:31）、`c259c4d48`（12:24）、`6da8d9a4d`（13:04）。這幾版程式把「更新工單、更新報修單、寫歷程」拆成三次獨立的 REST 請求，而且歷程寫的是 `order_id: orderId || null`。所以沒有工單時，報修單狀態仍會被改動，歷程也照寫。同日 18:44 的 `91c58356b` 改成單一交易的 `apply_repair_workflow` 後才修正。這些資料是修正前留下的。舊版 V1 `system/workorder.html`（例如 `57810e891^` 版的 1002-1018 行）也是分次寫入、不檢查錯誤，同樣可能造成部分寫入。
2. **資料庫至今仍允許繞過流程**，所以這類資料仍可能再產生：
   - RLS 政策 `repair_requests_managed_update` 允許主管、建立者，以及任何工單被指派者更新報修單。觸發程序 `protect_repair_request_columns` 對非管理者也特別放行 `status` 與 `updated_at`。結果是任何有權限的人都能用 REST 直接改 `status`，沒有狀態機檢查，也不會寫歷程。
   - 舊函式 `repair_order_transition(p_request_id, p_action, p_order_id, p_note, p_payload)` 仍授權給 `authenticated`。它在 `p_order_id` 為空時不碰工單，但仍會改報修單狀態並寫歷程；`v_from` 是寫死的，也不檢查目前狀態是否允許這個動作。目前的 `web/`、`system/`、`supabase/functions/` 都已不呼叫它（只剩 `apply_repair_workflow`，見 `supabase/functions/app-api/index.ts:2872`）。
3. **現行流程是安全的**：`apply_repair_workflow` 除了 `dispatch` 之外，每個動作都要求已有工單，並同時檢查報修單與工單的狀態。

### 影響範圍
- 戰情儀表板的「處理中」「已逾期」與單位排行會把這 6 筆算進去。完工回報與驗收按鈕不會出現，因為工單不存在，詳細視窗只顯示「建立／補建派工」。
- 6 筆中，274 與 079 的描述是「第一市場 辦公室 漏水」，像是真實案件；其餘的描述是「12」「123」等測試字串（見第 4 節）。

### 建議修正（未執行）
1. **處理既有資料**（依專案規則不刪除，請逐筆決定）：
   - 測試案件：`repair_requests.hidden = true`。
   - 真實案件：assigned 或 in_progress 的用畫面上的「建立／補建派工」補建工單；已 closed 或 pending_review 的，請主管確認後再決定補建或隱藏。
   ```sql
   -- 草稿，未執行：只隱藏確認是測試的案件
   update public.repair_requests set hidden = true, updated_at = now()
   where req_no in ('2026-07-01-575','2026-07-01-725','2026-08-03-001','20260815-001');
   ```
2. **封住繞過路徑**：
   ```sql
   -- 草稿，未執行：確認沒有呼叫端後撤銷舊函式
   revoke execute on function public.repair_order_transition(uuid, text, uuid, text, jsonb) from authenticated;

   -- 草稿，未執行：status 只能經由流程函式修改
   -- apply_repair_workflow 開頭加上 perform set_config('app.repair_workflow', 'on', true);
   -- protect_repair_request_columns 加上：
   --   if new.status is distinct from old.status
   --      and coalesce(current_setting('app.repair_workflow', true), '') <> 'on' then
   --     raise exception '報修狀態只能經由流程操作變更' using errcode = '42501';
   --   end if;
   ```
   注意：`supabase/functions/app-api/index.ts:2805` 目前以 service_role 直接把報修單設為 `cancelled`，要一併改成呼叫 `apply_repair_workflow`，或在呼叫前設定同一個旗標。
3. **報修單號唯一性**：先把 `2026-07-01-156` 其中一筆改號，再建立 `create unique index … on repair_requests(req_no)`。
4. **一張報修單一張有效工單**：處理 `2026-07-07-001` 的舊工單後，加上部分唯一索引，例如 `on maintenance_orders(request_id) where status not in ('cancelled','returned','rejected')`。

---

## 4. 測試資料混入正式統計（對應 #4）

### 設備巡檢 `inspection_records`
全表只有 13 筆，都在 2026-06-21 19:35 ～ 06-22 16:47（台北時間）之間，由同一個帳號在上線前測試時建立，幾秒鐘內連續寫入。其中 4 筆是異常，異常說明都是無意義字串：

| record_id | 巡檢時間（台北） | 設備 | 結果 | 異常說明 |
|---|---|---|---|---|
| 3024ae2c-64bf-4b6f-bbe7-745e4552adfe | 2026-06-21 20:04:05 | EQ-E012 配電盤 3F | 異常 | 122 |
| c8fec1b1-3dab-4aeb-ae1e-6066ca76f039 | 2026-06-21 20:04:19 | EQ-E012 配電盤 3F | 異常 | 21212 |
| 8428da0b-2949-46ca-a3a1-da005111a713 | 2026-06-21 20:23:52 | EQ-E012 配電盤 3F | 異常 | 12 |
| 13edd917-d6d0-48e5-849d-5c3b61c80d69 | 2026-06-21 21:16:24 | EQ-E012 配電盤 3F | 異常 | ,mm,. |

其餘 9 筆是「正常」，同一段時間、同一個帳號，也應視為測試資料。`inspection_records` 沒有隱藏或作廢欄位。

### 報修 `repair_requests`
44 筆可見報修單中，有 15 筆的故障描述是測試字串：

| 報修單號 | 狀態 | 建立日 | 描述 |
|---|---|---|---|
| RP20260630-0001 | transferred | 06-21 | 122 |
| RP20260630-0002 | closed | 06-21 | 21212 |
| RP20260630-0003 | transferred | 06-21 | 12 |
| 2026-07-04-001 | assigned | 07-04 | fdgdsg |
| 2026-07-04-002 | cancelled | 07-04 | asasa |
| 2026-07-07-001 | assigned | 07-07 | 12212 |
| 2026-08-03-001 | in_progress | 08-03 | 123 |
| 2026-08-14-001 | closed | 08-14 | FDSA |
| 20260815-001 | pending_review | 08-15 | 12 |
| 20260815-002 | assigned | 08-15 | 11111212 |
| 2026-08-17-001～005 | closed／cancelled | 08-17 | fdsafsd、sadas、sadfasdf、vczx、cxzc |

`RP20260630-0001～0003` 的描述與上表的巡檢異常說明完全相同，是那幾筆測試巡檢轉成的報修單。

### 影響
戰情儀表板的處理中、已逾期、SLA、MTTR、維修人員案件數，交接簿的「每日報修與維修狀況」，以及位置與費用分析都會把這些資料算進去。

### 建議修正（未執行）
```sql
-- 草稿，未執行：巡檢紀錄增加作廢標記，不刪除
alter table public.inspection_records
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;
update public.inspection_records
   set voided_at = now(), void_reason = '上線前測試資料（2026-10-26 排查）'
 where inspect_time < '2026-06-23';

-- 草稿，未執行：報修單用既有 hidden 欄位
update public.repair_requests set hidden = true, updated_at = now()
 where req_no in ('RP20260630-0001','RP20260630-0002','RP20260630-0003',
                  '2026-07-04-001','2026-07-04-002','2026-07-07-001','2026-08-03-001',
                  '2026-08-14-001','20260815-001','20260815-002',
                  '2026-08-17-001','2026-08-17-002','2026-08-17-003','2026-08-17-004','2026-08-17-005');
```
隱藏前請先確認：
- 這 15 筆中有沒有正在進行的真實案件；
- 儀表板、交接簿帶入與分析頁是否都已排除 `hidden = true`（本次沒有驗證）；
- 巡檢的查詢是否會加上 `voided_at is null`。

---

## 5. 交接人顯示 UUID（對應 #6）

### 現象
指揮台交接單清單的「交接人 → 接班人」欄，有 1 筆顯示 `df745e7a-…`。

### 根因
- `handover_records` 共 7 筆，其中 2 筆的 `handover_by` 是帳號 `df745e7a-deb4-471d-99f6-ba52464d2322`（工號 022372，角色 reporter）。這個帳號存在，但 `status = inactive`。
- `web/app/systems/[system]/[module]/handover-workspace.tsx:136` 只載入 `status = active` 的人員，經 `selectableActiveUsers` 後存入 `users`。第 154 行的 `nameOf` 又用同一份名單對照姓名，找不到時退回顯示原始 UUID。也就是說，「可以選的人」與「要顯示姓名的人」用了同一份名單。
- 同一個檔案的「未結事項」（`handover_cases`，第 479、488 行）是同樣寫法。
- `business-handover.tsx:246, 348`（業管組）也只載入在職人員，但找不到時顯示「—」，畫面上看不出是誰經手。
- 不受影響：`mechanical-handover.tsx:227, 259` 使用不篩選狀態的 `directoryUsers`；駐警隊交接簿的姓名由伺服器端的 `context.people` 提供；巡檢排班 `patrol-workspace.tsx:230` 也已註明「名稱查詢仍用完整名冊」。
- 附帶：這 2 筆中有 1 筆的 `shift_date` 是 `2023-02-15`（建立於 2026-08-05），應是日期誤植或測試資料。

### 建議修正（未執行）
比照機電課的作法，讓選單名單與姓名對照名冊分開。
```ts
// handover-workspace.tsx（草稿）
const [directory, setDirectory] = useState<Row[]>([]);
// load()：多抓一份不篩選狀態的名冊
client.from('users').select('user_id,name,status').order('name').limit(2000),
// …
setUsers(selectableActiveUsers(u.data || []));   // 下拉選單：只列在職
setDirectory(dir.data || []);                    // 姓名對照：包含停用與去識別化帳號
const nameOf = useCallback((id: unknown) => {
  const hit = directory.find(u => u.user_id === id);
  return hit ? `${hit.name}${hit.status === 'active' ? '' : '（已停用）'}` : id ? '（人員資料不存在）' : '—';
}, [directory]);
```
指揮台、未結事項、業管組三處都要改。改完後，非管理者是否讀得到停用帳號，要用一般角色實測，確認 RLS 允許。

---

## 附錄：本次執行的查詢類型
- 資料表：`patrol_shift_template`、`patrol_shifts`、`audit_logs`、`handover_records`、`users`、`repair_requests`、`maintenance_orders`、`case_status_log`、`inspection_records`、`equipment`。只有 `SELECT`。
- 系統目錄：`information_schema.columns`、`pg_indexes`、`pg_policy`、`pg_trigger`、`pg_proc`（`pg_get_functiondef`）、`supabase_migrations.schema_migrations`。
- 程式：`web/`、`supabase/functions/`、`supabase/migrations/`，以及 `system/workorder.html` 的 git 歷史版本。
