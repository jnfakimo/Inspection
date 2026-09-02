'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import { MarketMovementBadge } from '@/components/MarketMovementBadge';
import './market-board.css';

ChartJS.register(BarController, BarElement, CategoryScale, Filler, Legend, LineController, LineElement, LinearScale, PointElement, Tooltip);

type Numeric = number | null;
type GroupSummaryValues = { average_price: Numeric; quantity: Numeric; total_value: Numeric };
type GroupSummary = { market: string; category: string; current: GroupSummaryValues; previous: GroupSummaryValues };
type TableCell = {
  prev_avg: Numeric; avg: Numeric; change: Numeric; change_pct: Numeric;
  high: Numeric; middle: Numeric; low: Numeric; quantity: Numeric;
};
type TableRow = { item: string; category: string; cells: Record<string, TableCell | undefined> };
type TrendPoint = { observed_on: string; quantity: number; average_price: Numeric };
type BoardNotice = { title: string; body: string; created_at: string };
export type MarketBoardFeed = {
  source: { source_id: string; source_code: string; source_name: string };
  latest_date: string;
  previous_date: string;
  auto_step_seconds: number;
  refresh_seconds: number;
  markets: string[];
  categories: string[];
  groups_summary: GroupSummary[];
  table: { markets: string[]; rows: TableRow[] };
  trend: TrendPoint[];
  notices: BoardNotice[];
};

const MINIMUM_REFRESH_SECONDS = 300;
const TABLE_ROWS_PER_PAGE = 14;

const numberText = (value: unknown, digits = 1) => (
  value == null || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString('zh-TW', { maximumFractionDigits: digits })
);

const signedText = (value: unknown, digits = 2) => {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const parsed = Number(value);
  return `${parsed > 0 ? '+' : ''}${parsed.toLocaleString('zh-TW', { maximumFractionDigits: digits })}`;
};

const percentChange = (current: Numeric, previous: Numeric) => (
  current == null || previous == null || previous === 0 ? null : (current - previous) / Math.abs(previous) * 100
);

const bounded = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

function chartColors() {
  if (typeof window === 'undefined') return { text: '#7893aa', line: '#173952', bar: 'rgba(0,212,255,.4)', barBorder: '#00d4ff', price: '#ffb300' };
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const cyan = read('--cyan', '#00d4ff');
  return {
    text: read('--dim', '#7893aa'),
    line: read('--line', '#173952'),
    bar: `color-mix(in srgb, ${cyan} 38%, transparent)`,
    barBorder: cyan,
    price: read('--amber', '#ffb300'),
  };
}

export function useProjection(active: boolean) {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (active) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, [active]);
}

export function ProjectionButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onToggle(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, onToggle]);
  return <button type="button" className="secondary-btn compact" onClick={onToggle}>
    {active ? '結束公開播放' : '全螢幕公開播放'}
  </button>;
}

function BoardMarquee({ notices }: { notices: BoardNotice[] }) {
  if (!notices.length) return null;
  const items = notices.map((notice, index) => (
    <span key={`${index}-${notice.created_at}`}>
      {notice.title && <b>{notice.title}</b>}
      {notice.body || notice.title}
    </span>
  ));
  const duration = Math.max(28, Math.min(120, notices.length * 9));
  return <div className="market-board-marquee" style={{ '--market-board-marquee-duration': `${duration}s` } as CSSProperties} aria-label="看板即時訊息">
    <div>{items}{items}</div>
  </div>;
}

function GroupCard({ label, group }: { label: string; group: GroupSummary | undefined }) {
  const priceChange = percentChange(group?.current.average_price ?? null, group?.previous.average_price ?? null);
  const volumeChange = percentChange(group?.current.quantity ?? null, group?.previous.quantity ?? null);
  return <div className="market-board-group">
    <b>{label}</b>
    <dl>
      <div><dt>當日均價</dt><dd>{numberText(group?.current.average_price)}<small>元／公斤</small></dd></div>
      <div><dt>昨日均價</dt><dd>{numberText(group?.previous.average_price)}<small>元／公斤</small></dd></div>
      <div><dt>當日成交量</dt><dd>{numberText(group?.current.quantity, 0)}<small>公斤</small></dd></div>
      <div><dt>昨日成交量</dt><dd>{numberText(group?.previous.quantity, 0)}<small>公斤</small></dd></div>
    </dl>
    <div className="market-board-group-moves">
      <span>均價 <MarketMovementBadge value={priceChange} /></span>
      <span>成交量 <MarketMovementBadge value={volumeChange} /></span>
    </div>
  </div>;
}

