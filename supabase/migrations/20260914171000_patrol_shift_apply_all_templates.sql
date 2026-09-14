-- 將所有啟用中的巡檢班別範本一次套用到指定期間。
-- 內部沿用既有單範本交易函式，因此人員、通報時段、夜班跨日與稽核規則保持一致；
-- 外層函式讓所有範本同成同敗，避免只重建半套班表。

begin;

create or replace function public.apply_all_patrol_shift_templates_range(
  p_from date,
  p_to date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_template record;
  v_template_count integer := 0;
  v_rows integer := 0;
  v_days integer;
  v_operator uuid;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = '只有系統管理者可以套用巡檢班別範本';
  end if;
  if p_from is null or p_to is null then
    raise exception using errcode = '22023', message = '請指定套用的起訖日期';
  end if;
  if p_from < (current_timestamp at time zone 'Asia/Taipei')::date then
    raise exception using errcode = '22023', message = '只能從今天或未來日期套用，過去班表必須保留';
  end if;
  if p_to < p_from then
    raise exception using errcode = '22023', message = '迄日不可早於起日';
  end if;
  if (p_to - p_from) > 365 then
    raise exception using errcode = '22023', message = '一次最多只能套用 366 天';
  end if;

  v_days := p_to - p_from + 1;
  for v_template in
    select template_id
    from public.patrol_shift_template
    where coalesce(status, 'active') <> 'inactive'
    order by sort_order, template_id
  loop
    v_rows := v_rows + public.apply_patrol_shift_template_range(v_template.template_id, p_from, p_to);
    v_template_count := v_template_count + 1;
  end loop;
  if v_template_count = 0 then
    raise exception using errcode = '22023', message = '目前沒有啟用中的班別範本';
  end if;

  select user_id into v_operator
  from public.users
  where auth_id = auth.uid() and status = 'active';
  insert into public.audit_logs(table_name, record_id, action, changes, operator_id, source)
  values (
    'patrol_shifts', to_char(p_from, 'YYYY-MM-DD') || '..' || to_char(p_to, 'YYYY-MM-DD'), 'insert',
    jsonb_build_object('operation', 'apply_all_templates', 'from', p_from, 'to', p_to,
      'templates', v_template_count, 'days', v_days, 'rows', v_rows),
    v_operator, 'v2-patrol-apply-all'
  );

  return jsonb_build_object('templates', v_template_count, 'days', v_days, 'rows', v_rows);
end;
$$;

revoke all on function public.apply_all_patrol_shift_templates_range(date, date) from public, anon;
grant execute on function public.apply_all_patrol_shift_templates_range(date, date) to authenticated;

comment on function public.apply_all_patrol_shift_templates_range(date, date) is
  '交易式將全部啟用巡檢班別範本套用到日期區間，最多 366 天。';

notify pgrst, 'reload schema';

commit;
