import { supabase } from './supabase';
import { readLocationQueue, removeQueuedLocationPoints } from './storage';

const UPLOAD_BATCH_SIZE = 100;

export async function flushLocationQueue() {
  let queue = await readLocationQueue();
  let uploaded = 0;
  while (queue.length) {
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
