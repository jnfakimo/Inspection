'use client';

// 戰情元件的真實資料來源（2026-10-15）。電視牆與後台版面預覽的每個元件都從這裡讀，
// 同一頁只查一次、每 60 秒更新；查詢失敗時保留錯誤訊息讓元件照實顯示，不用模擬數字補。
// 報修與巡邏的查詢內容與 app/dashboard-client.tsx 相同（期間固定為本月）。

import { useEffect, useSyncExternalStore } from 'react';
import { getSupabase, invokeCachedAppApi } from '@/lib/supabase';
import { getPatrolShiftsForDate, isDeletedShift, isNightShiftName, patrolDateOffset, shiftRange, type PatrolShift } from '@/lib/patrol-status';
import { canonicalFloor } from '@/lib/floor';
import { taipeiDate, type MarketFeed, type Row } from '@/lib/dashboard-metrics';

export type LiveSource = 'repair' | 'patrol' | 'equipment' | 'market';

export type PatrolSnapshot = {
  points: number; done: number; shift: string;
  floors: Array<[string, number]>;
  shifts: Array<{ name: string; time: string; current: boolean }>;
};

export type DashboardLiveState = {
  requests: Row[] | null;
  orders: Row[] | null;
  trend: Array<{ label: string; value: number }> | null;
  patrol: PatrolSnapshot | null;
  equipment: Row[] | null;
  market: MarketFeed | null;
  errors: Partial<Record<LiveSource | 'trend', string>>;
  loading: Partial<Record<LiveSource, boolean>>;
  updatedAt: string;
};

const REFRESH_MS = 60_000;
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let state: DashboardLiveState = {
  requests: null, orders: null, trend: null, patrol: null, equipment: null, market: null,
  errors: {}, loading: {}, updatedAt: '',
};
const listeners = new Set<() => void>();
const wanted = new Map<LiveSource, number>();
const lastLoaded = new Map<LiveSource, number>();
const inFlight = new Set<LiveSource>();
let timer: ReturnType<typeof setInterval> | null = null;

function setState(patch: Partial<DashboardLiveState>) {
  state = { ...state, ...patch, errors: { ...state.errors, ...(patch.errors || {}) }, loading: { ...state.loading, ...(patch.loading || {}) } };
  listeners.forEach(listener => listener());
}

const message = (error: unknown) => (error && typeof error === 'object' && 'message' in error ? String((error as { message: unknown }).message) : String(error || '請稍後再試'));

async function loadRepair() {
  const client = getSupabase();
  const now = new Date();
  const from = ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to = ymd(now);
  const trendStart = `${now.getFullYear() - (now.getMonth() < 11 ? 1 : 0)}-${pad(((now.getMonth() + 1) % 12) + 1)}-01`;
  const trendEnd = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const [requestResult, orderResult, trendResult] = await Promise.all([
    client.from('repair_requests')
      .select('request_id,department,equipment_id,status,fault_type,fault_location,created_at,desired_finish,hidden,equipment(name,category,location)')
      .gte('created_at', `${from}T00:00:00+08:00`).lte('created_at', `${to}T23:59:59+08:00`).limit(1000),
    client.from('maintenance_orders')
      .select('order_id,assignee_id,status,start_time,finish_time,expected_finish,created_at,hidden,users:assignee_id(name)').limit(1000),
    client.rpc('repair_monthly_counts', { p_start: trendStart, p_end: trendEnd }),
  ]);
  if (requestResult.error || orderResult.error) {
    setState({ errors: { repair: `報修資料載入失敗：${message(requestResult.error || orderResult.error)}` } });
    return;
  }
  const counts: Record<string, number> = {};
  if (!trendResult.error) (trendResult.data || []).forEach((row: Row) => { counts[String(row.month_key)] = Number(row.total) || 0; });
  const trend: Array<{ label: string; value: number }> = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    trend.push({ label: `${d.getMonth() + 1}月`, value: counts[`${d.getFullYear()}-${pad(d.getMonth() + 1)}`] || 0 });
  }
  setState({
    requests: (requestResult.data || []).filter((row: Row) => !row.hidden),
    orders: (orderResult.data || []).filter((row: Row) => !row.hidden),
    trend: trendResult.error ? null : trend,
    errors: { repair: '', trend: trendResult.error ? `月趨勢統計載入失敗：${message(trendResult.error)}` : '' },
  });
}

