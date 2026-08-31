'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { MarketMovementBadge } from '@/components/MarketMovementBadge';
import { marketMovementPresentation } from '@/lib/market-movement';
import { invokeCachedAppApi } from '@/lib/supabase';
import './dashboard-market-prices.css';
import './dashboard-market-carousel.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

type FeedSource = {
  source_id: string;
  source_code: string;
  source_name: string;
};

type FeedCard = {
  key: string;
  market: string;
  category: string;
  item: string;
  configured: boolean;
  price: number | null;
  previous_price: number | null;
  quantity: number | null;
  high_price: number | null;
  low_price: number | null;
  trend?: TrendData;
};

type FeedGroup = {
  key: string;
  market: string;
  category: string;
  cards: FeedCard[];
};

type CardsFeed = {
  source: FeedSource;
  latest_date: string;
  previous_date: string;
  auto_step_seconds: number;
  refresh_seconds: number;
  cards_per_slide: number;
  cards_per_group: number;
  groups: FeedGroup[];
};

type SeriesPoint = {
  observed_on: string;
  compare_observed_on?: string | null;
  values?: Record<string, number | null>;
  compare_values?: Record<string, number | null>;
};

type TrendData = {
  periods?: {
    from: string;
    to: string;
    compare_from: string;
    compare_to: string;
  };
  series?: SeriesPoint[];
};

type Slide = {
  key: string;
  market: string;
  category: string;
  cards: FeedCard[];
};

const DEFAULT_STEP_SECONDS = 3.5;
const DEFAULT_REFRESH_SECONDS = 300;
const MINIMUM_REFRESH_SECONDS = 300;
const FEED_CACHE_TTL_MS = 4 * 60 * 1000;

const numberText = (value: unknown, digits = 1) => (
  value == null || !Number.isFinite(Number(value))
    ? '—'
    : Number(value).toLocaleString('zh-TW', { maximumFractionDigits: digits })
);

const percentChange = (current: number | null, previous: number | null) => (
  current == null || previous == null || previous === 0
    ? null
    : (current - previous) / Math.abs(previous) * 100
);

const boundedNumber = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

const chunks = <T,>(values: T[], size: number) => (
  Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size))
);

const chartColors = () => {
  if (typeof window === 'undefined') {
    return { text: '#64748b', line: '#cbd5e1', current: '#0284c7', compare: '#d97706' };
  }
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    text: read('--dim', '#64748b'),
    line: read('--line', '#cbd5e1'),
    current: read('--cyan', '#0284c7'),
    compare: read('--amber', '#d97706'),
  };
};

function feedToSlides(feed: CardsFeed): Slide[] {
  const cardsPerSlide = Math.round(boundedNumber(feed.cards_per_slide, 4, 1, 8));
  return (feed.groups || []).flatMap(group => {
    const pages = group.cards.length ? chunks(group.cards, cardsPerSlide) : [[]];
    return pages.map((cards, index) => ({
      key: group.key + '::' + index,
      market: group.market,
      category: group.category,
      cards,
    }));
  });
}

