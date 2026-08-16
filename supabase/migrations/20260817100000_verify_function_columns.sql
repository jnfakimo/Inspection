-- 驗證本輪新增函式所參照的欄位確實存在於正式環境。
--
-- 背景：plpgsql 於建立函式時不驗證欄位參照，因此 create or replace function 成功
-- 不代表函式可執行。20260816170000 的 save_patrol_shift_template 即因
-- patrol_shift_template.assigned_user_ids 不存在而在執行階段以 42703 失敗，該問題
-- 直到 20260817090000 回填時才浮現。
--
-- 本 migration 逐一比對，任一欄位缺失即中止並指出缺哪一個；套用成功即代表
-- complete_vehicle_trip、handover_case_action、save_patrol_shift、
-- save_patrol_shift_template、repair_order_transition、vehicle_request_action
-- 所需的欄位齊備。不修改任何資料。

begin;

do $$
declare
  spec  text;
  parts text[];
  missing text[] := '{}';
begin
  foreach spec in array array[
    -- complete_vehicle_trip / vehicle_request_action
    'vehicle_dispatch_requests:status','vehicle_dispatch_requests:actual_passenger_count',
    'vehicle_dispatch_requests:actual_departure_at','vehicle_dispatch_requests:actual_return_at',
    'vehicle_dispatch_requests:odometer_start','vehicle_dispatch_requests:odometer_end',
    'vehicle_dispatch_requests:last_refuel_odometer','vehicle_dispatch_requests:last_refuel_cost',
    'vehicle_dispatch_requests:refueled','vehicle_dispatch_requests:refuel_odometer',
    'vehicle_dispatch_requests:refuel_cost','vehicle_dispatch_requests:has_abnormality',
    'vehicle_dispatch_requests:abnormality_note','vehicle_dispatch_requests:driver_note',
    'vehicle_dispatch_requests:completed_at','vehicle_dispatch_requests:vehicle_id',
    'vehicle_dispatch_requests:trip_date','vehicle_dispatch_requests:driver_id',
    'vehicle_dispatch_requests:driver_accepted_at','vehicle_dispatch_requests:driver_accepted_by',
    'vehicle_dispatch_requests:applicant_id','vehicle_dispatch_requests:supervisor_id',
    'vehicle_dispatch_requests:supervisor_name','vehicle_dispatch_requests:supervisor_note',
    'vehicle_dispatch_requests:approved_at','vehicle_dispatch_requests:vehicle_manager_id',
    'vehicle_dispatch_requests:vehicle_manager_name','vehicle_dispatch_requests:plate_no',
    'vehicle_dispatch_requests:driver_name','vehicle_dispatch_requests:dispatch_note',
    'vehicle_dispatch_requests:dispatched_at','vehicle_dispatch_requests:cancel_reason',
    'vehicle_dispatch_requests:cancelled_at','vehicle_dispatch_requests:origin_location',
    'vehicle_dispatch_requests:destination_location',
    'official_vehicles:current_odometer','official_vehicles:plate_no',
    'vehicle_dispatch_logs:request_id','vehicle_dispatch_logs:from_status',
    'vehicle_dispatch_logs:to_status','vehicle_dispatch_logs:action',
    'vehicle_dispatch_logs:note','vehicle_dispatch_logs:operator_id','vehicle_dispatch_logs:operator_name',
    -- handover_case_action / log_handover_case_created
    'handover_cases:case_id','handover_cases:case_no','handover_cases:title',
    'handover_cases:status','handover_cases:assigned_to','handover_cases:created_by',
    'handover_cases:closed_at','handover_cases:closed_by','handover_cases:updated_at',
    'handover_case_logs:case_id','handover_case_logs:action','handover_case_logs:content',
    'handover_case_logs:old_data','handover_case_logs:new_data','handover_case_logs:created_by',
    -- save_patrol_shift / save_patrol_shift_template
    'patrol_shifts:shift_date','patrol_shifts:name','patrol_shifts:start_time',
    'patrol_shifts:end_time','patrol_shifts:sort_order','patrol_shifts:assigned_user_ids',
    'patrol_shift_template:template_id','patrol_shift_template:name',
    'patrol_shift_template:start_time','patrol_shift_template:end_time',
    'patrol_shift_template:sort_order','patrol_shift_template:assigned_user_ids',
    'system_settings:key','system_settings:value','system_settings:updated_at',
    -- repair_order_transition
    'repair_requests:request_id','repair_requests:status','repair_requests:assignee_id',
    'repair_requests:updated_at','repair_requests:created_by',
    'maintenance_orders:order_id','maintenance_orders:request_id','maintenance_orders:status',
    'maintenance_orders:accept_status','maintenance_orders:start_time','maintenance_orders:arrival_time',
    'maintenance_orders:finish_time','maintenance_orders:fault_cause','maintenance_orders:handle_method',
    'maintenance_orders:parts_used','maintenance_orders:materials','maintenance_orders:labor_hours',
    'maintenance_orders:assignee_id',
    'case_status_log:request_id','case_status_log:order_id','case_status_log:from_status',
    'case_status_log:to_status','case_status_log:note','case_status_log:operator_id',
    'case_status_log:operator_name',
    -- 共用
    'users:user_id','users:auth_id','users:status','users:name','users:username'
  ] loop
    parts := string_to_array(spec, ':');
    if to_regclass('public.' || parts[1]) is null then
      missing := missing || (spec || '（資料表不存在）');
    elsif not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = parts[1] and column_name = parts[2]
    ) then
      missing := missing || spec;
    end if;
  end loop;

  if array_length(missing, 1) > 0 then
    raise exception using errcode = '42703',
      message = '以下欄位不存在，相關函式將於執行階段失敗：' || array_to_string(missing, '、');
  end if;

  raise notice '欄位驗證通過：本輪新增函式所需欄位皆存在。';
end $$;

commit;
