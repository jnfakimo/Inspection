// 戰情元件共用的統計口徑（2026-10-15 自 dashboard-client.tsx 抽出）。
// 戰情儀表板、電視牆與後台版面預覽都用這裡的函式，數字才會一致。
// 這裡只做純計算，不查資料庫；查詢在 lib/dashboard-live-data.ts。

export type Row = Record<string, any>;
type Numeric = number | null;

export const DONE_ORDER = ['completed', 'closed'];
export const OPEN_REQUEST = ['pending', 'transferred', 'assigned', 'in_progress', 'waiting_parts', 'waiting_vendor', 'pending_review', 'overdue', 'returned', 'rejected'];
export const IN_PROGRESS_ORDER = ['accepted', 'in_progress', 'waiting_parts', 'waiting_vendor', 'assigned'];
export const REPAIR_STATUS_LABEL: Record<string, string> = {
  pending: '待派工', transferred: '已轉派', assigned: '已派工', accepted: '已接單',
  in_progress: '維修中', waiting_parts: '等待料件', waiting_vendor: '等待廠商',
  pending_review: '待驗收', completed: '已完成', closed: '已結案',
  returned: '已退回', rejected: '已拒絕', cancelled: '已取消', overdue: '已逾期',
};

export const taipeiDate = (value: unknown) => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};

export const countBy = (rows: Row[], pick: (row: Row) => unknown): Array<[string, number]> => {
  const map: Record<string, number> = {};
  rows.forEach(row => { const key = String(pick(row) ?? '') || '未填'; map[key] = (map[key] || 0) + 1; });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
};

export const average = (list: number[]) => list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;

export type RepairStats = {
  todayNew: number; todayDone: number; inProgress: number; overdue: number; waitDispatch: number;
  monthCount: number; doneCount: number; sla: number | null; mttr: number | null; mtbf: number | null;
  openCount: number; completionRate: number | null;
};

/** 報修／工單統計，與戰情儀表板同一口徑。 */
export function computeRepairStats(requests: Row[], orders: Row[], now = new Date()): RepairStats {
  const day = taipeiDate(now)!, month = day.slice(0, 7);
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
  const openCount = requests.filter(row => OPEN_REQUEST.includes(String(row.status))).length;
  const closedRequests = requests.filter(row => DONE_ORDER.includes(String(row.status))).length;
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
    openCount,
    completionRate: requests.length ? Math.round(closedRequests / requests.length * 100) : null,
  };
}

export type EquipmentReadiness = { active: number; withOpenRepair: number; readiness: number | null; byCategory: Array<[string, number]> };

/** 設備妥善率：啟用中的設備裡，沒有未結報修的比例。 */
export function computeEquipmentReadiness(equipment: Row[], requests: Row[]): EquipmentReadiness {
  const active = equipment.filter(row => String(row.status || 'active') === 'active');
  const openIds = new Set(requests.filter(row => OPEN_REQUEST.includes(String(row.status)) && row.equipment_id).map(row => String(row.equipment_id)));
  const withOpen = active.filter(row => openIds.has(String(row.equipment_id)));
  return {
    active: active.length,
    withOpenRepair: withOpen.length,
    readiness: active.length ? Math.round((active.length - withOpen.length) / active.length * 1000) / 10 : null,
    byCategory: countBy(withOpen, row => row.category || '未分類'),
  };
}

// ---- 市場行情（app-api dashboard_market_rotation view:'board' 的回傳） ----

type GroupValues = { average_price: Numeric; quantity: Numeric; total_value: Numeric };
type Cell = { prev_avg: Numeric; avg: Numeric; change: Numeric; change_pct: Numeric; quantity: Numeric };
export type MarketFeed = {
  latest_date: string;
  previous_date: string;
  markets: string[];
  groups_summary: Array<{ market: string; category: string; current: GroupValues; previous: GroupValues }>;
  table: { markets: string[]; rows: Array<{ item: string; category: string; cells: Record<string, Partial<Cell> | undefined> }> };
  trend: Array<{ observed_on: string; quantity: number; average_price: Numeric }>;
};

const finite = (value: unknown): number | null => (value == null || !Number.isFinite(Number(value)) ? null : Number(value));

export const percentChange = (current: Numeric, previous: Numeric) => (
  current == null || previous == null || previous === 0 ? null : Math.round((current - previous) / Math.abs(previous) * 1000) / 10
);

