'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Bar, Chart, Doughnut, Line, Pie } from 'react-chartjs-2';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { MarketMovementBadge } from '@/components/MarketMovementBadge';
import { marketMovementPresentation } from '@/lib/market-movement';
import { invokeAppApi } from '@/lib/supabase';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import './market-analytics.css';

ChartJS.register(ArcElement, BarController, BarElement, CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip);

type PeriodMode = 'day' | 'week' | 'month' | 'quarter' | 'year';
type ChartMode = 'trend' | 'bar' | 'kline' | 'pie' | 'doughnut' | 'pareto' | 'table';
type FieldDefinition = { key: string; label: string; kind: 'dimension' | 'measure'; unit?: string; aggregation?: string };
type Source = { source_id: string; source_name: string; source_code: string; field_definitions: FieldDefinition[]; config?: Record<string, unknown> };
type AnalysisRow = { dimensions: Record<string, string>; values: Record<string, number | null>; compare_values: Record<string, number | null>; changes: Record<string, number | null> };
type Analysis = {
  source: { source_id: string; source_name: string };
  fields: FieldDefinition[];
  dimensions: string[];
  measures: string[];
  periods: { from: string; to: string; compare_from: string; compare_to: string };
  totals: { values: Record<string, number | null>; compare_values: Record<string, number | null> };
  counts: { current: number; compare: number };
  quality?: { latest_observed_on?: string | null; total_group_count?: number; returned_group_count?: number; groups_truncated?: boolean };
  series?: Array<{ observed_on: string; compare_observed_on?: string | null; values: Record<string, number | null>; compare_values: Record<string, number | null> }>;
  rows: AnalysisRow[];
};

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const MODE_LABELS: Record<PeriodMode, string> = { day: '日', week: '週', month: '月', quarter: '季', year: '年' };
const CHART_LABELS: Record<ChartMode, string> = { trend: '趨勢', bar: '長條', kline: 'K 線', pie: '圓餅', doughnut: '甜甜圈', pareto: '柏拉圖', table: '明細' };
const PALETTE = ['#0284c7', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d', '#db2777'];

function isoDate(value: Date) { return value.toISOString().slice(0, 10); }
function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + amount);
  return isoDate(date);
}
function daysBetween(from: string, to: string) {
  return Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1);
}
function dateRange(anchor: string, mode: PeriodMode) {
  const date = new Date(`${anchor}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return { from: anchor, to: anchor };
  const year = date.getUTCFullYear(), month = date.getUTCMonth();
  if (mode === 'day') return { from: anchor, to: anchor };
  if (mode === 'week') {
    const start = new Date(date);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    return { from: isoDate(start), to: addDays(isoDate(start), 6) };
  }
  if (mode === 'month') return { from: `${year}-${String(month + 1).padStart(2, '0')}-01`, to: isoDate(new Date(Date.UTC(year, month + 1, 0))) };
  if (mode === 'quarter') {
    const firstMonth = Math.floor(month / 3) * 3;
    return { from: `${year}-${String(firstMonth + 1).padStart(2, '0')}-01`, to: isoDate(new Date(Date.UTC(year, firstMonth + 3, 0))) };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}
function numberText(value: unknown, fraction = 0) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('zh-TW', { minimumFractionDigits: fraction, maximumFractionDigits: fraction });
}
function finite(value: unknown) { return value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value); }
function percent(current: unknown, compare: unknown) {
  const a = finite(current), b = finite(compare);
  return a === null || b === null || b === 0 ? null : (a - b) / Math.abs(b) * 100;
}
function rowLabel(row: AnalysisRow) { return Object.values(row.dimensions).join('／') || '全部'; }
function periodText(from: string, to: string) { return from === to ? from : `${from}～${to}`; }

function chartOptions(text: string, stacked = false): ChartOptions<'bar'> {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.dataset.label || ''} ${numberText(context.parsed.y ?? context.parsed)}` } } },
    scales: { x: { stacked, title: { display: true, text: '分類／日期', color: 'var(--dim)' }, ticks: { color: 'var(--dim)', maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } }, y: { stacked, beginAtZero: true, title: { display: true, text, color: 'var(--dim)' }, ticks: { color: 'var(--dim)' }, grid: { color: 'color-mix(in srgb, var(--line) 70%, transparent)' } } },
  };
}

