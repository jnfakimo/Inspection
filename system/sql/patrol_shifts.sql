-- ============================================================
-- 駐衛警巡檢系統：班別排程
-- Version 1.0  |  Run ONCE in Supabase SQL Editor（idempotent）
-- ============================================================
-- patrol_shift_template：預設班別範本（只存一份，方便快速套用到新的一天）
-- patrol_shifts        ：實際生效的每日班別，逐日獨立可調整
-- 巡檢點沿用 plan_markers（kind='patrol'），簽到記錄沿用 checkin_logs，
-- 不需要新表。
-- ============================================================

create table if not exists patrol_shift_template (
  template_id uuid primary key default gen_random_uuid(),
  name        text not null,
  start_time  time not null,
  end_time    time not null,
  sort_order  int not null default 0,
  status      text not null default 'active' check (status in ('active','inactive'))
);

alter table patrol_shift_template add column if not exists status text not null default 'active';
alter table patrol_shift_template add column if not exists assigned_user_ids uuid[] not null default '{}';

create table if not exists patrol_shifts (
  shift_id    uuid primary key default gen_random_uuid(),
  shift_date  date not null,
  name        text not null,
  start_time  time not null,
  end_time    time not null,
  sort_order  int not null default 0,
  created_at  timestamptz default now()
);
create unique index if not exists idx_patrol_shifts_date_name on patrol_shifts(shift_date, name);
create index if not exists idx_patrol_shifts_date on patrol_shifts(shift_date);
alter table patrol_shifts add column if not exists assigned_user_ids uuid[] not null default '{}';

-- ── RLS ────────────────────────────────────────────────────
alter table patrol_shift_template enable row level security;
drop policy if exists "allow_all_for_now" on patrol_shift_template;
create policy "allow_all_for_now" on patrol_shift_template for all using (true);

alter table patrol_shifts enable row level security;
drop policy if exists "allow_all_for_now" on patrol_shifts;
create policy "allow_all_for_now" on patrol_shifts for all using (true);

-- ── 預設範本（可在後台自行調整）──────────────────────────────
insert into patrol_shift_template (name, start_time, end_time, sort_order)
select * from (values
  ('早班','08:00'::time,'12:00'::time,1),
  ('午班','12:00'::time,'17:00'::time,2),
  ('晚班','17:00'::time,'22:00'::time,3),
  ('夜班','22:00'::time,'08:00'::time,4)
) as v(name, start_time, end_time, sort_order)
where not exists (select 1 from patrol_shift_template);
