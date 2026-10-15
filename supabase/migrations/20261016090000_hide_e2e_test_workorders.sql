-- 隱藏正式資料中 2026-08-25 的 E2E 測試工單與其報修案件（hidden = true，不實體刪除，可還原）。
--
-- 背景：docs/runbooks/hide-test-records.sql 的步驟 2 在 SQL Editor 執行時是 postgres 身分、沒有登入者，
-- public.can_manage_workorder() 為 false，因此 trg_protect_technician_order_columns 與
-- trg_protect_repair_request_columns 會拒絕任何 UPDATE，整筆交易回滾。
--
-- 作法：只針對下列 3 組（工單 → 報修案件，2026-10-16 以 request_id 逐筆核對）在同一交易內
-- 暫停這兩個保護觸發器、只改 hidden 欄位，改完立即重新啟用；狀態機觸發器（before update of status）
-- 不受影響，因為這裡不改 status。
--   8b152df7-0a27-4b84-9129-cd3f0edbbee7 → 1fafba76-0224-41a0-b432-dd819ff7f44a
--   39b209fd-fee7-4077-98a8-461e6ba18102 → d0843f78-4d64-4872-978a-06dfa0ee31a5
--   ccab8940-54d5-46dd-82c8-99c5a0ceadd6 → 78b39f04-bb29-47b6-a7f5-083af0b8bc8b
--
-- 防呆：
--   - 3 組都找不到（全新或其他環境）：只印 notice，不做任何事。
--   - 只找到部分、或負責人不是 E2E 測試帳號、或工單未結案：raise，整筆回滾。
--   - 已經隱藏的列不重複更新；重跑沒有副作用。
--   - 事後驗證 6 筆都必須是 hidden = true，且兩個觸發器已重新啟用，否則 raise 回滾。
--
-- 還原（若需要，另以 migration 執行）：同樣暫停觸發器後把這 6 筆的 hidden 改回 false。

begin;

do $$
declare
  target_orders constant uuid[] := array[
    '8b152df7-0a27-4b84-9129-cd3f0edbbee7',
    '39b209fd-fee7-4077-98a8-461e6ba18102',
    'ccab8940-54d5-46dd-82c8-99c5a0ceadd6'
  ]::uuid[];
  target_requests constant uuid[] := array[
    '1fafba76-0224-41a0-b432-dd819ff7f44a',
    'd0843f78-4d64-4872-978a-06dfa0ee31a5',
    '78b39f04-bb29-47b6-a7f5-083af0b8bc8b'
  ]::uuid[];
  present int;
  matched int;
  hidden_orders int;
  hidden_requests int;
  has_order_guard boolean;
  has_request_guard boolean;
begin
  select count(*) into present from public.maintenance_orders where order_id = any(target_orders);
  if present = 0 then
    raise notice 'hide_e2e_test_workorders：此資料庫沒有目標工單，略過。';
    return;
  end if;

  -- 三組必須完整、一一對應、已結案，且負責人是 E2E 測試帳號。
  select count(*) into matched
  from public.maintenance_orders o
  join public.users u on u.user_id = o.assignee_id
  where o.order_id = any(target_orders)
    and o.request_id = any(target_requests)
    and o.status = 'closed'
    and u.name ilike '%E2E%';
  if matched <> 3 then
    raise exception 'hide_e2e_test_workorders：預期 3 筆 E2E 測試工單，實際符合 % 筆（存在 % 筆）；不執行。', matched, present;
  end if;

  select exists(select 1 from pg_trigger where tgrelid = 'public.maintenance_orders'::regclass
                and tgname = 'trg_protect_technician_order_columns' and not tgisinternal)
    into has_order_guard;
  select exists(select 1 from pg_trigger where tgrelid = 'public.repair_requests'::regclass
                and tgname = 'trg_protect_repair_request_columns' and not tgisinternal)
    into has_request_guard;

  if has_order_guard then
    alter table public.maintenance_orders disable trigger trg_protect_technician_order_columns;
  end if;
  if has_request_guard then
    alter table public.repair_requests disable trigger trg_protect_repair_request_columns;
  end if;

  update public.maintenance_orders set hidden = true
  where order_id = any(target_orders) and coalesce(hidden, false) = false;
  get diagnostics hidden_orders = row_count;

  update public.repair_requests set hidden = true
  where request_id = any(target_requests) and coalesce(hidden, false) = false;
  get diagnostics hidden_requests = row_count;

  if has_order_guard then
    alter table public.maintenance_orders enable trigger trg_protect_technician_order_columns;
  end if;
  if has_request_guard then
    alter table public.repair_requests enable trigger trg_protect_repair_request_columns;
  end if;

  -- 事後驗證。
  if (select count(*) from public.maintenance_orders where order_id = any(target_orders) and hidden) <> 3
     or (select count(*) from public.repair_requests where request_id = any(target_requests) and hidden) <> 3 then
    raise exception 'hide_e2e_test_workorders：事後檢查不符，回滾。';
  end if;
  if (has_order_guard and exists(select 1 from pg_trigger where tgrelid = 'public.maintenance_orders'::regclass
        and tgname = 'trg_protect_technician_order_columns' and tgenabled = 'D'))
     or (has_request_guard and exists(select 1 from pg_trigger where tgrelid = 'public.repair_requests'::regclass
        and tgname = 'trg_protect_repair_request_columns' and tgenabled = 'D')) then
    raise exception 'hide_e2e_test_workorders：保護觸發器未重新啟用，回滾。';
  end if;

  raise notice 'hide_e2e_test_workorders：hidden_orders = %，hidden_requests = %', hidden_orders, hidden_requests;
end $$;

commit;