function Movement({ current, compare }: { current: unknown; compare: unknown }) {
  return <MarketMovementBadge value={percent(current, compare)} />;
}

function ParetoChart({ analysis, measure, field, onSelect }: { analysis: Analysis; measure: string; field?: FieldDefinition; onSelect: (value: string) => void }) {
  const rows = analysis.rows.map(row => ({ label: rowLabel(row), value: finite(row.values[measure]) || 0 })).filter(row => row.value > 0).sort((a, b) => b.value - a.value).slice(0, 12);
  const total = rows.reduce((sum, row) => sum + row.value, 0) || 1;
  let running = 0;
  const cumulative = rows.map(row => { running += row.value; return running / total * 100; });
  const data = { labels: rows.map(row => row.label), datasets: [
    { type: 'bar' as const, label: field?.label || measure, data: rows.map(row => row.value), backgroundColor: PALETTE[0], borderRadius: 5, yAxisID: 'value' },
    { type: 'line' as const, label: '累積占比', data: cumulative, borderColor: PALETTE[2], backgroundColor: PALETTE[2], pointRadius: 3, tension: .25, yAxisID: 'percent' },
  ] };
  const options = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index' as const, intersect: false }, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: 'var(--dim)', maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, value: { beginAtZero: true, title: { display: true, text: field?.unit ? `${field.label}（${field.unit}）` : field?.label || measure, color: 'var(--dim)' }, ticks: { color: 'var(--dim)' }, grid: { color: 'color-mix(in srgb, var(--line) 70%, transparent)' } }, percent: { beginAtZero: true, max: 100, position: 'right' as const, title: { display: true, text: '累積占比（%）', color: 'var(--dim)' }, ticks: { color: 'var(--dim)', callback: (value: string | number) => `${value}%` }, grid: { drawOnChartArea: false } } } };
  const chartRef = useRef<ChartJS<'bar'> | null>(null);
  return <div className="market-command-chart-frame"><div className="market-chart-legend-row"><span><i style={{ background: PALETTE[0] }} />分類值</span><span><i className="line" style={{ borderColor: PALETTE[2] }} />累積占比</span><small>前 12 組，點選柱體可下鑽</small></div><div className="market-command-chart"><Chart ref={chartRef} type="bar" data={data} options={options} onClick={event => { const elements = chartRef.current?.getElementsAtEventForMode(event.nativeEvent, 'nearest', { intersect: true }, true) || []; const index = elements[0]?.index; if (index !== undefined) onSelect(rows[index]?.label || ''); }} /></div></div>;
}

