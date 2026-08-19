-- 個資去識別化 RPC（管理員限定）
-- 只處理已停用帳號，保留 user_id 與歷史稽核關聯，不刪除資料。
create or replace function public.deidentify_departed_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.users%rowtype;
  v_placeholder text;
begin
  if auth.uid() is null or not exists (
    select 1
      from public.users u
     where u.auth_id = auth.uid()
       and u.status = 'active'
       and (u.role = 'admin' or u.rbac_role in ('admin', 'sysadmin'))
  ) then
    raise exception '僅限已登入的系統管理員執行個資去識別化' using errcode = '42501';
  end if;

  select * into v_target
    from public.users
   where user_id = p_user_id
   for update;
  if not found then
    raise exception '找不到指定的使用者' using errcode = 'P0002';
  end if;
  if v_target.status <> 'inactive' then
    raise exception '只能對已停用（離職）的帳號執行去識別化，請先將該帳號停用' using errcode = '22023';
  end if;

  v_placeholder := '已離職人員-' || right(p_user_id::text, 4);
  update public.users
     set name = v_placeholder,
         phone = null,
         email = null,
         username = 'deidentified-' || p_user_id::text
   where user_id = p_user_id;
end;
$$;

revoke all on function public.deidentify_departed_user(uuid) from public;
grant execute on function public.deidentify_departed_user(uuid) to authenticated;

comment on function public.deidentify_departed_user(uuid) is
  '管理員限定：清除已停用帳號的直接識別欄位，保留 user_id 與歷史稽核關聯。';
