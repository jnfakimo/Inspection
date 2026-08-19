-- ============================================================
-- 動態戰情儀表板版面
-- 草稿、發布及還原均保留不可變版本，不刪除歷史資料。
-- 本檔可重複執行；請在 permanent_data_protection.sql 前套用。
-- ============================================================

begin;

create table if not exists dashboard_layouts (
  layout_id            uuid primary key default gen_random_uuid(),
  layout_code          text not null unique,
  layout_name          text not null,
  status               text not null default 'active'
                         check (status in ('active','inactive')),
  published_version_id uuid,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists dashboard_layout_versions (
  version_id    uuid primary key default gen_random_uuid(),
  layout_id     uuid not null references dashboard_layouts(layout_id),
  version_no    integer not null,
  state         text not null default 'draft'
                  check (state in ('draft','published','archived','failed')),
  version_note  text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  published_at timestamptz,
  unique(layout_id,version_no)
);

create table if not exists dashboard_layout_items (
  item_id          uuid primary key default gen_random_uuid(),
  version_id       uuid not null references dashboard_layout_versions(version_id),
  widget_key       text not null,
  title            text not null,
  x                integer not null default 0 check (x >= 0),
  y                integer not null default 0 check (y >= 0),
  width            integer not null default 3 check (width between 1 and 12),
  height           integer not null default 2 check (height between 1 and 20),
  min_width        integer not null default 1 check (min_width between 1 and 12),
  min_height       integer not null default 1 check (min_height between 1 and 20),
  visible          boolean not null default true,
  refresh_seconds  integer not null default 60 check (refresh_seconds between 0 and 86400),
  config           jsonb not null default '{}'::jsonb,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  unique(version_id,widget_key)
);

-- 已存在的環境也會補齊後續新增欄位。
alter table dashboard_layouts add column if not exists published_version_id uuid;
alter table dashboard_layouts add column if not exists updated_at timestamptz not null default now();
alter table dashboard_layout_versions add column if not exists version_note text;
alter table dashboard_layout_versions add column if not exists published_at timestamptz;
alter table dashboard_layout_items add column if not exists config jsonb not null default '{}'::jsonb;
alter table dashboard_layout_items add column if not exists refresh_seconds integer not null default 60;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname='dashboard_layouts_published_version_id_fkey'
  ) then
    alter table dashboard_layouts
      add constraint dashboard_layouts_published_version_id_fkey
      foreign key (published_version_id) references dashboard_layout_versions(version_id);
  end if;
end $$;

create index if not exists idx_dashboard_versions_layout
  on dashboard_layout_versions(layout_id,version_no desc);
create index if not exists idx_dashboard_items_version
  on dashboard_layout_items(version_id,sort_order);

-- 只有系統管理員能建立／發布版面；前台登入者均可讀取已發布版面。
create or replace function can_manage_dashboard_layout()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1 from users
    where auth_id=auth.uid()
      and status='active'
      and (rbac_role='sysadmin' or role='admin')
  );
$$;

grant execute on function can_manage_dashboard_layout() to authenticated;

alter table dashboard_layouts enable row level security;
alter table dashboard_layout_versions enable row level security;
alter table dashboard_layout_items enable row level security;

drop policy if exists "dashboard_layouts_read" on dashboard_layouts;
drop policy if exists "dashboard_layouts_manage" on dashboard_layouts;
drop policy if exists "dashboard_layouts_insert" on dashboard_layouts;
drop policy if exists "dashboard_layouts_update" on dashboard_layouts;
create policy "dashboard_layouts_read" on dashboard_layouts
  for select to authenticated using (true);
create policy "dashboard_layouts_insert" on dashboard_layouts
  for insert to authenticated with check (can_manage_dashboard_layout());
create policy "dashboard_layouts_update" on dashboard_layouts
  for update to authenticated using (can_manage_dashboard_layout()) with check (can_manage_dashboard_layout());

drop policy if exists "dashboard_versions_read" on dashboard_layout_versions;
drop policy if exists "dashboard_versions_manage" on dashboard_layout_versions;
drop policy if exists "dashboard_versions_insert" on dashboard_layout_versions;
drop policy if exists "dashboard_versions_update" on dashboard_layout_versions;
create policy "dashboard_versions_read" on dashboard_layout_versions
  for select to authenticated using (true);
