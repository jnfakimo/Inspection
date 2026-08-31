'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { MarketMovementBadge } from '@/components/MarketMovementBadge';
import { marketMovementPresentation } from '@/lib/market-movement';
import { invokeAppApi } from '@/lib/supabase';
import './dashboard-market-prices.css';
import './dashboard-market-carousel.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

type Source = { source_id: string; source_code: string; source_name: string; config?: Record<string, unknown> };
type Catalog = { sources?: Source[] };
type DimensionCatalog = { options?: Record<string, Array<{ value: string; count: number }>> };
type AnalysisRow = { dimensions?: Record<string, string>; values?: Record<string, number | null>; compare_values?: Record<string, number | null> };
type SeriesPoint = { observed_on: string; compare_observed_on?: string | null; values?: Record<string, number | null>; compare_values?: Record<string, number | null> };
type Analysis = { rows?: AnalysisRow[]; series?: SeriesPoint[]; periods?: { from: string; to: string; compare_from: string; compare_to: string } };
type Card = { key: string; item: string; market: string; price: number; previousPrice: number | null; quantity: number | null; highPrice: number | null; lowPrice: number | null };
type Slide = { key: string; market: string; cards: Card[] };
type Setup = { sourceId: string; sourceName: string; latestDate: string; previousDate: string };

const AUTO_STEP_MS = 3500;
const DATA_REFRESH_MS = 60000;
const CARDS_PER_SLIDE = 4;
const CARDS_PER_MARKET = 12;

const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const configOf = (source: Source) => source.config && typeof source.config === 'object' ? source.config : {};
const numberText = (value: unknown, digits = 1) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('zh-TW', { maximumFractionDigits: digits });
const percentChange = (current: number | null, previous: number | null) => current == null || previous == null || previous === 0 ? null : (current - previous) / Math.abs(previous) * 100;
const shiftDate = (value: string, offset: number) => { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };
const chunks = <T,>(values: T[], size: number) => Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));

const chartColors = () => {
  if (typeof window === 'undefined') return { text: '#64748b', line: '#cbd5e1', current: '#0284c7', compare: '#d97706' };
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return { text: read('--dim', '#64748b'), line: read('--line', '#cbd5e1'), current: read('--cyan', '#0284c7'), compare: read('--amber', '#d97706') };
};

function rowsToCards(rows: AnalysisRow[], market: string): Card[] {
  return rows.flatMap((row): Card[] => {
    const item = String(row.dimensions?.item || '').trim();
    const rowMarket = market || String(row.dimensions?.market || '').trim();
    const price = row.values?.average_price;
    if (!item || price == null || !Number.isFinite(Number(price))) return [];
    const numeric = (value: unknown) => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
    return [{
      key: `${rowMarket}::${item}`,
      item,
      market: rowMarket,
      price: Number(price),
      previousPrice: numeric(row.compare_values?.average_price),
      quantity: numeric(row.values?.quantity),
      highPrice: numeric(row.values?.high_price),
      lowPrice: numeric(row.values?.low_price),
    }];
  }).sort((left, right) => (right.quantity || 0) - (left.quantity || 0));
}

