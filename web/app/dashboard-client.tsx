'use client';

// 戰情儀表板：對應 V1 的 dashboard.html。
//
// 搬移的理由是一個功能斷點：V2 早就把「戰情版面設定」搬過來了（後台的戰情版面模組
// 可以編輯版本、項目座標大小並發布），但 V2 沒有任何頁面會去讀那份版面，
// 於是版面設定得了卻沒有地方生效。這頁把版面接回來。
//
// 版面來源與 V1 相同：dashboard_layouts(layout_code='operations_main') 的
// published_version_id → dashboard_layout_items。normalize 的補值與夾限規則
// 逐項沿用 V1 的 dashboard-layout.js，讀不到版面時退回同一份內建預設，
// 因此兩版對同一組設定會排出同樣的欄寬與順序。
//
// 與 V1 的兩點差異，都是刻意的：
// 1. V1 用 gridstack 的固定列座標，這裡改成 12 欄流動版面——沿用欄寬（width）與
//    排序（y, x, sort_order），高度換算成最小高度。固定列座標在窄螢幕會留下大片空洞，
//    而本站要支援手機。
// 2. 圖表不引入 Chart.js：狀態分佈與各項排行改用與 V1 rankBars 同樣的水平長條，
//    月趨勢沿用 V2 既有的 .trend-chart 直條。數字口徑不變。
//
// 臺灣即時氣象另成一個元件（weather-widget.tsx），資料仍走既有的 cwa-weather 函式。
//
// KPI／提醒的計算逐項沿用 V1 render() 的公式（SLA、MTTR、MTBF、逾期、待派工），
// 曆日一律以台北時區為準——timestamptz 回傳的是 UTC，直接 slice(0,10) 會跨日算錯。

import { useCallback, useEffect, useMemo, useState } from 'react';
import './dashboard.css';
import { AppShell } from '@/components/AppShell';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { getSupabase } from '@/lib/supabase';
import { getPatrolShiftsForDate, isDeletedShift, isNightShiftName, patrolDateOffset, shiftRange } from '@/lib/patrol-status';
import { canonicalFloor } from '@/lib/floor';
import { WeatherWidget } from './weather-widget';
import { DashboardMarketCarousel } from './dashboard-market-carousel';
import type { Profile } from '@/types/app';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, ArcElement, Tooltip, Legend, Filler);

type Row = Record<string, any>;
type TrendPeriod = 'week' | 'month' | 'quarter' | 'halfyear' | 'year';
type TrendPoint = { label: string; value: number };
type LayoutItem = {
  widget_key: string; title: string; x: number; y: number; width: number; height: number;
  min_width: number; min_height: number; visible: boolean; refresh_seconds: number; sort_order: number;
};

// 與 V1 dashboard-layout.js 的 CATALOG 一字不差，兩邊的預設版面才會一致。
const CATALOG = [
  { key: 'alerts', title: '重要提醒', x: 0, y: 0, w: 12, h: 1, minW: 3, minH: 1 },
  { key: 'kpis', title: '營運關鍵指標', x: 0, y: 1, w: 12, h: 2, minW: 4, minH: 2 },
  { key: 'patrol', title: '駐衛警巡檢即時', x: 0, y: 3, w: 8, h: 6, minW: 4, minH: 4 },
  { key: 'status', title: '案件狀態分佈', x: 8, y: 3, w: 4, h: 6, minW: 3, minH: 4 },
  { key: 'rank_dept', title: '各單位報修排行', x: 0, y: 9, w: 6, h: 4, minW: 3, minH: 3 },
  { key: 'rank_equipment', title: '各設備故障排行', x: 6, y: 9, w: 6, h: 4, minW: 3, minH: 3 },
  { key: 'rank_technician', title: '維修人員案件數', x: 0, y: 13, w: 6, h: 4, minW: 3, minH: 3 },
  { key: 'rank_fault', title: '故障類型分析', x: 6, y: 13, w: 6, h: 4, minW: 3, minH: 3 },
  { key: 'trend', title: '各月份報修趨勢', x: 0, y: 17, w: 12, h: 5, minW: 4, minH: 4 },
  { key: 'weather_taiwan', title: '臺灣即時氣象', x: 0, y: 22, w: 12, h: 7, minW: 6, minH: 5 },
  { key: 'market_snapshot', title: '市場交易行情摘要', x: 0, y: 29, w: 12, h: 5, minW: 4, minH: 4 },
] as const;