function weighted(groups: GroupValues[]) {
  let qty = 0, value = 0;
  groups.forEach(group => {
    const q = finite(group.quantity), p = finite(group.average_price);
    if (q == null || p == null) return;
    qty += q; value += q * p;
  });
  return { quantity: qty, averagePrice: qty ? value / qty : null };
}

export type MarketTotals = {
  latestDate: string; previousDate: string;
  quantity: number; previousQuantity: number; quantityChange: number | null;
  averagePrice: number | null; previousAveragePrice: number | null; priceChange: number | null;
  itemCount: number;
};

/** 最新與前一交易日的總成交量、量加權均價與有成交的品項數。 */
export function computeMarketTotals(feed: MarketFeed): MarketTotals {
  const current = weighted(feed.groups_summary.map(group => group.current));
  const previous = weighted(feed.groups_summary.map(group => group.previous));
  const itemCount = feed.table.rows.filter(row => Object.values(row.cells || {}).some(cell => finite(cell?.avg) != null)).length;
  return {
    latestDate: feed.latest_date, previousDate: feed.previous_date,
    quantity: current.quantity, previousQuantity: previous.quantity,
    quantityChange: percentChange(current.quantity, previous.quantity),
    averagePrice: current.averagePrice, previousAveragePrice: previous.averagePrice,
    priceChange: percentChange(current.averagePrice, previous.averagePrice),
    itemCount,
  };
}

/** 各市場、各大類本日與前一交易日均價。 */
export function computeGroupComparison(feed: MarketFeed) {
  return feed.groups_summary.map(group => ({
    label: `${group.market}${group.category}`,
    current: finite(group.current.average_price),
    previous: finite(group.previous.average_price),
    change: percentChange(finite(group.current.average_price), finite(group.previous.average_price)),
  }));
}

/** 最新交易日各大類成交量佔比（百分比，一位小數）。 */
export function computeCategoryShare(feed: MarketFeed): Array<[string, number]> {
  const map: Record<string, number> = {};
  feed.groups_summary.forEach(group => {
    const q = finite(group.current.quantity);
    if (q != null) map[group.category] = (map[group.category] || 0) + q;
  });
  const total = Object.values(map).reduce((a, b) => a + b, 0);
  if (!total) return [];
  return Object.entries(map).map(([key, value]) => [key, Math.round(value / total * 1000) / 10] as [string, number]).sort((a, b) => b[1] - a[1]);
}

export type ItemMove = { item: string; category: string; market: string; average: number; changePct: number | null };

/** 各品項在第一個有成交的市場的均價與漲跌幅。 */
export function computeItemMoves(feed: MarketFeed): ItemMove[] {
  const markets = feed.table.markets.length ? feed.table.markets : feed.markets;
  const moves: ItemMove[] = [];
  feed.table.rows.forEach(row => {
    for (const market of markets) {
      const cell = row.cells?.[market];
      const avg = finite(cell?.avg);
      if (avg == null) continue;
      moves.push({ item: row.item, category: row.category, market, average: avg, changePct: finite(cell?.change_pct) });
      break;
    }
  });
  return moves;
}

export function computeTopMovers(moves: ItemMove[], count = 3) {
  const ranked = moves.filter(move => move.changePct != null);
  return {
    gainers: ranked.filter(move => (move.changePct as number) > 0).sort((a, b) => (b.changePct as number) - (a.changePct as number)).slice(0, count),
    losers: ranked.filter(move => (move.changePct as number) < 0).sort((a, b) => (a.changePct as number) - (b.changePct as number)).slice(0, count),
  };
}

/** 單日漲跌幅絕對值達門檻（預設 15%）的品項。 */
export function computeVolatileItems(moves: ItemMove[], threshold = 15) {
  return moves.filter(move => move.changePct != null && Math.abs(move.changePct) >= threshold)
    .sort((a, b) => Math.abs(b.changePct as number) - Math.abs(a.changePct as number));
}

/** 成交總額估算：每個交易日的成交量 × 量加權均價。 */
export function computeTurnoverTrend(feed: MarketFeed) {
  return feed.trend.map(point => {
    const avg = finite(point.average_price), qty = finite(point.quantity);
    return { date: point.observed_on, value: avg == null || qty == null ? null : Math.round(avg * qty) };
  });
}
