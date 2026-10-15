-- 資安告警副本的保存期限（2026-10-15）。
--
-- 背景：資安告警的完整內容只存在 public.security_alerts（RLS 強制、僅管理員可讀，且有
-- 防刪除 trigger 保存為證據）。通知中心 public.notifications 只留給管理員的「提醒副本」。
-- 本檔只清除該提醒副本，不碰任何證據資料表：
--   security_alerts／security_alert_deliveries／security_session_blocks 維持 append-only。
--
-- 只增加函式與索引，不改寫既有資料，可重複套用。

begin;

-- 清除作業與管理員查詢都以 event 篩選；以部分索引避免掃描整張通知表。
create index if not exists idx_notifications_security_alert_created
  on public.notifications (created_at)
  where event = 'security_alert';

create or replace function public.purge_expired_security_notices(
  p_before timestamptz default now() - interval '90 days'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  removed bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception '只有系統排程可以執行資安通知保存政策';
  end if;
  -- 下限保護：誤傳過近的時間（例如 now()）不得清除近期通知。
  if p_before > now() - interval '7 days' then
    raise exception '資安通知至少保存 7 天';
  end if;
  delete from public.notifications
  where event = 'security_alert'
    and created_at < p_before;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_expired_security_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.purge_expired_security_notices(timestamptz) to service_role;

commit;
