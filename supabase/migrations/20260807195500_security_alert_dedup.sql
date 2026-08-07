-- 同一帳號、同一告警類型只保留一則未處理告警。
-- 既有重複告警不刪除，僅自動標記較舊項目為已處理並永久保留。

begin;

with ranked as (
  select alert_id,
         row_number() over (
           partition by alert_type, operator_id
           order by last_seen_at desc, detected_at desc, alert_id desc
         ) as item_rank
  from public.security_alerts
  where status = 'open' and operator_id is not null
)
update public.security_alerts a
set status = 'acknowledged',
    acknowledged_at = coalesce(a.acknowledged_at, now()),
    details = coalesce(a.details, '{}'::jsonb) || jsonb_build_object(
      'auto_deduplicated', true,
      'auto_deduplicated_at', now()
    )
from ranked r
where a.alert_id = r.alert_id and r.item_rank > 1;

create unique index if not exists ux_security_alerts_open_operator_type
  on public.security_alerts (alert_type, operator_id)
  where status = 'open' and operator_id is not null;

commit;
