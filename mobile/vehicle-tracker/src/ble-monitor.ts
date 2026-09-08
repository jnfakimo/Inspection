import { Platform } from 'react-native';
import { findRegisteredDevice } from './ble';
import { supabase } from './supabase';
import { readBleMonitorState, writeBleMonitorState } from './storage';
import type { ActiveTrackingSession, TrackingDevice } from './types';

const BLE_CHECK_INTERVAL_MS = 5 * 60_000;

export async function monitorBlePresence(session: ActiveTrackingSession) {
  const previous = await readBleMonitorState();
  const now = Date.now();
  if (now - previous.lastCheckedAt < BLE_CHECK_INTERVAL_MS) return;
  if (!session.platformIdentifier && !session.serviceUuid && !session.advertisedName) return;
  if (Platform.OS === 'ios' && !session.serviceUuid) return;

  const registered: TrackingDevice = {
    device_id: session.deviceId,
    vehicle_id: session.vehicleId,
    display_name: '勤務藍牙標籤',
    advertised_name: session.advertisedName,
    device_fingerprint: session.deviceId,
    service_uuid: session.serviceUuid,
    verification_status: 'verified',
    platform_identifiers: session.platformIdentifier ? { [Platform.OS]: session.platformIdentifier } : null,
  };
  const found = await findRegisteredDevice(registered);
  const presence = found ? 'present' : 'missing';
  if (previous.presence === 'unknown' || previous.presence === presence) {
    await writeBleMonitorState({ lastCheckedAt: now, presence });
    return;
  }

  const disconnected = presence === 'missing';
  const { error } = await supabase.from('vehicle_tracking_events').insert({
    vehicle_id: session.vehicleId,
    device_id: session.deviceId,
    session_id: session.sessionId,
    event_type: disconnected ? 'ble_disconnected' : 'ble_reconnected',
    severity: disconnected ? 'warning' : 'info',
    title: disconnected ? '車內藍牙標籤連線中斷' : '車內藍牙標籤已恢復',
    message: disconnected ? '勤務期間未掃描到指定藍牙標籤，請確認手機與標籤距離及電量。' : '已重新掃描到指定藍牙標籤。',
    occurred_at: new Date(now).toISOString(),
    details: { platform: Platform.OS },
  });
  if (error) throw new Error('藍牙連線事件暫時無法寫入，系統稍後會再次確認。');
  await writeBleMonitorState({ lastCheckedAt: now, presence });
}
