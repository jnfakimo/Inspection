-- LINE 通知群組改為「管理員產生一次性登記碼 → 在目標群組輸入」才寫入。
-- 取代過去 webhook 收到任何群組事件就覆寫 system_settings.line_group_id 的做法。
-- 登記碼只存 SHA-256 雜湊；群組 ID 本身只寫進 system_settings，不另外保存明文。
begin;

create table if not exists public.line_group_register_codes (
  code_id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending'
    check (state in ('pending', 'consumed', 'expired', 'cancelled')),
  created_by uuid not null references public.users(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  group_id_hash text check (group_id_hash is null or group_id_hash ~ '^[0-9a-f]{64}$'),
  constraint line_group_register_code_expiry_check check (expires_at > created_at),
  constraint line_group_register_code_consumed_check check (
    (state = 'consumed' and consumed_at is not null and group_id_hash is not null)
    or (state <> 'consumed' and group_id_hash is null)
  )
);

-- 同一時間只允許一組有效登記碼，避免舊碼被拿去改綁。
create unique index if not exists idx_line_group_register_codes_one_pending
  on public.line_group_register_codes((true))
  where state = 'pending';

-- Existing pending codes without an issuance snapshot fail closed on consumption.
alter table public.line_group_register_codes
  add column if not exists issuer_scope jsonb;

alter table public.line_group_register_codes enable row level security;
revoke all on public.line_group_register_codes from public, anon, authenticated;
grant all on public.line_group_register_codes to service_role;

comment on table public.line_group_register_codes is
  'LINE 通知群組的一次性登記碼（只存雜湊，10 分鐘有效）。只能經 admin-api 建立、經簽章驗證的 LINE webhook 使用。';

do $$
begin
  if to_regprocedure('public.reject_physical_data_removal()') is not null then
    drop trigger if exists trg_prevent_removal on public.line_group_register_codes;
    -- 同一行寫完：套用流程的防刪除檢查以 /truncate\s+(?!on\b)/ 掃描，換行會被誤判成 TRUNCATE 而拒絕套用。
    create trigger trg_prevent_removal before delete or truncate on public.line_group_register_codes for each statement execute function public.reject_physical_data_removal();
  end if;
end $$;

create or replace function public.create_line_group_register_code(
  p_user_id uuid,
  p_code_hash text,
  p_now timestamptz default now()
)
returns table (outcome text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user public.users;
  v_expires_at timestamptz := p_now + interval '10 minutes';
begin
  if p_user_id is null or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' or p_now is null then
    return query select 'invalid_request'::text, null::timestamptz;
    return;
  end if;

  select u.* into v_user from public.users u where u.user_id = p_user_id for share;
  if not found or v_user.status is distinct from 'active' then
    return query select 'user_inactive'::text, null::timestamptz;
    return;
  end if;

  -- Match admin-api's existing sysadmin OR legacy admin rule; add no new role.
  if not (coalesce(nullif(v_user.rbac_role, ''), v_user.role, '') = 'sysadmin'
          or coalesce(v_user.role, '') = 'admin') then
    return query select 'issuer_unauthorized'::text, null::timestamptz;
    return;
  end if;

  -- 產生新碼時，舊的未使用登記碼一律作廢。
  update public.line_group_register_codes c
  set state = 'cancelled'
  where c.state = 'pending';

  insert into public.line_group_register_codes (code_hash, state, created_by, created_at, expires_at, issuer_scope)
  values (p_code_hash, 'pending', p_user_id, p_now, v_expires_at,
    jsonb_build_object('role', v_user.role, 'rbac_role', v_user.rbac_role, 'dept_id', v_user.dept_id));

  return query select 'created'::text, v_expires_at;
end;
$$;

create or replace function public.consume_line_group_register_code(
  p_code_hash text,
  p_group_id text,
  p_group_id_hash text,
  p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_code public.line_group_register_codes;
  v_user public.users;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$'
    or p_group_id is null or p_group_id !~ '^C[0-9a-fA-F]{32}$'
    or p_group_id_hash is null or p_group_id_hash !~ '^[0-9a-f]{64}$'
    or p_now is null then
    return 'invalid_request';
  end if;

  select * into v_code
  from public.line_group_register_codes c
  where c.code_hash = p_code_hash
  for update;
  if not found then
    return 'invalid_code';
  end if;
  if v_code.state <> 'pending' then
    return 'already_used';
  end if;
  if v_code.expires_at <= p_now then
    update public.line_group_register_codes c set state = 'expired' where c.code_id = v_code.code_id;
    return 'expired';
  end if;

  -- Hold the issuer row through commit: concurrent status/role/scope changes
  -- cannot pass between this authorization decision and the group update.
  select u.* into v_user from public.users u where u.user_id = v_code.created_by for share;
  if not found or v_user.status is distinct from 'active'
    or not (coalesce(nullif(v_user.rbac_role, ''), v_user.role, '') = 'sysadmin'
            or coalesce(v_user.role, '') = 'admin')
    or v_code.issuer_scope is distinct from
      jsonb_build_object('role', v_user.role, 'rbac_role', v_user.rbac_role, 'dept_id', v_user.dept_id) then
    update public.line_group_register_codes c set state = 'cancelled' where c.code_id = v_code.code_id;
    return 'issuer_unauthorized';
  end if;

  update public.line_group_register_codes c
  set state = 'consumed', consumed_at = p_now, group_id_hash = p_group_id_hash
  where c.code_id = v_code.code_id;

  insert into public.system_settings (key, value, updated_at)
  values ('line_group_id', p_group_id, p_now)
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return 'registered';
end;
$$;

revoke all on function public.create_line_group_register_code(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.create_line_group_register_code(uuid, text, timestamptz)
  to service_role;
revoke all on function public.consume_line_group_register_code(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consume_line_group_register_code(text, text, text, timestamptz)
  to service_role;

commit;
