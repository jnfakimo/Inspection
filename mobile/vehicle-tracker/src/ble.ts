import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, State, type Device } from 'react-native-ble-plx';
import type { NearbyBleDevice, TrackingDevice } from './types';

let manager: BleManager | null = null;
const getManager = () => manager ||= new BleManager({
  restoreStateIdentifier: 'beinong-vehicle-ble-manager',
  restoreStateFunction: () => undefined,
});

async function requestAndroidBluetoothPermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 31) return;
  const results = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
  ]);
  const denied = Object.values(results).some(value => value !== PermissionsAndroid.RESULTS.GRANTED);
  if (denied) throw new Error('必須允許藍牙權限，才能確認車內定位標籤。');
}

function normalizeDevice(device: Device): NearbyBleDevice {
  return {
    id: device.id,
    name: device.name || device.localName || '未命名藍牙設備',
    rssi: device.rssi,
    serviceUuids: device.serviceUUIDs || [],
  };
}

export async function scanNearbyDevices(onUpdate: (devices: NearbyBleDevice[]) => void, serviceUuid?: string | null) {
  await requestAndroidBluetoothPermission();
  const ble = getManager();
  const state = await ble.state();
  if (state !== State.PoweredOn) throw new Error('請先開啟手機藍牙後再掃描。');
  const found = new Map<string, NearbyBleDevice>();
  ble.startDeviceScan(serviceUuid ? [serviceUuid] : null, { allowDuplicates: false }, (error, device) => {
    if (error) { ble.stopDeviceScan(); return; }
    if (!device) return;
    found.set(device.id, normalizeDevice(device));
    onUpdate([...found.values()].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999)));
  });
  const timer = setTimeout(() => ble.stopDeviceScan(), 10_000);
  return () => { clearTimeout(timer); ble.stopDeviceScan(); };
}

export async function findRegisteredDevice(registered: TrackingDevice, timeoutMs = 8_000) {
  await requestAndroidBluetoothPermission();
  const ble = getManager();
  if (await ble.state() !== State.PoweredOn) return null;
  if (Platform.OS === 'ios' && !registered.service_uuid) return null;
  return new Promise<NearbyBleDevice | null>(resolve => {
    let finished = false;
    const finish = (device: NearbyBleDevice | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      ble.stopDeviceScan();
      resolve(device);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    ble.startDeviceScan(registered.service_uuid ? [registered.service_uuid] : null, { allowDuplicates: false }, (error, device) => {
      if (error) { finish(null); return; }
      if (!device) return;
      const nearby = normalizeDevice(device);
      if (matchesRegisteredDevice(nearby, registered)) finish(nearby);
    });
  });
}

export function matchesRegisteredDevice(nearby: NearbyBleDevice, registered: TrackingDevice) {
  const platformId = registered.platform_identifiers?.[Platform.OS];
  if (platformId && platformId === nearby.id) return true;
  if (!registered.service_uuid && !registered.advertised_name) return false;
  const registeredService = registered.service_uuid?.toLowerCase();
  const serviceMatches = !registeredService || nearby.serviceUuids.some(uuid => uuid.toLowerCase() === registeredService);
  const nameMatches = !registered.advertised_name || nearby.name === registered.advertised_name;
  return serviceMatches && nameMatches;
}

export function stopBleManager() {
  manager?.stopDeviceScan();
}
