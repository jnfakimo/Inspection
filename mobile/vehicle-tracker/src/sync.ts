import { supabase } from './supabase';
import { readLocationQueue, removeQueuedLocationPoints } from './storage';

const UPLOAD_BATCH_SIZE = 100;
let pendingUpload: Promise<number> | null = null;

async function uploadOwnedPoints() {
  let queue = await readLocationQueue();
  if (!queue.length) return 0;
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('請恢復網路並確認登入後再補傳；定位資料仍保留在手機。');
  const { data: user, error: userError } = await supabase.from('users')
    .select('user_id').eq('auth_id', auth.user.id).eq('status', 'active').single();
  if (userError || !user) throw new Error('無法確認補傳人員，定位資料仍保留在手機。');
  // Retain other drivers' encrypted points for their next authenticated upload.
  queue = queue.filter(point => point.recorded_by === user.user_id);
  if (!queue.length) return 0;
  const { data: sessions, error: sessionsError } = await supabase.from('vehicle_tracking_sessions')
    .select('session_id').eq('driver_id', user.user_id).eq('status', 'active');
  if (sessionsError || !sessions) throw new Error('無法確認勤務狀態，定位資料仍保留在手機。');
  // Legacy or administratively closed duties cannot pass ingestion RLS. Keep their points
  // for reconciliation, without blocking uploads belonging to another active duty.
  const activeIds = new Set(sessions.map(session => session.session_id));
  queue = queue.filter(point => activeIds.has(point.session_id));
  let uploaded = 0;
  while (queue.length) {
    const { data: current, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || current.session?.user.id !== auth.user.id)
      throw new Error('登入帳號已變更，未確認的定位資料仍保留在手機。');
    const batch = queue.slice(0, UPLOAD_BATCH_SIZE);
    const { error } = await supabase.from('vehicle_location_points').upsert(batch, {
      onConflict: 'client_event_id',
      ignoreDuplicates: true,
    });
    if (error) throw new Error('定位資料暫時無法上傳，已保留在手機中稍後補傳。');
    uploaded += batch.length;
    await removeQueuedLocationPoints(batch.map(point => point.client_event_id));
    queue = queue.slice(UPLOAD_BATCH_SIZE);
  }
  return uploaded;
}

export function flushLocationQueue() {
  if (!pendingUpload) {
    pendingUpload = uploadOwnedPoints().finally(() => { pendingUpload = null; });
  }
  return pendingUpload;
}
