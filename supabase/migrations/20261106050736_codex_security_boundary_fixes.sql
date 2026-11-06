begin;

-- 共用邊界涵蓋直接 PostgREST、RLS 與 SECURITY DEFINER RPC。
create or replace function public.business_market_allowed(p_market text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.active_user_id() is not null
    and public.has_handover_module_access('business')
    and p_market in ('market_1','market_2')
    and (public.active_rbac_role()='sysadmin'
      or exists(select 1 from jsonb_array_elements_text(public.handover_staff_markets(public.active_user_id(),'business')) m(value)
        where m.value=p_market)),false)
$$;
revoke all on function public.business_market_allowed(text) from public,anon;
grant execute on function public.business_market_allowed(text) to authenticated,service_role;

-- RESTRICTIVE 與既有 owner/admin 政策取 AND，避免另一 permissive policy 繞過模組拒絕。
drop policy if exists meeting_bookings_module_gate on public.meeting_bookings;
create policy meeting_bookings_module_gate on public.meeting_bookings
as restrictive for all to authenticated
using (public.active_user_id() is not null and public.has_module_access('meetingroom','bookings'))
with check (public.active_user_id() is not null and public.has_module_access('meetingroom','bookings'));

-- 舊的未完成授權缺此值，finish 時必須拒絕；不影響已連結帳號。
alter table public.google_calendar_oauth_states add column if not exists browser_verifier_hash text;

notify pgrst, 'reload schema';
commit;
