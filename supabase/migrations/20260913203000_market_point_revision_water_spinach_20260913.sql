begin;

-- 北農官網盤後修正：2026-09-13 第一市場蔬菜「蕹菜」移除 LF1 品種，代碼組合由 LF1|LF2|LF3 變為 LF2|LF3
-- （成交量不變、下價由 35 修正為 48.2）。每日匯入的防重複計量檢查因此停止整批匯入，
-- 並連帶使 9/14、9/15 的排程失敗。經系統管理員確認以官網為準：原地更新該筆彙總（不刪除任何資料），
-- 修正前後內容寫入 audit_logs。資料庫已是官網版本時不重複執行；代碼組合與預期不符時停止並要求人工核對。
do $fix$
declare
  v_source constant uuid := '9a2c1e61-6b8c-49f7-b001-202608300001';
  v_new_key constant text := 'market-import:35774903c809e3f9cb8094999908f885d9bce07eb69b45c5563a70505cfae44f';
  v_new_dimensions constant jsonb := '{"market": "第一市場", "category": "蔬菜", "item": "蕹菜", "item_key": "LF2|LF3"}'::jsonb;
  v_new_measures constant jsonb := '{"quantity": 15692.0, "total_value": 1215813.2, "average_price": 77.4798, "high_price": 109.0, "middle_price": 75.4045, "low_price": 48.2}'::jsonb;
  v_old public.market_data_points%rowtype;
begin
  -- 與每日匯入使用同一把鎖，避免修正時排程同時寫入。
  perform pg_advisory_xact_lock(hashtext('tapmc_daily_import'));

  select * into v_old from public.market_data_points
   where source_id = v_source and observed_on = '2026-09-13'
     and dimensions->>'market' = '第一市場' and dimensions->>'category' = '蔬菜' and dimensions->>'item' = '蕹菜'
   for update;
  if not found then
    raise exception '找不到 2026-09-13 第一市場蔬菜蕹菜的行情資料，停止修正';
  end if;
  if v_old.external_key = v_new_key then
    raise notice '2026-09-13 蕹菜已是官網版本，不需修正';
    return;
  end if;
  if v_old.dimensions->>'item_key' is distinct from 'LF1|LF2|LF3' then
    raise exception '資料庫中蕹菜的代碼組合已變為 %，與預期的 LF1|LF2|LF3 不符，請重新人工核對', v_old.dimensions->>'item_key';
  end if;
  if exists (select 1 from public.market_data_points where source_id = v_source and external_key = v_new_key) then
    raise exception '官網版本的穩定鍵已存在於其他資料列，請人工核對';
  end if;

  update public.market_data_points
     set dimensions = v_new_dimensions,
         measures = v_new_measures,
         external_key = v_new_key,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
           'item_code_count', 2,
           'superseded_item_key', 'LF1|LF2|LF3',
           'superseded_external_key', v_old.external_key,
           'source_revision', '北農官網盤後移除 LF1 品種，經系統管理員確認以官網為準（2026-09-13）')
   where point_id = v_old.point_id;

  insert into public.audit_logs (table_name, record_id, action, changes, operator_id, source)
  values ('market_data_points', v_old.point_id, 'update',
          jsonb_build_object(
            'before', jsonb_build_object('dimensions', v_old.dimensions, 'measures', v_old.measures, 'external_key', v_old.external_key),
            'after', jsonb_build_object('dimensions', v_new_dimensions, 'measures', v_new_measures, 'external_key', v_new_key),
            'reason', '北農官網盤後修正：蕹菜移除 LF1 品種，經系統管理員確認以官網為準'),
          null, 'migration:20260913203000_market_point_revision_water_spinach_20260913');
end $fix$;

commit;
