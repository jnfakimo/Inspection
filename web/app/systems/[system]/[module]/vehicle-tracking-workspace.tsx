'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@/app/admin-workspace.css';
import './vehicle-tracking.css';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { AdminHeader, AdminModal, errorMessage, fmtTime, type Row } from '@/components/admin/shared';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { getSupabase } from '@/lib/supabase';
import { useFleetRole } from '@/lib/fleet-role';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };
type Vehicle = { vehicle_id: string; plate_no: string; vehicle_name?: string | null; status: string };
type Device = {
  device_id: string;
  vehicle_id?: string | null;
  display_name: string;
  advertised_name?: string | null;
  device_fingerprint: string;
  service_uuid?: string | null;
  characteristic_uuid?: string | null;
  verification_status: string;
  status: string;
  battery_level?: number | null;
  last_seen_at?: string | null;
  last_latitude?: number | null;
  last_longitude?: number | null;
  last_accuracy_m?: number | null;
  last_speed_kmh?: number | null;
  last_heading_deg?: number | null;
  last_recorded_at?: string | null;
  note?: string | null;
  official_vehicles?: Vehicle | Vehicle[] | null;
};
type Point = {
  point_id: number;
  vehicle_id: string;
  device_id: string;
  recorded_at: string;
  latitude: number;
  longitude: number;
  accuracy_m?: number | null;
  speed_kmh?: number | null;
  heading_deg?: number | null;
  source: string;
};
type Geofence = {
  geofence_id: string;
  name: string;
  shape_type: string;
  center_latitude?: number | null;
  center_longitude?: number | null;
  radius_m?: number | null;
  notify_on_enter: boolean;
  notify_on_exit: boolean;
  status: string;
};
type TrackingEvent = {
  event_id: string;
  vehicle_id?: string | null;
  event_type: string;
  severity: string;
  title: string;
  message?: string | null;
  occurred_at: string;
  acknowledged_at?: string | null;
};

type MapLibreMap = {
  on: (event: string, callback: () => void) => void;
  addControl: (control: unknown, position?: string) => void;
  addSource: (id: string, source: unknown) => void;
  addLayer: (layer: unknown) => void;
  fitBounds: (bounds: [[number, number], [number, number]], options?: Record<string, unknown>) => void;
  remove: () => void;
};
type MapLibreApi = {
  Map: new (options: Record<string, unknown>) => MapLibreMap;
  NavigationControl: new (options?: Record<string, unknown>) => unknown;
};

declare global {
  interface Window { maplibregl?: MapLibreApi }
}

const MAPLIBRE_SCRIPT = '/Inspection/v2/vendor/maplibre/maplibre-gl.js';
const MAPLIBRE_STYLE = '/Inspection/v2/vendor/maplibre/maplibre-gl.css';
const DEFAULT_MAP_STYLE = process.env.NEXT_PUBLIC_VEHICLE_TRACKING_MAP_STYLE_URL || 'https://tiles.openfreemap.org/styles/liberty';
let mapLibrePromise: Promise<MapLibreApi> | null = null;

