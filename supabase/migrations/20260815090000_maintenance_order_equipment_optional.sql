-- Allow direct repair requests without a linked equipment record to be dispatched.
-- The request form accepts a free-text fault location, so equipment_id is optional.
alter table if exists public.maintenance_orders
  alter column equipment_id drop not null;
