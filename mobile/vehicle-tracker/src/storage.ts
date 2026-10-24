import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActiveTrackingSession, BleMonitorState, QueuedLocationPoint } from './types';
import { encryptedStorage } from './encrypted-storage';

const ACTIVE_SESSION_KEY = 'vehicle_tracking_active_session_v1';
const LOCATION_QUEUE_KEY = 'vehicle_tracking_location_queue_v1';
const BLE_MONITOR_KEY = 'vehicle_tracking_ble_monitor_v1';
const MAX_QUEUE_POINTS = 10_000;
const LOCATION_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
let queueOperation: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueOperation.then(operation, operation);
  queueOperation = result.catch(() => undefined);
  return result;
}

function retained(points: QueuedLocationPoint[]) {
  const cutoff = Date.now() - LOCATION_RETENTION_MS;
  return points.filter(point => {
    const recorded = Date.parse(point.recorded_at);
    return Number.isFinite(recorded) && recorded >= cutoff && recorded <= Date.now() + 60_000;
  }).slice(-MAX_QUEUE_POINTS);
}

async function readQueueUnlocked(): Promise<QueuedLocationPoint[]> {
  const raw = await encryptedStorage.getItem(LOCATION_QUEUE_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('位置佇列格式不正確');
  const current = parsed as QueuedLocationPoint[];
  const fresh = retained(current);
  if (fresh.length !== current.length) await encryptedStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(fresh));
  return fresh;
}

export async function readActiveSession() {
  const raw = await encryptedStorage.getItem(ACTIVE_SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as ActiveTrackingSession; } catch { return null; }
}

export async function writeActiveSession(session: ActiveTrackingSession | null) {
  if (!session) {
    await Promise.all([
      encryptedStorage.removeItem(ACTIVE_SESSION_KEY),
      AsyncStorage.removeItem(BLE_MONITOR_KEY),
    ]);
    return;
  }
  return encryptedStorage.setItem(ACTIVE_SESSION_KEY, JSON.stringify(session));
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
  return withQueueLock(readQueueUnlocked);
}

export async function enqueueLocationPoints(points: QueuedLocationPoint[]) {
  if (!points.length) return;
  await withQueueLock(async () => {
    const current = await readQueueUnlocked();
    await encryptedStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(retained([...current, ...points])));
  });
}

export async function removeQueuedLocationPoints(clientEventIds: string[]) {
  const removed = new Set(clientEventIds);
  return withQueueLock(async () => {
    const current = await readQueueUnlocked();
    const remaining = current.filter(point => !removed.has(point.client_event_id));
    await encryptedStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(remaining));
    return remaining.length;
  });
}
