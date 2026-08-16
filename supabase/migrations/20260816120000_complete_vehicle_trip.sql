-- 司機行車回報改為單一交易完成：更新申請單、車輛目前里程與流程歷程。
--
-- 原本前端分三次呼叫（更新申請單 → 更新 official_vehicles → 寫入 logs），有兩個問題：
--
-- 1. 非原子：任一步失敗都會留下不一致狀態，例如行程已完成但里程未更新、
--    或狀態已變更但歷程沒寫進去（addLog 的錯誤原本只有 console.warn）。
-- 2. 車輛里程實際上從未更新：official_vehicles 的 RLS（vehicles_manager_update）
--    要求 is_admin() 或啟用中的派車管理員，司機兩者皆非，該次 update 會被 RLS
--    擋下並回傳 0 列；前端未檢查結果，因此失敗是靜默的。
--
-- 本函式以 security definer 執行，讓司機得以在完成回報時連帶更新車輛里程，
-- 同時保留既有的權限與流程保證：guard_vehicle_dispatch_assignment_and_driver
-- 與 guard_vehicle_dispatch_time_window 兩個 trigger 仍會照常觸發，並且函式內
-- 不改寫 auth.uid()，故「只有被指派且已接單的司機才能完成回報」等規則不變。

begin;

create or replace function public.complete_vehicle_trip(
  p_request_id             uuid,
  p_actual_passenger_count integer,
  p_actual_departure_at    timestamptz,
  p_actual_return_at       timestamptz,
  p_odometer_start         numeric,
  p_odometer_end           numeric,
  p_last_refuel_odometer   numeric     default null,
  p_last_refuel_cost       numeric     default null,
  p_refueled               boolean     default false,
  p_refuel_odometer        numeric     default null,
  p_refuel_cost            numeric     default null,
  p_has_abnormality        boolean     default false,
  p_abnormality_note       text        default null,
  p_driver_note            text        default null
)
returns public.vehicle_dispatch_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id   uuid;
  v_actor_name text;
  v_request    public.vehicle_dispatch_requests;
  v_refueled   boolean := coalesce(p_refueled, false);
  v_abnormal   boolean := coalesce(p_has_abnormality, false);
  v_mileage    numeric;
begin
  select u.user_id, u.name into v_actor_id, v_actor_name
  from public.users u
  where u.auth_id = auth.uid() and u.status = 'active'
  limit 1;

  if v_actor_id is null then
    raise exception using errcode = '42501', message = '找不到有效的派車系統人員帳號';
  end if;

  -- 鎖定該列，避免兩個分頁同時送出回報。
  select * into v_request
  from public.vehicle_dispatch_requests
  where request_id = p_request_id
  for update;

  if not found then
    raise exception using errcode = '02000', message = '找不到這筆派車申請';
  end if;

  if v_request.status <> 'assigned' then
    raise exception using errcode = '22023', message = '案件狀態已變更，請重新整理';
  end if;

  -- 以下三項為資料表 CHECK 約束與既有 trigger 均未涵蓋、原本只存在於前端的驗證。
  -- 其餘規則（回程里程不得小於起始、加油里程須介於起訖之間、實際時間不得晚於
  -- 現在、出發日須等於用車日等）已由 CHECK 或 trigger 負責，此處不重複實作。
  if v_refueled and (p_refuel_cost is null or p_refuel_cost < 0) then
    raise exception using errcode = '23514', message = '請填寫正確的本次加油費用';
  end if;

  if p_last_refuel_cost is not null and p_last_refuel_cost < 0 then
    raise exception using errcode = '23514', message = '上次加油費用不得為負數';
  end if;

  if v_abnormal and coalesce(btrim(p_abnormality_note), '') = '' then
    raise exception using errcode = '23514', message = '勾選異常通報時，請填寫異常內容';
  end if;

  update public.vehicle_dispatch_requests set
    status                 = 'completed',
    actual_passenger_count = p_actual_passenger_count,
    actual_departure_at    = p_actual_departure_at,
    actual_return_at       = p_actual_return_at,
    odometer_start         = p_odometer_start,
    odometer_end           = p_odometer_end,
    last_refuel_odometer   = p_last_refuel_odometer,
    last_refuel_cost       = p_last_refuel_cost,
    refueled               = v_refueled,
    refuel_odometer        = case when v_refueled then p_refuel_odometer end,
    refuel_cost            = case when v_refueled then p_refuel_cost end,
    has_abnormality        = v_abnormal,
    abnormality_note       = case when v_abnormal then btrim(p_abnormality_note) end,
    driver_note            = nullif(btrim(coalesce(p_driver_note, '')), ''),
    completed_at           = now()
  where request_id = p_request_id
    and status = 'assigned'
  returning * into v_request;

  if not found then
    raise exception using errcode = '22023', message = '案件狀態已變更，請重新整理';
  end if;

  -- 車輛目前里程只增不減，避免較舊的回報把里程往回寫。
  if v_request.vehicle_id is not null then
    update public.official_vehicles
    set current_odometer = p_odometer_end
    where vehicle_id = v_request.vehicle_id
      and p_odometer_end > current_odometer;
  end if;

  v_mileage := coalesce(p_odometer_end, 0) - coalesce(p_odometer_start, 0);

  insert into public.vehicle_dispatch_logs
    (request_id, from_status, to_status, action, note, operator_id, operator_name)
  values (
    p_request_id, 'assigned', 'completed', '司機完成行車回報',
    format('實際 %s 人｜%s km%s%s',
      coalesce(p_actual_passenger_count, 0),
      to_char(v_mileage, 'FM999999990.0'),
      case when v_refueled then format('｜加油 %s 元', to_char(coalesce(p_refuel_cost, 0), 'FM999999990.00')) else '' end,
      case when v_abnormal then '｜有異常通報' else '' end),
    v_actor_id, v_actor_name
  );

  return v_request;
end;
$$;

revoke all on function public.complete_vehicle_trip(
  uuid, integer, timestamptz, timestamptz, numeric, numeric,
  numeric, numeric, boolean, numeric, numeric, boolean, text, text
) from public, anon;

grant execute on function public.complete_vehicle_trip(
  uuid, integer, timestamptz, timestamptz, numeric, numeric,
  numeric, numeric, boolean, numeric, numeric, boolean, text, text
) to authenticated;

commit;
