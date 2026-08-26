-- 夜班的「值班日」是前一日，實際班別資料與通報設定則保存於隔日。
-- 例如值班日 2026-08-25 的夜班 00:00–08:00，資料列保存為 2026-08-26，
-- 讓凌晨打卡、逾時通知與排班頁使用同一個實際日期軸。

begin;

create or replace function public.apply_patrol_shift_template_range(
  p_template_id uuid,
  p_from        date,
  p_to          date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tpl          record;
  v_day          date;
  v_storage_day  date;
  v_count        integer := 0;
  v_staff        jsonb;
  v_work         jsonb;
  v_op           uuid;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = '只有系統管理者可以維護巡檢排班';
  end if;
  if p_from is null or p_to is null then
    raise exception using errcode = '22023', message = '請指定套用的起訖日期';
  end if;
  if p_to < p_from then
    raise exception using errcode = '22023', message = '迄日不可早於起日';
  end if;
  if (p_to - p_from) > 365 then
    raise exception using errcode = '22023', message = '一次最多只能套用 366 天';
  end if;

  select * into v_tpl from public.patrol_shift_template where template_id = p_template_id;
  if not found then
    raise exception using errcode = '02000', message = '找不到這個班別範本';
  end if;
  if coalesce(v_tpl.status, 'active') = 'inactive' then
    raise exception using errcode = '22023', message = '這個班別範本已刪除，不能套用';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t.id)), '[]'::jsonb)
  into v_staff
  from unnest(coalesce(v_tpl.assigned_user_ids, '{}'::uuid[])) as t(id);

  select coalesce(
           nullif(btrim(coalesce(value, '')), '')::jsonb #> array['workTimes', 'templates', v_tpl.name],
           '{}'::jsonb)
  into v_work
  from public.system_settings
  where key = 'patrol_shift_staff';

  v_day := p_from;
  while v_day <= p_to loop
    -- 夜班顯示在前一日，但 00:00–08:00 的實際資料屬於隔日。
    v_storage_day := case
      when replace(coalesce(v_tpl.name, ''), ' ', '') ~* '(夜班|night)' then v_day + 1
      else v_day
    end;

    insert into public.patrol_shifts (shift_date, name, start_time, end_time, sort_order, assigned_user_ids)
    values (v_storage_day, v_tpl.name, v_tpl.start_time, v_tpl.end_time,
            coalesce(v_tpl.sort_order, 0), coalesce(v_tpl.assigned_user_ids, '{}'::uuid[]))
    on conflict (shift_date, name) do update
    set start_time        = excluded.start_time,
        end_time          = excluded.end_time,
        sort_order        = excluded.sort_order,
        assigned_user_ids = excluded.assigned_user_ids;

    perform public.patrol_staff_config_apply(
      'date', to_char(v_storage_day, 'YYYY-MM-DD'), v_tpl.name, v_staff,
      nullif(coalesce(v_work->>'start', ''), ''), nullif(coalesce(v_work->>'end', ''), ''));

    v_count := v_count + 1;
    v_day := v_day + 1;
  end loop;

  select user_id into v_op from public.users where auth_id = auth.uid() and status = 'active';
  insert into public.audit_logs (table_name, record_id, action, changes, operator_id, source)
  values ('patrol_shifts', p_template_id::text, 'insert',
          jsonb_build_object('template', v_tpl.name, 'from', p_from, 'to', p_to,
                             'days', v_count, 'night_shift_storage', 'next_calendar_day'),
          v_op, 'v2-patrol-range');

  return v_count;
end;
$$;

revoke all on function public.apply_patrol_shift_template_range(uuid, date, date) from public, anon;
grant execute on function public.apply_patrol_shift_template_range(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';

commit;
