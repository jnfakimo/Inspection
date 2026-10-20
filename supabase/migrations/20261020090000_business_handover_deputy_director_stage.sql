-- 業管組交接簿主管批核新增第一階「市場副主任」（依市場啟用）。
-- 已啟用的市場：市場副主任 → 市場主任 → 營業部副理 → 營業部經理；市場主任須在副主任批核後才能批核。
-- 尚未啟用的市場（目前為二市場）維持原三階：市場主任 → 營業部副理 → 營業部經理，批核資格判斷與原先完全相同。
-- 之後要啟用某個市場，只需以一支小 migration 更新 business_deputy_director_effective_date()，並同步前端的啟用日。
--
-- 誰是哪一階，依 users.supervisor_id 的組織鏈判斷：往下幾層仍有該市場主管，就是哪一階。
--   已啟用：副主任＝0 層（該市場主管本人）、主任＝1 層、副理＝2 層、經理＝3 層
--   未啟用：主任＝0 層、副理＝1 層、經理＝2 層（與原先相同）
-- 系統管理員（sysadmin）可批核任一階。
--
-- 注意：已啟用的市場，原本的主任／副理／經理判斷各往上移了一層，所以人員資料的直屬主管欄位
-- 必須反映「副主任 → 主任 → 副理 → 經理」的上下級關係，否則高階批核會找不到人（系統管理員仍可批核）。
-- 副主任關卡自該市場的啟用日起適用，更早的歷史交接日不補批、主任不需先經副主任。
begin;

-- 各市場副主任關卡的啟用日；沒有啟用的市場回傳 infinity（不啟用）。
create or replace function public.business_deputy_director_effective_date(p_market text)
returns date language sql immutable set search_path='' as $$
  select case p_market when 'market_1' then date '2026-10-21' else 'infinity'::date end
$$;

create or replace function public.business_deputy_director_enabled(p_market text)
returns boolean language sql immutable set search_path='' as $$
  select public.business_deputy_director_effective_date(p_market) <> 'infinity'::date
$$;

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

-- 在 p_market 的主管組織鏈上，往下 p_depth 層是否仍有該市場的主管（0 層＝本人就是該市場主管）。
create or replace function public.business_supervisor_within(p_user uuid,p_market text,p_depth int)
returns boolean language sql stable security definer set search_path='' as $$
  select case p_depth
    when 0 then public.handover_staff_market(p_user,'business')=p_market
    when 1 then exists(select 1 from public.users d where d.supervisor_id=p_user and d.status='active'
      and coalesce(d.rbac_role,case d.role when 'supervisor' then 'unit_supervisor' else d.role end)='unit_supervisor'
      and public.handover_staff_market(d.user_id,'business')=p_market)
    when 2 then exists(select 1 from public.users d join public.users dp on dp.user_id=d.supervisor_id
      where dp.supervisor_id=p_user and d.status='active' and dp.status='active'
        and coalesce(d.rbac_role,case d.role when 'supervisor' then 'unit_supervisor' else d.role end)='unit_supervisor'
        and public.handover_staff_market(d.user_id,'business')=p_market)
    when 3 then exists(select 1 from public.users d
      join public.users dp on dp.user_id=d.supervisor_id
      join public.users dpp on dpp.user_id=dp.supervisor_id
      where dpp.supervisor_id=p_user and d.status='active' and dp.status='active' and dpp.status='active'
        and coalesce(d.rbac_role,case d.role when 'supervisor' then 'unit_supervisor' else d.role end)='unit_supervisor'
        and public.handover_staff_market(d.user_id,'business')=p_market)
    else false end
$$;

create or replace function public.business_market_approval_allowed(p_user uuid,p_market text,p_stage text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select
    -- 尚未啟用副主任關卡的市場沒有這一階，連系統管理員也不能對它批核。
    (p_stage<>'deputy_director' or public.business_deputy_director_enabled(p_market)) and (
    r.role_id='sysadmin' or (r.role_id='unit_supervisor' and public.business_receiver_allowed(u.user_id)
      and public.business_supervisor_within(u.user_id,p_market,
        case when public.business_deputy_director_enabled(p_market) then
          case p_stage when 'deputy_director' then 0 when 'director' then 1 when 'deputy_manager' then 2 when 'manager' then 3 else -1 end
        else
          case p_stage when 'director' then 0 when 'deputy_manager' then 1 when 'manager' then 2 else -1 end
        end)))
    from public.users u cross join lateral (select coalesce(u.rbac_role,case u.role when 'admin' then 'sysadmin' when 'supervisor' then 'unit_supervisor' else u.role end) role_id) r
    where u.user_id=p_user and u.status='active'),false)
$$;

-- 關卡：已啟用的市場，市場主任須在同市場、同一交接日的副主任批核之後才能批核。
-- 只擋新增（upsert 重新儲存說明時副主任批核早已存在）；沒有刪除權限，副主任批核不會消失。
create or replace function public.business_approval_require_deputy_director()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.stage='director' and public.business_deputy_director_enabled(new.market_code)
     and new.handover_date>=public.business_deputy_director_effective_date(new.market_code)
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

revoke all on function public.business_deputy_director_effective_date(text) from public,anon,authenticated;
revoke all on function public.business_deputy_director_enabled(text) from public,anon,authenticated;
revoke all on function public.business_supervisor_within(uuid,text,int) from public,anon,authenticated;
revoke all on function public.business_approval_require_deputy_director() from public,anon,authenticated;
revoke all on function public.business_market_approval_allowed(uuid,text,text) from public,anon,authenticated;
grant execute on function public.business_deputy_director_effective_date(text) to service_role;

comment on function public.business_market_approval_allowed(uuid,text,text) is
  '業管組批核資格：已啟用副主任關卡的市場為四階（deputy_director／director／deputy_manager／manager），其餘維持三階；依 users.supervisor_id 組織鏈逐層勾稽；sysadmin 可批核任一階。';

commit;
