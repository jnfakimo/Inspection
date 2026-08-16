-- 修正圖臺三表的寫入權限歸屬。
--
-- 20260806020000 以一個迴圈為「設備、樓層與材料主檔」建立 RLS 政策，把
-- floor_spaces、plan_markers、floor_models 一併放進該清單，因此三者的
-- insert/update 都要求 has_system_access('sys_equipment')。
--
-- 但這三張表的寫入來源全部都在圖臺（SYS-06）：
--   floor_spaces  <- arealist.html                    (structuremap/areas)
--   plan_markers  <- b1_integrated_marker_system.html (structuremap/markers)
--   floor_models  <- modeler.html                     (structuremap/models)
-- 設備系統只讀不寫。權限鍵應為 sys_structuremap。
--
-- 目前尚未出事，是因為 system_access_seed.sql 預設把所有 sys_* 發給所有
-- 角色；但該檔註明後續會在 RBAC 頁面手動收緊，屆時只要有角色被關掉
-- 「設備建置」，其圖臺編輯就會全部被 RLS 擋下，且錯誤訊息難以理解。
--
-- 此處刻意採用「兩者其一」而非直接換成 sys_structuremap：無法從遷移腳本
-- 得知正式環境是否已存在「有設備、沒圖臺」的角色，若直接置換會使該類角色
-- 立即失去圖臺編輯能力。本版保證沒有任何角色會失去現有權限。
--
-- 後續：確認 role_permissions 現況沒有「有設備、沒圖臺」的角色後，應再發
-- 一支 migration 將條件收斂為僅 sys_structuremap。

begin;

do $$
declare t text;
begin
  foreach t in array array['floor_spaces','plan_markers','floor_models'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop policy if exists %I on public.%I', t||'_managed_insert', t);
      execute format('drop policy if exists %I on public.%I', t||'_managed_update', t);

      execute format(
        'create policy %I on public.%I for insert to authenticated with check('
        '(public.has_system_access(''sys_structuremap'') or public.has_system_access(''sys_equipment''))'
        ' and public.has_app_permission(''create''))',
        t||'_managed_insert', t);

      execute format(
        'create policy %I on public.%I for update to authenticated using('
        '(public.has_system_access(''sys_structuremap'') or public.has_system_access(''sys_equipment''))'
        ' and public.has_app_permission(''update'')) with check('
        '(public.has_system_access(''sys_structuremap'') or public.has_system_access(''sys_equipment''))'
        ' and public.has_app_permission(''update''))',
        t||'_managed_update', t);
    end if;
  end loop;
end $$;

commit;
