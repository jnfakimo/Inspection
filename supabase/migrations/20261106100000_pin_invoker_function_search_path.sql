-- 2026-11-06 資安加固：固定 15 個 security invoker 函式的 search_path。
--
-- Supabase 資安建議 function_search_path_mutable 仍標記 15 個函式沒有設定 search_path（兩個 security definer 的 Auth 輔助函式
-- 已在 20261029140000 處理）。這 15 個都是 security invoker（以呼叫者身分執行），沒有提權風險，風險遠低於 definer；
-- 但 search_path 由呼叫端決定時，若前面有呼叫者可寫入的 schema，同名資料表／序列可能被搶先解析（例如 gen_material_code 的 materials）。
--
-- 作法：只用 ALTER FUNCTION ... SET search_path 固定搜尋路徑，不改函式本文、擁有者與權限（含 PUBLIC／anon／authenticated 的 EXECUTE）。已逐一讀過正式庫的函式本文：
--   - 編號產生函式（gen_*）用到未加 schema 的 materials 表與 req_seq／wo_seq／vehicle_dispatch_seq 序列（都在 public）→ public, pg_temp。
--   - 觸發器函式（reject_*、set_*_updated_at、touch_*）只用 now()、NEW、tg_table_name 與 raise exception（皆內建）→ 空字串，強制全部寫完整 schema。
--     其中 reject_physical_data_removal 被 62 個觸發器使用（禁止實體刪除），是專案的核心保護，PGlite 測試有驗證修正後仍擋 DELETE 與 TRUNCATE。
-- 這些函式不少在儀表板或舊 migration 建立，以 to_regprocedure 判斷：不存在的環境略過，不讓佈建失敗。
-- 注意：之後任何 migration 若 CREATE OR REPLACE 這些函式而沒寫 set search_path，設定會被清掉；security-check hook 已新增提醒。
begin;

do $$
declare
  item record;
begin
  for item in
    select * from (values
      ('public.gen_material_code(text,text)',                    'public, pg_temp'),
      ('public.gen_meeting_booking_no()',                        'public, pg_temp'),
      ('public.gen_req_no()',                                    'public, pg_temp'),
      ('public.gen_vehicle_dispatch_no()',                       'public, pg_temp'),
      ('public.gen_wo_no()',                                     'public, pg_temp'),
      ('public.reject_physical_data_removal()',                  ''),
      ('public.reject_security_alert_removal()',                 ''),
      ('public.reject_security_monitor_history_change()',        ''),
      ('public.reject_security_session_block_removal()',         ''),
      ('public.set_equipment_lifecycle_updated_at()',            ''),
      ('public.set_floor_spaces_updated_at()',                   ''),
      ('public.set_materials_updated_at()',                      ''),
      ('public.set_plan_markers_updated_at()',                   ''),
      ('public.touch_vehicle_tracking_updated_at()',             ''),
      ('public.touch_vehicle_updated_at()',                      '')
    ) as t(signature, search_path)
  loop
    if to_regprocedure(item.signature) is not null then
      execute format('alter function %s set search_path = %s', item.signature, case when item.search_path = '' then '''''' else item.search_path end);
    end if;
  end loop;
end $$;

commit;
