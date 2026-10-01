begin;

-- 輸入中的駐警交接暫存屬於登入者本人，尚未構成正式交接或簽名。
create table if not exists public.guard_handover_form_drafts (
  draft_id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(user_id),
  market_code text not null check (market_code in ('market_1','market_2')),
  duty_date date not null,
  shift_name text not null,
  content jsonb not null default '{}'::jsonb,
  source_log_id uuid references public.guard_handover_logs(log_id),
  source_updated_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '14 days'),
  constraint guard_form_draft_unique unique(owner_id,market_code,duty_date,shift_name),
  constraint guard_form_draft_shift check (char_length(shift_name) between 1 and 40),
  constraint guard_form_draft_content check (jsonb_typeof(content)='object' and octet_length(content::text)<=262144)
);
alter table public.guard_handover_form_drafts
  add column if not exists draft_id uuid default gen_random_uuid(),
  add column if not exists owner_id uuid references public.users(user_id),
  add column if not exists market_code text,
  add column if not exists duty_date date,
  add column if not exists shift_name text,
  add column if not exists content jsonb not null default '{}'::jsonb,
  add column if not exists source_log_id uuid references public.guard_handover_logs(log_id),
  add column if not exists source_updated_at timestamptz,
  add column if not exists is_active boolean not null default true,
  add column if not exists created_at timestamptz not null default clock_timestamp(),
  add column if not exists updated_at timestamptz not null default clock_timestamp(),
  add column if not exists expires_at timestamptz not null default (clock_timestamp()+interval '14 days');
create index if not exists guard_form_draft_expiry on public.guard_handover_form_drafts(expires_at) where is_active;

create or replace function public.guard_form_draft_stamp()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.draft_id is distinct from old.draft_id or new.owner_id is distinct from old.owner_id
    or new.market_code is distinct from old.market_code or new.duty_date is distinct from old.duty_date
    or new.shift_name is distinct from old.shift_name or new.created_at is distinct from old.created_at) then
    raise exception using errcode='23514',message='暫存識別資料不可變更';
  end if;
  new.updated_at:=clock_timestamp();
  if new.is_active then new.expires_at:=new.updated_at+interval '14 days'; end if;
  return new;
end $$;
revoke all on function public.guard_form_draft_stamp() from public,anon,authenticated;
drop trigger if exists trg_guard_form_draft_stamp on public.guard_handover_form_drafts;
create trigger trg_guard_form_draft_stamp before insert or update on public.guard_handover_form_drafts
  for each row execute function public.guard_form_draft_stamp();

alter table public.guard_handover_form_drafts enable row level security;
alter table public.guard_handover_form_drafts force row level security;
revoke all on public.guard_handover_form_drafts from public,anon,authenticated;
grant select,insert,update on public.guard_handover_form_drafts to authenticated;
drop policy if exists guard_form_draft_read on public.guard_handover_form_drafts;
create policy guard_form_draft_read on public.guard_handover_form_drafts for select to authenticated
  using (owner_id=public.active_user_id() and public.guard_market_allowed(market_code)
    and public.has_handover_module_access('guard'));
drop policy if exists guard_form_draft_add on public.guard_handover_form_drafts;
create policy guard_form_draft_add on public.guard_handover_form_drafts for insert to authenticated
  with check (owner_id=public.active_user_id() and public.guard_market_allowed(market_code)
    and public.has_handover_module_access('guard'));
drop policy if exists guard_form_draft_update on public.guard_handover_form_drafts;
create policy guard_form_draft_update on public.guard_handover_form_drafts for update to authenticated
  using (owner_id=public.active_user_id() and public.guard_market_allowed(market_code)
    and public.has_handover_module_access('guard'))
  with check (owner_id=public.active_user_id() and public.guard_market_allowed(market_code)
    and public.has_handover_module_access('guard'));

-- 原始交班文字改由 app-api 依主管權限回傳原文或遮蔽版；避免直接查表繞過遮蔽。
revoke select on public.guard_handover_logs from authenticated;
revoke select on public.guard_handover_corrections from authenticated;
revoke select on public.guard_handover_daily_approvals from authenticated;

notify pgrst,'reload schema';
commit;
