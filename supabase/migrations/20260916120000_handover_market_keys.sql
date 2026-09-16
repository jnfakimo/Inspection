-- 第一、第二市場的交接與巡檢資料鍵。舊版業管、駐警、巡檢與圖面屬一市；
-- 舊版機電交接簿明確標示第二批發市場，故保留為二市。只新增欄位與索引，不刪紀錄。
begin;

alter table public.business_handover_entries add column if not exists market_code text not null default 'market_1';
alter table public.business_handover_approvals add column if not exists market_code text not null default 'market_1';
alter table public.business_handover_transfers add column if not exists market_code text not null default 'market_1';

alter table public.guard_handover_logs add column if not exists market_code text not null default 'market_1';
alter table public.guard_handover_daily_approvals add column if not exists market_code text not null default 'market_1';
alter table public.guard_handover_attachments add column if not exists market_code text not null default 'market_1';

alter table public.mechanical_handover_entries add column if not exists market_code text not null default 'market_2';
alter table public.mechanical_handover_signatures add column if not exists market_code text not null default 'market_2';
alter table public.mechanical_handover_daily_approvals add column if not exists market_code text not null default 'market_2';
alter table public.mechanical_handover_transfers add column if not exists market_code text not null default 'market_2';

alter table public.patrol_shift_template add column if not exists market_code text not null default 'market_1';
alter table public.patrol_shifts add column if not exists market_code text not null default 'market_1';
alter table public.patrol_shift_day_status add column if not exists market_code text not null default 'market_1';
alter table public.plan_markers add column if not exists market_code text not null default 'market_1';
alter table public.checkin_logs add column if not exists market_code text not null default 'market_1';

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'business_handover_entries','business_handover_approvals','business_handover_transfers',
    'guard_handover_logs','guard_handover_daily_approvals','guard_handover_attachments',
    'mechanical_handover_entries','mechanical_handover_signatures','mechanical_handover_daily_approvals',
    'mechanical_handover_transfers','patrol_shift_template','patrol_shifts','patrol_shift_day_status',
    'plan_markers','checkin_logs'
  ] loop
    if not exists(select 1 from pg_constraint where conrelid=format('public.%I',table_name)::regclass
      and conname=table_name||'_market_code_check') then
      execute format('alter table public.%I add constraint %I check (market_code in (''market_1'',''market_2''))',
        table_name,table_name||'_market_code_check');
    end if;
  end loop;
end $$;

-- 基礎移轉只補市場鍵與查詢索引；舊版唯一鍵／RPC 保留運作。
-- 市場複合唯一鍵須在交接函式與前端全部改為市場感知後，再由啟用移轉切換。
create index if not exists business_entries_market_date on public.business_handover_entries(market_code,handover_date desc,shift_code);
create index if not exists guard_handover_market_attachments on public.guard_handover_attachments(market_code,duty_date,shift_name,incident_id) where not is_deleted;
create index if not exists mechanical_entries_market_date on public.mechanical_handover_entries(market_code,work_date desc,shift_code);
create index if not exists patrol_template_market on public.patrol_shift_template(market_code,status,sort_order);
create index if not exists patrol_markers_market on public.plan_markers(market_code,kind,status,floor_id);
create index if not exists patrol_checkins_market_time on public.checkin_logs(market_code,checkin_at desc);

-- 組織階層是市場歸屬正本；不用 users.department 文字副本判斷權限。
create or replace function public.handover_staff_market(p_user uuid,p_team text)
returns text language sql stable security definer set search_path='' as $$
  select case
    when p_team='mechanical' then (
      select s.market_code from public.users u
      join public.departments d on d.dept_id=u.dept_id and d.name='機電課' and d.status='active'
      join public.mechanical_staff_market_scopes s on s.user_id=u.user_id and s.is_active
      where u.user_id=p_user and u.status='active'
        and lower(trim(coalesce(u.username,''))) not like 'deidentified-%'
        and lower(trim(coalesce(u.email,''))) not like 'deidentified-%'
        and trim(coalesce(u.name,'')) not like '已離職人員-%' limit 1)
    when p_team in ('business','guard') then (
      select case parent.code when 'MKT1' then 'market_1' when 'MKT2' then 'market_2' end
      from public.users u
      join public.departments child on child.dept_id=u.dept_id and child.status='active'
      join public.departments parent on parent.dept_id=child.parent_id and parent.status='active'
      where u.user_id=p_user and u.status='active'
        and lower(trim(coalesce(u.username,''))) not like 'deidentified-%'
        and lower(trim(coalesce(u.email,''))) not like 'deidentified-%'
        and trim(coalesce(u.name,'')) not like '已離職人員-%'
        and child.code=parent.code||case p_team when 'business' then '-ADMIN' else '-GUARD' end
        and parent.code in ('MKT1','MKT2') limit 1)
  end
$$;

-- 主管可依 users.supervisor_id 組織鍊查看其轄下市場；一般人員只取得自己的市場。
create or replace function public.handover_staff_markets(p_user uuid,p_team text)
returns jsonb language sql stable security definer set search_path='' as $$
  with recursive scope(user_id) as (
    select p_user
    union
    select u.user_id from public.users u join scope s on u.supervisor_id=s.user_id where u.status='active'
  ), markets as (
    select distinct public.handover_staff_market(s.user_id,p_team) market_code from scope s
  )
  select coalesce(jsonb_agg(market_code order by market_code) filter(where market_code is not null),'[]'::jsonb) from markets
$$;
revoke all on function public.handover_staff_market(uuid,text) from public,anon,authenticated;
revoke all on function public.handover_staff_markets(uuid,text) from public,anon,authenticated;
grant execute on function public.handover_staff_market(uuid,text) to service_role;
grant execute on function public.handover_staff_markets(uuid,text) to service_role;

notify pgrst, 'reload schema';
commit;
