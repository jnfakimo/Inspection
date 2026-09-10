begin;

-- 機電課月排班：一市、二市分開編排，同一人跨市場的班次由 app-api 合併檢核。
create table if not exists public.mechanical_schedule_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  market_code text not null,
  duty_date date not null,
  user_id uuid not null references public.users(user_id),
  duty_code text not null,
  note text,
  is_active boolean not null default true,
  created_by uuid not null references public.users(user_id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.users(user_id),
  updated_at timestamptz not null default now(),
  unique(market_code,duty_date,user_id)
);

alter table public.mechanical_schedule_assignments
  add column if not exists market_code text,
  add column if not exists duty_date date,
  add column if not exists user_id uuid references public.users(user_id),
  add column if not exists duty_code text,
  add column if not exists note text,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_by uuid references public.users(user_id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_by uuid references public.users(user_id),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='mechanical_schedule_market_check'
      and conrelid='public.mechanical_schedule_assignments'::regclass
  ) then
    alter table public.mechanical_schedule_assignments add constraint mechanical_schedule_market_check
      check(market_code in ('market_1','market_2'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname='mechanical_schedule_duty_check'
      and conrelid='public.mechanical_schedule_assignments'::regclass
  ) then
    alter table public.mechanical_schedule_assignments add constraint mechanical_schedule_duty_check
      check(duty_code in ('01-09','09-17','17-01','weekly_off','rest_day','rotation_off','annual_leave','official_leave','sick_leave','personal_leave'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname='mechanical_schedule_note_length_check'
      and conrelid='public.mechanical_schedule_assignments'::regclass
  ) then
    alter table public.mechanical_schedule_assignments add constraint mechanical_schedule_note_length_check
      check(note is null or char_length(note)<=500);
  end if;
end
$$;

create index if not exists idx_mechanical_schedule_date_user
  on public.mechanical_schedule_assignments(duty_date,user_id) where is_active;
create index if not exists idx_mechanical_schedule_market_month
  on public.mechanical_schedule_assignments(market_code,duty_date) where is_active;
create unique index if not exists uq_mechanical_schedule_market_date_user
  on public.mechanical_schedule_assignments(market_code,duty_date,user_id);

alter table public.mechanical_schedule_assignments enable row level security;
alter table public.mechanical_schedule_assignments force row level security;
revoke all on public.mechanical_schedule_assignments from anon;
revoke insert,update,delete on public.mechanical_schedule_assignments from authenticated;
grant select on public.mechanical_schedule_assignments to authenticated;
drop policy if exists mechanical_schedule_read on public.mechanical_schedule_assignments;
create policy mechanical_schedule_read on public.mechanical_schedule_assignments
  for select to authenticated using(public.has_system_access('sys_handover'));

-- 只允許 app-api 的 service role 呼叫，避免繞過跨市場與勞動條件檢核。
create or replace function public.save_mechanical_schedule_month(
  p_actor_id uuid,
  p_year_month date,
  p_market_code text,
  p_assignments jsonb
)
returns table(saved_count integer,saved_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare
  before_rows jsonb;
  after_rows jsonb;
  operation_time timestamptz := now();
  month_end date;
  row_count integer;
begin
  if p_actor_id is null or not exists(
    select 1 from public.users u where u.user_id=p_actor_id and u.status='active'
  ) then
    raise exception using errcode='42501',message='active schedule actor is required';
  end if;
  if p_year_month is null or p_year_month<>date_trunc('month',p_year_month)::date then
    raise exception using errcode='22007',message='schedule month must be its first day';
  end if;
  if p_market_code not in ('market_1','market_2') then
    raise exception using errcode='23514',message='invalid schedule market';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments)<>'array' or jsonb_array_length(p_assignments)>1000 then
    raise exception using errcode='22023',message='invalid schedule payload';
  end if;
  month_end := (p_year_month+interval '1 month')::date;

  if exists(
    select 1
    from jsonb_to_recordset(p_assignments) as x(user_id text,duty_date text,duty_code text,note text)
    where x.user_id!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or x.duty_date!~'^\d{4}-\d{2}-\d{2}$'
      or x.duty_code not in ('01-09','09-17','17-01','weekly_off','rest_day','rotation_off','annual_leave','official_leave','sick_leave','personal_leave')
      or char_length(coalesce(x.note,''))>500
  ) then
    raise exception using errcode='23514',message='invalid schedule row';
  end if;

  begin
    if exists(
      select 1
      from jsonb_to_recordset(p_assignments) as x(user_id text,duty_date text,duty_code text,note text)
      where x.duty_date::date<p_year_month or x.duty_date::date>=month_end
    ) then
      raise exception using errcode='23514',message='schedule row is outside selected month';
    end if;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception using errcode='22007',message='invalid schedule date';
  end;

  if exists(
    select 1
    from jsonb_to_recordset(p_assignments) as x(user_id text,duty_date text,duty_code text,note text)
    group by x.user_id,x.duty_date having count(*)>1
  ) then
    raise exception using errcode='23505',message='duplicate schedule row';
  end if;

  if exists(
    select 1
    from jsonb_to_recordset(p_assignments) as x(user_id text,duty_date text,duty_code text,note text)
    left join public.users u on u.user_id=x.user_id::uuid and u.status='active'
    left join public.departments d on d.dept_id=u.dept_id and d.name='機電課' and d.level=2 and d.status='active'
    where u.user_id is null or d.dept_id is null
  ) then
    raise exception using errcode='42501',message='schedule personnel must belong to active level-two mechanical unit';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'assignment_id',a.assignment_id,'duty_date',a.duty_date,'user_id',a.user_id,
    'duty_code',a.duty_code,'note',a.note,'is_active',a.is_active
  ) order by a.duty_date,a.user_id),'[]'::jsonb)
  into before_rows
  from public.mechanical_schedule_assignments a
  where a.market_code=p_market_code and a.duty_date>=p_year_month and a.duty_date<month_end;

  update public.mechanical_schedule_assignments a
  set is_active=false,updated_by=p_actor_id,updated_at=operation_time
  where a.market_code=p_market_code and a.duty_date>=p_year_month and a.duty_date<month_end and a.is_active
    and not exists(
      select 1 from jsonb_to_recordset(p_assignments) as x(user_id text,duty_date text,duty_code text,note text)
      where x.user_id::uuid=a.user_id and x.duty_date::date=a.duty_date
    );

  insert into public.mechanical_schedule_assignments(
    market_code,duty_date,user_id,duty_code,note,is_active,created_by,created_at,updated_by,updated_at
  )
  select p_market_code,x.duty_date::date,x.user_id::uuid,x.duty_code,nullif(btrim(x.note),''),true,p_actor_id,operation_time,p_actor_id,operation_time
  from jsonb_to_recordset(p_assignments) as x(user_id text,duty_date text,duty_code text,note text)
  on conflict(market_code,duty_date,user_id) do update set
    duty_code=excluded.duty_code,note=excluded.note,is_active=true,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at;

  select coalesce(jsonb_agg(jsonb_build_object(
    'assignment_id',a.assignment_id,'duty_date',a.duty_date,'user_id',a.user_id,
    'duty_code',a.duty_code,'note',a.note,'is_active',a.is_active
  ) order by a.duty_date,a.user_id),'[]'::jsonb)
  into after_rows
  from public.mechanical_schedule_assignments a
  where a.market_code=p_market_code and a.duty_date>=p_year_month and a.duty_date<month_end;

  insert into public.audit_logs(table_name,record_id,action,changes,operator_id,operated_at,source)
  values(
    'mechanical_schedule_assignments',to_char(p_year_month,'YYYY-MM')||':'||p_market_code,
    case when before_rows='[]'::jsonb then 'insert' else 'update' end,
    jsonb_build_object('before',before_rows,'after',after_rows),p_actor_id,operation_time,'app-api'
  );

  row_count := jsonb_array_length(p_assignments);
  return query select row_count,operation_time;
end
$$;

revoke all on function public.save_mechanical_schedule_month(uuid,date,text,jsonb) from public,anon,authenticated;
grant execute on function public.save_mechanical_schedule_month(uuid,date,text,jsonb) to service_role;

comment on table public.mechanical_schedule_assignments is
  '機電課一市／二市月排班；清除班次採 is_active=false，完整批次異動另記 audit_logs';
comment on function public.save_mechanical_schedule_month(uuid,date,text,jsonb) is
  '由 app-api 在完成跨市場、11小時休息、40小時與連續工作檢核後，以單一交易儲存整月班表';

commit;