const DONE_ORDER = ['completed', 'closed'];
const OPEN_REQUEST = ['pending', 'transferred', 'assigned', 'in_progress', 'waiting_parts', 'waiting_vendor', 'pending_review', 'overdue', 'returned', 'rejected'];
const IN_PROGRESS_ORDER = ['accepted', 'in_progress', 'waiting_parts', 'waiting_vendor', 'assigned'];
const STATUS_LABEL: Record<string, string> = {
  pending: '待派工', transferred: '已轉派', assigned: '已派工', accepted: '已接單',
  in_progress: '維修中', waiting_parts: '等待料件', waiting_vendor: '等待廠商',
  pending_review: '待驗收', completed: '已完成', closed: '已結案',
  returned: '已退回', rejected: '已拒絕', cancelled: '已取消', overdue: '已逾期',
};

const taipeiDate = (value: unknown) => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};
const today = () => taipeiDate(new Date())!;
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
  const parsed = parseInt(String(value), 10);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
};
const countBy = (rows: Row[], pick: (row: Row) => unknown): Array<[string, number]> => {
  const map: Record<string, number> = {};
  rows.forEach(row => { const key = String(pick(row) ?? '') || '未填'; map[key] = (map[key] || 0) + 1; });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
};
const average = (list: number[]) => list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;

function trendSpec(period: TrendPeriod, now: Date) {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'week' || period === 'month') {
    const days = period === 'week' ? 7 : 30;
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - days + 1);
    return { start, end, points: Array.from({ length: days }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      return { start: date, end: date, label: `${date.getMonth() + 1}/${date.getDate()}` };
    }) };
  }
  if (period === 'quarter') {
    const weeks = 13;
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - weeks * 7 + 1);
    return { start, end, points: Array.from({ length: weeks }, (_, index) => {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index * 7);
      const pointEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 6);
      return { start: date, end: pointEnd > end ? end : pointEnd, label: `${date.getMonth() + 1}/${date.getDate()}` };
    }) };
  }
  const months = period === 'halfyear' ? 6 : 12;
  const start = new Date(end.getFullYear(), end.getMonth() - months + 1, 1);
  return { start, end, points: Array.from({ length: months }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth() + index, 1);
    const pointEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return { start: date, end: pointEnd > end ? end : pointEnd, label: `${date.getFullYear()}/${date.getMonth() + 1}` };
  }) };
}

function normalizeLayout(rows: Row[]): LayoutItem[] {
  const byKey: Record<string, Row> = {};
  (Array.isArray(rows) ? rows : []).forEach(row => { if (row && CATALOG.some(item => item.key === row.widget_key)) byKey[row.widget_key] = row; });
  return CATALOG.map((preset, index) => {
    const row = byKey[preset.key] || {};
    return {
      widget_key: preset.key,
      title: String(row.title || preset.title).slice(0, 80),
      x: clampInt(row.x, preset.x, 0, 11), y: clampInt(row.y, preset.y, 0, 999),
      width: clampInt(row.width, preset.w, 1, 12), height: clampInt(row.height, preset.h, 1, 20),
      min_width: clampInt(row.min_width, preset.minW, 1, 12), min_height: clampInt(row.min_height, preset.minH, 1, 20),
      visible: row.visible !== false,
      refresh_seconds: clampInt(row.refresh_seconds, 60, 0, 86400),
      sort_order: clampInt(row.sort_order, (index + 1) * 10, 0, 9999),
    };
  }).sort((a, b) => a.y - b.y || a.x - b.x || a.sort_order - b.sort_order);
}

function BarList({ entries, empty }: { entries: Array<[string, number]>; empty: string }) {
  if (!entries.length) return <p className="empty">{empty}</p>;
  const max = entries[0][1] || 1;
  return <div className="bar-list">{entries.slice(0, 8).map(([name, value]) => <div className="bar-row" key={name}>
    <div className="nm" title={name}>{name}</div>
    <div className="bar-track"><i className="bar-fill" style={{ width: `${Math.max(4, value / max * 100)}%` }} /></div>
    <div className="vv">{value}</div>
  </div>)}</div>;
}