export function DashboardMarketCarousel() {
  const [feed, setFeed] = useState<CardsFeed | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [focusIndex, setFocusIndex] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [colors, setColors] = useState(chartColors);
  const loadingRef = useRef(false);

  const loadCards = useCallback(async (force = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError('');
    try {
      const nextFeed = await invokeCachedAppApi<CardsFeed>(
        'dashboard_market_rotation',
        { view: 'cards' },
        { ttlMs: FEED_CACHE_TTL_MS, force },
      );
      const nextSlides = feedToSlides(nextFeed);
      setFeed(nextFeed);
      setSlides(nextSlides);
      setPageIndex(index => nextSlides.length ? index % nextSlides.length : 0);
      setFocusIndex(0);
      setUpdatedAt(new Date().toLocaleTimeString('zh-TW', { hour12: false }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '蔬果行情輪播載入失敗');
    } finally {
      loadingRef.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadCards();
  }, [loadCards]);

  const configuredRefreshSeconds = Math.round(boundedNumber(feed?.refresh_seconds, DEFAULT_REFRESH_SECONDS, 15, 86400));
  const refreshSeconds = Math.max(MINIMUM_REFRESH_SECONDS, configuredRefreshSeconds);
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (!document.hidden) void loadCards();
    };
    const timer = window.setInterval(refreshWhenVisible, refreshSeconds * 1000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [loadCards, refreshSeconds]);

  useEffect(() => {
    const refreshColors = () => setColors(chartColors());
    const observer = new MutationObserver(refreshColors);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const activeSlide = slides[pageIndex] || null;
  const activeCard = activeSlide?.cards[focusIndex] || activeSlide?.cards[0] || null;
  const trend = activeCard?.trend || null;
  const autoStepSeconds = boundedNumber(feed?.auto_step_seconds, DEFAULT_STEP_SECONDS, 2, 30);
  const autoStepMs = Math.round(autoStepSeconds * 1000);

  useEffect(() => {
    if (!activeSlide || !slides.length) return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setFocusIndex(index => {
        if (activeSlide.cards.length && index + 1 < activeSlide.cards.length) return index + 1;
        setPageIndex(page => (page + 1) % slides.length);
        return 0;
      });
    }, autoStepMs);
    return () => window.clearInterval(timer);
  }, [activeSlide, autoStepMs, slides.length]);

  const lineData = useMemo(() => ({
    labels: (trend?.series || []).map(point => point.observed_on.slice(5).replace('-', '/')),
    datasets: [
      {
        label: '近 7 日平均價',
        data: (trend?.series || []).map(point => point.values?.average_price ?? null),
        borderColor: colors.current,
        backgroundColor: colors.current,
        borderWidth: 3,
        pointRadius: 3,
        tension: .28,
        spanGaps: true,
      },
      {
        label: '前 7 日平均價',
        data: (trend?.series || []).map(point => point.compare_values?.average_price ?? null),
        borderColor: colors.compare,
        backgroundColor: colors.compare,
        borderWidth: 2,
        borderDash: [7, 5],
        pointRadius: 2,
        tension: .28,
        spanGaps: true,
      },
    ],
  }), [trend, colors]);

  const lineOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    events: [],
    animation: { duration: 650 },
    plugins: {
      legend: { position: 'top' as const, labels: { color: colors.text, usePointStyle: true } },
      tooltip: { enabled: false },
    },
    scales: {
      x: {
        grid: { color: colors.line },
        ticks: { color: colors.text },
        title: { display: true, text: '交易日期（X 軸）', color: colors.text },
      },
      y: {
        grid: { color: colors.line },
        ticks: { color: colors.text },
        title: { display: true, text: '加權平均價（元／公斤，Y 軸）', color: colors.text },
      },
    },
  }), [colors]);

  const style = { '--market-auto-step': autoStepMs + 'ms' } as CSSProperties;
  return <div className="dashboard-market-prices market-carousel" style={style}>
    <div className="market-price-heading">
      <div>
        <h3>蔬果品項行情自動輪播</h3>
        <p>{feed ? feed.source.source_name + '｜資料日 ' + feed.latest_date + '｜前一交易日 ' + feed.previous_date : '正在讀取最新匯入行情'}</p>
      </div>
      <div className="market-carousel-live">
        <i aria-hidden="true" />
        <b>自動播放中</b>
        <span>每 {Math.round(refreshSeconds / 60)} 分鐘檢查新資料{updatedAt ? '・' + updatedAt : ''}</span>
      </div>
    </div>

    {error && <div className="notice danger" role="status">{error}</div>}
    {busy && !activeSlide ? <p className="empty">蔬果品項行情載入中…</p> : activeSlide ? <>
      <div className="market-carousel-status">
        <b>{activeSlide.market}｜{activeSlide.category}</b>
        <span>第 {pageIndex + 1}／{slides.length} 組</span>
        <div className="market-carousel-progress"><i key={pageIndex + '-' + focusIndex} /></div>
      </div>

      {activeSlide.cards.length ? <div className="vegetable-price-grid market-carousel-cards">
        {activeSlide.cards.map((card, index) => {
          const change = percentChange(card.price, card.previous_price);
          const movement = marketMovementPresentation(change);
          const cardClass = 'vegetable-price-card market-card-' + movement.tone + (index === focusIndex ? ' selected current' : '');
          return <article className={cardClass} key={card.key}>
            <span className="vegetable-card-top">
              <b title={card.item}>{card.item}</b>
              <small>{card.market}／{card.category}</small>
            </span>
            {card.configured && <span className="market-carousel-fixed">後台固定</span>}
            <strong>{numberText(card.price)}<small>元／公斤</small></strong>
            <MarketMovementBadge value={change} />
            <span className="vegetable-card-previous">前一交易日 {numberText(card.previous_price)} 元／公斤</span>
            <span className="vegetable-card-volume">成交量 {numberText(card.quantity, 0)} 公斤</span>
            <span className="vegetable-card-range">上價 {numberText(card.high_price)}｜下價 {numberText(card.low_price)}</span>
          </article>;
        })}
      </div> : <div className="market-carousel-group-empty">
        <b>{activeSlide.market}／{activeSlide.category}</b>
        <span>最新交易日目前沒有可顯示的行情，系統仍會繼續輪播下一群組。</span>
      </div>}

      <div className="market-carousel-dots" aria-label="輪播進度">
        {slides.map((slide, index) => <span className={index === pageIndex ? 'active' : ''} key={slide.key} />)}
      </div>

      {activeCard ? <section className="market-week-analysis market-carousel-trend">
        <div className="market-week-heading">
          <div><span>同步輪播｜單品近一週走勢</span><h3>{activeCard.item}<small>・{activeCard.market}／{activeCard.category}</small></h3></div>
          <div className="market-focus-price"><small>最新加權平均價</small><b>{numberText(activeCard.price)} 元／公斤</b></div>
        </div>
        <p className="market-axis-guide"><b>圖例：</b>實線為近 7 日，虛線為前 7 日；X 軸是交易日期，Y 軸是成交量加權平均價。休市日保留空白，不補成 0。</p>
        {trend?.periods && <p className="market-week-period">近 7 日 {trend.periods.from}～{trend.periods.to}　｜　前 7 日 {trend.periods.compare_from}～{trend.periods.compare_to}</p>}
        <div className="market-week-chart">
          {trend?.series?.length ? <Line data={lineData} options={lineOptions} /> : <p className="empty">此品項目前沒有足夠的一週行情。</p>}
        </div>
      </section> : <section className="market-week-analysis market-carousel-trend market-carousel-no-trend">
        <p className="empty">此群組暫無單品行情，下一輪會自動切換到其他市場與大類。</p>
      </section>}
    </> : <p className="empty">目前沒有可輪播的市場交易行情，請先到資料介接中心匯入資料。</p>}
  </div>;
}
