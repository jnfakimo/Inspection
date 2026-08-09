-- 修正大量讀取告警誤判：頁面預載入與背景查詢不應直接造成安全告警。
-- 歷史告警不刪除，只將未達新門檻的開啟告警標記為已處理，保留完整證據。

begin;

update public.security_alerts
set status = 'acknowledged',
    acknowledged_at = coalesce(acknowledged_at, now()),
    details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
      'auto_acknowledged_reason', '未同時達到使用者操作讀取 25 次及 8 個不同資源的新門檻',
      'auto_acknowledged_at', now()
    )
where alert_type = 'bulk_read'
  and status = 'open'
  and (
    coalesce((details->>'read_count')::integer, event_count, 0) < 25
    or coalesce((details->>'unique_resource_count')::integer, 0) < 8
  );

comment on table public.security_alerts is
  '永久安全告警：僅針對使用者操作後的大量或廣泛資料讀取、重複拒絕存取及可疑檔案路徑。';

commit;