function TrendChart({ points }: { points: TrendPoint[] }) {
  const [colors, setColors] = useState(chartColors);
  useEffect(() => {
    const refresh = () => setColors(chartColors());
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  const data = useMemo(() => ({
    labels: points.map(point => point.observed_on.slice(5).replace('-', '/')),
    datasets: [
      {
        type: 'bar' as const,
        label: '成交量（公斤）',
        data: points.map(point => point.quantity),
        backgroundColor: colors.bar,
        borderColor: colors.barBorder,
        borderWidth: 1,
        borderRadius: 4,
        yAxisID: 'quantity',
      },
      {
        type: 'line' as const,
        label: '加權平均價（元／公斤）',
        data: points.map(point => point.average_price),
        borderColor: colors.price,
        backgroundColor: colors.price,
        borderWidth: 3,
        pointRadius: 3,
        tension: .28,
        spanGaps: true,
        yAxisID: 'price',
      },
    ],
  }), [points, colors]);
  const options = useMemo<ChartOptions<'bar' | 'line'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { position: 'top', labels: { color: colors.text, usePointStyle: true } },
      tooltip: { callbacks: { label: context => `${context.dataset.label || ''}：${numberText(context.parsed.y, 1)}` } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: colors.text }, title: { display: true, text: '交易日期（X 軸）', color: colors.text } },
      quantity: { beginAtZero: true, position: 'left', grid: { color: colors.line }, ticks: { color: colors.text }, title: { display: true, text: '成交量（Y 軸左）', color: colors.text } },
      price: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { color: colors.text }, title: { display: true, text: '加權平均價（Y 軸右）', color: colors.text } },
    },
  }), [colors]);
  if (!points.length) return <p className="market-board-empty">近 7 個交易日尚無可繪製的量價資料。</p>;
  return <div className="market-board-trend-canvas"><Chart type="bar" data={data} options={options} /></div>;
}

