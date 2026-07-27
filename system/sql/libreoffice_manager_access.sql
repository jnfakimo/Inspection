-- ============================================================
-- Supabase x LibreOffice Base - management read-only layer
--
-- Purpose:
--   Expose only the fields needed by management reports without granting
--   direct access to the underlying application tables.
--
-- Safe to run repeatedly. This script never deletes or truncates data.
-- Set the office_manager password separately in Supabase SQL Editor:
--   alter role office_manager password '<strong password>';
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'office_manager') then
    create role office_manager login;
  end if;
end
$$;

grant connect on database postgres to office_manager;
grant usage on schema public to office_manager;
revoke create on schema public from office_manager;

-- A previously tested package granted every public table. Remove that broad
-- permission before granting access to the curated views below.
revoke all privileges on all tables in schema public from office_manager;
revoke all privileges on all sequences in schema public from office_manager;

create or replace view public.vw_manager_equipment
with (security_barrier = true)
as
select
  e.equipment_id,
  e.qr_code as equipment_code,
  e.name as equipment_name,
  e.category as equipment_category,
  e.brand,
  e.model,
  e.serial_no,
  e.location,
  e.status,
  e.purchase_date,
  e.warranty_until,
  e.service_life_y,
  e.created_at
from public.equipment e;

create or replace view public.vw_manager_inspections
with (security_barrier = true)
as
select
  r.record_id as inspection_id,
  r.inspect_time::date as inspection_date,
  r.inspect_time,
  r.run_status as inspection_result,
  r.abnormal_note,
  r.light_status,
  r.location_point,
  e.equipment_id,
  e.qr_code as equipment_code,
  e.name as equipment_name,
  e.category as equipment_category,
  e.location as equipment_location,
  u.name as inspector_name,
  u.department as inspector_department
from public.inspection_records r
join public.equipment e on e.equipment_id = r.equipment_id
join public.users u on u.user_id = r.inspector_id
where coalesce(u.hidden, false) = false;

create or replace view public.vw_manager_today_inspections
with (security_barrier = true)
as
select *
from public.vw_manager_inspections
where inspection_date = current_date;

create or replace view public.vw_manager_abnormal_inspections
with (security_barrier = true)
as
select *
from public.vw_manager_inspections
where inspection_result = 'abnormal' or light_status = 'red';

create or replace view public.vw_manager_repairs
with (security_barrier = true)
as
select
  rr.request_id,
  rr.req_no,
  rr.created_at,
  rr.updated_at,
  rr.source,
  rr.reporter,
  rr.department,
  rr.phone,
  rr.mobile,
  rr.fault_location,
  rr.fault_type,
  rr.fault_desc,
  rr.impact_level,
  rr.affects_operation,
  rr.urgency,
  rr.desired_finish,
  rr.status,
  e.equipment_id,
  e.qr_code as equipment_code,
  e.name as equipment_name,
  e.category as equipment_category,
  assignee.name as assignee_name,
  assignee.department as assignee_department
from public.repair_requests rr
left join public.equipment e on e.equipment_id = rr.equipment_id
left join public.users assignee on assignee.user_id = rr.assignee_id
where coalesce(rr.hidden, false) = false;

create or replace view public.vw_manager_open_repairs
with (security_barrier = true)
as
select *
from public.vw_manager_repairs
where status not in ('completed', 'closed', 'rejected', 'cancelled');

create or replace view public.vw_manager_maintenance_orders
with (security_barrier = true)
as
select
  mo.order_id,
  mo.wo_no,
  mo.request_id,
  rr.req_no,
  mo.created_at,
  mo.status,
  mo.accept_status,
  mo.start_time,
  mo.arrival_time,
  mo.finish_time,
  mo.expected_arrival,
  mo.expected_finish,
  mo.work_content,
  mo.fault_cause,
  mo.handle_method,
  mo.parts_used,
  mo.labor_hours,
  mo.vendor,
  mo.result_desc,
  e.equipment_id,
  e.qr_code as equipment_code,
  e.name as equipment_name,
  assignee.name as assignee_name,
  assignee.department as assignee_department
from public.maintenance_orders mo
join public.repair_requests rr on rr.request_id = mo.request_id
join public.equipment e on e.equipment_id = mo.equipment_id
left join public.users assignee on assignee.user_id = mo.assignee_id
where coalesce(mo.hidden, false) = false
  and coalesce(rr.hidden, false) = false;

create or replace view public.vw_manager_monthly_kpi
with (security_barrier = true)
as
with month_keys as (
  select date_trunc('month', inspect_time)::date as month_start
  from public.inspection_records
  union
  select date_trunc('month', created_at)::date
  from public.repair_requests
), inspection_stats as (
  select
    date_trunc('month', inspect_time)::date as month_start,
    count(*) as total_inspections,
    count(*) filter (where run_status = 'normal') as normal_inspections,
    count(*) filter (where run_status = 'abnormal' or light_status = 'red') as abnormal_inspections
  from public.inspection_records
  group by 1
), repair_stats as (
  select
    date_trunc('month', created_at)::date as month_start,
    count(*) filter (where coalesce(hidden, false) = false) as total_repairs,
    count(*) filter (
      where coalesce(hidden, false) = false
        and status in ('completed', 'closed')
    ) as completed_repairs,
    count(*) filter (
      where coalesce(hidden, false) = false
        and status not in ('completed', 'closed', 'rejected', 'cancelled')
    ) as open_repairs
  from public.repair_requests
  group by 1
)
select
  m.month_start,
  coalesce(i.total_inspections, 0) as total_inspections,
  coalesce(i.normal_inspections, 0) as normal_inspections,
  coalesce(i.abnormal_inspections, 0) as abnormal_inspections,
  case
    when coalesce(i.total_inspections, 0) = 0 then 0
    else round(i.normal_inspections::numeric * 100 / i.total_inspections, 2)
  end as normal_rate_percent,
  coalesce(r.total_repairs, 0) as total_repairs,
  coalesce(r.completed_repairs, 0) as completed_repairs,
  coalesce(r.open_repairs, 0) as open_repairs
from month_keys m
left join inspection_stats i using (month_start)
left join repair_stats r using (month_start)
order by m.month_start desc;

grant select on
  public.vw_manager_equipment,
  public.vw_manager_inspections,
  public.vw_manager_today_inspections,
  public.vw_manager_abnormal_inspections,
  public.vw_manager_repairs,
  public.vw_manager_open_repairs,
  public.vw_manager_maintenance_orders,
  public.vw_manager_monthly_kpi
to office_manager;

-- Keep future tables private by default. Access must be added explicitly via
-- a reviewed management view.
alter default privileges in schema public
revoke all on tables from office_manager;

notify pgrst, 'reload schema';
