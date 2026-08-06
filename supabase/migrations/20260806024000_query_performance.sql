-- Bounded dashboard aggregation and indexes for common production filters.

create index if not exists idx_repair_requests_created_status on public.repair_requests(created_at,status);
create index if not exists idx_repair_requests_created_by on public.repair_requests(created_by);
create index if not exists idx_maintenance_orders_request on public.maintenance_orders(request_id);
create index if not exists idx_maintenance_orders_status_created on public.maintenance_orders(status,created_at);
create index if not exists idx_maintenance_orders_assignee on public.maintenance_orders(assignee_id);
create index if not exists idx_checkin_logs_user_checked on public.checkin_logs(user_id,checkin_at desc);
create index if not exists idx_checkin_logs_target_checked on public.checkin_logs(target_type,target_id,checkin_at desc);
create index if not exists idx_repair_attachments_request on public.repair_attachments(request_id);
create index if not exists idx_case_status_log_request_created on public.case_status_log(request_id,created_at);
create index if not exists idx_handover_cases_status_created on public.handover_cases(status,created_at);
create index if not exists idx_vehicle_requests_trip_status on public.vehicle_dispatch_requests(trip_date,status);
create index if not exists idx_vehicle_logs_request_created on public.vehicle_dispatch_logs(request_id,created_at);
create index if not exists idx_vehicle_attachments_request on public.vehicle_dispatch_attachments(request_id);

create or replace function public.repair_monthly_counts(p_start date,p_end date)
returns table(month_key text,total bigint)
language sql
security invoker
stable
set search_path=public,pg_temp
as $$
  select to_char(date_trunc('month',created_at at time zone 'Asia/Taipei'),'YYYY-MM'),count(*)
  from public.repair_requests
  where created_at >= p_start::timestamp at time zone 'Asia/Taipei'
    and created_at < (p_end+1)::timestamp at time zone 'Asia/Taipei'
    and coalesce(hidden,false)=false
  group by 1 order by 1
$$;

revoke all on function public.repair_monthly_counts(date,date) from public,anon;
grant execute on function public.repair_monthly_counts(date,date) to authenticated;
