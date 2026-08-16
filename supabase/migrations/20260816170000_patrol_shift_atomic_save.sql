-- 巡檢排班儲存改為單一交易，並改以伺服器端局部合併寫入人員指派設定。
--
-- 原本前端的兩個儲存流程都各自寫兩張表：
--   班別：upsert patrol_shifts          -> upsert system_settings('patrol_shift_staff')
--   範本：insert/update patrol_shift_template -> upsert system_settings('patrol_shift_staff')
-- 兩步為獨立請求，第二步失敗時第一步已 commit：班別時段存進去了、人員指派沒有。
-- 前端又在寫入前就先改了記憶體中的 staffAssignments，失敗時提早 return 而未重新
-- load()，畫面會顯示成已儲存，與資料庫不一致。
--
-- 另一個問題是 patrol_shift_staff 是「整包 JSON 存在單一列」，前端每次都送出完整
-- 結構覆寫。兩位管理員同時編輯不同日期時，後儲存者會覆蓋前者的變更。本函式改為
-- 只更新該日期／該班別對應的節點，其餘內容原樣保留。
--
-- 注意：security definer 會繞過 RLS，而 system_settings 為 admin-only（且設有
-- force row level security）、patrol_shifts 與 patrol_shift_template 的寫入政策
-- 同樣要求 is_admin()。因此函式內必須自行檢查 is_admin()，否則等同開放任何登入
-- 者改寫全站設定。

begin;

-- jsonb 字串陣列轉 uuid[]，供 assigned_user_ids 欄位使用。
create or replace function public.patrol_staff_uuid_array(p_staff jsonb)
returns uuid[]
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    (select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_staff, '[]'::jsonb)) as t(value)),
    '{}'::uuid[]);
$$;

-- 將 staffAssignments 的單一節點寫回 system_settings，其餘內容保持不變。
create or replace function public.patrol_staff_config_apply(
  p_scope      text,   -- 'date' | 'template'
  p_date_key   text,   -- p_scope='date' 時為 YYYY-MM-DD，否則忽略
  p_shift_name text,
  p_staff      jsonb,  -- uuid 陣列
  p_work_start text,
  p_work_end   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cfg   jsonb;
  v_work  jsonb := jsonb_build_object('start', p_work_start, 'end', p_work_end);
begin
  select coalesce(nullif(btrim(coalesce(value, '')), '')::jsonb, '{}'::jsonb)
  into v_cfg
  from public.system_settings
  where key = 'patrol_shift_staff'
  for update;

  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  v_cfg := jsonb_set(v_cfg, '{templates}', coalesce(v_cfg->'templates', '{}'::jsonb), true);
  v_cfg := jsonb_set(v_cfg, '{dates}',     coalesce(v_cfg->'dates',     '{}'::jsonb), true);
  v_cfg := jsonb_set(v_cfg, '{workTimes}', coalesce(v_cfg->'workTimes', '{}'::jsonb), true);
  v_cfg := jsonb_set(v_cfg, '{workTimes,templates}', coalesce(v_cfg->'workTimes'->'templates', '{}'::jsonb), true);
  v_cfg := jsonb_set(v_cfg, '{workTimes,dates}',     coalesce(v_cfg->'workTimes'->'dates',     '{}'::jsonb), true);

  if p_scope = 'template' then
    v_cfg := jsonb_set(v_cfg, array['templates', p_shift_name], coalesce(p_staff, '[]'::jsonb), true);
    v_cfg := jsonb_set(v_cfg, array['workTimes','templates', p_shift_name], v_work, true);
  elsif p_scope = 'date' then
    v_cfg := jsonb_set(v_cfg, array['dates', p_date_key],
                       coalesce(v_cfg->'dates'->p_date_key, '{}'::jsonb), true);
    v_cfg := jsonb_set(v_cfg, array['dates', p_date_key, p_shift_name], coalesce(p_staff, '[]'::jsonb), true);
    v_cfg := jsonb_set(v_cfg, array['workTimes','dates', p_date_key],
                       coalesce(v_cfg->'workTimes'->'dates'->p_date_key, '{}'::jsonb), true);
    v_cfg := jsonb_set(v_cfg, array['workTimes','dates', p_date_key, p_shift_name], v_work, true);
  else
    raise exception using errcode = '22023', message = '不支援的排班設定範圍';
  end if;

  insert into public.system_settings (key, value, updated_at)
  values ('patrol_shift_staff', v_cfg::text, now())
  on conflict (key) do update
  set value = excluded.value, updated_at = now();
end;
$$;

create or replace function public.save_patrol_shift(
  p_shift_date date,
  p_name       text,
  p_start_time time,
  p_end_time   time,
  p_sort_order integer,
  p_staff      jsonb,
  p_work_start text,
  p_work_end   text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = '只有系統管理者可以維護巡檢排班';
  end if;

  insert into public.patrol_shifts (shift_date, name, start_time, end_time, sort_order, assigned_user_ids)
  values (p_shift_date, p_name, p_start_time, p_end_time, coalesce(p_sort_order, 0),
          public.patrol_staff_uuid_array(p_staff))
  on conflict (shift_date, name) do update
  set start_time        = excluded.start_time,
      end_time          = excluded.end_time,
      sort_order        = excluded.sort_order,
      assigned_user_ids = excluded.assigned_user_ids;

  perform public.patrol_staff_config_apply(
    'date', to_char(p_shift_date, 'YYYY-MM-DD'), p_name, p_staff, p_work_start, p_work_end);
end;
$$;

create or replace function public.save_patrol_shift_template(
  p_template_id uuid,
  p_name        text,
  p_start_time  time,
  p_end_time    time,
  p_sort_order  integer,
  p_staff       jsonb,
  p_work_start  text,
  p_work_end    text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = '只有系統管理者可以維護巡檢班別範本';
  end if;

  if p_template_id is null then
    insert into public.patrol_shift_template (name, start_time, end_time, sort_order, assigned_user_ids)
    values (p_name, p_start_time, p_end_time, coalesce(p_sort_order, 0),
            public.patrol_staff_uuid_array(p_staff))
    returning template_id into v_id;
  else
    update public.patrol_shift_template
    set name = p_name, start_time = p_start_time, end_time = p_end_time,
        sort_order = coalesce(p_sort_order, sort_order),
        assigned_user_ids = public.patrol_staff_uuid_array(p_staff)
    where template_id = p_template_id
    returning template_id into v_id;

    if v_id is null then
      raise exception using errcode = '02000', message = '找不到這個班別範本';
    end if;
  end if;

  perform public.patrol_staff_config_apply(
    'template', null, p_name, p_staff, p_work_start, p_work_end);

  return v_id;
end;
$$;

revoke all on function public.patrol_staff_config_apply(text, text, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.save_patrol_shift(date, text, time, time, integer, jsonb, text, text) from public, anon;
revoke all on function public.save_patrol_shift_template(uuid, text, time, time, integer, jsonb, text, text) from public, anon;

grant execute on function public.save_patrol_shift(date, text, time, time, integer, jsonb, text, text) to authenticated;
grant execute on function public.save_patrol_shift_template(uuid, text, time, time, integer, jsonb, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
