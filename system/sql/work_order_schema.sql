-- ============================================================
-- 報修管理暨派工管理系統 — P1 資料庫基礎
-- 在 Supabase SQL Editor 執行一次（可重複執行，皆為 idempotent）
-- 擴充現有 repair_requests / maintenance_orders / equipment / users，
-- 並新增：狀態歷程(不可刪除) / 附件 / RBAC 權限 / 通知 / 自動編號。
-- ============================================================

-- ── 0. 自動編號（報修單號 / 派工單號）────────────────────────
create sequence if not exists req_seq;
create sequence if not exists wo_seq;
create or replace function gen_req_no() returns text language sql as
$$ select 'RP'||to_char(now(),'YYYYMMDD')||'-'||lpad(nextval('req_seq')::text,4,'0') $$;
create or replace function gen_wo_no() returns text language sql as
$$ select 'WO'||to_char(now(),'YYYYMMDD')||'-'||lpad(nextval('wo_seq')::text,4,'0') $$;

-- ── 1. 擴充 設備主檔（設備履歷 §六）─────────────────────────
alter table equipment add column if not exists category        text;
alter table equipment add column if not exists brand           text;
alter table equipment add column if not exists model           text;
alter table equipment add column if not exists serial_no       text;
alter table equipment add column if not exists warranty_until  date;
alter table equipment add column if not exists service_life_y  int;
alter table equipment add column if not exists manual_url      text;
alter table equipment add column if not exists location_id     uuid references locations(location_id);

-- ── 2. 擴充 使用者（RBAC 角色 §二）──────────────────────────
alter table users add column if not exists rbac_role text;     -- 對應 roles.role_id
alter table users add column if not exists email     text;
alter table users add column if not exists hidden    boolean default false;

-- ── 3. 擴充 報修單（§三）────────────────────────────────────
alter table repair_requests add column if not exists req_no            text;
alter table repair_requests add column if not exists mobile            text;
alter table repair_requests add column if not exists fault_location    text;
alter table repair_requests add column if not exists equipment_category text;
alter table repair_requests add column if not exists location_id       uuid references locations(location_id);
alter table repair_requests add column if not exists fault_type        text;
alter table repair_requests add column if not exists impact_level      text;   -- low/medium/high
alter table repair_requests add column if not exists affects_operation boolean default false;
alter table repair_requests add column if not exists urgency           text default 'normal'; -- low/normal/high/urgent
alter table repair_requests add column if not exists desired_finish    timestamptz;
alter table repair_requests add column if not exists assignee_id       uuid references users(user_id);
alter table repair_requests add column if not exists hidden            boolean default false;
alter table repair_requests add column if not exists updated_at        timestamptz default now();
alter table repair_requests alter column equipment_id drop not null;
alter table maintenance_orders alter column equipment_id drop not null;

-- 放寬 報修單 狀態（涵蓋舊值 + 完整流程 §八）
alter table repair_requests drop constraint if exists repair_requests_status_check;
alter table repair_requests add constraint repair_requests_status_check
  check (status in ('pending','transferred','assigned','in_progress','waiting_parts',
                    'waiting_vendor','pending_review','completed','closed','rejected','cancelled','overdue'));

-- 補上報修編號預設與回填
alter table repair_requests alter column req_no set default gen_req_no();
update repair_requests set req_no = gen_req_no() where req_no is null;

-- ── 4. 擴充 維修/派工單（§四 §五）──────────────────────────
alter table maintenance_orders add column if not exists wo_no            text;
alter table maintenance_orders add column if not exists helper_note      text;   -- 協助人員
alter table maintenance_orders add column if not exists vendor           text;   -- 委外廠商
alter table maintenance_orders add column if not exists expected_arrival timestamptz;
alter table maintenance_orders add column if not exists expected_finish  timestamptz;
alter table maintenance_orders add column if not exists work_content     text;
alter table maintenance_orders add column if not exists need_shutdown    boolean default false;
alter table maintenance_orders add column if not exists need_approval    boolean default false;
alter table maintenance_orders add column if not exists approved_by      uuid references users(user_id);
alter table maintenance_orders add column if not exists approved_at      timestamptz;
alter table maintenance_orders add column if not exists accept_status    text default 'pending'; -- pending/accepted/returned/rejected
alter table maintenance_orders add column if not exists arrival_time     timestamptz;
alter table maintenance_orders add column if not exists fault_cause      text;
alter table maintenance_orders add column if not exists handle_method    text;
alter table maintenance_orders add column if not exists parts_used       text;
alter table maintenance_orders add column if not exists labor_hours      numeric(6,1);
alter table maintenance_orders add column if not exists materials        text;
alter table maintenance_orders add column if not exists note             text;
alter table maintenance_orders add column if not exists hidden           boolean default false;

alter table maintenance_orders drop constraint if exists maintenance_orders_status_check;
alter table maintenance_orders add constraint maintenance_orders_status_check
  check (status in ('pending','assigned','accepted','in_progress','waiting_parts','waiting_vendor',
                    'pending_review','completed','closed','returned','rejected','cancelled','overdue'));

alter table maintenance_orders alter column wo_no set default gen_wo_no();
update maintenance_orders set wo_no = gen_wo_no() where wo_no is null;

-- ── 5. 狀態歷程（不可覆蓋、不可刪除 §七 §八 §十三）───────────
create table if not exists case_status_log (
  log_id      uuid primary key default gen_random_uuid(),
  request_id  uuid references repair_requests(request_id),
  order_id    uuid references maintenance_orders(order_id),
  from_status text,
  to_status   text not null,
  note        text,
  operator_id uuid references users(user_id),
  operator_name text,
  ip          text,
  created_at  timestamptz default now()
);
create index if not exists idx_csl_req on case_status_log(request_id);
create index if not exists idx_csl_ord on case_status_log(order_id);

