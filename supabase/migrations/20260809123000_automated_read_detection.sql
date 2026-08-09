-- 修正大量讀取告警：只有確認的非互動高頻存取才可維持開啟及強制離線。
-- 舊版告警保留證據，但不讓缺少新判定依據的紀錄繼續造成誤導。

begin;

update public.security_alerts
set status = 'acknowledged',
    title = '歷史讀取告警（待核對）',
    message = '此筆歷史紀錄未具備非互動高頻讀取的完整判定依據，已標記為已處理；原始稽核證據仍完整保留。',
    acknowledged_at = coalesce(acknowledged_at, now()),
    details = coalesce(details, '{}'::jsonb) || jsonb_build_object(
      'auto_acknowledged_reason', '缺少非互動高頻存取判定依據，或未達 40 次及 8 個資源的新門檻',
      'auto_acknowledged_at', now()
    )
where alert_type = 'bulk_read'
  and status = 'open'
  and (
    coalesce(details->>'detection_basis', '') <> 'non_interactive_high_rate'
    or coalesce((details->>'automated_read_count')::integer, 0) < 40
    or coalesce((details->>'unique_resource_count')::integer, 0) < 8
  );

comment on table public.security_alerts is
  '安全告警僅在同一來源於五分鐘內出現至少 40 次明確 page_load 非互動讀取，且涉及至少 8 個資源時升級；正常使用者操作不強制離線。';

commit;