async function loadPatrol() {
  const client = getSupabase();
  const now = new Date();
  const day = taipeiDate(now)!;
  const [markerResult, checkinResult, yesterday, today] = await Promise.all([
    client.from('plan_markers').select('marker_id,floor_id,label,status').eq('kind', 'patrol').limit(1000),
    client.from('checkin_logs').select('checkin_id,target_id,label,floor_id')
      .gte('checkin_at', `${day}T00:00:00+08:00`).lte('checkin_at', `${day}T23:59:59+08:00`).limit(1000),
    getPatrolShiftsForDate(client, patrolDateOffset(day, -1)),
    getPatrolShiftsForDate(client, day),
  ]);
  if (markerResult.error || checkinResult.error) {
    setState({ errors: { patrol: `巡邏資料載入失敗：${message(markerResult.error || checkinResult.error)}` } });
    return;
  }
  const points = (markerResult.data || []).filter((row: Row) => row.status !== 'inactive')
    .map((row: Row) => ({ ...row, floor_id: canonicalFloor(row.floor_id) }));
  const checked = new Set<string>();
  (checkinResult.data || []).forEach((row: Row) => {
    if (row.target_id) checked.add(String(row.target_id));
    checked.add(`${canonicalFloor(row.floor_id)}|${row.label}`);
  });
  const isDone = (point: Row) => checked.has(String(point.marker_id)) || checked.has(`${point.floor_id}|${point.label}`);
  const schedules = [...(yesterday || []), ...(today || [])].filter(item => !isDeletedShift(item.name));
  const ranged = schedules.map(item => ({ item, range: shiftRange(item, new Date(`${item.base_date}T00:00:00`)) }));
  const active = ranged.filter(({ range }) => now >= range.start && now <= range.end)
    .sort((a, b) => b.range.start.getTime() - a.range.start.getTime())[0]?.item;
  const label = (shift: PatrolShift) => `${shift.name}${isNightShiftName(shift.name) ? '（隔夜）' : ''}`;
  const time = (shift: PatrolShift) => `${String(shift.start_time).slice(0, 5)}–${String(shift.end_time).slice(0, 5)}`;
  const floorMap: Record<string, number> = {};
  points.filter((point: Row) => !isDone(point)).forEach((point: Row) => {
    const key = String(point.floor_id || '未分類');
    floorMap[key] = (floorMap[key] || 0) + 1;
  });
  setState({
    patrol: {
      points: points.length,
      done: points.filter(isDone).length,
      shift: active ? `${label(active)} ${time(active)}` : '',
      floors: Object.entries(floorMap).sort((a, b) => b[1] - a[1]),
      shifts: (today || []).filter(item => !isDeletedShift(item.name))
        .map(item => ({ name: label(item), time: time(item), current: active?.shift_id === item.shift_id && active?.base_date === item.base_date })),
    },
    errors: { patrol: '' },
  });
}

async function loadEquipment() {
  const result = await getSupabase().from('equipment').select('equipment_id,status,category').limit(5000);
  if (result.error) { setState({ errors: { equipment: `設備資料載入失敗：${message(result.error)}` } }); return; }
  setState({ equipment: result.data || [], errors: { equipment: '' } });
}

async function loadMarket(force: boolean) {
  try {
    const feed = await invokeCachedAppApi<MarketFeed>('dashboard_market_rotation', { view: 'board' }, { ttlMs: 5 * 60_000, force });
    setState({ market: feed, errors: { market: '' } });
  } catch (error) {
    setState({ errors: { market: `市場行情載入失敗：${message(error)}` } });
  }
}

const LOADERS: Record<LiveSource, (force: boolean) => Promise<void>> = {
  repair: () => loadRepair(),
  patrol: () => loadPatrol(),
  equipment: () => loadEquipment(),
  market: force => loadMarket(force),
};

async function refresh(source: LiveSource, force = false) {
  if (inFlight.has(source)) return;
  const last = lastLoaded.get(source) || 0;
  if (!force && Date.now() - last < REFRESH_MS) return;
  inFlight.add(source);
  setState({ loading: { [source]: true } });
  try {
    await LOADERS[source](force);
  } catch (error) {
    setState({ errors: { [source]: `資料載入失敗：${message(error)}` } });
  } finally {
    lastLoaded.set(source, Date.now());
    inFlight.delete(source);
    setState({ loading: { [source]: false }, updatedAt: new Date().toLocaleTimeString('zh-TW', { hour12: false }) });
  }
}

function ensureTimer() {
  if (timer || typeof window === 'undefined') return;
  timer = setInterval(() => { wanted.forEach((count, source) => { if (count > 0) void refresh(source, true); }); }, REFRESH_MS);
}

function want(sources: LiveSource[]) {
  sources.forEach(source => { wanted.set(source, (wanted.get(source) || 0) + 1); void refresh(source); });
  ensureTimer();
  return () => {
    sources.forEach(source => wanted.set(source, Math.max(0, (wanted.get(source) || 1) - 1)));
    if ([...wanted.values()].every(count => count === 0) && timer) { clearInterval(timer); timer = null; }
  };
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => state;

/** 讀取戰情元件需要的資料來源；同一頁多個元件共用同一次查詢。 */
export function useDashboardLiveData(sources: LiveSource[]): DashboardLiveState {
  const key = [...sources].sort().join(',');
  useEffect(() => (key ? want(key.split(',') as LiveSource[]) : undefined), [key]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
