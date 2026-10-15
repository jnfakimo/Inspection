'use client';

// 戰情版面元件的內容（電視牆與後台版面預覽共用）。2026-10-15 起全部讀真實資料：
// 報修／巡邏／設備走 Supabase，行情走 app-api dashboard_market_rotation，天氣走 cwa-weather。
// 沒有資料來源的元件（dataSource: 'unavailable'）只顯示「尚未介接資料來源」，不得再放模擬數字。

import React from 'react';
import { Chart as ChartJS, ArcElement, BarElement, CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip } from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { WeatherWidget } from '@/app/weather-widget';
import { CHART_SERIES } from '@/lib/chart-palette';
import { DASHBOARD_WIDGET_CATALOG } from '@/lib/dashboard-widget-catalog';
import {
  REPAIR_STATUS_LABEL, OPEN_REQUEST, computeCategoryShare, computeEquipmentReadiness, computeGroupComparison, computeItemMoves,
  computeMarketTotals, computeRepairStats, computeTopMovers, computeTurnoverTrend, computeVolatileItems, countBy,
  type ItemMove, type Row,
} from '@/lib/dashboard-metrics';
import { useDashboardLiveData, type DashboardLiveState, type LiveSource } from '@/lib/dashboard-live-data';
import '@/app/dashboard.css';
import '@/app/weather-widget-layout.css';
import './dashboard-widgets.css';

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip);

const SOURCES: Record<string, LiveSource[]> = {
  repair: ['repair'],
  patrol: ['patrol'],
  equipment: ['equipment', 'repair'],
  market: ['market'],
  weather: [],
  unavailable: [],
};

