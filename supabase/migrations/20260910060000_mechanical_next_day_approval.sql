-- 機電交接簿每日簽核須於工作日的隔日（Asia/Taipei）起才可執行。
create or replace function public.guard_mechanical_handover_daily_approval()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.work_date >= (now() at time zone 'Asia/Taipei')::date then
    raise exception using errcode='23514',message='mechanical handover approval is available from the next day';
  end if;
  return new;
end
$$;
revoke all on function public.guard_mechanical_handover_daily_approval() from public,anon,authenticated;

drop trigger if exists trg_guard_mechanical_handover_daily_approval
  on public.mechanical_handover_daily_approvals;
create trigger trg_guard_mechanical_handover_daily_approval
before insert or update on public.mechanical_handover_daily_approvals
for each row execute function public.guard_mechanical_handover_daily_approval();

drop policy if exists mechanical_handover_daily_approvals_write
  on public.mechanical_handover_daily_approvals;
create policy mechanical_handover_daily_approvals_write
  on public.mechanical_handover_daily_approvals
  for insert to authenticated with check (
    public.has_system_access('sys_handover')
    and approver_id=public.active_user_id()
    and public.can_approve_mechanical_handover()
    and work_date < (now() at time zone 'Asia/Taipei')::date
  );