create policy "dashboard_versions_insert" on dashboard_layout_versions
  for insert to authenticated with check (can_manage_dashboard_layout());
create policy "dashboard_versions_update" on dashboard_layout_versions
  for update to authenticated using (can_manage_dashboard_layout()) with check (can_manage_dashboard_layout());

drop policy if exists "dashboard_items_read" on dashboard_layout_items;
drop policy if exists "dashboard_items_manage" on dashboard_layout_items;
drop policy if exists "dashboard_items_insert" on dashboard_layout_items;
drop policy if exists "dashboard_items_update" on dashboard_layout_items;
create policy "dashboard_items_read" on dashboard_layout_items
  for select to authenticated using (true);
create policy "dashboard_items_insert" on dashboard_layout_items
  for insert to authenticated with check (can_manage_dashboard_layout());
create policy "dashboard_items_update" on dashboard_layout_items
  for update to authenticated using (can_manage_dashboard_layout()) with check (can_manage_dashboard_layout());

-- 單一交易建立草稿或發布版本，避免版本主檔與圖塊只寫入一半。
create or replace function save_dashboard_layout_version(
  p_layout_id uuid,
  p_items jsonb,
  p_note text default null,
  p_publish boolean default false
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_version_id uuid;
  v_version_no integer;
  v_item jsonb;
begin
  if not can_manage_dashboard_layout() then
    raise exception 'dashboard layout permission denied';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'dashboard layout items are required';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_layout_id::text));
  select coalesce(max(version_no),0)+1 into v_version_no
  from dashboard_layout_versions where layout_id=p_layout_id;

  insert into dashboard_layout_versions(
    layout_id,version_no,state,version_note,created_by,published_at
  ) values (
    p_layout_id,v_version_no,
    case when p_publish then 'published' else 'draft' end,
    nullif(trim(p_note),''),auth.uid(),
    case when p_publish then now() else null end
  ) returning version_id into v_version_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into dashboard_layout_items(
      version_id,widget_key,title,x,y,width,height,min_width,min_height,
      visible,refresh_seconds,config,sort_order
    ) values (
      v_version_id,
      v_item->>'widget_key',
      coalesce(nullif(v_item->>'title',''),v_item->>'widget_key'),
      greatest(0,coalesce((v_item->>'x')::integer,0)),
      greatest(0,coalesce((v_item->>'y')::integer,0)),
      least(12,greatest(1,coalesce((v_item->>'width')::integer,3))),
      least(20,greatest(1,coalesce((v_item->>'height')::integer,2))),
      least(12,greatest(1,coalesce((v_item->>'min_width')::integer,1))),
      least(20,greatest(1,coalesce((v_item->>'min_height')::integer,1))),
      coalesce((v_item->>'visible')::boolean,true),
      least(86400,greatest(0,coalesce((v_item->>'refresh_seconds')::integer,60))),
      coalesce(v_item->'config','{}'::jsonb),
      coalesce((v_item->>'sort_order')::integer,0)
    );
  end loop;

  if p_publish then
    update dashboard_layout_versions
      set state='archived'
      where layout_id=p_layout_id and version_id<>v_version_id and state='published';
    update dashboard_layouts
      set published_version_id=v_version_id,status='active',updated_at=now()
      where layout_id=p_layout_id;
  end if;
  return v_version_id;
exception when others then
  raise;
end;
$$;

create or replace function publish_dashboard_layout_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare v_layout_id uuid;
begin
  if not can_manage_dashboard_layout() then
    raise exception 'dashboard layout permission denied';
  end if;
  select layout_id into v_layout_id
    from dashboard_layout_versions where version_id=p_version_id;
  if v_layout_id is null then raise exception 'dashboard version not found'; end if;
  update dashboard_layout_versions set state='archived'
    where layout_id=v_layout_id and state='published' and version_id<>p_version_id;
  update dashboard_layout_versions set state='published',published_at=now()
    where version_id=p_version_id;
  update dashboard_layouts set published_version_id=p_version_id,status='active',updated_at=now()
    where layout_id=v_layout_id;
end;
$$;

