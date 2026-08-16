-- 回填既有班別與範本的 assigned_user_ids。
--
-- 20260816170000 起，save_patrol_shift / save_patrol_shift_template 會同時寫入
-- assigned_user_ids，但只對之後新存的資料生效。在此之前，V1 一律把人員指派放在
-- system_settings 的 patrol_shift_staff JSON，從未寫過該欄位，導致 V2 巡檢排班
-- 模組（app-api 的 guardpatrol/shifts 以 assigned_user_ids 作為「排定人員」來源）
-- 對既有資料一律顯示空白。
--
-- 本 migration 自該 JSON 反推回填。只處理目前為空的列，避免覆蓋較新的正確資料。
-- JSON 結構：
--   {"dates":{"YYYY-MM-DD":{"<班別名>":[uuid,...]}},
--    "templates":{"<班別名>":[uuid,...]}, "workTimes":{...}}

begin;

-- 補上正式環境缺少的欄位。
--
-- system/sql/patrol_shifts.sql 雖有對應的 add column if not exists，但正式資料庫
-- 實際並無 patrol_shift_template.assigned_user_ids（回填時以 42703 錯誤浮現）。
-- 由於 plpgsql 在建立函式時不驗證欄位參照，20260816170000 的
-- save_patrol_shift_template 得以建立成功，卻會在執行階段失敗——亦即班別範本
-- 儲存自該版起實際上無法運作。此處補齊，兩張表一併處理。
alter table public.patrol_shifts
  add column if not exists assigned_user_ids uuid[] not null default '{}';
alter table public.patrol_shift_template
  add column if not exists assigned_user_ids uuid[] not null default '{}';

do $$
declare
  v_cfg     jsonb;
  v_shifts  integer := 0;
  v_tpls    integer := 0;
begin
  select coalesce(nullif(btrim(coalesce(value, '')), '')::jsonb, '{}'::jsonb)
  into v_cfg
  from public.system_settings
  where key = 'patrol_shift_staff';

  if v_cfg is null or v_cfg = '{}'::jsonb then
    raise notice '找不到 patrol_shift_staff 設定，略過回填。';
    return;
  end if;

  -- 每日班別：dates -> <shift_date> -> <name>
  with src as (
    select s.shift_id,
           v_cfg->'dates'->to_char(s.shift_date,'YYYY-MM-DD')->s.name as ids
    from public.patrol_shifts s
    where coalesce(array_length(s.assigned_user_ids, 1), 0) = 0
  ),
  parsed as (
    select src.shift_id,
           (select coalesce(array_agg(value::uuid), '{}'::uuid[])
            from jsonb_array_elements_text(src.ids) as t(value)) as ids
    from src
    where jsonb_typeof(src.ids) = 'array'
      and jsonb_array_length(src.ids) > 0
  )
  update public.patrol_shifts s
  set assigned_user_ids = parsed.ids
  from parsed
  where s.shift_id = parsed.shift_id;
  get diagnostics v_shifts = row_count;

  -- 班別範本：templates -> <name>
  with src as (
    select t.template_id,
           v_cfg->'templates'->t.name as ids
    from public.patrol_shift_template t
    where coalesce(array_length(t.assigned_user_ids, 1), 0) = 0
  ),
  parsed as (
    select src.template_id,
           (select coalesce(array_agg(value::uuid), '{}'::uuid[])
            from jsonb_array_elements_text(src.ids) as t(value)) as ids
    from src
    where jsonb_typeof(src.ids) = 'array'
      and jsonb_array_length(src.ids) > 0
  )
  update public.patrol_shift_template t
  set assigned_user_ids = parsed.ids
  from parsed
  where t.template_id = parsed.template_id;
  get diagnostics v_tpls = row_count;

  raise notice '已回填班別 % 筆、範本 % 筆。', v_shifts, v_tpls;
end $$;

commit;
