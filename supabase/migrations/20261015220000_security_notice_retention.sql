-- 資安告警副本的保存期限（2026-10-15）。
--
-- 背景：資安告警的完整內容只存在 public.security_alerts（RLS 強制、僅管理員可讀，且有
-- 防刪除 trigger 保存為證據）。通知中心 public.notifications 只留給管理員的「提醒副本」。
--
-- 正式資料依規範只能追加、更新或停用，本檔因此不實體刪除任何列：
-- 超過保存期限的副本改為「清除內容」（改寫標題、清空本文），列本身保留。
-- security_alerts／security_alert_deliveries／security_session_blocks 維持 append-only，完全不碰。
--
-- 只增加函式與索引，不改寫既有資料，可重複套用。

begin;

-- 清除作業以 event 與時間篩選；以部分索引避免掃描整張通知表。
create index if not exists idx_notifications_security_alert_created
  on public.notifications (created_at)
  where event = 'security_alert';

create or replace function public.redact_expired_security_notices(
  p_before timestamptz default now() - interval '90 days'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  redacted bigint;
begin
  if auth.role() <> 'service_role' then
    raise exception '只有系統排程可以執行資安通知保存政策';
  end if;
  -- 下限保護：誤傳過近的時間（例如 now()）不得清除近期通知。
  if p_before > now() - interval '7 days' then
    raise exception '資安通知至少保存 7 天';
  end if;
  -- 已清除過的列（本文為空）不重複改寫，函式可重複執行。
  update public.notifications
  set title = '資安告警（已超過保存期限，內容已清除）',
      body = null
  where event = 'security_alert'
    and created_at < p_before
    and body is not null;
  get diagnostics redacted = row_count;
  return redacted;
end;
$$;

revoke all on function public.redact_expired_security_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.redact_expired_security_notices(timestamptz) to service_role;

commit;
