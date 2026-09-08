-- FindTag visible observations are NOT GPS points or verified device identities.
begin;
do $$begin
  if to_regprocedure('public.reject_physical_data_removal()') is null then
    raise exception '缺少正式資料永久保護，停止建立同步資料表';
  end if;
end$$;

create table if not exists public.findtag_collectors (
  collector_id uuid primary key default gen_random_uuid(),
  name text not null check(length(name) between 1 and 80),
  created_by uuid not null references public.users(user_id),
  created_at timestamptz not null default now(),
  active boolean not null default true,
  paired_at timestamptz,
  last_contact_at timestamptz,
  last_read_at timestamptz,
  last_received_at timestamptz,
  last_status text not null default 'unpaired'
    check(last_status in ('unpaired','waiting','readable','read_failed','disabled')),
  latest_snapshot_id uuid
);
create table if not exists public.findtag_collector_credentials (
  collector_id uuid primary key references public.findtag_collectors,
  pairing_hash text not null unique,
  pairing_expires_at timestamptz not null,
  token_hash text unique,
  token_expires_at timestamptz,
  check ((token_hash is null) = (token_expires_at is null))
);
create table if not exists public.findtag_visible_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  collector_id uuid not null references public.findtag_collectors,
  content_hash text not null,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  observations jsonb not null check(jsonb_typeof(observations)='array'),
  unique(collector_id,content_hash)
);
create index if not exists findtag_snapshots_time on public.findtag_visible_snapshots(collector_id,received_at desc);
alter table public.findtag_collectors enable row level security;
alter table public.findtag_collector_credentials enable row level security;
alter table public.findtag_visible_snapshots enable row level security;
revoke all on public.findtag_collectors,public.findtag_collector_credentials,public.findtag_visible_snapshots from public,anon,authenticated;
grant select on public.findtag_collectors,public.findtag_visible_snapshots to authenticated;
drop policy if exists findtag_collectors_read on public.findtag_collectors;
create policy findtag_collectors_read on public.findtag_collectors for select to authenticated
  using(public.active_user_id() is not null and public.has_system_access('sys_vehicletracking'));
drop policy if exists findtag_snapshots_read on public.findtag_visible_snapshots;
create policy findtag_snapshots_read on public.findtag_visible_snapshots for select to authenticated
  using(public.active_user_id() is not null and public.has_system_access('sys_vehicletracking'));

create or replace function public.findtag_issuer_active(p_user uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.users u where u.user_id=p_user and u.status='active'
    and (u.role='admin' or u.rbac_role in ('admin','sysadmin'))
    and (coalesce(u.rbac_role,case when u.role='admin' then 'sysadmin' else u.role end)='sysadmin'
      or exists(select 1 from public.role_permissions r where r.role_id=coalesce(u.rbac_role,u.role)
        and r.perm='sys_vehicletracking' and r.allowed)));
$$;
revoke all on function public.findtag_issuer_active(uuid) from public,anon,authenticated;

