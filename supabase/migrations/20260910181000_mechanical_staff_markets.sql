begin;

-- 每位機電課同仁只能歸屬一個市場；未分配者不會出現在任一市場的排班與交接名單。
create table if not exists public.mechanical_staff_market_scopes (
  user_id uuid primary key references public.users(user_id),
  market_code text not null,
  is_active boolean not null default true,
  assigned_by uuid not null references public.users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mechanical_staff_market_scopes
  add column if not exists user_id uuid references public.users(user_id),
  add column if not exists market_code text,
  add column if not exists is_active boolean not null default true,
  add column if not exists assigned_by uuid references public.users(user_id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='mechanical_staff_market_check'
      and conrelid='public.mechanical_staff_market_scopes'::regclass
  ) then
    alter table public.mechanical_staff_market_scopes add constraint mechanical_staff_market_check
      check(market_code in ('market_1','market_2'));
  end if;
end
$$;

create index if not exists idx_mechanical_staff_market_active
  on public.mechanical_staff_market_scopes(market_code,user_id) where is_active;

alter table public.mechanical_staff_market_scopes enable row level security;
alter table public.mechanical_staff_market_scopes force row level security;
revoke all on public.mechanical_staff_market_scopes from anon;
revoke insert,update,delete on public.mechanical_staff_market_scopes from authenticated;
grant select on public.mechanical_staff_market_scopes to authenticated;
drop policy if exists mechanical_staff_market_read on public.mechanical_staff_market_scopes;
create policy mechanical_staff_market_read on public.mechanical_staff_market_scopes
  for select to authenticated using(public.has_system_access('sys_handover'));

-- 既有班表若只出現於單一市場，可安全沿用該歸屬；跨市場或尚無班表者保留待分配。
insert into public.mechanical_staff_market_scopes(user_id,market_code,is_active,assigned_by,created_at,updated_at)
select a.user_id,min(a.market_code),true,(array_agg(a.updated_by order by a.updated_at desc))[1],now(),now()
from public.mechanical_schedule_assignments a
where a.is_active
group by a.user_id
having count(distinct a.market_code)=1
on conflict(user_id) do nothing;

create or replace function public.save_mechanical_staff_market_scope(
  p_actor_id uuid,
  p_user_id uuid,
  p_market_code text
)
returns table(market_code text,cleared_future_assignments integer,saved_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare
  operation_time timestamptz := now();
  taipei_today date := (now() at time zone 'Asia/Taipei')::date;
  before_row jsonb;
  cleared_count integer := 0;
begin
  if p_actor_id is null or not exists(
    select 1 from public.users u where u.user_id=p_actor_id and u.status='active'
  ) then
    raise exception using errcode='42501',message='active market scope actor is required';
  end if;
  if p_user_id is null or not exists(
    select 1
    from public.users u
    join public.departments d on d.dept_id=u.dept_id
    where u.user_id=p_user_id and u.status='active'
      and d.name='機電課' and d.level=2 and d.status='active'
  ) then
    raise exception using errcode='42501',message='market scope personnel must belong to active level-two mechanical unit';
  end if;
  if p_market_code is not null and p_market_code not in ('market_1','market_2') then
    raise exception using errcode='23514',message='invalid mechanical staff market';
  end if;

  select to_jsonb(s) into before_row
  from public.mechanical_staff_market_scopes s where s.user_id=p_user_id;

  if p_market_code is null then
    update public.mechanical_staff_market_scopes
    set is_active=false,assigned_by=p_actor_id,updated_at=operation_time
    where user_id=p_user_id and is_active;
  else
    insert into public.mechanical_staff_market_scopes(user_id,market_code,is_active,assigned_by,created_at,updated_at)
    values(p_user_id,p_market_code,true,p_actor_id,operation_time,operation_time)
    on conflict(user_id) do update set
      market_code=excluded.market_code,is_active=true,assigned_by=excluded.assigned_by,updated_at=excluded.updated_at;
  end if;

  update public.mechanical_schedule_assignments a
  set is_active=false,updated_by=p_actor_id,updated_at=operation_time
  where a.user_id=p_user_id and a.is_active and a.duty_date>=taipei_today
    and (p_market_code is null or a.market_code<>p_market_code);
  get diagnostics cleared_count=row_count;

  insert into public.audit_logs(table_name,record_id,action,changes,operator_id,operated_at,source)
  values(
    'mechanical_staff_market_scopes',p_user_id::text,'update',
    jsonb_build_object(
      'before',before_row,
      'after',case when p_market_code is null then null else jsonb_build_object('user_id',p_user_id,'market_code',p_market_code,'is_active',true) end,
      'cleared_future_assignments',cleared_count
    ),p_actor_id,operation_time,'app-api'
  );

  return query select p_market_code,cleared_count,operation_time;
end
$$;

revoke all on function public.save_mechanical_staff_market_scope(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.save_mechanical_staff_market_scope(uuid,uuid,text) to service_role;

create or replace function public.enforce_mechanical_schedule_market_scope()
returns trigger language plpgsql set search_path=''
as $$
begin
  if new.is_active and not exists(
    select 1 from public.mechanical_staff_market_scopes s
    where s.user_id=new.user_id and s.market_code=new.market_code and s.is_active
  ) then
    raise exception using errcode='23514',message='schedule personnel market scope mismatch';
  end if;
  return new;
end
$$;

drop trigger if exists trg_mechanical_schedule_market_scope on public.mechanical_schedule_assignments;
create trigger trg_mechanical_schedule_market_scope
before insert or update of user_id,market_code,is_active on public.mechanical_schedule_assignments
for each row execute function public.enforce_mechanical_schedule_market_scope();

comment on table public.mechanical_staff_market_scopes is
  '機電課人員的一市／二市唯一歸屬；同一人不得同時出現在兩個市場名單';
comment on function public.save_mechanical_staff_market_scope(uuid,uuid,text) is
  '由 app-api 設定單一市場歸屬，並停用今日起不符合新歸屬的班表但保留歷史與稽核';

commit;