function KlineChart({ analysis, measure }: { analysis: Analysis; measure: string }) {
  const series = (analysis.series || []).filter(point => finite(point.values[measure]) !== null).slice(-45);
  if (!series.length) return <p className="market-command-empty">目前期間沒有可繪製 K 線的價格資料。</p>;
  const prices = series.flatMap(point => [finite(point.values.high_price), finite(point.values.low_price), finite(point.values.average_price), finite(point.values.middle_price)]).filter((value): value is number => value !== null);
  const min = Math.min(...prices), max = Math.max(...prices), span = Math.max(max - min, 1);
  const position = (value: number) => Math.max(0, Math.min(100, (max - value) / span * 100));
  return <div className="market-kline-wrap"><div className="market-chart-legend-row"><span><i className="candle-rise" />收盤高於開盤</span><span><i className="candle-fall" />收盤低於開盤</span><small>開盤以中價、收盤以加權平均價呈現；每根代表一個交易日</small></div><div className="market-kline-scroll"><div className="market-kline-grid" style={{ '--kline-count': series.length } as CSSProperties}>{series.map(point => {
    const close = finite(point.values.average_price) ?? finite(point.values[measure]) ?? 0;
    const open = finite(point.values.middle_price) ?? close;
    const high = finite(point.values.high_price) ?? Math.max(open, close);
    const low = finite(point.values.low_price) ?? Math.min(open, close);
    const rising = close >= open;
    const bodyTop = Math.min(position(open), position(close));
    const bodyHeight = Math.max(3, Math.abs(position(open) - position(close)));
    return <div className="market-kline-item" key={point.observed_on} title={`${point.observed_on}　開 ${numberText(open, 1)}　收 ${numberText(close, 1)}　高 ${numberText(high, 1)}　低 ${numberText(low, 1)}`}><div className="market-kline-plot"><i className={`market-kline-wick ${rising ? 'rise' : 'fall'}`} style={{ top: `${position(high)}%`, height: `${Math.max(4, position(low) - position(high))}%` }} /><b className={`market-kline-body ${rising ? 'rise' : 'fall'}`} style={{ top: `${bodyTop}%`, height: `${bodyHeight}%` }} /></div><span>{point.observed_on.slice(5)}</span></div>;
  })}</div></div></div>;
}

function pieData(rows: Array<{ label: string; current: number }>) {
  return { labels: rows.map(row => row.label), datasets: [{ data: rows.map(row => row.current), backgroundColor: PALETTE, borderColor: 'var(--panel)', borderWidth: 2 }] };
}
function pieOptions(cutout: string) {
  return { responsive: true, maintainAspectRatio: false, cutout, plugins: { legend: { display: true, position: 'right' as const, labels: { color: 'var(--text)', boxWidth: 12, padding: 12, font: { size: 11 } } } } };
}
function PieChartView({ rows, onSelect }: { rows: Array<{ label: string; current: number }>; onSelect: (value: string) => void }) {
  const chartRef = useRef<ChartJS<'pie'> | null>(null);
  const handleClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const elements = chartRef.current?.getElementsAtEventForMode(event.nativeEvent, 'nearest', { intersect: true }, true) || [];
    const index = elements[0]?.index;
    if (index !== undefined) onSelect(rows[index]?.label || '');
  };
  return <Pie ref={chartRef} data={pieData(rows)} options={pieOptions('0%')} onClick={handleClick} />;
}
function DoughnutChartView({ rows, onSelect }: { rows: Array<{ label: string; current: number }>; onSelect: (value: string) => void }) {
  const chartRef = useRef<ChartJS<'doughnut'> | null>(null);
  const handleClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const elements = chartRef.current?.getElementsAtEventForMode(event.nativeEvent, 'nearest', { intersect: true }, true) || [];
    const index = elements[0]?.index;
    if (index !== undefined) onSelect(rows[index]?.label || '');
  };
  return <Doughnut ref={chartRef} data={pieData(rows)} options={pieOptions('58%')} onClick={handleClick} />;
}
function PieDoughnutChart({ mode, rows, onSelect }: { mode: 'pie' | 'doughnut'; rows: Array<{ label: string; current: number }>; onSelect: (value: string) => void }) {
  return <div className="market-command-chart">{mode === 'pie' ? <PieChartView rows={rows} onSelect={onSelect} /> : <DoughnutChartView rows={rows} onSelect={onSelect} />}</div>;
}

