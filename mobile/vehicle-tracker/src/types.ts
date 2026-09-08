export type ActiveTrackingSession = {
  sessionId: string;
  vehicleId: string;
  deviceId: string;
  driverId: string;
  serviceUuid: string | null;
  advertisedName: string | null;
  platformIdentifier: string | null;
};

export type BleMonitorState = {
  lastCheckedAt: number;
  presence: 'unknown' | 'present' | 'missing';
};

export type QueuedLocationPoint = {
  client_event_id: string;
  session_id: string;
  vehicle_id: string;
  device_id: string;
  recorded_by: string;
  recorded_at: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  speed_kmh: number | null;
  heading_deg: number | null;
  altitude_m: number | null;
  source: 'phone_gps';
  is_mocked: boolean;
  metadata: { platform: string };
};

export type Vehicle = {
  vehicle_id: string;
  plate_no: string;
  vehicle_name: string | null;
};

export type TrackingDevice = {
  device_id: string;
  vehicle_id: string | null;
  display_name: string;
  advertised_name: string | null;
  device_fingerprint: string;
  service_uuid: string | null;
  verification_status: string;
  platform_identifiers: Record<string, string> | null;
};

export type NearbyBleDevice = {
  id: string;
  name: string;
  rssi: number | null;
  serviceUuids: string[];
};
