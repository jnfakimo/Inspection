-- 班別範本一次套用到一段日期區間。
--
-- 在此之前範本只能「套用到當天」，而 patrol_shift_template 從來沒有「產生每日班表」
-- 的機制，排班人員得每天手動建一次——交接檔把這件事列為未處理項目已久。
--
-- 沿用 save_patrol_shift 的既有設計：security definer + 自行檢查 is_admin()（因為
-- system_settings 是 admin-only 且 force RLS），班別以 (shift_date, name) upsert，
-- 人員與通報時段透過 patrol_staff_config_apply 局部合併寫回設定，整段區間在同一個
-- 交易內完成，中途失敗不會留下半套班表。

begin;

create or replace function public.apply_patrol_shift_template_range(
  p_template_id uuid,
  p_from        date,
  p_to          date
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tpl   record;
  v_day   date;
  v_count integer := 0;
  v_staff jsonb;
  v_work  jsonb;
  v_op    uuid;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = '只有系統管理者可以維護巡檢排班';
  end if;
  if p_from is null or p_to is null then
    raise exception using errcode = '22023', message = '請指定套用的起訖日期';
  end if;
  if p_to < p_from then
    raise exception using errcode = '22023', message = '迄日不可早於起日';
  end if;
  -- patrol_shifts 受 trg_prevent_removal 保護、刪不掉，年份手滑就是永久的垃圾資料。
  if (p_to - p_from) > 365 then
    raise exception using errcode = '22023', message = '一次最多只能套用 366 天';
  end if;

  select * into v_tpl from public.patrol_shift_template where template_id = p_template_id;
  if not found then
    raise exception using errcode = '02000', message = '找不到這個班別範本';
  end if;
  if coalesce(v_tpl.status, 'active') = 'inactive' then
    raise exception using errcode = '22023', message = '這個班別範本已刪除，不能套用';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t.id)), '[]'::jsonb)
  into v_staff
  from unnest(coalesce(v_tpl.assigned_user_ids, '{}'::uuid[])) as t(id);

  -- 範本的通報時段存在 system_settings，不在 patrol_shift_template 上，逐日沿用同一組。
  select coalesce(
           nullif(btrim(coalesce(value, '')), '')::jsonb #> array['workTimes', 'templates', v_tpl.name],
           '{}'::jsonb)
  into v_work
  from public.system_settings
  where key = 'patrol_shift_staff';

  v_day := p_from;
  while v_day <= p_to loop
    insert into public.patrol_shifts (shift_date, name, start_time, end_time, sort_order, assigned_user_ids)
    values (v_day, v_tpl.name, v_tpl.start_time, v_tpl.end_time,
            coalesce(v_tpl.sort_order, 0), coalesce(v_tpl.assigned_user_ids, '{}'::uuid[]))
    on conflict (shift_date, name) do update
    set start_time        = excluded.start_time,
        end_time          = excluded.end_time,
        sort_order        = excluded.sort_order,
        assigned_user_ids = excluded.assigned_user_ids;

    perform public.patrol_staff_config_apply(
      'date', to_char(v_day, 'YYYY-MM-DD'), v_tpl.name, v_staff,
      nullif(coalesce(v_work->>'start', ''), ''), nullif(coalesce(v_work->>'end', ''), ''));

    v_count := v_count + 1;
    v_day := v_day + 1;
  end loop;

  select user_id into v_op from public.users where auth_id = auth.uid() and status = 'active';
  insert into public.audit_logs (table_name, record_id, action, changes, operator_id, source)
  values ('patrol_shifts', p_template_id::text, 'insert',
          jsonb_build_object('template', v_tpl.name, 'from', p_from, 'to', p_to, 'days', v_count),
          v_op, 'v2-patrol-range');

  return v_count;
end;
$$;

revoke all on function public.apply_patrol_shift_template_range(uuid, date, date) from public, anon;
grant execute on function public.apply_patrol_shift_template_range(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';

commit;
