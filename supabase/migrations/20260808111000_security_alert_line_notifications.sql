-- 資安告警 LINE 推播：預設開啟，並以原子方式保存每次推播結果。
begin;

insert into public.system_settings(key,value)
values ('line_notify_security_alerts','true')
on conflict (key) do nothing;

create or replace function public.record_security_alert_line_delivery(
  p_alert_id uuid,
  p_status text,
  p_http_status integer default null,
  p_response text default null
)
returns void
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if p_status not in ('sent','failed','disabled','not_configured') then
    raise exception '不支援的 LINE 推播狀態';
  end if;

  update public.security_alerts
  set details = coalesce(details,'{}'::jsonb) || jsonb_build_object(
    'line_notification', jsonb_build_object(
      'status', p_status,
      'attempted_at', now(),
      'sent_at', case when p_status='sent' then now() else null end,
      'http_status', p_http_status,
      'response', left(coalesce(p_response,''),500)
    )
  )
  where alert_id=p_alert_id;
end;
$$;

revoke all on function public.record_security_alert_line_delivery(uuid,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.record_security_alert_line_delivery(uuid,text,integer,text)
  to service_role;

comment on function public.record_security_alert_line_delivery(uuid,text,integer,text) is
  '由 audit-event Edge Function 保存資安 LINE 推播成功、失敗或未設定狀態。';

commit;