export function DashboardClient({ profile }: { profile: Profile }) {
  const [layout, setLayout] = useState<LayoutItem[]>(() => normalizeLayout([]));
  const [layoutNote, setLayoutNote] = useState('');
  const [requests, setRequests] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [patrol, setPatrol] = useState({ points: 0, done: 0, shift: '', floors: [] as Array<[string, number]> });
  const [range, setRange] = useState<'today' | 'month' | 'year'>('month');
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('month');
  const [from, setFrom] = useState(() => { const now = new Date(); return ymd(new Date(now.getFullYear(), now.getMonth(), 1)); });
  const [to, setTo] = useState(() => ymd(new Date()));
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [updatedAt, setUpdatedAt] = useState('');

  const applyQuickRange = (key: 'today' | 'month' | 'year') => {
    const now = new Date();
    const start = key === 'today' ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : key === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1)
        : new Date(now.getFullYear(), 0, 1);
    setRange(key); setFrom(ymd(start)); setTo(ymd(now));
  };

  // 版面只在進頁時讀一次；改版面是後台的行為，這裡不需要跟著期間重讀。
  useEffect(() => {
    void (async () => {
      const client = getSupabase();
      const { data: head, error: headError } = await client.from('dashboard_layouts')
        .select('layout_id,published_version_id').eq('layout_code', 'operations_main').eq('status', 'active').maybeSingle();
      if (headError || !head?.published_version_id) { setLayoutNote('目前使用系統內建版面（尚未發布戰情版面設定）'); return; }
      const { data, error: itemError } = await client.from('dashboard_layout_items')
        .select('*').eq('version_id', head.published_version_id).order('sort_order');
      if (itemError) { setLayoutNote('版面設定讀取失敗，改用系統內建版面'); return; }
      setLayout(normalizeLayout(data || []));
    })();
  }, []);

  const load = useCallback(async () => {
    setBusy(true); setError('');
    const client = getSupabase();
    const rangeStart = `${from}T00:00:00+08:00`, rangeEnd = `${to}T23:59:59+08:00`;
    const now = new Date();
    const trendWindow = trendSpec(trendPeriod, now);
    const trendStart = `${ymd(trendWindow.start)}T00:00:00+08:00`;
    const trendEnd = `${ymd(trendWindow.end)}T23:59:59+08:00`;
    const day = today();
    const [requestResult, orderResult, trendResult, markerResult, checkinResult, patrolYesterdayResult, patrolTodayResult] = await Promise.all([
      client.from('repair_requests')
        .select('request_id,department,equipment_id,status,fault_type,created_at,desired_finish,hidden,equipment(name,category)')
        .gte('created_at', rangeStart).lte('created_at', rangeEnd).limit(5000),
      client.from('maintenance_orders')
        .select('order_id,assignee_id,status,start_time,finish_time,expected_finish,created_at,hidden,users:assignee_id(name)').limit(5000),
      client.from('repair_requests').select('created_at,hidden')
        .gte('created_at', trendStart).lte('created_at', trendEnd).limit(10000),
      client.from('plan_markers').select('marker_id,floor_id,label,status').eq('kind', 'patrol').limit(5000),
      client.from('checkin_logs').select('checkin_id,target_id,label,floor_id')
        .gte('checkin_at', `${day}T00:00:00+08:00`).lte('checkin_at', `${day}T23:59:59+08:00`).limit(5000),
      getPatrolShiftsForDate(client, patrolDateOffset(day, -1)),
      getPatrolShiftsForDate(client, day),
    ]);

    if (requestResult.error || orderResult.error) {
      setError(`資料載入失敗：${(requestResult.error || orderResult.error)?.message || '請稍後再試'}`);
      setBusy(false); return;
    }
    // 巡邏點、打卡、班別與月趨勢失敗時不擋整頁——維修資料仍然有效——但一定要說出來。
    // 少了這段，「今天沒有排班」與「patrol_shifts 查詢被 RLS 擋下」在畫面上
    // 都只會顯示「目前無進行中班別」，無從分辨；月趨勢同理，RPC 掛掉與真的沒案件
    // 都是一條全 0 的線。兩者可能同時失敗，因此一起列出而不是互相覆蓋。
    const notices: string[] = [];
    const patrolFailure = markerResult.error || checkinResult.error;
    if (patrolFailure) notices.push(`當班巡檢資料載入失敗：${patrolFailure.message || '請稍後再試'}`);
    if (trendResult.error) notices.push(`走勢統計載入失敗：${trendResult.error.message || '請稍後再試'}`);
    if (notices.length) setError(notices.join('；'));
    setRequests((requestResult.data || []).filter(row => !row.hidden));
    setOrders((orderResult.data || []).filter(row => !row.hidden));

    // 走勢依選取期間自動分桶；查詢失敗時保留空值，不虛構數字。
    const trendCounts: TrendPoint[] = trendWindow.points.map(point => ({ label: point.label, value: 0 }));
    if (!trendResult.error) {
      (trendResult.data || []).filter((row: Row) => !row.hidden).forEach((row: Row) => {
        const created = taipeiDate(row.created_at);
        const index = trendWindow.points.findIndex(point => created != null && created >= ymd(point.start) && created <= ymd(point.end));
        if (index >= 0) trendCounts[index].value += 1;
      });
    }
    setTrend(trendCounts);

    // 當班巡檢：以當日打卡對照巡邏點，班別取此刻進行中者，與 SYS-03 打卡矩陣同口徑。
    const points = (markerResult.data || [])
      .filter(row => row.status !== 'inactive')
      .map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) }));
    const checked = new Set<string>();
    (checkinResult.data || []).forEach(row => {
      if (row.target_id) checked.add(String(row.target_id));
      checked.add(`${canonicalFloor(row.floor_id)}|${row.label}`);
    });
    const isDone = (point: Row) => checked.has(String(point.marker_id)) || checked.has(`${point.floor_id}|${point.label}`);
    // 已軟刪除的班別不列入當班判定，並與巡檢打卡矩陣共用「夜班歸前一日、實際日期為隔日」的時間軸。
    // 交界時刻若前一班的結束與下一班的開始重疊，取開始時間較晚的班別。
    const patrolSchedules = [...(patrolYesterdayResult || []), ...(patrolTodayResult || [])]
      .filter(item => !isDeletedShift(item.name));
    const activeShift = patrolSchedules.map(item => ({ item, range: shiftRange(item, new Date(`${item.base_date}T00:00:00`)) }))
      .filter(({ range }) => now >= range.start && now <= range.end)
      .sort((a, b) => b.range.start.getTime() - a.range.start.getTime())[0]?.item;
    const floorMap: Record<string, number> = {};
    points.filter(point => !isDone(point)).forEach(point => {
      const key = String(point.floor_id || '未分類');
      floorMap[key] = (floorMap[key] || 0) + 1;
    });
    setPatrol({
      points: points.length, done: points.filter(isDone).length,
      shift: activeShift ? `${activeShift.name}${isNightShiftName(activeShift.name) ? '（隔夜）' : ''} ${String(activeShift.start_time).slice(0, 5)}–${String(activeShift.end_time).slice(0, 5)}` : '',
      floors: Object.entries(floorMap).sort((a, b) => b[1] - a[1]),
    });

    setUpdatedAt(new Date().toLocaleTimeString('zh-TW', { hour12: false }));
    setBusy(false);
  }, [from, to, trendPeriod]);
  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const day = today(), month = day.slice(0, 7), now = new Date();
    const doneOrders = orders.filter(row => DONE_ORDER.includes(String(row.status)) && row.finish_time);
    const onTime = doneOrders.filter(row => row.expected_finish ? new Date(String(row.finish_time)) <= new Date(String(row.expected_finish)) : true).length;
    const mttr = average(doneOrders.filter(row => row.start_time)
      .map(row => (Date.parse(String(row.finish_time)) - Date.parse(String(row.start_time))) / 3600000));
    // MTBF：同一設備相鄰兩次報修的平均間隔天數，與 V1 相同。
    const byEquipment: Record<string, number[]> = {};
    requests.forEach(row => { if (row.equipment_id) (byEquipment[String(row.equipment_id)] ||= []).push(Date.parse(String(row.created_at))); });
    const gaps: number[] = [];
    Object.values(byEquipment).forEach(list => {
      if (list.length < 2) return;
      list.sort((a, b) => a - b);
      for (let i = 1; i < list.length; i += 1) gaps.push((list[i] - list[i - 1]) / 86400000);
    });
    return {
      todayNew: requests.filter(row => taipeiDate(row.created_at) === day).length,
      todayDone: orders.filter(row => DONE_ORDER.includes(String(row.status)) && taipeiDate(row.finish_time) === day).length,
      inProgress: orders.filter(row => IN_PROGRESS_ORDER.includes(String(row.status))).length,
      overdue: orders.filter(row => !DONE_ORDER.includes(String(row.status)) && row.expected_finish && new Date(String(row.expected_finish)) < now).length
        + requests.filter(row => OPEN_REQUEST.includes(String(row.status)) && row.desired_finish && new Date(String(row.desired_finish)) < now).length,
      waitDispatch: requests.filter(row => row.status === 'pending').length,
      monthCount: requests.filter(row => (taipeiDate(row.created_at) || '').slice(0, 7) === month).length,
      doneCount: doneOrders.length,
      sla: doneOrders.length ? Math.round(onTime / doneOrders.length * 100) : null,
      mttr, mtbf: average(gaps),
    };
  }, [requests, orders]);

  const widget = (item: LayoutItem) => {
    switch (item.widget_key) {
      case 'alerts': return <div className="dash-alerts">
        {stats.overdue > 0 && <div className="dash-alert danger"><b>{stats.overdue}</b><span>已逾期</span></div>}
        {stats.waitDispatch > 0 && <div className="dash-alert warn"><b>{stats.waitDispatch}</b><span>待派工</span></div>}
        <div className="dash-alert"><b>{requests.length}</b><span>區間報修</span><b>{stats.doneCount}</b><span>已完成</span></div>
      </div>;
      case 'kpis': return <div className="dash-kpis">
        {([
          [stats.todayNew, '', '新增', 'var(--cyan)'],
          [stats.todayDone, '', '完成', 'var(--green)'],
          [stats.inProgress, '', '處理中', 'var(--cyan)'],
          [stats.sla == null ? '—' : `${stats.sla}%`, '', 'SLA', 'var(--amber)'],
          [stats.mttr == null ? '—' : stats.mttr.toFixed(1), 'h', 'MTTR', 'var(--cyan)'],
          [stats.mtbf == null ? '—' : stats.mtbf.toFixed(1), 'd', 'MTBF', 'var(--violet)'],
          [stats.monthCount, '', '本月', 'var(--green)'],
        ] as Array<[string | number, string, string, string]>).map(([value, unit, label, color]) =>
          <div className="dash-kpi" key={label} style={{ ['--kpi' as string]: color }}>
            <b>{value}{unit && <small>{unit}</small>}</b><span>{label}</span>
          </div>)}
      </div>;
      case 'patrol': return <>
        <div className="patrol-summary">
          <span>當班{patrol.shift ? '' : '狀態'}<b>{patrol.shift || '目前無進行中班別'}</b></span>
          <span className="done">已打卡<b>{patrol.done}</b></span>
          <span className="pending">未打卡<b>{Math.max(patrol.points - patrol.done, 0)}</b></span>
          <span>巡邏點<b>{patrol.points}</b></span>
        </div>
        <BarList entries={patrol.floors} empty="今日所有巡邏點都已完成打卡" />
      </>;
      case 'status': {
        const counts = countBy(requests, row => STATUS_LABEL[String(row.status)] || '未知狀態');
        if (!counts.length) return <p className="empty">區間內沒有報修案件</p>;
        const data = {
          labels: counts.map(c => c[0]),
          datasets: [{
            data: counts.map(c => c[1]),
            backgroundColor: ['#00d4ff', '#00ff9d', '#ffb300', '#ff3b3b', '#a855f7', '#3b82f6', '#ec4899', '#f97316'],
            borderWidth: 0,
            hoverOffset: 4
          }]
        };
        const options = { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'right' as const, labels: { color: 'gray', padding: 20 } } } };
        return <div style={{ position: 'relative', height: '100%', minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Doughnut data={data} options={options} /></div>;
      }
      case 'rank_dept': return <BarList entries={countBy(requests, row => row.department)} empty="區間內沒有報修案件" />;
      case 'rank_equipment': return <BarList entries={countBy(requests, row => (row.equipment as Row)?.name || '未知設備')} empty="區間內沒有報修案件" />;
      case 'rank_technician': return <BarList entries={countBy(orders, row => (row.users as Row)?.name || '未指派')} empty="目前沒有維修工單" />;
      case 'rank_fault': return <BarList entries={countBy(requests, row => row.fault_type || '未分類')} empty="區間內沒有報修案件" />;
      case 'trend': {
        const data = {
          labels: trend.map(m => m.label),
          datasets: [{
            label: '報修件數',
            data: trend.map(m => m.value),
            borderColor: '#00d4ff',
            backgroundColor: 'rgba(0, 212, 255, 0.1)',
            borderWidth: 2,
            fill: true,
            tension: 0.4
          }]
        };
        const options = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(128,128,128,0.1)' }, ticks: { color: 'gray' } }, x: { grid: { display: false }, ticks: { color: 'gray' } } } };
        return <div className="trend-widget">
          <div className="trend-controls">
            <label htmlFor="dashboard-trend-period">走勢期間</label>
            <select id="dashboard-trend-period" data-trend-version="20260901-2" value={trendPeriod} onChange={event => setTrendPeriod(event.target.value as TrendPeriod)}>
              <option value="week">周走勢（近 7 日）</option>
              <option value="month">月走勢（近 30 日）</option>
              <option value="quarter">季走勢（近 13 週）</option>
              <option value="halfyear">半年走勢（近 6 個月）</option>
              <option value="year">年走勢（近 12 個月）</option>
            </select>
          </div>
          <div style={{ position: 'relative', height: 'calc(100% - 42px)', minHeight: '200px' }}><Line data={data} options={options} /></div>
        </div>;
      }
      case 'weather_taiwan': return <WeatherWidget />;
      case 'market_snapshot': return <>
        <div className="dash-market-stock-legend" aria-label="行情方向圖例">
          <b>行情方向</b>
          <span className="rise"><i aria-hidden="true">▲</i> 上漲（紅）</span>
          <span className="fall"><i aria-hidden="true">▼</i> 下跌（綠）</span>
          <small>與前一交易日相比，紅漲綠跌僅表示價格方向，非漲停／跌停。</small>
        </div>
        <DashboardMarketCarousel />
      </>;
      default: return <p className="empty">未知的版面元件：{item.widget_key}</p>;
    }
  };

  return <AppShell profile={profile} title="戰情儀表板">
    {error && <div className="notice danger">{error}</div>}
    {layoutNote && <p className="inline-message">{layoutNote}</p>}

    <div className="dash-toolbar">
      <button className={`range-btn${range === 'today' ? ' active' : ''}`} onClick={() => applyQuickRange('today')}>今日</button>
      <button className={`range-btn${range === 'month' ? ' active' : ''}`} onClick={() => applyQuickRange('month')}>本月</button>
      <button className={`range-btn${range === 'year' ? ' active' : ''}`} onClick={() => applyQuickRange('year')}>今年</button>
      <div style={{ width: '130px' }}>
        <LocalizedDateInput aria-label="起始日期（年/月/日）" value={from} onChange={e => setFrom(e.target.value)} />
      </div>
      <div style={{ width: '130px' }}>
        <LocalizedDateInput aria-label="結束日期（年/月/日）" value={to} onChange={e => setTo(e.target.value)} />
      </div>
      <button onClick={() => void load()} disabled={busy}>{busy ? '載入中…' : '重新整理'}</button>
      <span className="spacer">區間：{from} ~ {to}{updatedAt && `　最後更新：${updatedAt}`}</span>
    </div>

    <div className="dash-grid">
      {layout.filter(item => item.visible).map(item =>
        <section className="dash-widget" key={item.widget_key}
          style={{ gridColumn: `span ${item.width}`, minHeight: item.height * 56 }}>
          <header><h2>{item.title}</h2><span>{item.widget_key}</span></header>
          {widget(item)}
        </section>)}
    </div>
  </AppShell>;
}