function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mapLibrePromise) return mapLibrePromise;
  mapLibrePromise = new Promise<MapLibreApi>((resolve, reject) => {
    if (!document.querySelector(`link[href="${MAPLIBRE_STYLE}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = MAPLIBRE_STYLE;
      document.head.appendChild(link);
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${MAPLIBRE_SCRIPT}"]`);
    const script = existing || document.createElement('script');
    const ready = () => window.maplibregl ? resolve(window.maplibregl) : reject(new Error('開源地圖元件載入失敗'));
    script.addEventListener('load', ready, { once: true });
    script.addEventListener('error', () => reject(new Error('開源地圖元件載入失敗')), { once: true });
    if (!existing) {
      script.src = MAPLIBRE_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return mapLibrePromise;
}

const DEVICE_STATUS: Record<string, string> = { active: '啟用', inactive: '停用', retired: '已汰換' };
const VERIFY_STATUS: Record<string, string> = { untested: '尚未測試', scanning: '測試中', verified: '已驗證', incompatible: '不相容' };
const EVENT_TYPE: Record<string, string> = {
  geofence_enter: '進入圍籬', geofence_exit: '離開圍籬', location_stale: '定位逾時',
  ble_disconnected: '藍牙中斷', ble_reconnected: '藍牙恢復', session_started: '勤務開始',
  session_ended: '勤務結束', battery_low: '電量偏低',
};
const SEVERITY: Record<string, string> = { info: '一般', warning: '注意', critical: '嚴重' };
const PERIODS = [
  ['latest', '最新資料'], ['1', '最近1小時'], ['2', '最近2小時'], ['4', '最近4小時'],
  ['6', '最近6小時'], ['24', '最近1天'], ['custom', '自訂'],
] as const;

function relatedVehicle(value: Device['official_vehicles']) {
  return Array.isArray(value) ? value[0] : value;
}

function taipeiToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
}

function trackingRange(period: (typeof PERIODS)[number][0], fromDate: string, toDate: string) {
  if (period === 'custom') {
    return {
      from: new Date(`${fromDate}T00:00:00+08:00`).toISOString(),
      to: new Date(`${toDate}T23:59:59+08:00`).toISOString(),
    };
  }
  const hours = period === 'latest' ? 24 : Number(period);
  return { from: new Date(Date.now() - hours * 60 * 60_000).toISOString(), to: new Date().toISOString() };
}

function connectionState(device: Device) {
  if (!device.last_recorded_at) return { key: 'none', label: '尚無定位', age: Infinity };
  const age = Math.max(0, Date.now() - new Date(device.last_recorded_at).getTime());
  if (age <= 3 * 60_000) return { key: 'online', label: '在線', age };
  if (age <= 15 * 60_000) return { key: 'stale', label: '未更新', age };
  return { key: 'offline', label: '離線', age };
}

function boundsFor(points: Point[]): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  let minLng = points[0].longitude, maxLng = minLng, minLat = points[0].latitude, maxLat = minLat;
  points.forEach(point => {
    minLng = Math.min(minLng, point.longitude); maxLng = Math.max(maxLng, point.longitude);
    minLat = Math.min(minLat, point.latitude); maxLat = Math.max(maxLat, point.latitude);
  });
  if (minLng === maxLng) { minLng -= 0.005; maxLng += 0.005; }
  if (minLat === maxLat) { minLat -= 0.005; maxLat += 0.005; }
  return [[minLng, minLat], [maxLng, maxLat]];
}

function distanceKm(a: Point, b: Point) {
  const toRadians = (value: number) => value * Math.PI / 180;
  const lat = toRadians(b.latitude - a.latitude);
  const lng = toRadians(b.longitude - a.longitude);
  const start = toRadians(a.latitude);
  const end = toRadians(b.latitude);
  const h = Math.sin(lat / 2) ** 2 + Math.cos(start) * Math.cos(end) * Math.sin(lng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function routeSummary(points: Point[]) {
  const ordered = points.slice().sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
  let distance = 0, gaps = 0, stops = 0, stoppedBlock = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1], current = ordered[index];
    const minutes = Math.max(0, (new Date(current.recorded_at).getTime() - new Date(previous.recorded_at).getTime()) / 60_000);
    if (minutes > 5) gaps += 1;
    if (minutes <= 60) distance += distanceKm(previous, current);
    if (minutes <= 60 && Number(previous.speed_kmh || 0) < 3 && Number(current.speed_kmh || 0) < 3) stoppedBlock += minutes;
    else {
      if (stoppedBlock >= 5) stops += 1;
      stoppedBlock = 0;
    }
  }
  if (stoppedBlock >= 5) stops += 1;
  return { distance, gaps, stops };
}

function circlePolygon(fence: Geofence) {
  const latitude = Number(fence.center_latitude), longitude = Number(fence.center_longitude), radius = Number(fence.radius_m);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radius)) return [];
  const coordinates: number[][] = [];
  const latitudeRadius = radius / 111320;
  const longitudeRadius = radius / (111320 * Math.max(0.01, Math.cos(latitude * Math.PI / 180)));
  for (let index = 0; index <= 64; index += 1) {
    const angle = index / 64 * Math.PI * 2;
    coordinates.push([longitude + Math.cos(angle) * longitudeRadius, latitude + Math.sin(angle) * latitudeRadius]);
  }
  return coordinates;
}