grant execute on function save_dashboard_layout_version(uuid,jsonb,text,boolean) to authenticated;
grant execute on function publish_dashboard_layout_version(uuid) to authenticated;

-- 系統預設版面；固定 UUID 方便 idempotent seed。
insert into dashboard_layouts(layout_id,layout_code,layout_name,status)
values('11111111-1111-4111-8111-111111111111','operations_main','營運戰情總覽','active')
on conflict(layout_code) do nothing;

insert into dashboard_layout_versions(
  version_id,layout_id,version_no,state,version_note,published_at
) values(
  '22222222-2222-4222-8222-222222222222',
  (select layout_id from dashboard_layouts where layout_code='operations_main'),
  1,'published','系統預設版面',now()
)
on conflict(layout_id,version_no) do nothing;

insert into dashboard_layout_items(
  version_id,widget_key,title,x,y,width,height,min_width,min_height,visible,sort_order
)
select v.version_id,x.widget_key,x.title,x.x,x.y,x.w,x.h,x.min_w,x.min_h,true,x.ord
from dashboard_layout_versions v
cross join (values
  ('alerts','重要提醒',0,0,12,1,3,1,10),
  ('kpis','營運關鍵指標',0,1,12,2,4,2,20),
  ('patrol','駐衛警巡檢即時',0,3,8,6,4,4,30),
  ('status','案件狀態分佈',8,3,4,6,3,4,40),
  ('rank_dept','各單位報修排行',0,9,6,4,3,3,50),
  ('rank_equipment','各設備故障排行',6,9,6,4,3,3,60),
  ('rank_technician','維修人員案件數',0,13,6,4,3,3,70),
  ('rank_fault','故障類型分析',6,13,6,4,3,3,80),
  ('trend','各月份報修趨勢',0,17,12,5,4,4,90),
  ('weather_taiwan','臺灣即時氣象',0,22,12,7,6,5,100)
) as x(widget_key,title,x,y,w,h,min_w,min_h,ord)
where v.layout_id=(select layout_id from dashboard_layouts where layout_code='operations_main')
  and v.version_no=1
on conflict(version_id,widget_key) do nothing;

update dashboard_layouts l
set published_version_id=v.version_id,updated_at=now()
from dashboard_layout_versions v
where l.layout_code='operations_main'
  and v.layout_id=l.layout_id and v.version_no=1
  and l.published_version_id is null;

commit;

-- 讓 Supabase PostgREST 立即辨識本檔新增的 RPC，避免短時間仍回報
-- "Could not find the function ... in the schema cache"。
notify pgrst, 'reload schema';

-- TV 專屬預設版面
insert into dashboard_layouts(layout_id,layout_code,layout_name,status)
values('33333333-3333-4333-8333-333333333333','tv_display','大螢幕戰情看板','active')
on conflict(layout_code) do nothing;

insert into dashboard_layout_versions(
  version_id,layout_id,version_no,state,version_note,published_at
) values(
  '44444444-4444-4444-8444-444444444444',
  (select layout_id from dashboard_layouts where layout_code='tv_display'),
  1,'published','大螢幕預設版面',now()
)
on conflict(layout_id,version_no) do nothing;

insert into dashboard_layout_items(
  version_id,widget_key,title,x,y,width,height,min_width,min_height,visible,sort_order
)
select v.version_id,x.widget_key,x.title,x.x,x.y,x.w,x.h,x.min_w,x.min_h,true,x.ord
from dashboard_layout_versions v
cross join (values
  ('tv_alerts','即時重大警報',0,0,12,2,4,2,10),
  ('tv_kpis','戰情關鍵數據',0,2,12,3,4,3,20),
  ('tv_equipment','重點設備健康度',0,5,6,7,4,4,30),
  ('tv_map','設備位置熱區預覽',6,5,6,7,4,4,40)
) as x(widget_key,title,x,y,w,h,min_w,min_h,ord)
where v.layout_id=(select layout_id from dashboard_layouts where layout_code='tv_display')
  and v.version_no=1
on conflict(version_id,widget_key) do nothing;

update dashboard_layouts l
set published_version_id=v.version_id,updated_at=now()
from dashboard_layout_versions v
where l.layout_code='tv_display'
  and v.layout_id=l.layout_id and v.version_no=1
  and l.published_version_id is null;