export function DashboardMarketCarousel() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [focusIndex, setFocusIndex] = useState(0);
  const [trend, setTrend] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(true);
  const [trendBusy, setTrendBusy] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [colors, setColors] = useState(chartColors);
  const loadingRef = useRef(false);
  const trendCache = useRef(new Map<string, Analysis>());

  useEffect(() => {
    const refreshColors = () => setColors(chartColors());
    const observer = new MutationObserver(refreshColors);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (!slides.length) setBusy(true);
      setError('');
      try {
        const catalog = await invokeAppApi<Catalog>('market_catalog');
        const sources = catalog.sources || [];
        const source = sources.find(item => configOf(item).is_default === true && configOf(item).is_actual === true)
          || sources.find(item => item.source_code !== 'market_demo' && configOf(item).is_demo !== true)
          || sources[0];
        if (!source) throw new Error('尚未設定可用的市場行情資料來源');
        const sourceConfig = configOf(source);
        const latestDate = String(sourceConfig.latest_observed_on || sourceConfig.default_to || '');
        const previousDate = String(sourceConfig.default_compare_from || sourceConfig.default_compare_to || '');
        if (!validDate(latestDate) || !validDate(previousDate)) throw new Error('市場行情尚未建立可比較的交易日期');

        let markets: string[] = [];
        try {
          const dimensions = await invokeAppApi<DimensionCatalog>('market_dimension_catalog', { source_id: source.source_id, filters: { category: '蔬菜' } });
          markets = (dimensions.options?.market || []).map(item => item.value).filter(Boolean);
        } catch {
          // 目錄暫時失效時仍由分析結果的 market 維度分組，不停止戰情輪播。
        }

        let cardsByMarket: Array<{ market: string; cards: Card[] }> = [];
        if (markets.length) {
          cardsByMarket = await Promise.all(markets.map(async market => {
            const analysis = await invokeAppApi<Analysis>('market_analysis', {
              source_id: source.source_id, from: latestDate, to: latestDate,
              compare_from: previousDate, compare_to: previousDate,
              dimensions: ['item'], filters: { category: '蔬菜', market },
              measures: ['quantity', 'average_price', 'high_price', 'low_price'],
            });
            return { market, cards: rowsToCards(analysis.rows || [], market).slice(0, CARDS_PER_MARKET) };
          }));
        } else {
          const analysis = await invokeAppApi<Analysis>('market_analysis', {
            source_id: source.source_id, from: latestDate, to: latestDate,
            compare_from: previousDate, compare_to: previousDate,
            dimensions: ['market', 'item'], filters: { category: '蔬菜' },
            measures: ['quantity', 'average_price', 'high_price', 'low_price'],
          });
          const grouped = new Map<string, Card[]>();
          rowsToCards(analysis.rows || [], '').forEach(card => grouped.set(card.market, [...(grouped.get(card.market) || []), card]));
          cardsByMarket = [...grouped].map(([market, cards]) => ({ market, cards: cards.slice(0, CARDS_PER_MARKET) }));
        }

        const nextSlides = cardsByMarket.flatMap(group => chunks(group.cards, CARDS_PER_SLIDE).map((cards, index) => ({ key: `${group.market}-${index}`, market: group.market, cards })));
        if (cancelled) return;
        setSetup(current => {
          if (current?.sourceId !== source.source_id || current?.latestDate !== latestDate) trendCache.current.clear();
          return { sourceId: source.source_id, sourceName: source.source_name, latestDate, previousDate };
        });
        setSlides(nextSlides);
        setUpdatedAt(new Date().toLocaleTimeString('zh-TW', { hour12: false }));
        setPageIndex(index => nextSlides.length ? index % nextSlides.length : 0);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '蔬菜行情輪播載入失敗');
      } finally {
        loadingRef.current = false;
        if (!cancelled) setBusy(false);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), DATA_REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
    // 只建立一次輪詢；load 內以 state setter 接收最新狀態，避免每次輪播重建資料計時器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeSlide = slides[pageIndex] || null;
  const activeCard = activeSlide?.cards[focusIndex] || activeSlide?.cards[0] || null;

  useEffect(() => {
    if (!activeSlide?.cards.length || !slides.length) return;
    const timer = window.setInterval(() => {
      setFocusIndex(index => {
        if (index + 1 < activeSlide.cards.length) return index + 1;
        setPageIndex(page => (page + 1) % slides.length);
        return 0;
      });
    }, AUTO_STEP_MS);
    return () => window.clearInterval(timer);
  }, [activeSlide, slides.length]);

  useEffect(() => {
    if (!setup || !activeCard) { setTrend(null); return; }
    let cancelled = false;
    const cacheKey = `${setup.sourceId}|${setup.latestDate}|${activeCard.key}`;
    const cached = trendCache.current.get(cacheKey);
    if (cached) { setTrend(cached); setTrendBusy(false); return; }
    void (async () => {
      setTrendBusy(true);
      try {
        const currentFrom = shiftDate(setup.latestDate, -6);
        const compareTo = shiftDate(currentFrom, -1);
        const analysis = await invokeAppApi<Analysis>('market_analysis', {
          source_id: setup.sourceId, from: currentFrom, to: setup.latestDate,
          compare_from: shiftDate(compareTo, -6), compare_to: compareTo,
          dimensions: [], filters: { category: '蔬菜', market: activeCard.market, item: activeCard.item },
          measures: ['average_price', 'quantity', 'high_price', 'low_price'],
        });
        trendCache.current.set(cacheKey, analysis);
        if (!cancelled) setTrend(analysis);
      } catch {
        if (!cancelled) setTrend(null);
      } finally {
        if (!cancelled) setTrendBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [setup, activeCard]);

  const lineData = useMemo(() => ({
    labels: (trend?.series || []).map(point => point.observed_on.slice(5).replace('-', '/')),
    datasets: [
      { label: '近 7 日平均價', data: (trend?.series || []).map(point => point.values?.average_price ?? null), borderColor: colors.current, backgroundColor: colors.current, borderWidth: 3, pointRadius: 3, tension: .28, spanGaps: true },
      { label: '前 7 日平均價', data: (trend?.series || []).map(point => point.compare_values?.average_price ?? null), borderColor: colors.compare, backgroundColor: colors.compare, borderWidth: 2, borderDash: [7, 5], pointRadius: 2, tension: .28, spanGaps: true },
    ],
  }), [trend, colors]);

  const lineOptions = useMemo(() => ({
    responsive: true, maintainAspectRatio: false, events: [], animation: { duration: 650 },
    plugins: { legend: { position: 'top' as const, labels: { color: colors.text, usePointStyle: true } }, tooltip: { enabled: false } },
    scales: {
      x: { grid: { color: colors.line }, ticks: { color: colors.text }, title: { display: true, text: '交易日期（X 軸）', color: colors.text } },
      y: { grid: { color: colors.line }, ticks: { color: colors.text }, title: { display: true, text: '加權平均價（元／公斤，Y 軸）', color: colors.text } },
    },
  }), [colors]);

  return <div className="dashboard-market-prices market-carousel" aria-live="polite">
    <div className="market-price-heading">
      <div><h3>蔬菜品項行情自動輪播</h3><p>{setup ? `${setup.sourceName}｜資料日 ${setup.latestDate}｜前一交易日 ${setup.previousDate}` : '正在讀取最新匯入行情'}</p></div>
      <div className="market-carousel-live"><i aria-hidden="true" /><b>自動播放中</b><span>每 60 秒檢查新資料{updatedAt ? `・${updatedAt}` : ''}</span></div>
    </div>
    {error && <div className="notice danger">{error}</div>}
    {busy && !activeSlide ? <p className="empty">蔬菜品項行情載入中…</p> : activeSlide ? <>
      <div className="market-carousel-status"><b>{activeSlide.market}</b><span>主要成交品項第 {pageIndex + 1}／{slides.length} 組</span><div className="market-carousel-progress"><i key={`${pageIndex}-${focusIndex}`} /></div></div>
      <div className="vegetable-price-grid market-carousel-cards">
        {activeSlide.cards.map((card, index) => {
          const change = percentChange(card.price, card.previousPrice);
          const movement = marketMovementPresentation(change);
          return <article className={`vegetable-price-card market-card-${movement.tone}${index === focusIndex ? ' selected current' : ''}`} key={card.key}>
            <span className="vegetable-card-top"><b title={card.item}>{card.item}</b><small>{card.market}</small></span>
            <strong>{numberText(card.price)}<small>元／公斤</small></strong><MarketMovementBadge value={change} />
            <span className="vegetable-card-previous">前一交易日 {numberText(card.previousPrice)} 元／公斤</span>
            <span className="vegetable-card-volume">成交量 {numberText(card.quantity, 0)} 公斤</span>
            <span className="vegetable-card-range">上價 {numberText(card.highPrice)}｜下價 {numberText(card.lowPrice)}</span>
          </article>;
        })}
      </div>
      <div className="market-carousel-dots" aria-label="輪播進度">{slides.map((slide, index) => <span className={index === pageIndex ? 'active' : ''} key={slide.key} />)}</div>
      {activeCard && <section className="market-week-analysis market-carousel-trend">
        <div className="market-week-heading"><div><span>同步輪播｜單品近一週走勢</span><h3>{activeCard.item}<small>・{activeCard.market}</small></h3></div><div className="market-focus-price"><small>最新加權平均價</small><b>{numberText(activeCard.price)} 元／公斤</b></div></div>
        <p className="market-axis-guide"><b>圖例：</b>實線為近 7 日，虛線為前 7 日；X 軸是交易日期，Y 軸是成交量加權平均價。休市日保留空白，不補成 0。</p>
        {trend?.periods && <p className="market-week-period">近 7 日 {trend.periods.from}～{trend.periods.to}　｜　前 7 日 {trend.periods.compare_from}～{trend.periods.compare_to}</p>}
        <div className="market-week-chart">{trendBusy ? <p className="empty">正在切換單品走勢…</p> : trend?.series?.length ? <Line data={lineData} options={lineOptions} /> : <p className="empty">此品項目前沒有足夠的一週行情。</p>}</div>
      </section>}
    </> : <p className="empty">目前沒有可輪播的蔬菜交易行情，請先匯入最新資料。</p>}
  </div>;
}
