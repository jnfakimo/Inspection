'use client';

import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Bar, Chart, Doughnut, Line } from 'react-chartjs-2';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { MarketMovementBadge } from '@/components/MarketMovementBadge';
import { invokeAppApi } from '@/lib/supabase';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import './market-interactive-dashboard.css';

ChartJS.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);

type PeriodMode = 'day' | 'week' | 'month' | 'quarter' | 'year';
type BaselineMode = 'previous' | 'year';
type ChartMode = 'combo' | 'trend' | 'bar';
type FieldDefinition = {
  key: string;
  label: string;
  kind: 'dimension' | 'measure';
  unit?: string;
  aggregation?: string;
};
type Source = {
  source_id: string;
  source_code: string;
  source_name: string;
  field_definitions: FieldDefinition[];
  config?: Record<string, unknown>;
};
type AnalysisRow = {
  dimensions: Record<string, string>;
  values: Record<string, number | null>;
  compare_values: Record<string, number | null>;
  changes: Record<string, number | null>;
};
type Analysis = {
  source: { source_id: string; source_name: string };
  fields: FieldDefinition[];
  dimensions: string[];
  measures: string[];
  periods: { from: string; to: string; compare_from: string; compare_to: string };
  totals: { values: Record<string, number | null>; compare_values: Record<string, number | null> };
  counts: { current: number; compare: number };
  quality?: {
    latest_observed_on?: string | null;
    total_group_count?: number;
    returned_group_count?: number;
    groups_truncated?: boolean;
  };
  series?: Array<{
    observed_on: string;
    compare_observed_on?: string | null;
    values: Record<string, number | null>;
    compare_values: Record<string, number | null>;
  }>;
  rows: AnalysisRow[];
};
type DimensionCatalog = Record<string, Array<{ value: string; count: number }>>;
type ChartTheme = { text: string; dim: string; line: string; panel: string };

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const PERIOD_LABELS: Record<PeriodMode, string> = { day: '日', week: '週', month: '月', quarter: '季', year: '年' };
const CHART_LABELS: Record<ChartMode, string> = { combo: '價量疊圖', trend: '價格走勢', bar: '交易量比較' };
const KNOWN_FIELD_LABELS: Record<string, string> = {
  market: '市場',
  category: '蔬果大類',
  item: '品項',
  quantity: '成交量',
  average_price: '成交量加權平均價',
  total_value: '推估成交額',
  high_price: '上價',
  middle_price: '中價',
  low_price: '下價',
};
const PALETTE = ['#0284c7', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d', '#db2777'];

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + amount);
  return isoDate(date);
}
function daysBetween(from: string, to: string) {
  return Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1);
}
function periodRange(anchor: string, mode: PeriodMode) {
  const date = new Date(`${anchor}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return { from: anchor, to: anchor };
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  if (mode === 'day') return { from: anchor, to: anchor };
  if (mode === 'week') {
    const start = new Date(date);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    return { from: isoDate(start), to: addDays(isoDate(start), 6) };
  }
  if (mode === 'month') {
    return {
      from: `${year}-${String(month + 1).padStart(2, '0')}-01`,
      to: isoDate(new Date(Date.UTC(year, month + 1, 0))),
    };
  }
  if (mode === 'quarter') {
    const firstMonth = Math.floor(month / 3) * 3;
    return {
      from: `${year}-${String(firstMonth + 1).padStart(2, '0')}-01`,
      to: isoDate(new Date(Date.UTC(year, firstMonth + 3, 0))),
    };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}
function shiftYear(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const shiftedYear = date.getUTCFullYear() + amount;
  const lastDay = new Date(Date.UTC(shiftedYear, month + 1, 0)).getUTCDate();
  return isoDate(new Date(Date.UTC(shiftedYear, month, Math.min(day, lastDay))));
}
function numberText(value: unknown, fraction = 0) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('zh-TW', { minimumFractionDigits: fraction, maximumFractionDigits: fraction });
}
function finite(value: unknown) {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
}
function percent(current: unknown, compare: unknown) {
  const a = finite(current);
  const b = finite(compare);
  return a === null || b === null || b === 0 ? null : (a - b) / Math.abs(b) * 100;
}
function periodText(from: string, to: string) {
  return from === to ? from : `${from}～${to}`;
}
function fieldLabel(field: FieldDefinition | undefined, key: string) {
  return field?.label || KNOWN_FIELD_LABELS[key] || '自訂欄位';
}
function fieldUnit(field: FieldDefinition | undefined) {
  return field?.unit ? `（${field.unit}）` : '';
}
function rowLabel(row: AnalysisRow, dimension: string) {
  return row.dimensions[dimension] || Object.values(row.dimensions).join('／') || '全部';
}
function preferredOption(options: string[], keywords: string[], fallback: string) {
  return options.find(value => keywords.every(keyword => value.includes(keyword)))
    || options.find(value => keywords.some(keyword => value.includes(keyword)))
    || fallback;
}
function safeCsvCell(value: unknown) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function useChartTheme(): ChartTheme {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setRevision(current => current + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      text: style.getPropertyValue('--text').trim() || '#172033',
      dim: style.getPropertyValue('--dim').trim() || '#64748b',
      line: style.getPropertyValue('--line').trim() || '#cbd5e1',
      panel: style.getPropertyValue('--panel').trim() || '#ffffff',
    };
  }, [revision]);
}

function axisOptions(label: string, theme: ChartTheme): ChartOptions<'bar'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: {
        ticks: { color: theme.dim, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
        title: { display: true, text: 'X 軸：日期或目前下鑽分類', color: theme.dim },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: { color: theme.dim },
        title: { display: true, text: `Y 軸：${label}`, color: theme.dim },
        grid: { color: theme.line },
      },
    },
  };
}

function InteractiveDashboard({
  module,
}: {
  module: ModuleDefinition;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [dimensionOptions, setDimensionOptions] = useState<DimensionCatalog>({});
  const [sourceId, setSourceId] = useState('');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('day');
  const [baseline, setBaseline] = useState<BaselineMode>('previous');
  const [anchor, setAnchor] = useState(TODAY);
  const [market, setMarket] = useState('');
  const [category, setCategory] = useState('');
  const [item, setItem] = useState('');
  const [chartMode, setChartMode] = useState<ChartMode>('combo');
  const [metric, setMetric] = useState('average_price');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const requestSerial = useRef(0);
  const chartTheme = useChartTheme();

  const source = sources.find(candidate => candidate.source_id === sourceId);
  const dimensions = useMemo(
    () => (source?.field_definitions || []).filter(field => field.kind === 'dimension'),
    [source],
  );
  const measures = useMemo(
    () => (source?.field_definitions || []).filter(field => field.kind === 'measure'),
    [source],
  );
  const fieldMap = useMemo(
    () => new Map((analysis?.fields || source?.field_definitions || []).map(field => [field.key, field])),
    [analysis, source],
  );
  const dimensionKeys = useMemo(() => new Set(dimensions.map(field => field.key)), [dimensions]);
  const range = useMemo(() => periodRange(anchor, periodMode), [anchor, periodMode]);
  const compareRange = useMemo(() => {
    const length = daysBetween(range.from, range.to);
    if (baseline === 'year') {
      const from = shiftYear(range.from, -1);
      return { from, to: addDays(from, length - 1) };
    }
    return { from: addDays(range.from, -length), to: addDays(range.to, -length) };
  }, [baseline, range.from, range.to]);
  const filters = useMemo(
    () => Object.fromEntries([
      ['market', market.trim()],
      ['category', category.trim()],
      ['item', item.trim()],
    ].filter(([key, value]) => dimensionKeys.has(key) && Boolean(value))),
    [category, dimensionKeys, item, market],
  );
  const currentDimension = useMemo(() => {
    if (!market && dimensionKeys.has('market')) return 'market';
    if (!category && dimensionKeys.has('category')) return 'category';
    return dimensionKeys.has('item') ? 'item' : dimensions[0]?.key || '';
  }, [category, dimensionKeys, dimensions, market]);
  const requestedMeasures = useMemo(() => {
    const available = new Set(measures.map(field => field.key));
    const preferred = ['quantity', 'average_price', 'total_value', metric].filter(key => available.has(key));
    return [...new Set(preferred.length ? preferred : measures.map(field => field.key))].slice(0, 4);
  }, [measures, metric]);

  const loadCatalog = useCallback(async () => {
    setError('');
    try {
      const result = await invokeAppApi<{ sources: Source[] }>('market_catalog');
      const nextSources = (result.sources || []).filter(
        candidate => candidate.source_code !== 'market_demo' && candidate.config?.is_demo !== true,
      );
      setSources(nextSources);
      const preferred = nextSources.find(candidate => candidate.config?.is_default === true) || nextSources[0];
      if (!preferred) {
        setError('目前沒有可使用的正式市場行情資料來源。');
        return;
      }
      setSourceId(preferred.source_id);
      const latest = String(preferred.config?.latest_observed_on || preferred.config?.default_to || TODAY);
      if (/^\d{4}-\d{2}-\d{2}$/.test(latest)) setAnchor(latest);
      const sourceMeasures = preferred.field_definitions.filter(field => field.kind === 'measure');
      setMetric(current => sourceMeasures.some(field => field.key === current)
        ? current
        : sourceMeasures.find(field => field.key === 'average_price')?.key || sourceMeasures[0]?.key || '');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '市場行情資料來源載入失敗。');
    }
  }, []);

  const loadAnalysis = useCallback(async () => {
    if (!sourceId || !currentDimension || !requestedMeasures.length) return;
    const serial = ++requestSerial.current;
    setBusy(true);
    setError('');
    try {
      const result = await invokeAppApi<Analysis>('market_analysis', {
        source_id: sourceId,
        from: range.from,
        to: range.to,
        compare_from: compareRange.from,
        compare_to: compareRange.to,
        dimensions: [currentDimension],
        measures: requestedMeasures,
        filters,
      });
      if (serial !== requestSerial.current) return;
      setAnalysis(result);
      setUpdatedAt(new Date().toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }));
    } catch (loadError) {
      if (serial === requestSerial.current) {
        setAnalysis(null);
        setError(loadError instanceof Error ? loadError.message : '市場行情分析載入失敗。');
      }
    } finally {
      if (serial === requestSerial.current) setBusy(false);
    }
  }, [compareRange.from, compareRange.to, currentDimension, filters, range.from, range.to, requestedMeasures, sourceId]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => {
    if (!measures.length) return;
    setMetric(current => measures.some(field => field.key === current)
      ? current
      : measures.find(field => field.key === 'average_price')?.key || measures[0].key);
  }, [measures]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (!sourceId) return;
      const linkedFilters: Record<string, string> = {};
      if (market.trim()) linkedFilters.market = market.trim();
      if (category.trim()) linkedFilters.category = category.trim();
      void invokeAppApi<{ options: DimensionCatalog }>('market_dimension_catalog', {
        source_id: sourceId,
        filters: linkedFilters,
      }).then(result => {
        if (active) setDimensionOptions(result.options || {});
      }).catch(() => {
        if (active) setDimensionOptions({});
      });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [category, market, sourceId]);
  useEffect(() => {
    if (!sourceId) return;
    const timer = window.setTimeout(() => void loadAnalysis(), 360);
    return () => window.clearTimeout(timer);
  }, [loadAnalysis, sourceId]);

  const marketValues = useMemo(() => (dimensionOptions.market || []).map(option => option.value), [dimensionOptions]);
  const categoryValues = useMemo(() => (dimensionOptions.category || []).map(option => option.value), [dimensionOptions]);
  const itemValues = useMemo(() => (dimensionOptions.item || []).map(option => option.value), [dimensionOptions]);
  const firstMarket = preferredOption(marketValues, ['第一', '市場'], '第一市場');
  const secondMarket = preferredOption(marketValues, ['第二', '市場'], '第二市場');
  const vegetableCategory = preferredOption(categoryValues, ['蔬菜'], '蔬菜');
  const fruitCategory = preferredOption(categoryValues, ['水果'], '水果');
  const activeMetric = analysis?.measures.includes(metric) ? metric : analysis?.measures[0] || requestedMeasures[0] || '';
  const activeField = fieldMap.get(activeMetric);
  const quantityField = fieldMap.get('quantity');
  const priceField = fieldMap.get('average_price');
  const valueField = fieldMap.get('total_value');
  const rankedRows = useMemo(() => (analysis?.rows || []).map(row => ({
    row,
    label: rowLabel(row, currentDimension),
    current: finite(row.values[activeMetric]) || 0,
    compare: finite(row.compare_values[activeMetric]) || 0,
  })).sort((a, b) => b.current - a.current), [activeMetric, analysis, currentDimension]);
  const topRows = rankedRows.slice(0, 12);
  const shareMeasure = analysis?.measures.includes('quantity') ? 'quantity' : activeMetric;
  const shareField = fieldMap.get(shareMeasure);
  const shareRows = useMemo(() => (analysis?.rows || []).map(row => ({
    label: rowLabel(row, currentDimension),
    value: finite(row.values[shareMeasure]) || 0,
  })).filter(row => row.value > 0).sort((a, b) => b.value - a.value).slice(0, 8), [analysis, currentDimension, shareMeasure]);

  const chooseMarket = (value: string) => {
    setMarket(value);
    setCategory('');
    setItem('');
  };
  const chooseCategory = (value: string) => {
    setCategory(value);
    setItem('');
  };
  const chooseDrill = (value: string) => {
    if (!value || value === '全部') return;
    if (currentDimension === 'market') chooseMarket(value);
    else if (currentDimension === 'category') chooseCategory(value);
    else if (currentDimension === 'item') setItem(value);
  };

  const comboRef = useRef<ChartJS<'bar' | 'line'> | null>(null);
  const barRef = useRef<ChartJS<'bar'> | null>(null);
  const rankingRef = useRef<ChartJS<'bar'> | null>(null);
  const doughnutRef = useRef<ChartJS<'doughnut'> | null>(null);
  const series = analysis?.series || [];
  const useSeries = series.length > 1;
  const chartLabels = useSeries ? series.map(point => point.observed_on.slice(5)) : topRows.map(row => row.label);
  const comboData = {
    labels: chartLabels,
    datasets: [
      {
        type: 'bar' as const,
        label: '成交量',
        data: useSeries
          ? series.map(point => finite(point.values.quantity))
          : topRows.map(row => finite(row.row.values.quantity)),
        backgroundColor: 'rgba(2,132,199,.42)',
        borderColor: PALETTE[0],
        borderWidth: 1,
        borderRadius: 4,
        yAxisID: 'quantity',
      },
      {
        type: 'line' as const,
        label: '成交量加權平均價',
        data: useSeries
          ? series.map(point => finite(point.values.average_price))
          : topRows.map(row => finite(row.row.values.average_price)),
        borderColor: PALETTE[2],
        backgroundColor: PALETTE[2],
        pointRadius: 2,
        tension: .25,
        yAxisID: 'price',
      },
    ],
  };
  const comboOptions: ChartOptions<'bar' | 'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: context => `${context.dataset.label || ''}：${numberText(context.parsed.y, 1)}` } },
    },
    scales: {
      x: {
        ticks: { color: chartTheme.dim, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
        grid: { display: false },
        title: { display: true, text: useSeries ? 'X 軸：交易日期' : `X 軸：${fieldLabel(fieldMap.get(currentDimension), currentDimension)}`, color: chartTheme.dim },
      },
      quantity: {
        beginAtZero: true,
        position: 'left',
        ticks: { color: chartTheme.dim },
        grid: { color: chartTheme.line },
        title: { display: true, text: `Y 軸（左）：${fieldLabel(quantityField, 'quantity')}${fieldUnit(quantityField)}`, color: chartTheme.dim },
      },
      price: {
        beginAtZero: true,
        position: 'right',
        ticks: { color: chartTheme.dim },
        grid: { drawOnChartArea: false },
        title: { display: true, text: `Y 軸（右）：${fieldLabel(priceField, 'average_price')}${fieldUnit(priceField)}`, color: chartTheme.dim },
      },
    },
  };
  const trendData = {
    labels: useSeries ? chartLabels : topRows.map(row => row.label),
    datasets: [
      {
        label: '本期',
        data: useSeries
          ? series.map(point => finite(point.values[activeMetric]))
          : topRows.map(row => row.current),
        borderColor: PALETTE[0],
        backgroundColor: PALETTE[0],
        pointRadius: 2,
        tension: .25,
        spanGaps: false,
      },
      {
        label: '比較期',
        data: useSeries
          ? series.map(point => finite(point.compare_values[activeMetric]))
          : topRows.map(row => row.compare),
        borderColor: PALETTE[3],
        backgroundColor: PALETTE[3],
        borderDash: [7, 5],
        pointRadius: 2,
        tension: .25,
        spanGaps: false,
      },
    ],
  };
  const barData = {
    labels: topRows.map(row => row.label),
    datasets: [
      { label: '本期', data: topRows.map(row => row.current), backgroundColor: PALETTE[0], borderRadius: 4 },
      { label: '比較期', data: topRows.map(row => row.compare), backgroundColor: PALETTE[3], borderRadius: 4 },
    ],
  };
  const rankingData = {
    labels: topRows.map(row => row.label),
    datasets: [{ label: fieldLabel(activeField, activeMetric), data: topRows.map(row => row.current), backgroundColor: PALETTE[1], borderRadius: 4 }],
  };
  const shareData = {
    labels: shareRows.map(row => row.label),
    datasets: [{ data: shareRows.map(row => row.value), backgroundColor: PALETTE, borderColor: chartTheme.panel, borderWidth: 2 }],
  };

  const exportCsv = () => {
    if (!analysis) return;
    const measureKeys = analysis.measures;
    const headers = [
      ...analysis.dimensions.map(key => fieldLabel(fieldMap.get(key), key)),
      ...measureKeys.flatMap(key => [
        `本期${fieldLabel(fieldMap.get(key), key)}`,
        `比較期${fieldLabel(fieldMap.get(key), key)}`,
      ]),
    ];
    const lines = [
      headers.map(safeCsvCell).join(','),
      ...analysis.rows.map(row => [
        ...analysis.dimensions.map(key => row.dimensions[key] || ''),
        ...measureKeys.flatMap(key => [row.values[key] ?? '', row.compare_values[key] ?? '']),
      ].map(safeCsvCell).join(',')),
    ];
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `市場分析_${range.from}_${range.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const kpis = analysis ? [
    {
      key: 'quantity',
      label: fieldLabel(quantityField, 'quantity'),
      current: analysis.totals.values.quantity,
      compare: analysis.totals.compare_values.quantity,
      unit: quantityField?.unit || '',
      fraction: 0,
    },
    {
      key: 'average_price',
      label: fieldLabel(priceField, 'average_price'),
      current: analysis.totals.values.average_price,
      compare: analysis.totals.compare_values.average_price,
      unit: priceField?.unit || '',
      fraction: 1,
    },
    {
      key: 'total_value',
      label: fieldLabel(valueField, 'total_value'),
      current: analysis.totals.values.total_value,
      compare: analysis.totals.compare_values.total_value,
      unit: valueField?.unit || '',
      fraction: 0,
    },
    {
      key: 'records',
      label: '有效資料筆數',
      current: analysis.counts.current,
      compare: analysis.counts.compare,
      unit: '筆',
      fraction: 0,
    },
  ] : [];

  return <div className="mid-page">
    <section className="panel mid-editorial-header" aria-labelledby="market-interactive-title">
      <div>
        <span>市場情報 · 決策分析</span>
        <h2 id="market-interactive-title">每日市場交易行情</h2>
        <p>{module.description}</p>
      </div>
      <dl>
        <div><dt>資料來源</dt><dd>{source?.source_name || '載入中'}</dd></div>
        <div><dt>資料截止</dt><dd>{analysis?.quality?.latest_observed_on || '—'}</dd></div>
        <div><dt>最後更新</dt><dd>{updatedAt || '—'}</dd></div>
      </dl>
    </section>

    <section className="panel mid-controls" aria-label="市場行情篩選條件">
      <div className="mid-control-grid">
        <label>資料來源
          <select value={sourceId} onChange={event => {
            const nextSourceId = event.target.value;
            const nextSource = sources.find(option => option.source_id === nextSourceId);
            setSourceId(nextSourceId);
            setMarket('');
            setCategory('');
            setItem('');
            setDimensionOptions({});
            setAnalysis(null);
            if (nextSource) {
              const latest = String(nextSource.config?.latest_observed_on || nextSource.config?.default_to || TODAY);
              if (/^\d{4}-\d{2}-\d{2}$/.test(latest)) setAnchor(latest);
              const nextMeasures = nextSource.field_definitions.filter(field => field.kind === 'measure');
              setMetric(current => nextMeasures.some(field => field.key === current)
                ? current
                : nextMeasures.find(field => field.key === 'average_price')?.key || nextMeasures[0]?.key || '');
            }
          }}>
            <option value="">選擇正式資料來源</option>
            {sources.map(option => <option key={option.source_id} value={option.source_id}>{option.source_name}</option>)}
          </select>
        </label>
        <label>基準日期
          <LocalizedDateInput aria-label="市場分析基準日期（年/月/日）" value={anchor} onChange={event => setAnchor(event.target.value)} />
        </label>
        <label>比較基準
          <select value={baseline} onChange={event => setBaseline(event.target.value as BaselineMode)}>
            <option value="previous">前一段同日數期間</option>
            <option value="year">去年同期（同日數）</option>
          </select>
        </label>
        <label>判讀指標
          <select value={metric} onChange={event => setMetric(event.target.value)}>
            {measures.map(field => <option key={field.key} value={field.key}>{field.label}{fieldUnit(field)}</option>)}
          </select>
        </label>
        <button type="button" className="primary-btn" disabled={busy || !sourceId} onClick={() => void loadAnalysis()}>
          {busy ? '分析中…' : '更新分析'}
        </button>
      </div>

      <div className="mid-period-row" role="group" aria-label="行情期間">
        <b>行情期間</b>
        {(Object.entries(PERIOD_LABELS) as Array<[PeriodMode, string]>).map(([key, label]) =>
          <button key={key} type="button" className={periodMode === key ? 'active' : ''} aria-pressed={periodMode === key} onClick={() => setPeriodMode(key)}>{label}</button>,
        )}
        <span>{periodText(range.from, range.to)}　對照 {periodText(compareRange.from, compareRange.to)}</span>
      </div>

      <div className="mid-quick-filter">
        <div role="group" aria-label="市場快速篩選">
          <b>市場</b>
          {[['', '全部'], [firstMarket, '第一市場'], [secondMarket, '第二市場']].map(([value, label]) =>
            <button key={label} type="button" className={market === value ? 'active' : ''} aria-pressed={market === value} onClick={() => chooseMarket(value)}>{label}</button>,
          )}
        </div>
        <div role="group" aria-label="蔬果大類快速篩選">
          <b>蔬果</b>
          {[['', '全部'], [vegetableCategory, '蔬菜'], [fruitCategory, '水果']].map(([value, label]) =>
            <button key={label} type="button" className={category === value ? 'active' : ''} aria-pressed={category === value} onClick={() => chooseCategory(value)}>{label}</button>,
          )}
        </div>
      </div>

      <div className="mid-slicers">
        <label>市場（可輸入）
          <input list="mid-market-options" value={market} onChange={event => {
            setMarket(event.target.value);
            setCategory('');
            setItem('');
          }} placeholder="全部市場" />
          <datalist id="mid-market-options">{marketValues.map(value => <option key={value} value={value} />)}</datalist>
        </label>
        <label>蔬果大類（可輸入）
          <input list="mid-category-options" value={category} onChange={event => {
            setCategory(event.target.value);
            setItem('');
          }} placeholder="全部蔬果" />
          <datalist id="mid-category-options">{categoryValues.map(value => <option key={value} value={value} />)}</datalist>
        </label>
        <label>品項（依市場與蔬果連動）
          <input list="mid-item-options" value={item} onChange={event => setItem(event.target.value)} placeholder="例如 高麗菜、香蕉" />
          <datalist id="mid-item-options">{itemValues.map(value => <option key={value} value={value} />)}</datalist>
          <small>選項由目前正式資料動態產生，不使用固定品項清單。</small>
        </label>
      </div>
    </section>

    <nav className="mid-drill-path" aria-label="行情下鑽路徑">
      <b>下鑽路徑</b>
      <button type="button" onClick={() => { setMarket(''); setCategory(''); setItem(''); }}>整體行情</button>
      {market && <><span>›</span><button type="button" onClick={() => { setCategory(''); setItem(''); }}>{market}</button></>}
      {category && <><span>›</span><button type="button" onClick={() => setItem('')}>{category}</button></>}
      {item && <><span>›</span><strong>{item}</strong></>}
      <small>點選排行、圓餅、長條圖或明細列，可往下一層查看。</small>
    </nav>

    {error && <div className="notice danger mid-message" role="alert">{error}</div>}
    {busy && <div className="mid-loading" role="status" aria-live="polite"><i />正在依篩選條件重新彙整行情…</div>}
    {analysis && <>
      {analysis.quality?.groups_truncated && <div className="notice warning mid-message">分類結果較多，目前顯示 {numberText(analysis.quality.returned_group_count)}／{numberText(analysis.quality.total_group_count)} 組；請縮小篩選範圍再做完整判讀。</div>}
      <section className="mid-kpis" aria-label="核心營運指標">
        {kpis.map(kpi => <article key={kpi.key}>
          <span>{kpi.label}</span>
          <strong>{numberText(kpi.current, kpi.fraction)}<small>{kpi.unit}</small></strong>
          <p><span>比較期 {numberText(kpi.compare, kpi.fraction)}</span><MarketMovementBadge value={percent(kpi.current, kpi.compare)} /></p>
        </article>)}
      </section>

      <section className="panel mid-main-chart" aria-labelledby="mid-main-chart-title">
        <header>
          <div><span>本期與比較期</span><h3 id="mid-main-chart-title">{CHART_LABELS[chartMode]}</h3><p>圖例與軸線均使用實際市場資料；休市日不補零。</p></div>
          <div role="group" aria-label="主要圖表切換">
            {(Object.entries(CHART_LABELS) as Array<[ChartMode, string]>).map(([key, label]) =>
              <button key={key} type="button" className={chartMode === key ? 'active' : ''} aria-pressed={chartMode === key} onClick={() => setChartMode(key)}>{label}</button>,
            )}
          </div>
        </header>
        <div className="mid-chart-legend" aria-label="圖例">
          {chartMode === 'combo' ? <>
            <span><i className="volume" />成交量（左軸）</span>
            <span><i className="price" />成交量加權平均價（右軸）</span>
          </> : <>
            <span><i className="current" />本期</span>
            <span><i className="compare" />比較期</span>
          </>}
          <small>{useSeries ? 'X 軸為交易日期' : `X 軸為${fieldLabel(fieldMap.get(currentDimension), currentDimension)}`}</small>
        </div>
        <div className="mid-chart-canvas">
          {chartMode === 'combo' && <Chart ref={comboRef} type="bar" data={comboData} options={comboOptions} onClick={event => {
            if (useSeries) return;
            const points = comboRef.current?.getElementsAtEventForMode(event.nativeEvent, 'nearest', { intersect: true }, true) || [];
            const index = points[0]?.index;
            if (index !== undefined) chooseDrill(topRows[index]?.label || '');
          }} />}
          {chartMode === 'trend' && <Line data={trendData} options={{ ...axisOptions(`${fieldLabel(activeField, activeMetric)}${fieldUnit(activeField)}`, chartTheme), plugins: { legend: { display: false } } } as ChartOptions<'line'>} />}
          {chartMode === 'bar' && <Bar ref={barRef} data={barData} options={axisOptions(`${fieldLabel(activeField, activeMetric)}${fieldUnit(activeField)}`, chartTheme)} onClick={event => {
            const points = barRef.current?.getElementsAtEventForMode(event.nativeEvent, 'nearest', { intersect: true }, true) || [];
            const index = points[0]?.index;
            if (index !== undefined) chooseDrill(topRows[index]?.label || '');
          }} />}
        </div>
      </section>

      <section className="mid-secondary-grid">
        <article className="panel mid-ranking" aria-labelledby="mid-ranking-title">
          <header><div><span>品項／分類排名</span><h3 id="mid-ranking-title">本期前 12 名</h3></div><small>{fieldLabel(activeField, activeMetric)}{fieldUnit(activeField)}</small></header>
          <p>依目前下鑽層級排序；點選長條可繼續下鑽。</p>
          <div className="mid-small-chart"><Bar ref={rankingRef} data={rankingData} options={{ ...axisOptions(`${fieldLabel(activeField, activeMetric)}${fieldUnit(activeField)}`, chartTheme), indexAxis: 'y' }} onClick={event => {
            const points = rankingRef.current?.getElementsAtEventForMode(event.nativeEvent, 'nearest', { intersect: true }, true) || [];
            const index = points[0]?.index;
            if (index !== undefined) chooseDrill(topRows[index]?.label || '');
          }} /></div>
        </article>
        <article className="panel mid-share" aria-labelledby="mid-share-title">
          <header><div><span>交易結構</span><h3 id="mid-share-title">本期分布</h3></div><small>{fieldLabel(shareField, shareMeasure)}{fieldUnit(shareField)}</small></header>
          <p>圓餅面積代表目前篩選結果所占比重；點選區塊可下鑽。</p>
          <div className="mid-small-chart"><Doughnut ref={doughnutRef} data={shareData} options={{
            responsive: true,
            maintainAspectRatio: false,
            cutout: '56%',
            plugins: { legend: { position: 'right', labels: { color: chartTheme.text, boxWidth: 11, padding: 10 } } },
          }} onClick={event => {
            const points = doughnutRef.current?.getElementsAtEventForMode(event.nativeEvent, 'nearest', { intersect: true }, true) || [];
            const index = points[0]?.index;
            if (index !== undefined) chooseDrill(shareRows[index]?.label || '');
          }} /></div>
        </article>
      </section>

      <section className="panel mid-details" aria-labelledby="mid-detail-title">
        <header>
          <div><span>可追溯明細</span><h3 id="mid-detail-title">本期與比較期分類明細</h3><p>顯示目前分析回傳結果前 50 列；匯出檔包含完整回傳列。</p></div>
          <button type="button" className="secondary-btn compact" onClick={exportCsv}>匯出 CSV</button>
        </header>
        <div className="responsive-table">
          <table>
            <thead><tr>
              <th>{fieldLabel(fieldMap.get(currentDimension), currentDimension)}</th>
              {analysis.measures.map(key => <th key={`current-${key}`}>本期{fieldLabel(fieldMap.get(key), key)}</th>)}
              {analysis.measures.map(key => <th key={`compare-${key}`}>比較期{fieldLabel(fieldMap.get(key), key)}</th>)}
              <th>差異</th>
              <th>操作</th>
            </tr></thead>
            <tbody>{rankedRows.slice(0, 50).map(({ row, label, current, compare }) => <tr key={label}>
              <th scope="row">{label}</th>
              {analysis.measures.map(key => <td key={`current-${label}-${key}`}>{numberText(row.values[key], fieldMap.get(key)?.aggregation?.includes('avg') ? 1 : 0)}</td>)}
              {analysis.measures.map(key => <td key={`compare-${label}-${key}`}>{numberText(row.compare_values[key], fieldMap.get(key)?.aggregation?.includes('avg') ? 1 : 0)}</td>)}
              <td><MarketMovementBadge value={percent(current, compare)} /></td>
              <td>{currentDimension === 'item'
                ? <span className="mid-final-level">品項層</span>
                : <button type="button" className="secondary-btn compact" onClick={() => chooseDrill(label)}>下鑽</button>}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </section>
      <p className="mid-disclaimer">本頁使用市場營運統計口徑；紅色 ▲／綠色 ▼ 僅表示相較比較期的方向，不代表營運好壞或股票法定漲跌幅。所有圖表均取自已介接的正式行情資料。</p>
    </>}
    {!analysis && !busy && !error && <div className="panel mid-empty">正在準備市場分析資料；如未自動載入，請選擇資料來源後按「更新分析」。</div>}
  </div>;
}

export function MarketInteractiveDashboardWorkspace({
  system,
  module,
}: {
  system: SystemDefinition;
  module: ModuleDefinition;
}) {
  return <AuthGate>{profile =>
    <AppShell profile={profile} title={system.title}>
      <InteractiveDashboard module={module} />
    </AppShell>
  }</AuthGate>;
}
