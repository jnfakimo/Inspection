-- 將圖臺三表的寫入權限收斂為僅 sys_structuremap。
--
-- 20260816140000 修正了 floor_spaces / plan_markers / floor_models 的寫入權限被
-- 誤綁在 sys_equipment 的問題，但當時採用「sys_structuremap 或 sys_equipment 其一」
-- 的寬鬆寫法，因為無法從遷移腳本得知正式環境是否存在「有設備權限、沒圖臺權限」
-- 的角色——若逕行置換，該類角色會立即失去圖臺編輯能力。
--
-- 本 migration 先驗證再收斂：
--   1. 檢查 role_permissions 是否存在該類角色。有的話直接中止並在錯誤訊息中列出
--      角色代碼，整份 rollback，不會有人失去權限。
--   2. 通過才把三張表的 insert/update 政策改為僅認 sys_structuremap。
--
-- 判斷依據的完整性：has_system_access 只查 role_permissions，另加 sysadmin 一律
-- 放行的例外，並無其他來源，故只檢查 role_permissions 即為完整。sysadmin 不受
-- 本次收斂影響。

begin;

do $$
declare
  v_bad text[];
begin
  select coalesce(array_agg(distinct rp.role_id), '{}'::text[])
  into v_bad
  from public.role_permissions rp
  where rp.perm = 'sys_equipment'
    and rp.allowed = true
    and rp.role_id <> 'sysadmin'
    and not exists (
      select 1 from public.role_permissions rp2
      where rp2.role_id = rp.role_id
        and rp2.perm = 'sys_structuremap'
        and rp2.allowed = true
    );

  if coalesce(array_length(v_bad, 1), 0) > 0 then
    raise exception using errcode = '0A000',
      message = '中止收斂：以下角色有設備權限但無圖臺權限，收斂後會失去圖臺編輯能力 → '
                || array_to_string(v_bad, '、')
                || '。請先於 RBAC 頁面補上圖臺存取權，或維持 20260816140000 的兩者其一條件。';
  end if;

  raise notice '驗證通過：無「有設備權限、沒圖臺權限」的角色，開始收斂。';
end $$;

do $$
declare t text;
begin
  foreach t in array array['floor_spaces','plan_markers','floor_models'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists %I on public.%I', t||'_managed_insert', t);
      execute format('drop policy if exists %I on public.%I', t||'_managed_update', t);

      execute format(
        'create policy %I on public.%I for insert to authenticated with check('
        'public.has_system_access(''sys_structuremap'') and public.has_app_permission(''create''))',
        t||'_managed_insert', t);

      execute format(
        'create policy %I on public.%I for update to authenticated using('
        'public.has_system_access(''sys_structuremap'') and public.has_app_permission(''update'')) '
        'with check(public.has_system_access(''sys_structuremap'') and public.has_app_permission(''update''))',
        t||'_managed_update', t);
    end if;
  end loop;
end $$;

commit;
