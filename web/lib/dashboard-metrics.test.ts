import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeCategoryShare, computeEquipmentReadiness, computeGroupComparison, computeItemMoves, computeMarketTotals,
  computeRepairStats, computeTopMovers, computeTurnoverTrend, computeVolatileItems, countBy, type MarketFeed,
} from './dashboard-metrics.ts';
import { DASHBOARD_WIDGET_CATALOG } from './dashboard-widget-catalog.ts';

const now = new Date('2026-10-15T04:00:00Z'); // 臺北 12:00

test('報修統計與戰情儀表板同一口徑', () => {
  const requests = [
    { request_id: 'r1', equipment_id: 'e1', status: 'pending', created_at: '2026-10-15T01:00:00Z', desired_finish: '2026-10-14T00:00:00Z' },
    { request_id: 'r2', equipment_id: 'e1', status: 'completed', created_at: '2026-10-05T01:00:00Z' },
    { request_id: 'r3', equipment_id: 'e2', status: 'in_progress', created_at: '2026-09-20T01:00:00Z' },
  ];
  const orders = [
    { status: 'completed', start_time: '2026-10-15T00:00:00Z', finish_time: '2026-10-15T02:00:00Z', expected_finish: '2026-10-15T03:00:00Z' },
    { status: 'closed', start_time: '2026-10-10T00:00:00Z', finish_time: '2026-10-10T06:00:00Z', expected_finish: '2026-10-10T01:00:00Z' },
    { status: 'in_progress', expected_finish: '2026-10-14T00:00:00Z' },
  ];
  const stats = computeRepairStats(requests, orders, now);
  assert.equal(stats.todayNew, 1);
  assert.equal(stats.todayDone, 1);
  assert.equal(stats.inProgress, 1);
  assert.equal(stats.overdue, 2); // 一張逾期工單 + 一件逾期未結報修
  assert.equal(stats.waitDispatch, 1);
  assert.equal(stats.monthCount, 2);
  assert.equal(stats.sla, 50);
  assert.equal(stats.mttr, 4);
  assert.equal(stats.mtbf, 10);
  assert.equal(stats.openCount, 2);
  assert.equal(stats.completionRate, 33);
});

test('沒有資料時不產生數字', () => {
  const stats = computeRepairStats([], [], now);
  assert.equal(stats.sla, null);
  assert.equal(stats.mttr, null);
  assert.equal(stats.completionRate, null);
  assert.deepEqual(countBy([], row => row.x), []);
});

test('設備妥善率只計啟用設備，未結報修才算異常', () => {
  const equipment = [
    { equipment_id: 'e1', status: 'active', category: '冷凍' },
    { equipment_id: 'e2', status: 'active', category: '電力' },
    { equipment_id: 'e3', status: 'retired', category: '電力' },
    { equipment_id: 'e4', status: 'active', category: '冷凍' },
  ];
  const requests = [
    { equipment_id: 'e1', status: 'pending' },
    { equipment_id: 'e2', status: 'completed' },
    { equipment_id: 'e3', status: 'pending' },
  ];
  const result = computeEquipmentReadiness(equipment, requests);
  assert.equal(result.active, 3);
  assert.equal(result.withOpenRepair, 1);
  assert.equal(result.readiness, 66.7);
  assert.deepEqual(result.byCategory, [['冷凍', 1]]);
  assert.equal(computeEquipmentReadiness([], []).readiness, null);
});

const feed: MarketFeed = {
  latest_date: '2026-10-15',
  previous_date: '2026-10-14',
  markets: ['一市', '二市'],
  groups_summary: [
    { market: '一市', category: '蔬菜', current: { quantity: 100, average_price: 30, total_value: null }, previous: { quantity: 80, average_price: 25, total_value: null } },
    { market: '一市', category: '水果', current: { quantity: 50, average_price: 60, total_value: null }, previous: { quantity: 70, average_price: 50, total_value: null } },
    { market: '二市', category: '蔬菜', current: { quantity: 50, average_price: null, total_value: null }, previous: { quantity: 50, average_price: 20, total_value: null } },
  ],
  table: {
    markets: ['一市', '二市'],
    rows: [
      { item: '甘藍', category: '蔬菜', cells: { 一市: { avg: 20, change_pct: 25 }, 二市: { avg: 18, change_pct: 5 } } },
      { item: '番茄', category: '蔬菜', cells: { 一市: { avg: null }, 二市: { avg: 40, change_pct: -20 } } },
      { item: '香蕉', category: '水果', cells: { 一市: { avg: 35, change_pct: 3 } } },
      { item: '芒果', category: '水果', cells: { 一市: { avg: null } } },
    ],
  },
  trend: [
    { observed_on: '2026-10-14', quantity: 200, average_price: 30 },
    { observed_on: '2026-10-15', quantity: 150, average_price: null },
  ],
};

test('行情總量與量加權均價', () => {
  const totals = computeMarketTotals(feed);
  assert.equal(totals.quantity, 150); // 二市蔬菜缺均價，不計入加權
  assert.equal(totals.averagePrice, 40);
  assert.equal(totals.previousQuantity, 200);
  assert.equal(totals.previousAveragePrice, 32.5);
  assert.equal(totals.quantityChange, -25);
  assert.equal(totals.priceChange, 23.1);
  assert.equal(totals.itemCount, 3);
});

test('大類比較、佔比與品項漲跌', () => {
  assert.deepEqual(computeGroupComparison(feed)[0], { label: '一市蔬菜', current: 30, previous: 25, change: 20 });
  assert.deepEqual(computeCategoryShare(feed), [['蔬菜', 75], ['水果', 25]]);
  const moves = computeItemMoves(feed);
  assert.deepEqual(moves.map(move => `${move.item}@${move.market}`), ['甘藍@一市', '番茄@二市', '香蕉@一市']);
  const top = computeTopMovers(moves, 2);
  assert.deepEqual(top.gainers.map(move => move.item), ['甘藍', '香蕉']);
  assert.deepEqual(top.losers.map(move => move.item), ['番茄']);
  assert.deepEqual(computeVolatileItems(moves).map(move => move.item), ['甘藍', '番茄']);
  assert.deepEqual(computeTurnoverTrend(feed), [{ date: '2026-10-14', value: 6000 }, { date: '2026-10-15', value: null }]);
});

test('元件清單完整，沒有資料來源的元件明確標示', () => {
  const keys = Object.keys(DASHBOARD_WIDGET_CATALOG);
  assert.equal(keys.length, 32);
  const unavailable = keys.filter(key => DASHBOARD_WIDGET_CATALOG[key].dataSource === 'unavailable').sort();
  assert.deepEqual(unavailable, ['auction_efficiency', 'cctv_ipcam_grid', 'floor_congestion', 'market_allocation', 'supplier_ranking']);
  for (const key of unavailable) assert.match(DASHBOARD_WIDGET_CATALOG[key].desc, /尚未介接/);
});

test('戰情元件不得再顯示模擬數字，且每個有資料來源的元件都有實作', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../components/DashboardWidgetContent.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /setInterval|Math\.random|\btick\b/, '元件內容不得用計時器或亂數產生數字');
  for (const [key, definition] of Object.entries(DASHBOARD_WIDGET_CATALOG)) {
    if (definition.dataSource === 'unavailable') continue;
    assert.match(source, new RegExp(`case '${key}':`), `${key} 缺少真實資料實作`);
  }
});