function BoardTable({ table, page }: { table: MarketBoardFeed['table']; page: number }) {
  const markets = table.markets;
  const totalPages = Math.max(1, Math.ceil(table.rows.length / TABLE_ROWS_PER_PAGE));
  const safePage = ((page % totalPages) + totalPages) % totalPages;
  const rows = table.rows.slice(safePage * TABLE_ROWS_PER_PAGE, safePage * TABLE_ROWS_PER_PAGE + TABLE_ROWS_PER_PAGE);
  return <>
    <div className="market-board-table-scroll">
      <table className="market-board-table">
        <thead>
          <tr>
            <th className="market-board-col-item" rowSpan={2}>品項</th>
            {markets.map(market => <th key={market} colSpan={7}>{market}</th>)}
          </tr>
          <tr>
            {markets.map(market => [
              <th key={`${market}-prev`} className="market-board-cell-sep">昨日均價</th>,
              <th key={`${market}-avg`}>當日均價</th>,
              <th key={`${market}-change`}>漲跌</th>,
              <th key={`${market}-pct`}>漲跌幅</th>,
              <th key={`${market}-high`}>上價</th>,
              <th key={`${market}-middle`}>中價</th>,
              <th key={`${market}-low`}>下價</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => <tr key={`${row.category}::${row.item}`}>
            <th scope="row">{row.item}<small>{row.category}</small></th>
            {markets.map(market => {
              const cell = row.cells[market];
              const direction = cell && cell.change != null ? (cell.change > 0 ? 'rise' : cell.change < 0 ? 'fall' : 'steady') : undefined;
              return [
                <td key={`${market}-prev`} className="market-board-cell-sep">{numberText(cell?.prev_avg)}</td>,
                <td key={`${market}-avg`}>{numberText(cell?.avg)}</td>,
                <td key={`${market}-change`} className="market-board-cell-change" data-direction={direction}>{signedText(cell?.change)}</td>,
                <td key={`${market}-pct`} className="market-board-cell-change" data-direction={direction}>{cell?.change_pct == null ? '—' : `${signedText(cell.change_pct, 2)}%`}</td>,
                <td key={`${market}-high`}>{numberText(cell?.high)}</td>,
                <td key={`${market}-middle`}>{numberText(cell?.middle)}</td>,
                <td key={`${market}-low`}>{numberText(cell?.low)}</td>,
              ];
            })}
          </tr>)}
        </tbody>
      </table>
    </div>
    {totalPages > 1 && <div className="market-board-table-dots" aria-label={`全場均價分頁 ${safePage + 1}／${totalPages}`}>
      {Array.from({ length: totalPages }, (_, index) => <span key={index} className={index === safePage ? 'active' : ''} />)}
    </div>}
  </>;
}

/**
 * SYS-12 長官戰情看板的呈現主體。資料載入由外部注入（登入版走 app-api，
 * 公開版走 market_board_public），因此登入頁與 /board/ 公開頁共用同一份畫面。
 */
export function MarketExecutiveBoard({ title, subtitle, loadFeed, headerExtra, variant = 'panel' }: {
  title: string;
  subtitle?: string;
  loadFeed: (force: boolean) => Promise<MarketBoardFeed>;
  headerExtra?: ReactNode;
  variant?: 'panel' | 'public';
}) {
  const [feed, setFeed] = useState<MarketBoardFeed | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [tablePage, setTablePage] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const loadingRef = useRef(false);
  useProjection(fullscreen);

  const load = useCallback(async (force = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError('');
    try {
      const next = await loadFeed(force);
      setFeed(next);
      setUpdatedAt(new Date().toLocaleTimeString('zh-TW', { hour12: false }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '市場公開看板載入失敗');
    } finally {
      loadingRef.current = false;
      setBusy(false);
    }
  }, [loadFeed]);

  useEffect(() => { void load(); }, [load]);

  const refreshSeconds = Math.max(MINIMUM_REFRESH_SECONDS, Math.round(bounded(feed?.refresh_seconds, MINIMUM_REFRESH_SECONDS, 15, 86400)));
  useEffect(() => {
    const refreshWhenVisible = () => { if (!document.hidden) void load(); };
    const timer = window.setInterval(refreshWhenVisible, refreshSeconds * 1000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [load, refreshSeconds]);

  const rows = feed?.table?.rows || [];
  const totalPages = Math.max(1, Math.ceil(rows.length / TABLE_ROWS_PER_PAGE));
  const stepMs = Math.round(Math.max(6, bounded(feed?.auto_step_seconds, 3.5, 2, 30) * 2) * 1000);
  useEffect(() => {
    if (totalPages <= 1) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setTablePage(page => (page + 1) % totalPages);
    }, stepMs);
    return () => window.clearInterval(timer);
  }, [stepMs, totalPages]);
  useEffect(() => { setTablePage(0); }, [feed?.latest_date]);

  const groupByKey = useMemo(() => {
    const map = new Map<string, GroupSummary>();
    for (const group of feed?.groups_summary || []) map.set(`${group.market}::${group.category}`, group);
    return map;
  }, [feed]);

  const markets = feed?.markets?.length ? feed.markets : ['第一市場', '第二市場'];
  const categories = feed?.categories?.length ? feed.categories : ['蔬菜', '水果'];
  const staleFeed = Boolean(feed) && !Array.isArray(feed?.groups_summary);

  return <div className={`market-board-page market-board-${variant}`} data-fullscreen={fullscreen}>
    <div className="market-board-head">
      <div>
        <h2>{title}</h2>
        <p>{feed
          ? `${feed.source.source_name}｜資料日 ${feed.latest_date}｜前一交易日 ${feed.previous_date}`
          : (subtitle || '正在讀取最新匯入行情')}</p>
      </div>
      <div className="market-board-head-actions">
        <span className="market-board-live"><i aria-hidden="true" /><b>自動更新中</b>每 {Math.round(refreshSeconds / 60)} 分鐘檢查{updatedAt ? `・${updatedAt}` : ''}</span>
        {headerExtra}
        <ProjectionButton active={fullscreen} onToggle={() => setFullscreen(value => !value)} />
      </div>
    </div>

    <div className="market-board-legend" aria-label="行情方向圖例">
      <b>行情方向</b>
      <span data-direction="rise"><i>▲</i>上漲（紅）</span>
      <span data-direction="fall"><i>▼</i>下跌（綠）</span>
      <span><i>—</i>持平</span>
      <small>相較前一交易日；非漲停／跌停</small>
    </div>

    {error && <div className="notice danger" role="status">{error}</div>}
    {staleFeed && <p className="market-board-stale"><b>看板資料整備中</b>：後端行情彙總服務尚未更新到最新版本，請稍後重新整理或聯絡系統管理員部署 app-api。</p>}

    {feed && <BoardMarquee notices={feed.notices || []} />}

    {busy && !feed ? <p className="market-board-empty">市場公開看板載入中…</p> : feed && !staleFeed ? <>
      <div className="market-board-markets">
        {markets.map(market => <section className="market-board-market" key={market}>
          <h3>{market}</h3>
          <div className="market-board-market-groups">
            {categories.map(category => <GroupCard key={category} label={`${category}總計`} group={groupByKey.get(`${market}::${category}`)} />)}
          </div>
        </section>)}
      </div>

      <section className="market-board-trend">
        <h3>量價趨勢</h3>
        <p>近 7 個交易日的每日成交量（長條）與整體加權平均價（折線）。</p>
        <TrendChart points={feed.trend || []} />
      </section>

      <section className="market-board-table-panel">
        <div className="market-board-table-head">
          <h3>全場均價</h3>
          <span>共 {rows.length} 個品項{totalPages > 1 ? `・每 ${Math.round(stepMs / 1000)} 秒輪播一頁` : ''}</span>
        </div>
        {rows.length
          ? <BoardTable table={feed.table} page={tablePage} />
          : <p className="market-board-empty">最新交易日尚無可顯示的品項行情。</p>}
      </section>
    </> : null}
  </div>;
}
