import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { enqueueLocationPoints } from './storage';
import { flushLocationQueue } from './sync';
import { readActiveSession } from './storage';
import { monitorBlePresence } from './ble-monitor';
import type { QueuedLocationPoint } from './types';

export const LOCATION_TASK_NAME = 'beinong-vehicle-background-location';

TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error || !data) return;
  const session = await readActiveSession();
  if (!session) return;
  const locations = (data as { locations?: Location.LocationObject[] }).locations || [];
  const points: QueuedLocationPoint[] = locations.map(location => ({
    client_event_id: Crypto.randomUUID(),
    session_id: session.sessionId,
    vehicle_id: session.vehicleId,
    device_id: session.deviceId,
    recorded_by: session.driverId,
    recorded_at: new Date(location.timestamp).toISOString(),
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy_m: location.coords.accuracy,
    speed_kmh: location.coords.speed == null ? null : Math.max(0, location.coords.speed * 3.6),
    heading_deg: location.coords.heading == null || location.coords.heading < 0 ? null : location.coords.heading,
    altitude_m: location.coords.altitude,
    source: 'phone_gps',
    is_mocked: Boolean((location as Location.LocationObject & { mocked?: boolean }).mocked),
    metadata: { platform: Platform.OS },
  }));
  await enqueueLocationPoints(points);
  await flushLocationQueue().catch(() => undefined);
  await monitorBlePresence(session).catch(() => undefined);
});

export async function requestTrackingPermissions() {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') throw new Error('必須允許精確定位，才能開始公務車勤務。');
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') throw new Error('必須允許背景定位，才能在畫面關閉後持續回傳車況。');
}

export async function startBackgroundTracking() {
  await requestTrackingPermissions();
  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  if (alreadyStarted) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: 30_000,
    distanceInterval: 25,
    deferredUpdatesInterval: 60_000,
    deferredUpdatesDistance: 50,
    pausesUpdatesAutomatically: true,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: '北農公務車定位中',
      notificationBody: '勤務進行中，系統正在回傳車輛位置。',
      notificationColor: '#0284c7',
    },
  });
}

export async function stopBackgroundTracking() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  }
}
