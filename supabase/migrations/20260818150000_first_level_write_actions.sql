-- 第一級跨使用者寫入收斂：巡檢週期必須在同一交易完成關閉與建立。
create or replace function public.open_inspection_cycle(p_cycle_type text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception '無權限' using errcode = '42501';
  end if;
  if p_cycle_type not in ('daily', 'shift', 'weekly') then
    raise exception '週期類型無效' using errcode = '22023';
  end if;

  update public.inspection_cycles
     set ended_at = now()
   where ended_at is null;
  insert into public.inspection_cycles(cycle_type, started_at, created_by)
  values (p_cycle_type, now(), public.active_user_id())
  returning cycle_id into v_id;
  return v_id;
end;
$$;

revoke all on function public.open_inspection_cycle(text) from public;
grant execute on function public.open_inspection_cycle(text) to authenticated;
