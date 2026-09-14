-- 從指定值班日起軟刪除全部巡檢班別；班別異動與逐筆稽核必須同一交易完成。
-- 夜班新資料存於隔日，因此界線日上的夜班原則上屬於前一值班日；只有呼叫端
-- 明確帶入畫面所見的舊制夜班識別碼時才清除。

begin;

create or replace function public.soft_delete_patrol_shifts_from_date(
  p_from date,
  p_duty_shift_ids uuid[] default '{}'::uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_shift record;
  v_hidden_name text;
  v_operator uuid;
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = '只有系統管理者可以清除巡檢班別';
  end if;
  if p_from is null then
    raise exception using errcode = '22023', message = '請指定清除起始值班日';
  end if;
  if p_from < (current_timestamp at time zone 'Asia/Taipei')::date then
    raise exception using errcode = '22023', message = '只能清除今天或未來的班別，過去班表必須保留';
  end if;

  select user_id into v_operator
  from public.users
  where auth_id = auth.uid() and status = 'active';
  if v_operator is null then
    raise exception using errcode = '42501', message = '找不到有效的操作人員';
  end if;

  for v_shift in
    select shift_id, shift_date, name, assigned_user_ids
    from public.patrol_shifts
    where name not like '[已刪除]%'
      and (
        shift_date > p_from
        or (
          shift_date = p_from
          and (
            replace(coalesce(name, ''), ' ', '') !~* '(夜班|night)'
            or shift_id = any(coalesce(p_duty_shift_ids, '{}'::uuid[]))
          )
        )
      )
    order by shift_date, shift_id
    for update
  loop
    v_hidden_name := '[已刪除] ' || v_shift.name || ' ' || substr(v_shift.shift_id::text, 1, 8);
    update public.patrol_shifts
    set name = v_hidden_name,
        assigned_user_ids = '{}'::uuid[]
    where shift_id = v_shift.shift_id;

    insert into public.audit_logs(table_name, record_id, action, changes, operator_id, source)
    values (
      'patrol_shifts', v_shift.shift_id::text, 'update',
      jsonb_build_object(
        'before', jsonb_build_object(
          'shift_date', v_shift.shift_date,
          'name', v_shift.name,
          'assigned_user_ids', to_jsonb(v_shift.assigned_user_ids)
        ),
        'after', jsonb_build_object(
          'shift_date', v_shift.shift_date,
          'name', v_hidden_name,
          'assigned_user_ids', '[]'::jsonb,
          'bulk_from_date', p_from
        )
      ),
      v_operator, 'v2-patrol-bulk-reset'
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.soft_delete_patrol_shifts_from_date(date, uuid[]) from public, anon;
grant execute on function public.soft_delete_patrol_shifts_from_date(date, uuid[]) to authenticated;

comment on function public.soft_delete_patrol_shifts_from_date(date, uuid[]) is
  '交易式軟刪除指定值班日起的巡檢班別，保留跨日界線前一值班日夜班並逐筆寫入稽核。';

notify pgrst, 'reload schema';

commit;
