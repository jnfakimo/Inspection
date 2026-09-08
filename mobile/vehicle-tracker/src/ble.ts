import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Device, type Subscription } from 'react-native-ble-plx';
import type { NearbyBleDevice, TrackingDevice } from './types';

let manager: BleManager | null = null;
let cancelScan: (() => void) | null = null;
const getManager = () => manager ||= new BleManager({
  restoreStateIdentifier: 'beinong-vehicle-ble-manager',
  restoreStateFunction: () => undefined,
});

async function requestAndroidBluetoothPermission() {
  if (Platform.OS !== 'android') return;
  const permissions = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  if (Number(Platform.Version) >= 31) permissions.push(
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  );
  const results = await PermissionsAndroid.requestMultiple(permissions);
  const denied = Object.values(results).some(value => value !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied) throw new Error('請在手機設定允許本程式使用藍牙及定位權限，才能掃描車內標籤。');
}

async function waitForBluetooth(ble: BleManager) {
  await new Promise<void>((resolve, reject) => {
    let subscription: Subscription | undefined;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      subscription?.remove();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => finish(new Error('藍牙啟動逾時，請確認手機藍牙與本程式權限。')), 8_000);
    subscription = ble.onStateChange(state => {
      if (state === State.PoweredOn) finish();
      else if (state === State.PoweredOff) finish(new Error('手機藍牙尚未開啟，請先開啟藍牙。'));
      else if (state === State.Unauthorized) finish(new Error('本程式未獲得藍牙權限，請至手機設定允許使用藍牙。'));
      else if (state === State.Unsupported) finish(new Error('此裝置不支援所需的低功耗藍牙功能。'));
      // Unknown/Resetting are temporary, especially during iOS cold start.
    }, true);
    if (settled) subscription.remove();
  });
}

function normalizeDevice(device: Device): NearbyBleDevice {
  return {
    id: device.id,
    name: device.name || device.localName || '未命名藍牙設備',
    rssi: device.rssi,
    serviceUuids: device.serviceUUIDs || [],
  };
}

/** Resolves only when scanning ends, and rejects on native errors or cancellation. */
export async function scanNearbyDevices(
  onUpdate: (devices: NearbyBleDevice[]) => void,
  serviceUuid?: string | null,
  timeoutMs = 10_000,
): Promise<NearbyBleDevice[]> {
  if (cancelScan) throw new Error('藍牙掃描正在進行，請等候本次掃描完成。');
  let cancelled = false;
  cancelScan = () => { cancelled = true; };
  try {
    await requestAndroidBluetoothPermission();
    const ble = getManager();
    await waitForBluetooth(ble);
    if (cancelled) throw new Error('藍牙掃描已取消。');
    return await new Promise<NearbyBleDevice[]>((resolve, reject) => {
      const found = new Map<string, NearbyBleDevice>();
      let finished = false;
      const sorted = () => [...found.values()].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        // Settle after cleanup, preventing an old scan from stopping a new scan.
        void ble.stopDeviceScan().then(() => {
          error ? reject(error) : resolve(sorted());
        }, () => reject(error || new Error('無法停止藍牙掃描，請重新開啟本程式。')));
      };
      const timer = setTimeout(() => finish(), timeoutMs);
      cancelScan = () => finish(new Error('藍牙掃描已取消。'));
      const failStart = () => finish(new Error('無法啟動藍牙掃描，請確認手機權限後重試。'));
      try {
        void ble.startDeviceScan(serviceUuid ? [serviceUuid] : null, { allowDuplicates: true }, (error, device) => {
          if (finished) return;
          if (error) {
            finish(new Error('藍牙掃描失敗，請確認本程式的藍牙與定位權限；Android 亦需開啟系統定位服務。'));
            return;
          }
          if (!device) return;
          found.set(device.id, normalizeDevice(device));
          onUpdate(sorted());
        }).catch(failStart);
      } catch {
        failStart();
      }
    });
  } finally {
    cancelScan = null;
  }
}

export async function findRegisteredDevice(registered: TrackingDevice, timeoutMs = 8_000) {
  if (Platform.OS === 'ios' && !registered.service_uuid) return null;
  const devices = await scanNearbyDevices(() => undefined, registered.service_uuid, timeoutMs);
  return devices.find(device => matchesRegisteredDevice(device, registered)) || null;
}

export function matchesRegisteredDevice(nearby: NearbyBleDevice, registered: TrackingDevice) {
  const platformId = registered.platform_identifiers?.[Platform.OS];
  // Name/service identify a model, not an individual tag. Another FT is not proof of binding.
  return Boolean(platformId && platformId === nearby.id);
}

export function stopBleManager() {
  cancelScan?.();
}