create or replace function public.findtag_create_pairing(p_name text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid; v_code text;
begin
  if public.active_user_id() is null or not coalesce(public.has_system_access('sys_vehicletracking') and public.is_admin(),false) then
    raise exception '只有具定位系統權限的管理員可以授權桌機';
  end if;
  if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception '請填寫桌機名稱'; end if;
  if (select count(*) from public.findtag_collectors where created_by=public.active_user_id() and active)>=10 then
    raise exception '啟用中的同步來源已達上限，請先停用不再使用的來源';
  end if;
  v_code=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','');
  insert into public.findtag_collectors(name,created_by) values(trim(p_name),public.active_user_id()) returning collector_id into v_id;
  insert into public.findtag_collector_credentials(collector_id,pairing_hash,pairing_expires_at)
    values(v_id,encode(sha256(convert_to(v_code,'UTF8')),'hex'),now()+interval '10 minutes');
  return jsonb_build_object('collector_id',v_id,'pairing_code',v_code,'expires_at',now()+interval '10 minutes');
end$$;

create or replace function public.findtag_redeem_pairing(p_pairing_code text,p_token text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_key public.findtag_collector_credentials%rowtype; v_hash text;
begin
  if p_pairing_code is null or p_pairing_code !~ '^[0-9a-f]{64}$' or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception '桌機配對資料無效';
  end if;
  select * into v_key from public.findtag_collector_credentials
    where pairing_hash=encode(sha256(convert_to(p_pairing_code,'UTF8')),'hex') for update;
  if not found or v_key.pairing_expires_at<now() or not exists(
    select 1 from public.findtag_collectors c
    where c.collector_id=v_key.collector_id and c.active and public.findtag_issuer_active(c.created_by)
  ) then raise exception '桌機配對已失效，請重新授權'; end if;
  v_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  if v_key.token_hash is not null and v_key.token_hash<>v_hash then raise exception '桌機配對已使用'; end if;
  if v_key.token_hash is null then
    update public.findtag_collector_credentials set token_hash=v_hash,token_expires_at=now()+interval '90 days' where collector_id=v_key.collector_id;
    update public.findtag_collectors set paired_at=now(),last_status='waiting' where collector_id=v_key.collector_id;
  end if;
  return jsonb_build_object('collector_id',v_key.collector_id,'paired',true);
end$$;

create or replace function public.findtag_ingest(p_token text,p_captured_at timestamptz,p_observations jsonb,p_status text default 'readable',p_live_read boolean default true)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_key public.findtag_collector_credentials%rowtype; v_source public.findtag_collectors%rowtype;
  v_row jsonb; v_rows jsonb; v_hash text; v_id uuid; v_existing uuid;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception '桌機授權無效'; end if;
  select * into v_key from public.findtag_collector_credentials
    where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  if not found or v_key.token_expires_at is null or v_key.token_expires_at<now() then raise exception '桌機授權無效或已到期'; end if;
  select * into v_source from public.findtag_collectors where collector_id=v_key.collector_id for update;
  if not v_source.active or not public.findtag_issuer_active(v_source.created_by) then
    raise exception '桌機授權已停用';
  end if;
  if v_source.last_contact_at>now()-interval '20 seconds' then raise exception '同步過於頻繁，請稍後重試'; end if;
  if p_status is null or p_status not in ('readable','read_failed') then raise exception '同步狀態無效'; end if;
  if p_status='read_failed' then
    if p_observations is not null then raise exception '讀取失敗不可傳送畫面內容'; end if;
    update public.findtag_collectors set last_contact_at=now(),last_status='read_failed' where collector_id=v_key.collector_id;
    return jsonb_build_object('accepted',true,'status','read_failed');
  end if;
  if p_observations is null or jsonb_typeof(p_observations)<>'array' or pg_column_size(p_observations)>524288
    or jsonb_array_length(p_observations) not between 1 and 200 then raise exception '可見清單格式或筆數不符'; end if;
  if p_captured_at is null or not isfinite(p_captured_at) or p_captured_at>now()+interval '5 minutes' or p_captured_at<'2020-01-01T00:00:00Z' then
    raise exception '擷取時間無效';
  end if;
  for v_row in select value from jsonb_array_elements(p_observations) loop
    if jsonb_typeof(v_row)<>'object' or (v_row - array['device_label','address_text','source_time_text'])<>'{}'::jsonb
      or jsonb_typeof(v_row->'device_label') is distinct from 'string'
      or jsonb_typeof(v_row->'address_text') is distinct from 'string'
      or jsonb_typeof(v_row->'source_time_text') is distinct from 'string'
      or length(trim(v_row->>'device_label')) not between 1 and 256
      or length(trim(v_row->>'address_text')) not between 1 and 1536
      or (v_row->>'source_time_text') !~ '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$' then
      raise exception '只接受設備名稱、地址與原始時間文字，不接受推估座標';
    end if;
    perform (v_row->>'source_time_text')::timestamp;
  end loop;
  -- Sort and deduplicate whole rows, never merge same-name devices.
  select jsonb_agg(value order by value::text) into v_rows from (select distinct value from jsonb_array_elements(p_observations)) rows;
  v_hash=encode(sha256(convert_to(v_rows::text,'UTF8')),'hex');
  select snapshot_id into v_existing from public.findtag_visible_snapshots where collector_id=v_key.collector_id and content_hash=v_hash;
  insert into public.findtag_visible_snapshots(collector_id,content_hash,captured_at,observations)
    values(v_key.collector_id,v_hash,p_captured_at,v_rows) on conflict(collector_id,content_hash) do nothing
    returning snapshot_id into v_id;
  if v_id is null then v_id=v_existing; end if;
  update public.findtag_collectors set last_contact_at=now(),last_status=case when p_live_read is true then 'readable' else 'read_failed' end,last_read_at=greatest(last_read_at,p_captured_at),
    last_received_at=case when v_existing is null then now() else last_received_at end,
    latest_snapshot_id=case when v_source.last_read_at is null or p_captured_at>=v_source.last_read_at then v_id else latest_snapshot_id end
    where collector_id=v_key.collector_id;
  return jsonb_build_object('accepted',true,'duplicate',v_existing is not null,'snapshot_id',v_id);
end$$;

create or replace function public.findtag_disable_collector(p_collector_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.active_user_id() is null or not coalesce(public.has_system_access('sys_vehicletracking') and public.is_admin(),false) then
    raise exception '只有具定位系統權限的管理員可以停用桌機';
  end if;
  update public.findtag_collectors set active=false,last_status='disabled' where collector_id=p_collector_id;
end$$;
revoke all on function public.findtag_create_pairing(text),public.findtag_redeem_pairing(text,text),
  public.findtag_ingest(text,timestamptz,jsonb,text,boolean),public.findtag_disable_collector(uuid) from public,anon,authenticated;
grant execute on function public.findtag_create_pairing(text),public.findtag_disable_collector(uuid) to authenticated;
grant execute on function public.findtag_redeem_pairing(text,text),public.findtag_ingest(text,timestamptz,jsonb,text,boolean) to anon;
do $$declare v_table text; begin
  foreach v_table in array array['findtag_collectors','findtag_collector_credentials','findtag_visible_snapshots'] loop
    execute format('drop trigger if exists trg_prevent_removal on public.%I',v_table);
    execute format('create trigger trg_prevent_removal before delete or truncate on public.%I for each statement execute function public.reject_physical_data_removal()',v_table);
  end loop;
end$$;
notify pgrst, 'reload schema';
commit;
