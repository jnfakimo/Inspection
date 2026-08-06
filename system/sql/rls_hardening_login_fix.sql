-- ============================================================
-- Legacy authenticated-only username lookup helper
-- ============================================================
--
-- Browser login now uses the username-login Edge Function. This helper remains
-- only for authenticated compatibility calls and is never granted to anon.
-- ============================================================

create or replace function login_lookup_email(p_username text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select email from users
  where username = p_username and status = 'active'
  limit 1;
$$;

revoke all on function login_lookup_email(text) from public;
grant execute on function login_lookup_email(text) to authenticated;

-- 未登入的帳號解析改由 username-login Edge Function 在伺服器內完成；
-- 不授權 anon 呼叫本函式，以免被用來列舉帳號與 Email。