function TrackingMap({ points, devices, geofences, routeVehicleId, noteMapError }: {
  points: Point[];
  devices: Device[];
  geofences: Geofence[];
  routeVehicleId: string;
  noteMapError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!container.current) return;
    let active = true;
    let map: MapLibreMap | null = null;
    loadMapLibre().then(api => {
      if (!active || !container.current) return;
      map = new api.Map({ container: container.current, style: DEFAULT_MAP_STYLE, center: [121.516, 25.045], zoom: 10.2, attributionControl: true });
      map.addControl(new api.NavigationControl({ visualizePitch: true }), 'top-right');
      map.on('load', () => {
        if (!map || !active) return;
        const deviceByVehicle = new Map(devices.filter(item => item.vehicle_id).map(item => [String(item.vehicle_id), item]));
        const latest = new Map<string, Point>();
        points.forEach(point => { if (!latest.has(point.vehicle_id)) latest.set(point.vehicle_id, point); });
        const vehiclesGeoJson = {
          type: 'FeatureCollection',
          features: [...latest.values()].map(point => {
            const device = deviceByVehicle.get(point.vehicle_id);
            const vehicle = relatedVehicle(device?.official_vehicles);
            return { type: 'Feature', geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] }, properties: { vehicle_id: point.vehicle_id, plate_no: vehicle?.plate_no || device?.display_name || '未命名車輛' } };
          }),
        };
        map.addSource('tracking-vehicles', { type: 'geojson', data: vehiclesGeoJson, cluster: true, clusterMaxZoom: 14, clusterRadius: 46 });
        map.addLayer({ id: 'tracking-clusters', type: 'circle', source: 'tracking-vehicles', filter: ['has', 'point_count'], paint: { 'circle-color': '#0284c7', 'circle-radius': ['step', ['get', 'point_count'], 20, 10, 27], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
        map.addLayer({ id: 'tracking-cluster-count', type: 'symbol', source: 'tracking-vehicles', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13 }, paint: { 'text-color': '#ffffff' } });
        map.addLayer({ id: 'tracking-vehicles', type: 'circle', source: 'tracking-vehicles', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': '#00a879', 'circle-radius': 9, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
        map.addLayer({ id: 'tracking-vehicle-labels', type: 'symbol', source: 'tracking-vehicles', filter: ['!', ['has', 'point_count']], layout: { 'text-field': ['get', 'plate_no'], 'text-offset': [0, 1.3], 'text-size': 12, 'text-allow-overlap': false }, paint: { 'text-color': '#10233f', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
        const fenceFeatures = geofences.filter(fence => fence.status === 'active' && fence.shape_type === 'circle').map(fence => ({
          type: 'Feature',
          properties: { name: fence.name },
          geometry: { type: 'Polygon', coordinates: [circlePolygon(fence)] },
        })).filter(feature => feature.geometry.coordinates[0].length);
        if (fenceFeatures.length) {
          map.addSource('tracking-geofences', { type: 'geojson', data: { type: 'FeatureCollection', features: fenceFeatures } });
          map.addLayer({ id: 'tracking-geofence-fill', type: 'fill', source: 'tracking-geofences', paint: { 'fill-color': '#0284c7', 'fill-opacity': 0.09 } });
          map.addLayer({ id: 'tracking-geofence-line', type: 'line', source: 'tracking-geofences', paint: { 'line-color': '#0284c7', 'line-width': 2, 'line-dasharray': [3, 2] } });
          map.addLayer({ id: 'tracking-geofence-label', type: 'symbol', source: 'tracking-geofences', layout: { 'text-field': ['get', 'name'], 'text-size': 11 }, paint: { 'text-color': '#0369a1', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
        }
        const route = routeVehicleId ? points.filter(point => point.vehicle_id === routeVehicleId).slice().reverse() : [];
        if (route.length > 1) {
          map.addSource('tracking-route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.map(point => [point.longitude, point.latitude]) } } });
          map.addLayer({ id: 'tracking-route', type: 'line', source: 'tracking-route', paint: { 'line-color': '#7c3aed', 'line-width': 5, 'line-opacity': 0.78 } });
        }
        const bounds = boundsFor(route.length ? route : [...latest.values()]);
        if (bounds) map.fitBounds(bounds, { padding: 70, maxZoom: 15, duration: 0 });
      });
    }).catch(error => noteMapError(error instanceof Error ? error.message : '地圖載入失敗'));
    return () => { active = false; map?.remove(); };
  }, [devices, geofences, noteMapError, points, routeVehicleId]);

  return <div ref={container} className="vehicle-tracking-map" aria-label="公務車定位地圖" />;
}

function TrackingDataShell({ system, module, profile }: Props) {
  const { canManageFleet } = useFleetRole(profile);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [points, setPoints] = useState<Point[]>([]);
  const [geofences, setGeofences] = useState<Geofence[]>([]);
  const [events, setEvents] = useState<TrackingEvent[]>([]);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>(module.key === 'history' ? '24' : 'latest');
  const [fromDate, setFromDate] = useState(taipeiToday());
  const [toDate, setToDate] = useState(taipeiToday());
  const [deviceEditor, setDeviceEditor] = useState<Partial<Device> | null>(null);
  const [geofenceEditor, setGeofenceEditor] = useState<Partial<Geofence> | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const [vehicleResult, deviceResult, pointResult, fenceResult, eventResult] = await Promise.all([
      client.from('official_vehicles').select('vehicle_id,plate_no,vehicle_name,status').order('plate_no'),
      client.from('vehicle_tracking_devices').select('*,official_vehicles(vehicle_id,plate_no,vehicle_name,status)').order('display_name'),
      client.from('vehicle_location_points').select('point_id,vehicle_id,device_id,recorded_at,latitude,longitude,accuracy_m,speed_kmh,heading_deg,source').gte('recorded_at', since).order('recorded_at', { ascending: false }).limit(5000),
      client.from('vehicle_geofences').select('*').order('name'),
      client.from('vehicle_tracking_events').select('*').order('occurred_at', { ascending: false }).limit(500),
    ]);
    const firstError = vehicleResult.error || deviceResult.error || pointResult.error || fenceResult.error || eventResult.error;
    if (firstError) setNote(`定位系統資料載入失敗：${errorMessage(firstError, '請確認定位資料庫已完成設定')}`);
    setVehicles((vehicleResult.data || []) as Vehicle[]);
    setDevices((deviceResult.data || []) as unknown as Device[]);
    setPoints((pointResult.data || []) as Point[]);
    setGeofences((fenceResult.data || []) as Geofence[]);
    setEvents((eventResult.data || []) as TrackingEvent[]);
    setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (module.key !== 'history' || selectedVehicle || !vehicles.length) return;
    setSelectedVehicle(vehicles[0].vehicle_id);
  }, [module.key, selectedVehicle, vehicles]);

  useEffect(() => {
    if (module.key !== 'live' && module.key !== 'alerts') return;
    const client = getSupabase();
    const channel = client.channel(`vehicle-tracking-${module.key}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vehicle_location_points' }, payload => {
        const point = payload.new as Point;
        setPoints(previous => [point, ...previous.filter(item => item.point_id !== point.point_id)].slice(0, 5000));
        setDevices(previous => previous.map(device => device.device_id === point.device_id ? {
          ...device,
          last_seen_at: point.recorded_at,
          last_recorded_at: point.recorded_at,
          last_latitude: point.latitude,
          last_longitude: point.longitude,
          last_accuracy_m: point.accuracy_m,
          last_speed_kmh: point.speed_kmh,
          last_heading_deg: point.heading_deg,
        } : device));
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vehicle_tracking_events' }, payload => {
        const item = payload.new as TrackingEvent;
        setEvents(previous => [item, ...previous.filter(event => event.event_id !== item.event_id)].slice(0, 500));
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [module.key]);

  useEffect(() => {
    if (module.key !== 'history' || !selectedVehicle || period === 'latest') return;
    if (period === 'custom' && (!fromDate || !toDate || fromDate > toDate)) {
      setNote('自訂日期的開始日期不可晚於結束日期');
      return;
    }
    let active = true;
    const range = trackingRange(period, fromDate, toDate);
    setBusy(true);
    setNote('');
    void getSupabase().from('vehicle_location_points')
      .select('point_id,vehicle_id,device_id,recorded_at,latitude,longitude,accuracy_m,speed_kmh,heading_deg,source')
      .eq('vehicle_id', selectedVehicle)
      .gte('recorded_at', range.from)
      .lte('recorded_at', range.to)
      .order('recorded_at', { ascending: false })
      .limit(10000)
      .then(result => {
        if (!active) return;
        if (result.error) setNote(`歷史軌跡載入失敗：${errorMessage(result.error)}`);
        else {
          const rows = (result.data || []) as Point[];
          setPoints(rows);
          if (rows.length === 10000) setNote('本次軌跡已達一萬筆顯示上限，請縮小日期區間以查看完整資料');
        }
        setBusy(false);
      });
    return () => { active = false; };
  }, [fromDate, module.key, period, selectedVehicle, toDate]);

  const periodPoints = useMemo(() => {
    let cutoff = 0;
    if (period !== 'latest' && period !== 'custom') cutoff = Date.now() - Number(period) * 60 * 60_000;
    const customStart = new Date(`${fromDate}T00:00:00+08:00`).getTime();
    const customEnd = new Date(`${toDate}T23:59:59+08:00`).getTime();
    const filtered = points.filter(point => {
      if (selectedVehicle && point.vehicle_id !== selectedVehicle) return false;
      const time = new Date(point.recorded_at).getTime();
      if (period === 'custom') return time >= customStart && time <= customEnd;
      if (cutoff) return time >= cutoff;
      return true;
    });
    if (period !== 'latest') return filtered;
    const latest = new Map<string, Point>();
    filtered.forEach(point => { if (!latest.has(point.vehicle_id)) latest.set(point.vehicle_id, point); });
    return [...latest.values()];
  }, [fromDate, period, points, selectedVehicle, toDate]);

  const vehicleById = useMemo(() => new Map(vehicles.map(vehicle => [vehicle.vehicle_id, vehicle])), [vehicles]);
  const routeStats = useMemo(() => routeSummary(periodPoints), [periodPoints]);
  const onlineCount = devices.filter(device => connectionState(device).key === 'online').length;
  const staleCount = devices.filter(device => ['stale', 'offline'].includes(connectionState(device).key)).length;

  const saveDevice = async () => {
    if (!deviceEditor) return;
    const displayName = String(deviceEditor.display_name || '').trim();
    const fingerprint = String(deviceEditor.device_fingerprint || '').trim();
    if (!displayName || !fingerprint) { setNote('請填寫設備名稱與設備識別碼'); return; }
    setBusy(true); setNote('');
    const payload = {
      vehicle_id: deviceEditor.vehicle_id || null,
      display_name: displayName,
      advertised_name: String(deviceEditor.advertised_name || '').trim() || null,
      device_fingerprint: fingerprint,
      service_uuid: String(deviceEditor.service_uuid || '').trim() || null,
      characteristic_uuid: String(deviceEditor.characteristic_uuid || '').trim() || null,
      verification_status: deviceEditor.verification_status || 'untested',
      status: deviceEditor.status || 'active',
      note: String(deviceEditor.note || '').trim() || null,
      created_by: deviceEditor.device_id ? undefined : profile.user_id,
    };
    const client = getSupabase();
    const result = deviceEditor.device_id
      ? await client.from('vehicle_tracking_devices').update(payload).eq('device_id', deviceEditor.device_id)
      : await client.from('vehicle_tracking_devices').insert(payload);
    if (result.error) { setNote(`設備儲存失敗：${errorMessage(result.error)}`); setBusy(false); return; }
    setDeviceEditor(null); await load(); setNote('藍牙設備資料已儲存');
  };

  const saveGeofence = async () => {
    if (!geofenceEditor) return;
    const name = String(geofenceEditor.name || '').trim();
    const latitude = Number(geofenceEditor.center_latitude);
    const longitude = Number(geofenceEditor.center_longitude);
    const radius = Number(geofenceEditor.radius_m);
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radius) || radius < 10) {
      setNote('請填寫圍籬名稱、正確座標及至少10公尺的半徑'); return;
    }
    setBusy(true); setNote('');
    const payload = { name, shape_type: 'circle', center_latitude: latitude, center_longitude: longitude, radius_m: radius, notify_on_enter: geofenceEditor.notify_on_enter !== false, notify_on_exit: geofenceEditor.notify_on_exit !== false, status: geofenceEditor.status || 'active', created_by: geofenceEditor.geofence_id ? undefined : profile.user_id };
    const client = getSupabase();
    const result = geofenceEditor.geofence_id
      ? await client.from('vehicle_geofences').update(payload).eq('geofence_id', geofenceEditor.geofence_id)
      : await client.from('vehicle_geofences').insert(payload);
    if (result.error) { setNote(`電子圍籬儲存失敗：${errorMessage(result.error)}`); setBusy(false); return; }
    setGeofenceEditor(null); await load(); setNote('電子圍籬已儲存');
  };

  const acknowledge = async (eventId: string) => {
    const { error } = await getSupabase().from('vehicle_tracking_events').update({ acknowledged_at: new Date().toISOString(), acknowledged_by: profile.user_id }).eq('event_id', eventId);
    if (error) { setNote(`告警確認失敗：${errorMessage(error)}`); return; }
    await load(); setNote('告警已確認');
  };

  const mapError = useCallback((message: string) => setNote(message), []);

  const filters = <section className="tracking-filter panel">
    <label>公務車輛
      <select value={selectedVehicle} onChange={event => setSelectedVehicle(event.target.value)}>
        <option value="">{module.key === 'history' ? '請選擇車輛' : '全部車輛'}</option>
        {vehicles.map(vehicle => <option key={vehicle.vehicle_id} value={vehicle.vehicle_id}>{vehicle.plate_no}{vehicle.vehicle_name ? `｜${vehicle.vehicle_name}` : ''}</option>)}
      </select>
    </label>
    <div className="tracking-periods" aria-label="定位資料時間篩選">
      {PERIODS.map(([value, label]) => <button key={value} type="button" className={period === value ? 'is-active' : ''} onClick={() => setPeriod(value)}>{label}</button>)}
    </div>
    {period === 'custom' && <div className="tracking-date-range">
      <label>開始日期<LocalizedDateInput aria-label="開始日期" value={fromDate} onChange={event => setFromDate(event.target.value)} /></label>
      <span>至</span>
      <label>結束日期<LocalizedDateInput aria-label="結束日期" value={toDate} onChange={event => setToDate(event.target.value)} /></label>
    </div>}
  </section>;

  return <AppShell profile={profile} title={module.title}>
    <div className="vehicle-tracking-page">
      <AdminHeader module={module} busy={busy} note={note} onReload={load}
        action={module.key === 'devices' && canManageFleet ? <button className="primary-btn compact" onClick={() => setDeviceEditor({ verification_status: 'untested', status: 'active' })}>＋ 新增藍牙設備</button>
          : module.key === 'geofences' && canManageFleet ? <button className="primary-btn compact" onClick={() => setGeofenceEditor({ radius_m: 300, notify_on_enter: true, notify_on_exit: true, status: 'active' })}>＋ 新增電子圍籬</button> : undefined} />

      {(module.key === 'live' || module.key === 'history') && <>
        {filters}
        {module.key === 'live' ? <section className="tracking-metrics">
          <article><span>已綁定設備</span><strong>{devices.filter(device => device.status === 'active').length}</strong></article>
          <article><span>目前在線</span><strong>{onlineCount}</strong></article>
          <article><span>未更新／離線</span><strong>{staleCount}</strong></article>
          <article><span>篩選定位點</span><strong>{periodPoints.length.toLocaleString('zh-TW')}</strong></article>
        </section> : <section className="tracking-metrics">
          <article><span>軌跡定位點</span><strong>{periodPoints.length.toLocaleString('zh-TW')}</strong></article>
          <article><span>推估里程</span><strong>{routeStats.distance.toFixed(1)} <small>公里</small></strong></article>
          <article><span>停留次數</span><strong>{routeStats.stops}</strong></article>
          <article><span>超過5分鐘缺口</span><strong>{routeStats.gaps}</strong></article>
        </section>}
        <section className="tracking-map-layout panel">
          <TrackingMap points={periodPoints} devices={devices} geofences={geofences} routeVehicleId={module.key === 'history' ? selectedVehicle : ''} noteMapError={mapError} />
          <aside className="tracking-vehicle-list">
            <h2>{module.key === 'live' ? '車輛即時狀態' : '軌跡分析車輛'}</h2>
            {devices.map(device => {
              const vehicle = relatedVehicle(device.official_vehicles) || (device.vehicle_id ? vehicleById.get(device.vehicle_id) : undefined);
              const state = connectionState(device);
              return <button key={device.device_id} type="button" className={selectedVehicle === device.vehicle_id ? 'is-selected' : ''} onClick={() => setSelectedVehicle(String(device.vehicle_id || ''))}>
                <span className={`tracking-dot ${state.key}`} />
                <span><b>{vehicle?.plate_no || device.display_name}</b><small>{state.label}｜{device.last_recorded_at ? fmtTime(device.last_recorded_at) : '尚無定位資料'}</small></span>
                <em>{device.last_speed_kmh == null ? '—' : `${Number(device.last_speed_kmh).toFixed(0)} km/h`}</em>
              </button>;
            })}
            {!devices.length && <p className="empty">尚未綁定藍牙設備</p>}
          </aside>
        </section>
      </>}

      {module.key === 'devices' && <section className="panel tracking-table-panel">
        <h2>手機藍牙綁定說明</h2>
        <p>本頁是設備管理後台，不會掃描手機藍牙。iPhone 請使用已安裝的「北農公務車定位」原生 App；Safari 網頁無法代替原生 App 掃描。FindTag 的掃描結果不會自動匯入本系統。</p>
        <ol>
          <li>先在原生 App 使用「免登入藍牙檢測」確認是否找得到實物標籤。</li>
          <li>管理員新增設備並指定車輛；登入原生 App，選擇該車與設備，再掃描並點選「綁定」。</li>
          <li>只有綁定儲存成功才顯示「已綁定」。設備名稱相同不代表同一顆標籤，iPhone 識別碼也可能不同於 FindTag 顯示的位址。</li>
        </ol>
        <p>原生 App 尚需完成簽章、安裝及實機相容性驗證；更新本網站不會自動安裝 App。掃描到標籤也不代表已完成連線、尋鈴或背景定位驗證。</p>
        <div className="responsive-table"><table><thead><tr><th>設備名稱</th><th>綁定車輛</th><th>藍牙識別</th><th>硬體驗證</th><th>電量</th><th>最後出現</th><th>狀態</th>{canManageFleet && <th>操作</th>}</tr></thead>
          <tbody>{devices.map(device => { const vehicle = relatedVehicle(device.official_vehicles); return <tr key={device.device_id}>
            <td><strong>{device.display_name}</strong><small>{device.advertised_name || '尚未記錄廣播名稱'}</small></td>
            <td>{vehicle?.plate_no || '尚未綁定'}</td><td>{device.device_fingerprint}</td>
            <td>{VERIFY_STATUS[device.verification_status] || '未知狀態'}</td><td>{device.battery_level == null ? '—' : `${device.battery_level}%`}</td>
            <td>{device.last_seen_at ? fmtTime(device.last_seen_at) : '尚無紀錄'}</td><td>{DEVICE_STATUS[device.status] || '未知狀態'}</td>
            {canManageFleet && <td><button className="secondary-btn compact" onClick={() => setDeviceEditor(device)}>編輯</button></td>}
          </tr>; })}</tbody></table></div>
        {!devices.length && <p className="empty">目前沒有可顯示的設備；若上方顯示資料載入失敗，需先完成資料庫設定或權限檢查。</p>}
      </section>}

      {module.key === 'geofences' && <section className="panel tracking-table-panel">
        <div className="responsive-table"><table><thead><tr><th>圍籬名稱</th><th>形狀</th><th>中心座標</th><th>範圍</th><th>通知</th><th>狀態</th>{canManageFleet && <th>操作</th>}</tr></thead>
          <tbody>{geofences.map(fence => <tr key={fence.geofence_id}><td><strong>{fence.name}</strong></td><td>{fence.shape_type === 'circle' ? '圓形' : '多邊形'}</td><td>{fence.center_latitude == null ? '—' : `${Number(fence.center_latitude).toFixed(5)}, ${Number(fence.center_longitude).toFixed(5)}`}</td><td>{fence.radius_m == null ? '—' : `${fence.radius_m} 公尺`}</td><td>{[fence.notify_on_enter && '進入', fence.notify_on_exit && '離開'].filter(Boolean).join('、') || '不通知'}</td><td>{fence.status === 'active' ? '啟用' : '停用'}</td>{canManageFleet && <td><button className="secondary-btn compact" onClick={() => setGeofenceEditor(fence)}>編輯</button></td>}</tr>)}</tbody></table></div>
        {!geofences.length && <p className="empty">尚未設定電子圍籬</p>}
      </section>}

      {module.key === 'alerts' && <section className="panel tracking-table-panel">
        <div className="responsive-table"><table><thead><tr><th>時間</th><th>車輛</th><th>事件</th><th>等級</th><th>說明</th><th>處理狀態</th>{canManageFleet && <th>操作</th>}</tr></thead>
          <tbody>{events.map(item => <tr key={item.event_id}><td>{fmtTime(item.occurred_at)}</td><td>{item.vehicle_id ? vehicleById.get(item.vehicle_id)?.plate_no || '未知車輛' : '系統'}</td><td>{EVENT_TYPE[item.event_type] || '其他事件'}</td><td><span className={`tracking-severity ${item.severity}`}>{SEVERITY[item.severity] || '未知'}</span></td><td><strong>{item.title}</strong><small>{item.message || ''}</small></td><td>{item.acknowledged_at ? `已確認｜${fmtTime(item.acknowledged_at)}` : '待確認'}</td>{canManageFleet && <td>{!item.acknowledged_at && <button className="secondary-btn compact" onClick={() => void acknowledge(item.event_id)}>確認</button>}</td>}</tr>)}</tbody></table></div>
        {!events.length && <p className="empty">目前沒有定位告警</p>}
      </section>}
    </div>

    {deviceEditor && <AdminModal title={deviceEditor.device_id ? '編輯藍牙設備' : '新增藍牙設備'} onClose={() => setDeviceEditor(null)}>
      <div className="admin-form-grid">
        <label>設備名稱（必填）<input value={String(deviceEditor.display_name || '')} onChange={event => setDeviceEditor({ ...deviceEditor, display_name: event.target.value })} placeholder="例：公務車標籤01" /></label>
        <label>藍牙廣播名稱<input value={String(deviceEditor.advertised_name || '')} onChange={event => setDeviceEditor({ ...deviceEditor, advertised_name: event.target.value })} placeholder="由手機掃描取得" /></label>
        <label className="wide">設備識別碼（必填）<input value={String(deviceEditor.device_fingerprint || '')} onChange={event => setDeviceEditor({ ...deviceEditor, device_fingerprint: event.target.value })} placeholder="使用掃描結果產生的穩定識別碼" /></label>
        <label>綁定公務車<select value={String(deviceEditor.vehicle_id || '')} onChange={event => setDeviceEditor({ ...deviceEditor, vehicle_id: event.target.value || null })}><option value="">尚未綁定</option>{vehicles.map(vehicle => <option key={vehicle.vehicle_id} value={vehicle.vehicle_id}>{vehicle.plate_no}{vehicle.vehicle_name ? `｜${vehicle.vehicle_name}` : ''}</option>)}</select></label>
        <label>硬體驗證<select value={String(deviceEditor.verification_status || 'untested')} onChange={event => setDeviceEditor({ ...deviceEditor, verification_status: event.target.value })}>{Object.entries(VERIFY_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>服務識別碼<input value={String(deviceEditor.service_uuid || '')} onChange={event => setDeviceEditor({ ...deviceEditor, service_uuid: event.target.value })} placeholder="實機掃描後填入" /></label>
        <label>特徵識別碼<input value={String(deviceEditor.characteristic_uuid || '')} onChange={event => setDeviceEditor({ ...deviceEditor, characteristic_uuid: event.target.value })} placeholder="實機掃描後填入" /></label>
        <label>狀態<select value={String(deviceEditor.status || 'active')} onChange={event => setDeviceEditor({ ...deviceEditor, status: event.target.value })}>{Object.entries(DEVICE_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="wide">備註<input value={String(deviceEditor.note || '')} onChange={event => setDeviceEditor({ ...deviceEditor, note: event.target.value })} /></label>
      </div>
      <p className="tracking-form-hint">設備尚未完成實機掃描前，請保留「尚未測試」，避免誤認為已支援背景定位或尋鈴。</p>
      <footer><button className="secondary-btn" onClick={() => setDeviceEditor(null)}>取消</button><button className="primary-btn compact" disabled={busy} onClick={() => void saveDevice()}>{busy ? '儲存中…' : '儲存'}</button></footer>
    </AdminModal>}

    {geofenceEditor && <AdminModal title={geofenceEditor.geofence_id ? '編輯電子圍籬' : '新增電子圍籬'} onClose={() => setGeofenceEditor(null)}>
      <div className="admin-form-grid">
        <label className="wide">圍籬名稱（必填）<input value={String(geofenceEditor.name || '')} onChange={event => setGeofenceEditor({ ...geofenceEditor, name: event.target.value })} /></label>
        <label>中心緯度<input type="number" step="0.000001" value={String(geofenceEditor.center_latitude ?? '')} onChange={event => setGeofenceEditor({ ...geofenceEditor, center_latitude: Number(event.target.value) })} /></label>
        <label>中心經度<input type="number" step="0.000001" value={String(geofenceEditor.center_longitude ?? '')} onChange={event => setGeofenceEditor({ ...geofenceEditor, center_longitude: Number(event.target.value) })} /></label>
        <label>半徑（公尺）<input type="number" min="10" step="10" value={String(geofenceEditor.radius_m ?? 300)} onChange={event => setGeofenceEditor({ ...geofenceEditor, radius_m: Number(event.target.value) })} /></label>
        <label>狀態<select value={String(geofenceEditor.status || 'active')} onChange={event => setGeofenceEditor({ ...geofenceEditor, status: event.target.value })}><option value="active">啟用</option><option value="inactive">停用</option></select></label>
        <label className="checkbox"><input type="checkbox" checked={geofenceEditor.notify_on_enter !== false} onChange={event => setGeofenceEditor({ ...geofenceEditor, notify_on_enter: event.target.checked })} />進入時通知</label>
        <label className="checkbox"><input type="checkbox" checked={geofenceEditor.notify_on_exit !== false} onChange={event => setGeofenceEditor({ ...geofenceEditor, notify_on_exit: event.target.checked })} />離開時通知</label>
      </div>
      <footer><button className="secondary-btn" onClick={() => setGeofenceEditor(null)}>取消</button><button className="primary-btn compact" disabled={busy} onClick={() => void saveGeofence()}>{busy ? '儲存中…' : '儲存'}</button></footer>
    </AdminModal>}
  </AppShell>;
}

export function VehicleTrackingWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  return <AuthGate>{profile => {
    const allowed = profile.allowed_systems.includes('*') || profile.allowed_systems.includes('vehicletracking');
    if (!allowed) return <AppShell profile={profile} title={module.title}><div className="notice danger">目前角色沒有公務車定位追蹤系統權限，請由管理員開放。</div></AppShell>;
    return <TrackingDataShell system={system} module={module} profile={profile} />;
  }}</AuthGate>;
}