function BarChartView({ rows, field, onSelect }: { rows: Array<{ label: string; current: number; compare: number }>; field?: FieldDefinition; onSelect: (value: string) => void }) {
  const chartRef = useRef<ChartJS<'bar'> | null>(null);
  const data = { labels: rows.map(row => row.label), datasets: [{ label: '本期', data: rows.map(row => row.current), backgroundColor: PALETTE[0], borderRadius: 5 }, { label: '比較期', data: rows.map(row => row.compare), backgroundColor: PALETTE[3], borderRadius: 5 }] };
  return <div className="market-command-chart-frame"><div className="market-chart-legend-row"><span><i style={{ background: PALETTE[0] }} />本期</span><span><i style={{ background: PALETTE[3] }} />比較期</span><small>前 {rows.length} 組；點選柱體可下鑽</small></div><div className="market-command-chart"><Bar ref={chartRef} data={data} options={chartOptions(field?.unit ? `${field.label}（${field.unit}）` : field?.label || '數值')} onClick={event => { const elements = chartRef.current?.getElementsAtEventForMode(event.nativeEvent, 'nearest', { intersect: true }, true) || []; const index = elements[0]?.index; if (index !== undefined) onSelect(rows[index]?.label || ''); }} /></div></div>;
}

function DashboardChart({ mode, analysis, measure, field, onSelect }: { mode: ChartMode; analysis: Analysis; measure: string; field?: FieldDefinition; onSelect: (value: string) => void }) {
  const rows = analysis.rows.map(row => ({ label: rowLabel(row), current: finite(row.values[measure]) || 0, compare: finite(row.compare_values[measure]) || 0 })).sort((a, b) => Math.max(b.current, b.compare) - Math.max(a.current, a.compare)).slice(0, 14);
  if (mode === 'kline') return <KlineChart analysis={analysis} measure={measure} />;
  if (mode === 'pareto') return <ParetoChart analysis={analysis} measure={measure} field={field} onSelect={onSelect} />;
  if (mode === 'table') return <div className="responsive-table market-command-table"><table><thead><tr><th>分類</th><th>本期</th><th>比較期</th><th>差異</th><th>操作</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><th scope="row">{row.label}</th><td>{numberText(row.current)}</td><td>{numberText(row.compare)}</td><td><Movement current={row.current} compare={row.compare} /></td><td><button type="button" className="secondary-btn compact" onClick={() => onSelect(row.label)}>下鑽</button></td></tr>)}</tbody></table></div>;
  if (mode === 'trend') {
    const series = analysis.series || [];
    const data = { labels: series.map(point => point.observed_on.slice(5)), datasets: [{ label: '本期', data: series.map(point => finite(point.values[measure])), borderColor: PALETTE[0], backgroundColor: 'transparent', pointRadius: 2, tension: .25, spanGaps: false }, { label: '比較期', data: series.map(point => finite(point.compare_values[measure])), borderColor: PALETTE[3], backgroundColor: 'transparent', borderDash: [7, 5], pointRadius: 2, tension: .25, spanGaps: false }] };
    return <div className="market-command-chart-frame"><div className="market-chart-legend-row"><span><i style={{ background: PALETTE[0] }} />本期（實線）</span><span><i className="line" style={{ borderColor: PALETTE[3] }} />比較期（虛線）</span><small>橫軸：日期；縱軸：{field?.label || measure}{field?.unit ? `（${field.unit}）` : ''}</small></div><div className="market-command-chart"><Line data={data} options={{ ...chartOptions(field?.unit ? `${field.label}（${field.unit}）` : field?.label || measure), plugins: { legend: { display: false } } } as ChartOptions<'line'>} /></div></div>;
  }
  const pieRows = rows.filter(row => row.current > 0);
  if (mode === 'pie' || mode === 'doughnut') {
    return <PieDoughnutChart mode={mode} rows={pieRows} onSelect={onSelect} />;
  }
  return <BarChartView rows={rows} field={field} onSelect={onSelect} />;
}

