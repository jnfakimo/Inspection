-- 公文傳送流程：部室依序會辦、陳核、核決與原申請人收訖。
-- 只新增結構、索引與安全規則；流程資料採追加／更新，不實體移除。

begin;

create table if not exists public.official_documents (
  document_id uuid primary key default gen_random_uuid(),
  document_no text not null,
  subject text not null,
  originator_id uuid not null references public.users(user_id),
  originator_dept_id uuid references public.departments(dept_id),
  status text not null default 'draft'
    check (status in ('draft','awaiting_co_sign','ready_for_next','awaiting_approval','awaiting_originator','returned','closed')),
  current_step_id uuid,
  barcode_value text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

alter table public.official_documents add column if not exists document_no text;
alter table public.official_documents add column if not exists subject text;
alter table public.official_documents add column if not exists originator_id uuid references public.users(user_id);
alter table public.official_documents add column if not exists originator_dept_id uuid references public.departments(dept_id);
alter table public.official_documents add column if not exists status text default 'draft';
alter table public.official_documents add column if not exists current_step_id uuid;
alter table public.official_documents add column if not exists barcode_value text;
alter table public.official_documents add column if not exists created_at timestamptz default now();
alter table public.official_documents add column if not exists updated_at timestamptz default now();
alter table public.official_documents add column if not exists closed_at timestamptz;

create unique index if not exists official_documents_document_no_uq on public.official_documents(document_no);
create index if not exists official_documents_originator_idx on public.official_documents(originator_id, created_at desc);
create index if not exists official_documents_status_idx on public.official_documents(status, updated_at desc);
create index if not exists official_documents_barcode_idx on public.official_documents(barcode_value);

create table if not exists public.official_document_steps (
  step_id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.official_documents(document_id),
  step_no integer not null,
  step_type text not null check (step_type in ('co_sign','approval')),
  unit_id uuid not null references public.departments(dept_id),
  unit_name text not null,
  status text not null default 'sent' check (status in ('sent','received','completed','returned')),
  sent_by uuid references public.users(user_id),
  sent_at timestamptz not null default now(),
  received_by uuid references public.users(user_id),
  received_at timestamptz,
  completed_by uuid references public.users(user_id),
  completed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  unique(document_id, step_no)
);

create index if not exists official_document_steps_current_idx on public.official_document_steps(document_id, step_no desc);
create index if not exists official_document_steps_unit_idx on public.official_document_steps(unit_id, status, sent_at desc);
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'official_documents_current_step_fk'
      and conrelid = 'public.official_documents'::regclass
  ) then
    alter table public.official_documents
      add constraint official_documents_current_step_fk
      foreign key (current_step_id) references public.official_document_steps(step_id);
  end if;
end $$;

create table if not exists public.official_document_events (
  event_id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.official_documents(document_id),
  step_id uuid references public.official_document_steps(step_id),
  action text not null check (action in ('create','barcode_generated','send_co_sign','receive','co_sign_complete','send_approval','approval_receive','approve','return','resubmit','originator_receive')),
  from_status text,
  to_status text,
  actor_id uuid references public.users(user_id),
  actor_name text,
  actor_role text,
  actor_dept_id uuid references public.departments(dept_id),
  actor_dept_name text,
  target_unit_id uuid references public.departments(dept_id),
  note text,
  idempotency_key text not null unique,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists official_document_events_document_idx on public.official_document_events(document_id, occurred_at);
create index if not exists official_document_events_actor_idx on public.official_document_events(actor_id, occurred_at desc);

create table if not exists public.official_document_notifications (
  notification_id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.official_documents(document_id),
  step_id uuid references public.official_document_steps(step_id),
  recipient_id uuid not null references public.users(user_id),
  notification_type text not null check (notification_type in ('new_step','returned','approved','overdue')),
  status text not null default 'recorded' check (status in ('recorded','read','sent','failed')),
  title text not null,
  body text not null,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  sent_at timestamptz,
  unique(document_id, step_id, recipient_id, notification_type)
);

create index if not exists official_document_notifications_recipient_idx
  on public.official_document_notifications(recipient_id, status, created_at desc);

-- 事件軸是不可刪除、不可覆寫的稽核事實；流程目前狀態另存於 documents/steps。
create or replace function public.prevent_official_document_event_change()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  raise exception '公文流程事件不可修改或移除';
end;
$$;
drop trigger if exists trg_official_document_events_immutable on public.official_document_events;
create trigger trg_official_document_events_immutable
before update or delete on public.official_document_events
for each row execute function public.prevent_official_document_event_change();

alter table public.official_documents enable row level security;
alter table public.official_document_steps enable row level security;
alter table public.official_document_events enable row level security;
alter table public.official_document_notifications enable row level security;
alter table public.official_documents force row level security;
alter table public.official_document_steps force row level security;
alter table public.official_document_events force row level security;
alter table public.official_document_notifications force row level security;

drop policy if exists official_documents_read on public.official_documents;
drop policy if exists official_document_steps_read on public.official_document_steps;
drop policy if exists official_document_events_read on public.official_document_events;
drop policy if exists official_document_notifications_read on public.official_document_notifications;
drop policy if exists official_document_notifications_update on public.official_document_notifications;

-- 實際讀寫由 app-api 以服務角色執行並再次檢查部室／角色；直接 REST 僅能讀取
-- 已取得公文系統權限的登入者，不能直接插入或改寫流程事件。
create policy official_documents_read on public.official_documents
for select to authenticated
using (public.has_system_access('sys_officialdocs'));
create policy official_document_steps_read on public.official_document_steps
for select to authenticated
using (public.has_system_access('sys_officialdocs'));
create policy official_document_events_read on public.official_document_events
for select to authenticated
using (public.has_system_access('sys_officialdocs'));
create policy official_document_notifications_read on public.official_document_notifications
for select to authenticated
using (recipient_id = public.active_user_id() or public.is_admin());
create policy official_document_notifications_update on public.official_document_notifications
for update to authenticated
using (recipient_id = public.active_user_id())
with check (recipient_id = public.active_user_id());

-- 站內通知中心沿用既有 notifications，補上公文關聯欄位，保留既有資料。
alter table public.notifications add column if not exists document_id uuid references public.official_documents(document_id);
create index if not exists notifications_document_idx on public.notifications(document_id, created_at desc);

-- 讓系統角色能在後台以既有「系統存取權限」矩陣開關公文系統；預設沿用既有角色的
-- 其他業務系統設定，不覆寫管理員已手動收緊的權限。
insert into public.role_permissions(role_id, perm, allowed)
select role_id, 'sys_officialdocs', true
from public.roles
on conflict(role_id, perm) do nothing;

insert into public.system_settings(key, value)
values
  ('official_doc_receive_due_minutes', '60'),
  ('official_doc_approval_due_minutes', '480')
on conflict(key) do nothing;

commit;
