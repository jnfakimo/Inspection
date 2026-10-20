-- 業管組交接簿主管批核新增第一階「市場副主任」。
-- 批核順序：市場副主任 → 市場主任 → 營業部副理 → 營業部經理；市場主任須在副主任批核後才能批核。
--
-- 誰是哪一階，依 users.supervisor_id 的組織鏈判斷（與原三階相同的作法，整體上移一層）：
--   deputy_director  該市場業管組的主管（鏈的最下層主管）
--   director         至少有一位直屬部屬是該市場主管的主管
--   deputy_manager   兩層以上：部屬的部屬是該市場主管
--   manager          三層以上：部屬的部屬的部屬是該市場主管
-- 系統管理員（sysadmin）可批核任一階。
--
-- 注意：原本的 director／deputy_manager／manager 判斷各往上移了一層，所以人員資料的直屬上司欄位
-- 必須反映「副主任 → 主任 → 副理 → 經理」的上下級關係，否則高階批核會找不到人。
-- 副主任關卡自 business_deputy_director_effective_date() 起適用，更早的歷史交接日不補批、主任不需先經副主任。
begin;

create or replace function public.business_deputy_director_effective_date()
returns date language sql immutable set search_path='' as $$ select date '2026-10-21' $$;

alter table public.business_handover_approvals drop constraint if exists business_handover_stage_check;
-- 正式庫的階段檢查若曾以其他名稱建立（內容仍是舊的三階清單），一併移除，避免新階段被舊檢查擋下。
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid='public.business_handover_approvals'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%deputy_manager%' loop
    execute format('alter table public.business_handover_approvals drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.business_handover_approvals add constraint business_handover_stage_check
  check (stage in ('deputy_director', 'director', 'deputy_manager', 'manager'));

create or replace function public.business_market_approval_allowed(p_user uuid,p_market text,p_stage text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select
    r.role_id='sysadmin' or (r.role_id='unit_supervisor' and public.business_receiver_allowed(u.user_id) and case p_stage
      when 'deputy_director' then public.handover_staff_market(u.user_id,'business')=p_market
      when 'director' then exists(select 1 from public.users d where d.supervisor_id=u.user_id and d.status='active'
        and coalesce(d.rbac_role,case d.role when 'supervisor' then 'unit_supervisor' else d.role end)='unit_supervisor'
        and public.handover_staff_market(d.user_id,'business')=p_market)
      when 'deputy_manager' then exists(select 1 from public.users d join public.users dp on dp.user_id=d.supervisor_id
        where dp.supervisor_id=u.user_id and d.status='active' and dp.status='active'
          and coalesce(d.rbac_role,case d.role when 'supervisor' then 'unit_supervisor' else d.role end)='unit_supervisor'
          and public.handover_staff_market(d.user_id,'business')=p_market)
      when 'manager' then exists(select 1 from public.users d
        join public.users dp on dp.user_id=d.supervisor_id
        join public.users dpp on dpp.user_id=dp.supervisor_id
        where dpp.supervisor_id=u.user_id and d.status='active' and dp.status='active' and dpp.status='active'
          and coalesce(d.rbac_role,case d.role when 'supervisor' then 'unit_supervisor' else d.role end)='unit_supervisor'
          and public.handover_staff_market(d.user_id,'business')=p_market)
      else false end)
    from public.users u cross join lateral (select coalesce(u.rbac_role,case u.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' else u.role end) role_id) r
    where u.user_id=p_user and u.status='active'),false)
$$;

-- 關卡：市場主任須在同一市場、同一交接日的副主任批核之後才能批核。
-- 只擋新增（upsert 重新儲存說明時副主任批核早已存在）；沒有刪除權限，副主任批核不會消失。
create or replace function public.business_approval_require_deputy_director()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.stage='director' and new.handover_date>=public.business_deputy_director_effective_date()
     and not exists(select 1 from public.business_handover_approvals a
       where a.market_code=new.market_code and a.handover_date=new.handover_date and a.stage='deputy_director') then
    raise exception '請先由%副主任批核，%主任才能批核',
      case new.market_code when 'market_2' then '二市場' else '一市場' end,
      case new.market_code when 'market_2' then '二市場' else '一市場' end
      using errcode='P0001';
  end if;
  return new;
end $$;

drop trigger if exists trg_business_approval_require_deputy_director on public.business_handover_approvals;
create trigger trg_business_approval_require_deputy_director before insert on public.business_handover_approvals
  for each row execute function public.business_approval_require_deputy_director();

revoke all on function public.business_deputy_director_effective_date() from public,anon,authenticated;
revoke all on function public.business_approval_require_deputy_director() from public,anon,authenticated;
revoke all on function public.business_market_approval_allowed(uuid,text,text) from public,anon,authenticated;
grant execute on function public.business_deputy_director_effective_date() to service_role;

comment on function public.business_market_approval_allowed(uuid,text,text) is
  '業管組四階批核資格：deputy_director／director／deputy_manager／manager，依 users.supervisor_id 組織鏈逐層勾稽；sysadmin 可批核任一階。';

commit;