const num = (value: number | null | undefined, digits = 0) => (
  value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('zh-TW', { maximumFractionDigits: digits })
);
const signed = (value: number | null | undefined) => (value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`);
const moveClass = (value: number | null | undefined) => (value == null || value === 0 ? '' : value > 0 ? ' is-rise' : ' is-fall');

const chartScales = { y: { beginAtZero: true, grid: { color: 'rgba(128,128,128,0.12)' }, ticks: { color: 'gray' } }, x: { grid: { display: false }, ticks: { color: 'gray' } } };

function Notice({ tone, children }: { tone?: 'error' | 'muted'; children: React.ReactNode }) {
  return <p className={`dw-notice${tone === 'error' ? ' is-error' : ''}`}>{children}</p>;
}

function BarList({ entries, empty, unit = '' }: { entries: Array<[string, number]>; empty: string; unit?: string }) {
  if (!entries.length) return <Notice>{empty}</Notice>;
  const max = Math.max(...entries.map(entry => entry[1])) || 1;
  return <div className="dw-bars">{entries.slice(0, 8).map(([name, value]) => <div className="dw-bar" key={name}>
    <span className="dw-bar-name" title={name}>{name}</span>
    <span className="dw-bar-track"><i style={{ width: `${Math.max(4, value / max * 100)}%` }} /></span>
    <b>{num(value, 1)}{unit}</b>
  </div>)}</div>;
}

function Tiles({ items }: { items: Array<{ label: string; value: string; note?: string; tone?: 'primary' | 'ok' | 'warn' | 'danger' | 'accent' }> }) {
  return <div className="dw-tiles">{items.map(item => <div className={`dw-tile tone-${item.tone || 'primary'}`} key={item.label}>
    <span>{item.label}</span><b>{item.value}</b>{item.note && <small>{item.note}</small>}
  </div>)}</div>;
}

function MoveList({ moves, empty }: { moves: ItemMove[]; empty: string }) {
  if (!moves.length) return <Notice>{empty}</Notice>;
  return <ul className="dw-moves">{moves.slice(0, 8).map(move => <li key={`${move.market}-${move.item}`}>
    <span>{move.item}<small>{move.market}{move.category}</small></span>
    <b>{num(move.average, 1)}<small>元/公斤</small></b>
    <em className={`dw-change${moveClass(move.changePct)}`}>{signed(move.changePct)}</em>
  </li>)}</ul>;
}

function DateNote({ live }: { live: DashboardLiveState }) {
  return live.market ? <p className="dw-foot">交易日 {live.market.latest_date}（比較 {live.market.previous_date}）</p> : null;
}

function renderWidget(widgetKey: string, live: DashboardLiveState): React.ReactNode {
  const requests = live.requests || [];
  const orders = live.orders || [];
  const stats = computeRepairStats(requests, orders);
  const market = live.market;

  switch (widgetKey) {
    // ---- 報修／工單 ----
    case 'alerts':
      return <Tiles items={[
        { label: '已逾期', value: num(stats.overdue), tone: stats.overdue ? 'danger' : 'ok' },
        { label: '待派工', value: num(stats.waitDispatch), tone: stats.waitDispatch ? 'warn' : 'ok' },
        { label: '本月報修', value: num(requests.length) },
        { label: '已完成工單', value: num(stats.doneCount), tone: 'ok' },
      ]} />;
    case 'kpis':
      return <Tiles items={[
        { label: '今日新增', value: num(stats.todayNew) },
        { label: '今日完成', value: num(stats.todayDone), tone: 'ok' },
        { label: '處理中', value: num(stats.inProgress) },
        { label: 'SLA', value: stats.sla == null ? '—' : `${stats.sla}%`, tone: 'warn' },
        { label: 'MTTR', value: stats.mttr == null ? '—' : `${stats.mttr.toFixed(1)}h` },
        { label: 'MTBF', value: stats.mtbf == null ? '—' : `${stats.mtbf.toFixed(1)}d`, tone: 'accent' },
        { label: '本月', value: num(stats.monthCount), tone: 'ok' },
      ]} />;
    case 'repairs': {
      const counts = countBy(requests, row => REPAIR_STATUS_LABEL[String(row.status)] || '未知狀態');
      return <>
        <Tiles items={[
          { label: '本月報修', value: num(requests.length) },
          { label: '未結案', value: num(stats.openCount), tone: stats.openCount ? 'warn' : 'ok' },
          { label: '完工率', value: stats.completionRate == null ? '—' : `${stats.completionRate}%`, tone: 'ok' },
        ]} />
        <BarList entries={counts} empty="本月沒有報修案件" />
      </>;
    }
    case 'sla_compliance':
      return <Tiles items={[
        { label: 'SLA 達標率', value: stats.sla == null ? '—' : `${stats.sla}%`, note: `已完成 ${stats.doneCount} 張工單`, tone: 'ok' },
        { label: 'MTTR', value: stats.mttr == null ? '—' : `${stats.mttr.toFixed(1)} 小時`, note: '開工到完工平均' },
        { label: '逾期件數', value: num(stats.overdue), tone: stats.overdue ? 'danger' : 'ok' },
      ]} />;
    case 'realtime_incident_map': {
      const open = requests.filter(row => OPEN_REQUEST.includes(String(row.status)));
      return <BarList entries={countBy(open, row => row.fault_location || (row.equipment as Row)?.location || '未填位置')} empty="目前沒有未結報修案件" />;
    }
    case 'rank_dept': return <BarList entries={countBy(requests, row => row.department)} empty="本月沒有報修案件" />;
    case 'rank_equipment': return <BarList entries={countBy(requests, row => (row.equipment as Row)?.name || '未綁定設備')} empty="本月沒有報修案件" />;
    case 'rank_technician': return <BarList entries={countBy(orders, row => (row.users as Row)?.name || '未指派')} empty="目前沒有維修工單" />;
    case 'rank_fault': return <BarList entries={countBy(requests, row => row.fault_type || '未分類')} empty="本月沒有報修案件" />;
    case 'trend': {
      if (!live.trend) return <Notice tone="error">{live.errors.trend || '月趨勢統計尚未載入'}</Notice>;
      const data = { labels: live.trend.map(m => m.label), datasets: [{ label: '報修件數', data: live.trend.map(m => m.value), borderColor: CHART_SERIES[0], backgroundColor: 'rgba(2,132,199,0.12)', borderWidth: 2, fill: true, tension: 0.35 }] };
      return <div className="dw-chart"><Line data={data} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: chartScales }} /></div>;
    }

    // ---- 巡邏 ----
    case 'patrol': {
      const patrol = live.patrol;
      if (!patrol) return null;
      return <>
        <Tiles items={[
          { label: '當班', value: patrol.shift || '目前無進行中班別' },
          { label: '已打卡', value: num(patrol.done), tone: 'ok' },
          { label: '未打卡', value: num(Math.max(patrol.points - patrol.done, 0)), tone: patrol.points > patrol.done ? 'warn' : 'ok' },
          { label: '巡邏點', value: num(patrol.points) },
        ]} />
        <BarList entries={patrol.floors} empty="今日所有巡邏點都已完成打卡" />
      </>;
    }
    case 'staff_duty_matrix': {
      const shifts = live.patrol?.shifts || [];
      if (!shifts.length) return <Notice>今日沒有巡邏排班</Notice>;
      return <ul className="dw-shifts">{shifts.map(shift => <li key={`${shift.name}-${shift.time}`} className={shift.current ? 'is-current' : ''}>
        <b>{shift.name}</b><span>{shift.time}</span>{shift.current && <em>當班中</em>}
      </li>)}</ul>;
    }

    // ---- 設備 ----
    case 'equipment_status': {
      if (!live.equipment) return null;
      const result = computeEquipmentReadiness(live.equipment, requests);
      return <>
        <Tiles items={[
          { label: '設備妥善率', value: result.readiness == null ? '—' : `${result.readiness}%`, tone: 'ok' },
          { label: '啟用設備', value: num(result.active) },
          { label: '有未結報修', value: num(result.withOpenRepair), tone: result.withOpenRepair ? 'warn' : 'ok' },
        ]} />
        <BarList entries={result.byCategory} empty="所有啟用設備都沒有未結報修" />
      </>;
    }

    // ---- 天氣 ----
    case 'weather_taiwan':
    case 'weather_risk_radar':
    case 'origin_weather_map':
      return <WeatherWidget />;

    // ---- 市場行情 ----
    case 'trading_kpi': {
      if (!market) return null;
      const totals = computeMarketTotals(market);
      return <>
        <Tiles items={[
          { label: '總成交量', value: `${num(totals.quantity / 1000, 1)} 公噸`, note: `較前日 ${signed(totals.quantityChange)}` },
          { label: '量加權均價', value: `${num(totals.averagePrice, 1)} 元/公斤`, note: `較前日 ${signed(totals.priceChange)}`, tone: 'ok' },
          { label: '成交品項', value: num(totals.itemCount), tone: 'accent' },
        ]} />
        <DateNote live={live} />
      </>;
    }
    case 'price_comparison': {
      if (!market) return null;
      const groups = computeGroupComparison(market);
      if (!groups.length) return <Notice>最新交易日沒有分類行情</Notice>;
      const data = {
        labels: groups.map(group => group.label),
        datasets: [
          { label: market.previous_date, data: groups.map(group => group.previous), backgroundColor: CHART_SERIES[3], borderRadius: 4 },
          { label: market.latest_date, data: groups.map(group => group.current), backgroundColor: CHART_SERIES[0], borderRadius: 4 },
        ],
      };
      return <div className="dw-chart"><Bar data={data} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' as const, labels: { color: 'gray' } } }, scales: chartScales }} /></div>;
    }
    case 'weekly_trend':
    case 'historical_price_curve': {
      if (!market) return null;
      // 看板資料的趨勢約含近 24 個交易日：週趨勢只取最近 7 個，歷史曲線畫全部。
      const points = widgetKey === 'weekly_trend' ? market.trend.slice(-7) : market.trend;
      if (!points.length) return <Notice>沒有近期交易日資料</Notice>;
      const labels = points.map(point => point.observed_on.slice(5));
      const data = widgetKey === 'weekly_trend'
        ? { labels, datasets: [{ label: '成交量（公噸）', data: points.map(point => Math.round(point.quantity / 100) / 10), backgroundColor: CHART_SERIES[1], borderRadius: 4 }] }
        : { labels, datasets: [{ label: '均價（元/公斤）', data: points.map(point => point.average_price), borderColor: CHART_SERIES[2], backgroundColor: 'rgba(217,119,6,0.12)', borderWidth: 2, fill: true, tension: 0.3 }] };
      return <div className="dw-chart">{widgetKey === 'weekly_trend'
        ? <Bar data={data as never} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: chartScales }} />
        : <Line data={data as never} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: chartScales }} />}</div>;
    }
    case 'market_turnover': {
      if (!market) return null;
      const points = computeTurnoverTrend(market).slice(-8);
      if (!points.length) return <Notice>沒有近期交易日資料</Notice>;
      const data = { labels: points.map(point => point.date.slice(5)), datasets: [{ label: '成交總額估算（萬元）', data: points.map(point => point.value == null ? null : Math.round(point.value / 1000) / 10), borderColor: CHART_SERIES[1], backgroundColor: 'rgba(5,150,105,0.12)', borderWidth: 2, fill: true, tension: 0.3 }] };
      return <><div className="dw-chart"><Line data={data} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: chartScales }} /></div>
        <p className="dw-foot">估算方式：每日成交量 × 量加權均價（萬元）</p></>;
    }
    case 'commodity_ratio': {
      if (!market) return null;
      const share = computeCategoryShare(market);
      if (!share.length) return <Notice>最新交易日沒有成交量</Notice>;
      const data = { labels: share.map(entry => entry[0]), datasets: [{ data: share.map(entry => entry[1]), backgroundColor: [...CHART_SERIES], borderWidth: 0 }] };
      return <div className="dw-chart"><Doughnut data={data} options={{ responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right' as const, labels: { color: 'gray' } } } }} /></div>;
    }
    case 'public_price_board':
      return market ? <><MoveList moves={computeItemMoves(market)} empty="最新交易日沒有品項行情" /><DateNote live={live} /></> : null;
    case 'price_volatility':
      return market ? <><MoveList moves={computeVolatileItems(computeItemMoves(market))} empty="沒有單日漲跌超過 15% 的品項" /><DateNote live={live} /></> : null;
    case 'consumer_guide_board': {
      if (!market) return null;
      const falling = computeItemMoves(market).filter(move => move.changePct != null && move.changePct < 0)
        .sort((a, b) => (a.changePct as number) - (b.changePct as number));
      return <><MoveList moves={falling} empty="最新交易日沒有均價下跌的品項" /><DateNote live={live} /></>;
    }
    case 'top_gainers_losers': {
      if (!market) return null;
      const top = computeTopMovers(computeItemMoves(market));
      return <div className="dw-split">
        <section><h3>漲幅前三</h3><MoveList moves={top.gainers} empty="沒有上漲品項" /></section>
        <section><h3>跌幅前三</h3><MoveList moves={top.losers} empty="沒有下跌品項" /></section>
      </div>;
    }
    case 'realtime_ticker': {
      if (!market) return null;
      const moves = computeItemMoves(market).filter(move => move.changePct != null);
      if (!moves.length) return <Notice>最新交易日沒有可比較的品項</Notice>;
      return <div className="dw-ticker" aria-label="品項漲跌輪播"><div className="dw-ticker-track">
        {[...moves, ...moves].map((move, index) => <span key={`${move.item}-${index}`} className={`dw-change${moveClass(move.changePct)}`}>
          {move.item} {num(move.average, 1)} 元 {signed(move.changePct)}
        </span>)}
      </div></div>;
    }

    default:
      return null;
  }
}

export function DashboardWidgetContent({ widgetKey, desc }: { widgetKey: string; desc?: string }) {
  const definition = DASHBOARD_WIDGET_CATALOG[widgetKey];
  const dataSource = definition?.dataSource || 'unavailable';
  const sources = SOURCES[dataSource];
  const live = useDashboardLiveData(sources);

  if (!definition) return <Notice tone="error">未知的版面元件：{widgetKey}</Notice>;
  if (dataSource === 'unavailable') {
    return <div className="dw-unavailable"><b>尚未介接資料來源</b><span>{desc || definition.desc}</span></div>;
  }
  const errors = sources.map(source => live.errors[source]).filter(Boolean);
  if (errors.length) return <Notice tone="error">{errors.join('；')}</Notice>;
  // 資料還沒回來前不計算，避免先閃一輪全是 0 的畫面被誤認為真實數字。
  const ready = sources.every(source => (
    source === 'repair' ? live.requests != null
      : source === 'patrol' ? live.patrol != null
        : source === 'equipment' ? live.equipment != null
          : live.market != null));
  const content = ready ? renderWidget(widgetKey, live) : null;
  if (content == null) {
    const loading = sources.some(source => live.loading[source] !== false);
    return <Notice>{loading ? '資料載入中…' : '目前沒有資料'}</Notice>;
  }
  return <div className="dw-body">{content}</div>;
}
