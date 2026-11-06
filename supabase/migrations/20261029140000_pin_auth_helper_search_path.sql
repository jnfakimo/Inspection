-- 2026-10-29 資安加固：固定兩個 Auth 輔助函式的 search_path。
--
-- 問題：admin_reset_user_password(text, text) 與 get_auth_user_id_by_email(text) 都是 security definer（以 postgres 身分執行、
-- 可讀寫 auth.users），卻沒有設定 search_path（Supabase 資安建議 function_search_path_mutable）。
-- 兩者目前只有 service_role 可執行（anon／authenticated 無權限，已讀回確認），風險低；但函式內的 crypt()、gen_salt() 沒有加 schema，
-- 若呼叫端的 search_path 先含可寫入的 schema，同名函式就可能被搶先解析（search_path 劫持），攔截新密碼或改寫密碼雜湊。
--
-- 作法：只用 ALTER FUNCTION ... SET search_path 固定搜尋路徑，不改函式本文、擁有者與權限。
--   - admin_reset_user_password：本文用到 pgcrypto 的 crypt()／gen_salt()（在 extensions schema），所以固定為 extensions, pg_temp。
--   - get_auth_user_id_by_email：本文只用已加 schema 的 auth.users，固定為空字串（強制全部寫完整 schema）。
-- 這兩個函式在 repo 的 migration 裡沒有建立（當初由儀表板建立），所以用 to_regprocedure 判斷：不存在的環境略過，不讓佈建失敗。
begin;

do $$
begin
  if to_regprocedure('public.admin_reset_user_password(text,text)') is not null then
    alter function public.admin_reset_user_password(text, text) set search_path = extensions, pg_temp;
  end if;
  if to_regprocedure('public.get_auth_user_id_by_email(text)') is not null then
    alter function public.get_auth_user_id_by_email(text) set search_path = '';
  end if;
end $$;

commit;
