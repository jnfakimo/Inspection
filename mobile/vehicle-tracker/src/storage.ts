import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActiveTrackingSession, BleMonitorState, QueuedLocationPoint } from './types';

const ACTIVE_SESSION_KEY = 'vehicle_tracking_active_session_v1';
const LOCATION_QUEUE_KEY = 'vehicle_tracking_location_queue_v1';
const BLE_MONITOR_KEY = 'vehicle_tracking_ble_monitor_v1';
const MAX_QUEUE_POINTS = 10_000;

export async function readActiveSession() {
  const raw = await AsyncStorage.getItem(ACTIVE_SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as ActiveTrackingSession; } catch { return null; }
}

export async function writeActiveSession(session: ActiveTrackingSession | null) {
  if (!session) {
    await Promise.all([
      AsyncStorage.removeItem(ACTIVE_SESSION_KEY),
      AsyncStorage.removeItem(BLE_MONITOR_KEY),
    ]);
    return;
  }
  return AsyncStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
}

export async function readBleMonitorState(): Promise<BleMonitorState> {
  const raw = await AsyncStorage.getItem(BLE_MONITOR_KEY);
  if (!raw) return { lastCheckedAt: 0, presence: 'unknown' };
  try { return JSON.parse(raw) as BleMonitorState; }
  catch { return { lastCheckedAt: 0, presence: 'unknown' }; }
}

export async function writeBleMonitorState(state: BleMonitorState) {
  await AsyncStorage.setItem(BLE_MONITOR_KEY, JSON.stringify(state));
}

export async function readLocationQueue() {
  const raw = await AsyncStorage.getItem(LOCATION_QUEUE_KEY);
  if (!raw) return [] as QueuedLocationPoint[];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as QueuedLocationPoint[] : [];
  } catch { return [] as QueuedLocationPoint[]; }
}

export async function enqueueLocationPoints(points: QueuedLocationPoint[]) {
  if (!points.length) return;
  const current = await readLocationQueue();
  const merged = [...current, ...points].slice(-MAX_QUEUE_POINTS);
  await AsyncStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(merged));
}

export async function removeQueuedLocationPoints(clientEventIds: string[]) {
  const removed = new Set(clientEventIds);
  const current = await readLocationQueue();
  const remaining = current.filter(point => !removed.has(point.client_event_id));
  await AsyncStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(remaining));
  return remaining.length;
}
