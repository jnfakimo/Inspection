-- 離職人員個資去識別化 RPC。
--
-- 這支檔案在 5f2e941（2026-08-19 09:52，訊息寫「add deidentify user database RPC
-- migration」）被建立，但實際寫入的是 0 bytes 的空檔——函式定義只存在於
-- system/sql/pii_deidentify.sql，而那支檔案並不在 AGENTS.md 的執行順序清單裡。
-- 正式環境已經有這支函式（2026-08-20 以 pg_proc 查證過），admin-api 的
-- admin_deidentify_user 也一直呼叫得到，所以不是線上故障；但用 migration 佈建的
-- 全新環境會少掉它，後台的「去識別化個資」按鈕會失敗。本檔補上內容，與
-- system/sql/pii_deidentify.sql 保持同一份定義（create or replace，可重複執行）。

begin;

create or replace function deidentify_departed_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_placeholder text;
begin
  -- 僅限已登入且為管理員的帳號執行；沿用 auth_profile_recovery.sql 的
  -- 內嵌檢查寫法，不倚賴跨函式呼叫的權限語意。
  if auth.uid() is null or not exists (
    select 1 from users u
    where u.auth_id = auth.uid()
      and u.status = 'active'
      and (u.role = 'admin' or u.rbac_role in ('admin', 'sysadmin'))
  ) then
    raise exception '僅限已登入的系統管理員執行個資去識別化'
      using errcode = '42501';
  end if;

  select * into v_target from users where user_id = p_user_id;
  if v_target is null then
    raise exception '找不到指定的使用者' using errcode = 'P0002';
  end if;
  if v_target.status <> 'inactive' then
    raise exception '只能對已停用（離職）的帳號執行去識別化，請先將該帳號停用'
      using errcode = '22023';
  end if;

  v_placeholder := '已離職人員-' || right(p_user_id::text, 4);

  update users set
    name = v_placeholder,
    phone = null,
    email = null,
    username = 'deidentified-' || p_user_id::text
  where user_id = p_user_id;

  -- users 表上既有的 trg_users_history（permanent_data_protection.sql）
  -- 會在這次 UPDATE 後自動補一筆快照，記錄「誰、何時執行了這次去識別化」，
  -- 不需要在這裡額外手動寫入 users_history。
end;
$$;

revoke all on function deidentify_departed_user(uuid) from public;
grant execute on function deidentify_departed_user(uuid) to authenticated;

comment on function deidentify_departed_user(uuid) is
  '管理員限定：清除已離職（inactive）帳號的姓名/電話/Email/登入帳號等直接識別欄位，保留 user_id 與所有歷史稽核紀錄的關聯完整性。';

notify pgrst, 'reload schema';

commit;