-- ── 6. 附件（照片/影片/PDF/Word/Excel §三 §五）──────────────
create table if not exists repair_attachments (
  attach_id   uuid primary key default gen_random_uuid(),
  request_id  uuid references repair_requests(request_id),
  order_id    uuid references maintenance_orders(order_id),
  kind        text,            -- photo/video/pdf/doc/xls/other
  file_path   text not null,   -- storage 路徑
  file_name   text,
  uploaded_by uuid references users(user_id),
  uploaded_at timestamptz default now()
);
create index if not exists idx_att_req on repair_attachments(request_id);

-- ── 7. RBAC 角色與權限（§二）────────────────────────────────
create table if not exists roles (
  role_id    text primary key,
  name       text not null,
  sort_order int default 0
);
create table if not exists role_permissions (
  role_id text references roles(role_id) on delete cascade,
  perm    text,    -- create/update/delete/read/dispatch/close/sign/export/admin
  allowed boolean default false,
  primary key (role_id, perm)
);

insert into roles (role_id,name,sort_order) values
 ('reporter','一般報修人員',10),
 ('duty','值班人員',20),
 ('dispatcher','派工管理員',30),
 ('technician','維修技術人員',40),
 ('unit_supervisor','單位主管',50),
 ('mgmt_supervisor','管理部主管',60),
 ('sysadmin','系統管理員',70)
on conflict (role_id) do nothing;

-- 預設權限矩陣（9 種權限 × 7 角色）
do $$
declare r text; p text; v boolean;
  perms text[] := array['create','update','delete','read','dispatch','close','sign','export','admin'];
begin
  foreach r in array array['reporter','duty','dispatcher','technician','unit_supervisor','mgmt_supervisor','sysadmin'] loop
    foreach p in array perms loop
      v := case
        when r='sysadmin' then true
        when r='mgmt_supervisor' and p in ('read','close','sign','export') then true
        when r='unit_supervisor' and p in ('read','create','close','sign','export') then true
        when r='dispatcher' and p in ('read','create','update','dispatch','export') then true
        when r='technician' and p in ('read','update') then true
        when r='duty' and p in ('read','create','dispatch') then true
        when r='reporter' and p in ('read','create') then true
        else false end;
      insert into role_permissions (role_id,perm,allowed) values (r,p,v)
      on conflict (role_id,perm) do nothing;
    end loop;
  end loop;
end $$;
-- 維修流程由主管派工；既有資料庫必須覆寫舊的 false 權限，而非僅 do nothing。
insert into role_permissions(role_id,perm,allowed) values
  ('unit_supervisor','dispatch',true),
  ('mgmt_supervisor','dispatch',true)
on conflict(role_id,perm) do update set allowed=excluded.allowed;

-- ── 8. 通知（站內 §九）──────────────────────────────────────
create table if not exists notifications (
  notif_id     uuid primary key default gen_random_uuid(),
  recipient_id uuid references users(user_id),
  event        text,   -- new_repair/dispatch/return/overdue/complete/close/sign
  title        text,
  body         text,
  request_id   uuid,
  order_id     uuid,
  is_read      boolean default false,
  created_at   timestamptz default now()
);
create index if not exists idx_notif_rcpt on notifications(recipient_id, is_read);

-- ── 9. RLS ──────────────────────────────────────────────────
create or replace function public.is_admin() returns boolean
language sql security definer stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.users
    where auth_id = auth.uid()
      and (role = 'admin' or rbac_role in ('admin','sysadmin'))
      and status = 'active'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table case_status_log   enable row level security;
alter table repair_attachments enable row level security;
alter table roles             enable row level security;
alter table role_permissions  enable row level security;
alter table notifications     enable row level security;
do $$
declare t text;
begin
  foreach t in array array['case_status_log','repair_attachments','notifications'] loop
    execute format('drop policy if exists "allow_all_for_now" on %I', t);
    execute format('drop policy if exists "authenticated_only" on %I', t);
    execute format('create policy "authenticated_only" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['roles','role_permissions'] loop
    execute format('drop policy if exists "allow_all_for_now" on %I', t);
    execute format('drop policy if exists "authenticated_only" on %I', t);
    execute format('drop policy if exists "rbac_read" on %I', t);
    execute format('drop policy if exists "rbac_admin_insert" on %I', t);
    execute format('drop policy if exists "rbac_admin_update" on %I', t);
    execute format('drop policy if exists "rbac_admin_delete" on %I', t);
    execute format('create policy "rbac_read" on %I for select to authenticated using (true)', t);
    execute format('create policy "rbac_admin_insert" on %I for insert to authenticated with check (public.is_admin())', t);
    execute format('create policy "rbac_admin_update" on %I for update to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    execute format('create policy "rbac_admin_delete" on %I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

-- ── 10. 附件儲存桶 ─────────────────────────────────────────
insert into storage.buckets (id,name,public) values ('repair-files','repair-files',true)
on conflict (id) do update set public = true;
drop policy if exists "repairfiles_read"   on storage.objects;
drop policy if exists "repairfiles_write"  on storage.objects;
drop policy if exists "repairfiles_update" on storage.objects;
drop policy if exists "repairfiles_delete" on storage.objects;
create policy "repairfiles_read"   on storage.objects for select using (bucket_id='repair-files');
create policy "repairfiles_write"  on storage.objects for insert to authenticated with check (bucket_id='repair-files');
create policy "repairfiles_update" on storage.objects for update to authenticated using (bucket_id='repair-files') with check (bucket_id='repair-files');
create policy "repairfiles_delete" on storage.objects for delete to authenticated using (bucket_id='repair-files');