function CommandCenter({ system, module, profile }: { system: SystemDefinition; module: ModuleDefinition; profile: Profile }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [dimensionOptions, setDimensionOptions] = useState<Record<string, Array<{ value: string; count: number }>>>({});
  const [sourceId, setSourceId] = useState('');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('day');
  const [anchor, setAnchor] = useState(TODAY);
  const [market, setMarket] = useState('');
  const [category, setCategory] = useState('');
  const [item, setItem] = useState('');
  const [chartMode, setChartMode] = useState<ChartMode>('trend');
  const [measure, setMeasure] = useState('quantity');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [drillPath, setDrillPath] = useState<Array<{ key: string; value: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');

  const source = sources.find(candidate => candidate.source_id === sourceId);
  const measures = useMemo(() => source?.field_definitions.filter(field => field.kind === 'measure') || [], [source]);
  const fieldMap = useMemo(() => new Map((analysis?.fields || source?.field_definitions || []).map(field => [field.key, field])), [analysis, source]);
  const primaryField = fieldMap.get(measure) || measures[0];
  const range = useMemo(() => dateRange(anchor, periodMode), [anchor, periodMode]);
  const drillFilters = useMemo(() => Object.fromEntries(drillPath.map(step => [step.key, step.value])), [drillPath]);
  const manualFilters = useMemo(() => Object.fromEntries([['market', market], ['category', category], ['item', item].filter(Boolean)].filter(([, value]) => value)), [market, category, item]);
  // The item catalog must follow the selected market and produce category.
  // Keep this filter set separate from the analysis filters so the datalist can
  // refresh immediately without waiting for an analysis request.
  const catalogFilters = useMemo<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    if (market.trim()) next.market = market.trim();
    if (category.trim()) next.category = category.trim();
    return next;
  }, [market, category]);
  const filters = useMemo(() => ({ ...manualFilters, ...drillFilters }), [manualFilters, drillFilters]);
  const dimensions = useMemo(() => {
    const dimensionKeys = new Set((source?.field_definitions || []).filter(field => field.kind === 'dimension').map(field => field.key));
    const has = (key: string) => dimensionKeys.has(key);
    if (drillPath.some(step => step.key === 'item')) return has('item') ? ['item'] : [];
    if (drillPath.some(step => step.key === 'category')) return has('item') ? ['item'] : [];
    if (drillPath.some(step => step.key === 'market')) return has('category') ? ['category'] : has('item') ? ['item'] : [];
    return has('market') ? ['market'] : has('category') ? ['category'] : has('item') ? ['item'] : [];
  }, [drillPath, source]);

  const loadCatalog = useCallback(async () => {
    try {
      const result = await invokeAppApi<{ sources: Source[] }>('market_catalog');
      const nextSources = (result.sources || []).filter(candidate => candidate.source_code !== 'market_demo' && candidate.config?.is_demo !== true);
      setSources(nextSources);
      const preferred = nextSources.find(candidate => candidate.config?.is_default === true) || nextSources[0];
      if (preferred) {
        setSourceId(preferred.source_id);
        const latest = String(preferred.config?.latest_observed_on || preferred.config?.default_to || TODAY);
        if (/^\d{4}-\d{2}-\d{2}$/.test(latest)) setAnchor(latest);
        const defaultMeasure = Array.isArray(preferred.config?.default_measures) ? String(preferred.config?.default_measures[0] || '') : '';
        if (defaultMeasure) setMeasure(defaultMeasure);
      }
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : '市場戰情資料來源載入失敗'); }
  }, []);

  const loadAnalysis = useCallback(async () => {
    if (!source?.source_id || !dimensions.length || !measures.length) { setError('目前資料來源尚未定義可分析欄位。'); return; }
    setBusy(true); setError('');
    try {
      const length = daysBetween(range.from, range.to);
      const compareFrom = addDays(range.from, -length), compareTo = addDays(range.to, -length);
      const result = await invokeAppApi<Analysis>('market_analysis', { source_id: source.source_id, from: range.from, to: range.to, compare_from: compareFrom, compare_to: compareTo, dimensions, measures: measures.slice(0, 4).map(field => field.key), filters });
      setAnalysis(result); setUpdatedAt(new Date().toISOString());
      if (!measures.some(field => field.key === measure)) setMeasure(measures[0]?.key || '');
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : '市場行情分析載入失敗'); }
    finally { setBusy(false); }
  }, [dimensions, filters, measures, measure, range.from, range.to, source?.source_id]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  useEffect(() => {
    let active = true;
    setDimensionOptions({});
    if (!source?.source_id) return () => { active = false; };
    void invokeAppApi<{ options: Record<string, Array<{ value: string; count: number }>> }>('market_dimension_catalog', { source_id: source.source_id, filters: catalogFilters })
      .then(result => { if (active) setDimensionOptions(result.options || {}); })
      .catch(() => { if (active) setDimensionOptions({}); });
    return () => { active = false; };
  }, [catalogFilters, source?.source_id]);
  useEffect(() => { if (source?.source_id && measures.length && !analysis) void loadAnalysis(); }, [analysis, loadAnalysis, measures.length, source?.source_id]);

  const choosePeriod = (next: PeriodMode) => { setPeriodMode(next); setDrillPath([]); setAnalysis(null); };
  const chooseDrill = (label: string) => {
    const value = label.trim();
    if (!value || value === '全部') return;
    const dimension = dimensions[0] || '';
    if (!(source?.field_definitions || []).some(field => field.key === dimension)) return;
    setDrillPath(path => [...path.filter(step => step.key !== dimension), { key: dimension, value }]);
    if (dimension === 'market') setMarket(value);
    if (dimension === 'category') setCategory(value);
    if (dimension === 'item') setItem(value);
    setAnalysis(null);
  };
  const clearDrill = () => { setDrillPath([]); setAnalysis(null); };
  const kpiKeys = ['quantity', 'average_price', 'total_value'].filter(key => fieldMap.has(key) && analysis?.measures.includes(key));
  const activeMeasure = analysis?.measures.includes(measure) ? measure : analysis?.measures[0] || measures[0]?.key || '';
  const activeField = fieldMap.get(activeMeasure);
  const topRows = useMemo(() => (analysis?.rows || []).map(row => ({ label: rowLabel(row), value: finite(row.values[activeMeasure]) || 0, compare: finite(row.compare_values[activeMeasure]) || 0 })).sort((a, b) => b.value - a.value), [activeMeasure, analysis]);
  const largestRise = [...topRows].map(row => ({ ...row, pct: percent(row.value, row.compare) })).filter(row => row.pct !== null).sort((a, b) => (b.pct as number) - (a.pct as number))[0];
  const largestFall = [...topRows].map(row => ({ ...row, pct: percent(row.value, row.compare) })).filter(row => row.pct !== null).sort((a, b) => (a.pct as number) - (b.pct as number))[0];
  const activeDays = analysis?.series?.filter(point => finite(point.values[activeMeasure]) !== null).length || 0;
  const compareDays = analysis?.series?.filter(point => finite(point.compare_values[activeMeasure]) !== null).length || 0;
  const sourceCategories = useMemo(() => (dimensionOptions.category || []).map(option => option.value), [dimensionOptions]);
  const sourceMarkets = useMemo(() => (dimensionOptions.market || []).map(option => option.value), [dimensionOptions]);
  const sourceItems = useMemo(() => (dimensionOptions.item || []).map(option => option.value), [dimensionOptions]);

  return <div className="market-command-page">
    <section className="panel market-command-hero">
      <div><span className="market-kicker">SYS-10 · 決策專用</span><h2>市場戰情儀表板</h2><p>像股市看盤一樣切換期間與圖形；由市場 → 蔬果大類 → 品項逐層下鑽，讓決策者先看變化，再追溯原因。</p></div>
      <div className="market-command-status"><span className={analysis ? 'ready' : 'loading'}><i />{analysis ? '資料已更新' : busy ? '分析中…' : '等待分析'}</span>{updatedAt && <time dateTime={updatedAt}>{updatedAt.slice(0, 16).replace('T', ' ')}</time>}</div>
    </section>
    <section className="panel market-command-controls">
      <div className="market-command-control-row"><label>資料來源<select value={sourceId} onChange={event => { setSourceId(event.target.value); setMarket(''); setCategory(''); setItem(''); setAnalysis(null); setDrillPath([]); }}><option value="">選擇資料來源</option>{sources.map(itemOption => <option key={itemOption.source_id} value={itemOption.source_id}>{itemOption.source_name}</option>)}</select></label><label>基準日期<LocalizedDateInput aria-label="戰情基準日期（年/月/日）" value={anchor} onChange={event => { setAnchor(event.target.value); setAnalysis(null); }} /></label><label>判讀指標<select value={activeMeasure} onChange={event => { setMeasure(event.target.value); setAnalysis(null); }}>{measures.map(field => <option key={field.key} value={field.key}>{field.label}{field.unit ? `（${field.unit}）` : ''}</option>)}</select></label><button type="button" className="primary-btn" disabled={busy || !sourceId} onClick={() => void loadAnalysis()}>{busy ? '分析中…' : '更新戰情'}</button></div>
      <div className="market-period-presets market-command-periods" role="group" aria-label="行情期間切換"><span>行情期間：</span>{(Object.entries(MODE_LABELS) as Array<[PeriodMode, string]>).map(([mode, label]) => <button type="button" key={mode} className={periodMode === mode ? 'active' : ''} aria-pressed={periodMode === mode} onClick={() => choosePeriod(mode)}>{label}</button>)}<small>{periodText(range.from, range.to)}　比較前一段同日數期間</small></div>
      <div className="market-command-slicers"><label>市場（可輸入）<input list="market-command-market-options" value={market} onChange={event => { setMarket(event.target.value); setCategory(''); setItem(''); setDrillPath([]); setAnalysis(null); }} placeholder="全部市場" /><datalist id="market-command-market-options">{sourceMarkets.map(value => <option key={value} value={value} />)}</datalist></label><label>蔬果大類（可輸入）<input list="market-command-category-options" value={category} onChange={event => { setCategory(event.target.value); setItem(''); setDrillPath([]); setAnalysis(null); }} placeholder="全部蔬果" /><datalist id="market-command-category-options">{sourceCategories.map(value => <option key={value} value={value} />)}</datalist></label><label className="market-command-item-filter">品項（可輸入）<input list="market-command-item-options" value={item} onChange={event => { setItem(event.target.value); setAnalysis(null); }} placeholder="例如 高麗菜、菠菜、山蘇" /><datalist id="market-command-item-options">{sourceItems.map(value => <option key={value} value={value} />)}</datalist><small className="market-command-filter-hint">品項會依市場與蔬果大類連動篩選</small></label></div>
    </section>
    {error && <p className="market-inline-message" role="alert">{error}</p>}
    {analysis && <>
      <section className="market-command-context panel"><div><b>{analysis.source.source_name}</b><span>本期 {periodText(analysis.periods.from, analysis.periods.to)}</span><span>比較期 {periodText(analysis.periods.compare_from, analysis.periods.compare_to)}</span><span>本期 {numberText(analysis.counts.current)} 筆</span><span>資料截止 {analysis.quality?.latest_observed_on || '—'}</span></div><div className="market-command-breadcrumb"><button type="button" onClick={clearDrill} disabled={!drillPath.length}>整體</button>{drillPath.map((step, index) => <span key={`${step.key}-${index}`}>› <button type="button" onClick={() => { setDrillPath(drillPath.slice(0, index + 1)); setAnalysis(null); }}>{step.value}</button></span>)}</div></section>
      <div className="market-command-direction-legend market-stock-legend" aria-label="行情方向圖例"><b>行情方向</b><span data-direction="rise"><i>▲</i>上漲（紅）</span><span data-direction="fall"><i>▼</i>下跌（綠）</span><span data-direction="steady"><i>—</i>持平</span><small>相較比較期；不代表法定漲停／跌停</small></div>
      <section className="market-command-kpis">{kpiKeys.map(key => { const current = analysis.totals.values[key], compare = analysis.totals.compare_values[key], field = fieldMap.get(key); const movement = marketMovementPresentation(percent(current, compare)); return <article className={`market-command-kpi market-card-${movement.tone}`} key={key}><span>{field?.label || key}</span><strong>{numberText(current, field?.aggregation?.includes('avg') ? 1 : 0)}<small>{field?.unit || ''}</small></strong><div><span>比較期 {numberText(compare, field?.aggregation?.includes('avg') ? 1 : 0)}</span><MarketMovementBadge value={percent(current, compare)} /></div></article>; })}<article className="market-command-kpi"><span>有效交易日</span><strong>{numberText(activeDays)}<small>日</small></strong><div><span>比較期 {numberText(compareDays)} 日</span><Movement current={activeDays} compare={compareDays} /></div></article></section>
      <section className="market-command-insight-row"><article><span>本期主要分類</span><b>{topRows[0]?.label || '資料不足'}</b><small>{topRows[0] ? `${numberText(topRows[0].value)} ${activeField?.unit || ''}` : '尚無可判讀資料'}</small></article><article className="market-card-rise"><span>最大上升</span><b>{largestRise?.label || '—'}</b><small>{largestRise ? <Movement current={largestRise.value} compare={largestRise.compare} /> : '比較資料不足'}</small></article><article className="market-card-fall"><span>最大下降</span><b>{largestFall?.label || '—'}</b><small>{largestFall ? <Movement current={largestFall.value} compare={largestFall.compare} /> : '比較資料不足'}</small></article></section>
      <section className="panel market-command-chart-panel"><header><div><span className="market-kicker">Power BI 式圖形切換</span><h3>{CHART_LABELS[chartMode]} · {activeField?.label || activeMeasure}</h3><p>可切換同一批資料的統計視角；長條、圓餅、柏拉圖與明細均可點選下鑽。</p></div><div className="market-command-chart-switch" role="group" aria-label="圖形切換">{(Object.entries(CHART_LABELS) as Array<[ChartMode, string]>).map(([mode, label]) => <button type="button" key={mode} className={chartMode === mode ? 'active' : ''} aria-pressed={chartMode === mode} onClick={() => setChartMode(mode)}>{label}</button>)}</div></header><div className="market-command-drill-note"><span>下鑽路徑：{drillPath.length ? drillPath.map(step => step.value).join(' › ') : '整體行情'}</span><small>{analysis.quality?.groups_truncated ? `顯示 ${numberText(analysis.quality.returned_group_count)}／${numberText(analysis.quality.total_group_count)} 組` : `共 ${numberText(analysis.rows.length)} 組`}</small></div><DashboardChart mode={chartMode} analysis={analysis} measure={activeMeasure} field={activeField} onSelect={chooseDrill} /></section>
    </>}
    {!analysis && !busy && <div className="panel market-command-empty-panel">請選擇資料來源與行情期間，按「更新戰情」開始分析。</div>}
    <p className="market-command-disclaimer">圖表採用市場營運統計口徑；紅色 ▲／綠色 ▼ 僅表示本期相較比較期的方向，不代表股票法定漲停或跌停。K 線以中價／加權平均價模擬開收盤，供營運趨勢判讀。</p>
  </div>;
}

export function MarketCommandCenterWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  return <AuthGate>{profile => <AppShell profile={profile} title={system.title}><div className="page-actions"><div><p>{module.description}</p></div><div className="action-cluster"><a className="secondary-btn compact" href="/Inspection/v2/systems/marketanalytics/overview/">進階分析工作台</a></div></div><CommandCenter system={system} module={module} profile={profile} /></AppShell>}</AuthGate>;
}
