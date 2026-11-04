// deno-lint-ignore no-import-prefix
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.110.7';
import {
  createEquipmentLineAlertWorkerHandler, type AlertClaim, type AlertPrepared, type AlertStore,
} from '../_shared/equipment-line-alert-worker.ts';
import { equipmentLineAccess } from '../_shared/equipment-line-query.ts';

function client() {
  const url = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !key) throw new Error('Worker unavailable');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function createStore(): AlertStore {
  const db = client();
  return {
    async loadToken() {
      const { data, error } = await db.from('system_settings')
        .select('value').eq('key', 'line_channel_token').maybeSingle();
      if (error) throw error;
      return typeof data?.value === 'string' && data.value ? data.value : null;
    },
    async claim(now) {
      const { data, error } = await db.rpc('claim_inspection_line_alerts', {
        p_limit: 20, p_lease_seconds: 90, p_now: now,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []).filter(row =>
        typeof row?.outbox_id === 'string' && typeof row?.lease_token === 'string');
    },
    async prepare(job: AlertClaim, now: Date): Promise<AlertPrepared> {
      const outbox = await db.from('inspection_line_alert_outbox')
        .select('outbox_id,event_id,equipment_id,user_id,message_text,state,attempts,first_attempt_at,lease_token,lease_until')
        .eq('outbox_id', job.outbox_id).eq('lease_token', job.lease_token).eq('state', 'leased').maybeSingle();
      if (outbox.error) throw outbox.error;
      const row = outbox.data;
      if (!row || !row.lease_until || !Number.isFinite(Date.parse(row.lease_until))
        || Date.parse(row.lease_until) <= now.getTime()) {
        return { outcome: 'lease_lost' };
      }
      const [subscription, binding, event] = await Promise.all([
        db.from('inspection_line_equipment_subscriptions').select('active')
          .eq('user_id', row.user_id).eq('equipment_id', row.equipment_id).maybeSingle(),
        db.from('inspection_line_bindings').select('state,line_user_id')
          .eq('user_id', row.user_id).maybeSingle(),
        db.from('equipment_monitor_events').select('equipment_id,severity,event_state,occurred_at')
          .eq('event_id', row.event_id).maybeSingle(),
      ]);
      for (const result of [subscription, binding, event]) if (result.error) throw result.error;
      const occurred = Date.parse(String(event.data?.occurred_at || ''));
      if (!subscription.data?.active || binding.data?.state !== 'linked'
        || !binding.data?.line_user_id || event.data?.equipment_id !== row.equipment_id
        || !['warning', 'critical'].includes(String(event.data?.severity))
        || !['open', 'acknowledged'].includes(String(event.data?.event_state))
        || !Number.isFinite(occurred) || now.getTime() - occurred > 24 * 3600_000
        || occurred - now.getTime() > 120_000) return { outcome: 'suppressed' };
      const access = await equipmentLineAccess(db, row.user_id);
      if (!access.assets || !access.monitoring) return { outcome: 'suppressed' };
      return {
        outcome: 'ready',
        line_user_id: binding.data.line_user_id,
        message_text: row.message_text,
        attempts: row.attempts,
        first_attempt_at: row.first_attempt_at,
      };
    },
    async finish(job, resolution, status, nextAttemptAt, now) {
      const { data, error } = await db.rpc('finish_inspection_line_alert', {
        p_outbox_id: job.outbox_id, p_lease_token: job.lease_token,
        p_resolution: resolution, p_http_status: status,
        p_next_attempt_at: nextAttemptAt, p_now: now.toISOString(),
      });
      if (error) throw error;
      return typeof data === 'string' ? data : 'lease_lost';
    },
  };
}

Deno.serve(createEquipmentLineAlertWorkerHandler({
  cronSecret: () => Deno.env.get('CRON_SECRET') || '',
  createStore,
}));
