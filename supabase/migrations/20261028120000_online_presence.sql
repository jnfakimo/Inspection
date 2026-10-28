-- 上方工作列的「在線人數」：登入中的使用者每分鐘回報一次心跳，最近 3 分鐘內有回報的不重複使用者數即為在線人數。
--
-- 設計原則（最小揭露）：
--   1. 前端只拿到「人數」這一個整數，拿不到是誰在線；presence 資料表不開放任何直接讀寫，
--      一律經由 security definer 函式，且 RLS 啟用、不設任何政策（預設拒絕）。
--   2. 同一人開多個分頁只算一人（以 user_id 為主鍵）；已停用帳號不計入。
--   3. 不實體刪除：登出時把最後回報時間往前調一天（視為離線），不 delete；表上掛既有的 trg_prevent_removal。
--   4. 只記「最後一次出現時間」，不留歷史軌跡，不記頁面、IP 或裝置。

begin;

create table if not exists public.user_presence (
  user_id uuid primary key references public.users(user_id),
  last_seen_at timestamptz not null default now()
);

alter table public.user_presence enable row level security;
revoke all on public.user_presence from public, anon, authenticated;

comment on table public.user_presence is
  '登入使用者最後一次出現的時間，只供「在線人數」計數；不開放直接讀寫，也不保存歷史。';

do $$
begin
  if to_regprocedure('public.reject_physical_data_removal()') is not null then
    drop trigger if exists trg_prevent_removal on public.user_presence;
    -- 同一行寫完：套用流程的防刪除檢查以 /truncate\s+(?!on\b)/ 掃描，換行會被誤判成 TRUNCATE 而拒絕套用。
    create trigger trg_prevent_removal before delete or truncate on public.user_presence for each statement execute function public.reject_physical_data_removal();
  end if;
end $$;

-- 回報心跳並回傳目前在線人數（最近 3 分鐘內有回報、帳號啟用中的不重複使用者）。
create or replace function public.presence_heartbeat()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_count integer;
begin
  select u.user_id into v_user
  from public.users u
  where u.auth_id = auth.uid() and u.status = 'active'
  limit 1;
  if v_user is null then
    raise exception using errcode = '42501', message = '找不到有效的使用者帳號';
  end if;

  insert into public.user_presence (user_id, last_seen_at)
  values (v_user, now())
  on conflict (user_id) do update set last_seen_at = excluded.last_seen_at;

  select count(*)::integer into v_count
  from public.user_presence p
  join public.users u on u.user_id = p.user_id and u.status = 'active'
  where p.last_seen_at > now() - interval '3 minutes';
  return v_count;
end;
$$;

-- 登出時呼叫：視為離線（把最後出現時間調到一天前，不刪除資料列）。
create or replace function public.presence_leave()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
begin
  select u.user_id into v_user
  from public.users u
  where u.auth_id = auth.uid() and u.status = 'active'
  limit 1;
  if v_user is null then return; end if;
  update public.user_presence
  set last_seen_at = now() - interval '1 day'
  where user_id = v_user;
end;
$$;

revoke all on function public.presence_heartbeat() from public, anon;
revoke all on function public.presence_leave() from public, anon;
grant execute on function public.presence_heartbeat() to authenticated;
grant execute on function public.presence_leave() to authenticated;

notify pgrst, 'reload schema';

commit;
