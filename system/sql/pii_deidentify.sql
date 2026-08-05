-- ============================================================
-- 離職人員個資去識別化（管理員限定）
-- 目的：對已停用（status='inactive'）的帳號清除直接識別的個資欄位，
-- 同時保留稽核鏈完整性（user_id、角色、所有歷史紀錄的外鍵皆不受影響）。
-- 這不是刪除——本系統資料庫層禁止 DELETE/TRUNCATE（見
-- permanent_data_protection.sql），這裡只是欄位層級的去識別化，符合
-- append-only 的核心原則。可重複執行（idempotent）。
-- ============================================================

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
