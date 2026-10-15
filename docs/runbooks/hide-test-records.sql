-- 正式資料中的測試資料處理（隱藏，不實體刪除）
-- 依 AGENTS.md：正式資料只增、改、停用，永久資料保護 trigger 也會拒絕 DELETE／TRUNCATE，
-- 因此「清除」以 hidden = true 處理；戰情儀表板、電視牆、排行與統計都會略過 hidden 的列，
-- 可隨時以 hidden = false 還原。
--
-- 使用方式（Supabase SQL Editor，以專案擁有者身分）：
--   1. 先只執行「步驟 1」確認清單，確認每一列都是測試資料。
--   2. 再執行「步驟 2」。整段包在交易內，最後會印出受影響筆數；數字不符就 ROLLBACK。
--   3. 「已離職人員-xxxx」是去識別化的離職帳號，屬法定保存資料，不要隱藏。

-- ===== 步驟 1：預覽（唯讀） =====
select o.order_id, o.status, o.created_at, o.hidden, u.name as assignee, u.status as assignee_status
from maintenance_orders o
join users u on u.user_id = o.assignee_id
where u.name ilike '%E2E%' or u.name like '%測試%'
order by o.created_at;

select r.request_id, r.status, r.created_at, r.hidden, r.department, r.fault_desc
from repair_requests r
where r.request_id in (
  select o.request_id from maintenance_orders o
  join users u on u.user_id = o.assignee_id
  where u.name ilike '%E2E%' or u.name like '%測試%'
);

-- ===== 步驟 2：隱藏（可還原） =====
begin;

with test_users as (
  select user_id from users where name ilike '%E2E%' or name like '%測試%'
), hide_orders as (
  update maintenance_orders set hidden = true
  where assignee_id in (select user_id from test_users) and coalesce(hidden, false) = false
  returning request_id
), hide_requests as (
  update repair_requests set hidden = true
  where request_id in (select request_id from hide_orders) and coalesce(hidden, false) = false
  returning request_id
)
select (select count(*) from hide_orders) as hidden_orders,
       (select count(*) from hide_requests) as hidden_requests;

-- 確認筆數與步驟 1 的預覽一致後執行 COMMIT；不一致請執行 ROLLBACK。
-- commit;
-- rollback;

-- ===== 還原（若需要） =====
-- update maintenance_orders set hidden = false where assignee_id in (select user_id from users where name ilike '%E2E%' or name like '%測試%');
