'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type CSSProperties } from 'react';
import {
  ArcElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from 'chart.js';
import { Doughnut, Line, Pie } from 'react-chartjs-2';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { invokeAppApi } from '@/lib/supabase';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import './market-analytics.css';

ChartJS.register(ArcElement, CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip);

type ChartType = 'bar' | 'pie' | 'doughnut' | 'line' | 'area' | 'table' | 'cards';
type PaletteId = 'market' | 'produce' | 'cool' | 'warm' | 'accessible' | 'custom';

type FieldDefinition = {
  key: string;
  label: string;
  kind: 'dimension' | 'measure';
  unit?: string;
  aggregation?: 'sum' | 'avg' | 'min' | 'max';
  required?: boolean;
};
type Source = {
  source_id: string;
  source_code: string;
  source_name: string;
  source_type: string;
  endpoint_url?: string | null;
  field_definitions: FieldDefinition[];
  status: string;
  updated_at?: string;
};
type Template = {
  template_id: string;
  template_code: string;
  template_name: string;
  description?: string | null;
  source_id?: string | null;
  dimensions: string[];
  measures: string[];
  chart_type: ChartType;
  default_config?: Record<string, unknown>;
  updated_at?: string;
};
type AnalysisRow = {
  dimensions: Record<string, string>;
  values: Record<string, number | null>;
  compare_values: Record<string, number | null>;
  changes: Record<string, number | null>;
};
type Analysis = {
  source: { source_id: string; source_code: string; source_name: string };
  fields: FieldDefinition[];
  dimensions: string[];
  measures: string[];
  periods: { from: string; to: string; compare_from: string; compare_to: string };
  totals: { values: Record<string, number | null>; compare_values: Record<string, number | null>; changes: Record<string, number | null> };
  counts: { current: number; compare: number };
  rows: AnalysisRow[];
};
type SimulationRun = {
  simulation_id: string;
  name: string;
  source_id: string;
  period_from: string;
  period_to: string;
  base_totals: Record<string, number | null>;
  assumptions: Record<string, unknown>;
  projected_totals: Record<string, number | null>;
  created_at: string;
  status: 'draft' | 'completed';
};

type PaletteDefinition = {
  id: PaletteId;
  label: string;
  colors: string[];
};

const CHART_TYPE_LABELS: Record<ChartType, string> = {
  bar: '比較長條',
  pie: '占比圓餅',
  doughnut: '占比甜甜圈',
  line: '分類比較折線',
  area: '分類比較面積',
  table: '明細表格',
  cards: '彩色數值卡',
};
const CHART_TYPE_OPTIONS = Object.entries(CHART_TYPE_LABELS) as Array<[ChartType, string]>;
const SOURCE_TYPE_LABELS: Record<string, string> = { csv: 'CSV 檔案', json: 'JSON 資料', api: '外部 API', manual: '手動輸入' };
const DEFAULT_CUSTOM_COLORS = ['#0284c7', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];
const PALETTES: PaletteDefinition[] = [
  { id: 'market', label: '市場藍綠', colors: ['--cyan', '--green', '--amber', '--violet', '--red', '#0891b2'] },
  { id: 'produce', label: '蔬果鮮彩', colors: ['#15803d', '#0d9488', '#65a30d', '#f59e0b', '#ea580c', '#db2777'] },
  { id: 'cool', label: '冷色專業', colors: ['#0369a1', '#2563eb', '#4f46e5', '#7c3aed', '#0f766e', '#0891b2'] },
  { id: 'warm', label: '暖色行情', colors: ['#b45309', '#ea580c', '#d97706', '#dc2626', '#be123c', '#9333ea'] },
  { id: 'accessible', label: '高對比友善', colors: ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#d55e00', '#56b4e9'] },
  { id: 'custom', label: '自訂色卡', colors: DEFAULT_CUSTOM_COLORS },
];
const PALETTE_IDS = new Set<PaletteId>(PALETTES.map(palette => palette.id));

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const DEFAULT_FIELDS: FieldDefinition[] = [
  { key: 'item', label: '品項', kind: 'dimension', required: true },
  { key: 'market', label: '市場', kind: 'dimension' },
  { key: 'unit', label: '交易單位', kind: 'dimension' },
  { key: 'quantity', label: '交易量', kind: 'measure', unit: '公斤', aggregation: 'sum' },
  { key: 'average_price', label: '平均價', kind: 'measure', unit: '元／公斤', aggregation: 'avg' },
  { key: 'min_price', label: '最低價', kind: 'measure', unit: '元／公斤', aggregation: 'min' },
  { key: 'max_price', label: '最高價', kind: 'measure', unit: '元／公斤', aggregation: 'max' },
  { key: 'total_value', label: '交易金額', kind: 'measure', unit: '元', aggregation: 'sum' },
];

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function addYears(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCFullYear(date.getUTCFullYear() + amount);
  return date.toISOString().slice(0, 10);
}
function rangeLength(from: string, to: string) {
  return Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1);
}
function numberText(value: unknown, fraction = 0) {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('zh-TW', { minimumFractionDigits: fraction, maximumFractionDigits: fraction });
}
function dateText(value: unknown) {
  const raw = String(value || '').trim().replaceAll('/', '-');
  const match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return match ? `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}` : raw;
}
function parseFieldLines(value: string): FieldDefinition[] {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [keyRaw, labelRaw, kindRaw, unitRaw, aggregationRaw] = line.split('|').map(part => part.trim());
    const key = keyRaw.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
    const kind: FieldDefinition['kind'] = kindRaw === '數值' || kindRaw === 'measure' ? 'measure' : 'dimension';
    const aggregationValue = ({ 總和: 'sum', 平均: 'avg', 最低: 'min', 最高: 'max' } as Record<string, string>)[aggregationRaw || ''] || aggregationRaw;
    const aggregation = ['sum', 'avg', 'min', 'max'].includes(aggregationValue || '') ? aggregationValue as FieldDefinition['aggregation'] : kind === 'measure' ? 'sum' : undefined;
    return { key, label: labelRaw || key, kind, unit: unitRaw || undefined, aggregation };
  }).filter(field => /^[a-z][a-z0-9_-]{0,59}$/.test(field.key));
}
function fieldLines(fields: FieldDefinition[]) {
  return fields.map(field => [field.key, field.label, field.kind === 'measure' ? '數值' : '分類', field.unit || '', field.aggregation || ''].join('|')).join('\n');
}
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell.trim()); cell = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); }
  const headers = (rows.shift() || []).map((header, index) => header || `欄位${index + 1}`);
  return { headers, rows: rows.map(values => headers.map((_, index) => values[index] || '')) };
}
function parseJsonRows(text: string) {
  const parsed: unknown = JSON.parse(text);
  const object = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const candidate = Array.isArray(parsed) ? parsed : object.data;
  const records = (Array.isArray(candidate) ? candidate : []).filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, unknown>>;
  const headers = [...new Set(records.flatMap(record => {
    const dimensions = record.dimensions && typeof record.dimensions === 'object' ? Object.keys(record.dimensions as Record<string, unknown>) : [];
    const measures = record.measures && typeof record.measures === 'object' ? Object.keys(record.measures as Record<string, unknown>) : [];
    return [...Object.keys(record).filter(key => key !== 'dimensions' && key !== 'measures' && key !== 'metadata'), ...dimensions, ...measures];
  }))];
  return {
    headers,
    rows: records.map(record => {
      const dimensions = record.dimensions && typeof record.dimensions === 'object' && !Array.isArray(record.dimensions) ? record.dimensions as Record<string, unknown> : {};
      const measures = record.measures && typeof record.measures === 'object' && !Array.isArray(record.measures) ? record.measures as Record<string, unknown> : {};
      return headers.map(header => String(record[header] ?? dimensions[header] ?? measures[header] ?? ''));
    }),
  };
}
function periodText(period: { from: string; to: string }) { return period.from === period.to ? period.from : `${period.from}～${period.to}`; }
function dateTimeText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date).replaceAll('/', '-');
}

function paletteIdFrom(config?: Record<string, unknown>): PaletteId {
  const value = String(config?.palette_id || 'market') as PaletteId;
  return PALETTE_IDS.has(value) ? value : 'market';
}
function normalizeCustomColors(value: unknown) {
  const colors = (Array.isArray(value) ? value : []).map(color => String(color).trim().toLowerCase()).filter(color => /^#[0-9a-f]{6}$/.test(color));
  if (colors.length < 2) return DEFAULT_CUSTOM_COLORS;
  return [...colors.slice(0, 8), ...DEFAULT_CUSTOM_COLORS].slice(0, Math.max(6, Math.min(8, colors.length)));
}
function chartMeasureFrom(config: Record<string, unknown> | undefined, measures: string[]) {
  const value = String(config?.chart_measure || '');
  return measures.includes(value) ? value : measures[0] || '';
}
function chartRowLabel(row: AnalysisRow) { return Object.values(row.dimensions).join('／') || '全部'; }
function finiteNumber(value: unknown): number | null { return Number.isFinite(Number(value)) ? Number(value) : null; }
function withAlpha(color: string, alpha: number) {
  const hex = color.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) return `rgba(${Number.parseInt(hex.slice(0, 2), 16)}, ${Number.parseInt(hex.slice(2, 4), 16)}, ${Number.parseInt(hex.slice(4, 6), 16)}, ${alpha})`;
  const rgb = color.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})` : color;
}

function useResolvedPalette(paletteId: PaletteId, customColors: string[]) {
  const [themeRevision, setThemeRevision] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeRevision(revision => revision + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return useMemo(() => {
    const style = typeof window === 'undefined' ? null : getComputedStyle(document.documentElement);
    const fallbacks: Record<string, string> = { '--cyan': '#0284c7', '--green': '#059669', '--amber': '#d97706', '--violet': '#7c3aed', '--red': '#dc2626' };
    const definition = PALETTES.find(palette => palette.id === paletteId) || PALETTES[0];
    const selected = paletteId === 'custom' ? normalizeCustomColors(customColors) : definition.colors;
    const colors = selected.map(color => color.startsWith('--') ? style?.getPropertyValue(color).trim() || fallbacks[color] || '#64748b' : color);
    return {
      colors,
      text: style?.getPropertyValue('--text').trim() || '#172033',
      dim: style?.getPropertyValue('--dim').trim() || '#64748b',
      grid: style?.getPropertyValue('--line').trim() || '#cbd5e1',
      panel: style?.getPropertyValue('--panel').trim() || '#ffffff',
    };
  }, [paletteId, customColors, themeRevision]);
}

function PalettePicker({ value, customColors, onChange, onCustomColorsChange }: { value: PaletteId; customColors: string[]; onChange: (value: PaletteId) => void; onCustomColorsChange: (colors: string[]) => void }) {
  const customLabels = ['本期主色', '比較主色', '分類色 1', '分類色 2', '分類色 3', '分類色 4'];
  return <div className="market-palette-control">
    <span>圖表色卡</span>
    <div className="market-palette-grid" role="radiogroup" aria-label="選擇圖表色卡">
      {PALETTES.map(palette => {
        const previewColors = palette.id === 'custom' ? normalizeCustomColors(customColors) : palette.colors;
        return <button type="button" role="radio" aria-checked={value === palette.id} aria-label={`選擇${palette.label}色卡`} className={`market-palette-option${value === palette.id ? ' active' : ''}`} key={palette.id} onClick={() => onChange(palette.id)}>
          <b>{palette.label}{palette.id === 'market' ? <small>預設</small> : null}</b>
          <svg viewBox="0 0 96 16" aria-hidden="true">{previewColors.slice(0, 6).map((color, index) => <circle key={`${color}-${index}`} cx={8 + index * 16} cy="8" r="6" fill={color.startsWith('--') ? `var(${color})` : color} />)}</svg>
        </button>;
      })}
    </div>
    {value === 'custom' && <div className="market-custom-colors">{normalizeCustomColors(customColors).slice(0, 6).map((color, index, colors) => <label key={index}>{customLabels[index]}<input type="color" value={color} aria-label={customLabels[index]} onChange={event => onCustomColorsChange(colors.map((item, colorIndex) => colorIndex === index ? event.target.value : item))} /></label>)}</div>}
  </div>;
}

function PaletteStrip({ paletteId, customColors }: { paletteId: PaletteId; customColors: string[] }) {
  const definition = PALETTES.find(palette => palette.id === paletteId) || PALETTES[0];
  const colors = paletteId === 'custom' ? normalizeCustomColors(customColors) : definition.colors;
  return <svg className="market-palette-strip" viewBox="0 0 96 12" aria-label={`${definition.label}色卡`}>{colors.slice(0, 6).map((color, index) => <rect key={`${color}-${index}`} x={index * 16} width="16" height="12" fill={color.startsWith('--') ? `var(${color})` : color} />)}</svg>;
}

type ChartRow = { label: string; current: number | null; compare: number | null };
function chartRows(analysis: Analysis, measure: string, limit: number, positiveOnly = false): ChartRow[] {
  const rows = analysis.rows.map(row => ({ label: chartRowLabel(row), current: finiteNumber(row.values[measure]), compare: finiteNumber(row.compare_values[measure]) }))
    .filter(row => positiveOnly ? Number(row.current) > 0 || Number(row.compare) > 0 : row.current !== null || row.compare !== null)
    .sort((left, right) => Math.max(Math.abs(Number(right.current) || 0), Math.abs(Number(right.compare) || 0)) - Math.max(Math.abs(Number(left.current) || 0), Math.abs(Number(left.compare) || 0)));
  if (rows.length <= limit) return rows;
  const visible = rows.slice(0, Math.max(1, limit - 1));
  const remainder = rows.slice(Math.max(1, limit - 1));
  visible.push({ label: `其他（${remainder.length} 類）`, current: remainder.reduce((sum, row) => sum + (Number(row.current) || 0), 0), compare: remainder.reduce((sum, row) => sum + (Number(row.compare) || 0), 0) });
  return visible;
}

function MarketArcCharts({ analysis, measure, field, chartType, paletteId, customColors }: { analysis: Analysis; measure: string; field?: FieldDefinition; chartType: 'pie' | 'doughnut'; paletteId: PaletteId; customColors: string[] }) {
  const palette = useResolvedPalette(paletteId, customColors);
  const rows = useMemo(() => chartRows(analysis, measure, 10, true), [analysis, measure]);
  if (!rows.length) return <p className="market-empty">圓餅圖只呈現大於 0 的數值，此期間沒有可繪製資料。</p>;
  const pieOptions: ChartOptions<'pie'> = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: palette.text, boxWidth: 13, padding: 12 } }, tooltip: { enabled: true } } };
  const doughnutOptions: ChartOptions<'doughnut'> = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: palette.text, boxWidth: 13, padding: 12 } }, tooltip: { enabled: true } } };
  const renderChart = (period: 'current' | 'compare', title: string) => {
    const values = rows.map(row => Math.max(0, Number(row[period]) || 0));
    const data = { labels: rows.map(row => row.label), datasets: [{ label: `${title}${field?.unit ? `（${field.unit}）` : ''}`, data: values, backgroundColor: rows.map((_, index) => palette.colors[index % palette.colors.length]), borderColor: palette.panel, borderWidth: 2 }] };
    return <article className="market-chart-card"><h3>{title}</h3><div className="market-arc-canvas">{values.some(value => value > 0) ? chartType === 'pie' ? <Pie role="img" aria-label={`${title}${field?.label || measure}占比圓餅圖`} data={data} options={pieOptions} /> : <Doughnut role="img" aria-label={`${title}${field?.label || measure}占比甜甜圈圖`} data={data} options={doughnutOptions} /> : <p className="market-empty">此期間沒有大於 0 的資料。</p>}</div></article>;
  };
  const currentTotal = rows.reduce((sum, row) => sum + Math.max(0, Number(row.current) || 0), 0);
  const compareTotal = rows.reduce((sum, row) => sum + Math.max(0, Number(row.compare) || 0), 0);
  return <><div className="market-chart-grid">{renderChart('current', '本期')}{renderChart('compare', '比較期')}</div><details className="market-chart-summary"><summary>查看占比數值與百分比</summary><div className="responsive-table"><table><thead><tr><th>分類</th><th>本期</th><th>本期占比</th><th>比較期</th><th>比較期占比</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><td>{row.label}</td><td>{numberText(row.current)}</td><td>{currentTotal > 0 ? `${(Math.max(0, Number(row.current) || 0) / currentTotal * 100).toFixed(1)}%` : '—'}</td><td>{numberText(row.compare)}</td><td>{compareTotal > 0 ? `${(Math.max(0, Number(row.compare) || 0) / compareTotal * 100).toFixed(1)}%` : '—'}</td></tr>)}</tbody></table></div></details></>;
}

function MarketLineChart({ analysis, measure, field, chartType, paletteId, customColors }: { analysis: Analysis; measure: string; field?: FieldDefinition; chartType: 'line' | 'area'; paletteId: PaletteId; customColors: string[] }) {
  const palette = useResolvedPalette(paletteId, customColors);
  const rows = useMemo(() => chartRows(analysis, measure, 20), [analysis, measure]);
  if (!rows.length) return <p className="market-empty">此期間沒有可繪製的分類資料。</p>;
  const data = { labels: rows.map(row => row.label), datasets: [
    { label: '本期', data: rows.map(row => row.current), borderColor: palette.colors[0], backgroundColor: withAlpha(palette.colors[0], .18), borderWidth: 2, pointRadius: 3, pointStyle: 'circle' as const, tension: .28, fill: chartType === 'area', spanGaps: true },
    { label: '比較期', data: rows.map(row => row.compare), borderColor: palette.colors[1 % palette.colors.length], backgroundColor: withAlpha(palette.colors[1 % palette.colors.length], .1), borderDash: [7, 5], borderWidth: 2, pointRadius: 3, pointStyle: 'rectRot' as const, tension: .28, fill: chartType === 'area', spanGaps: true },
  ] };
  const options: ChartOptions<'line'> = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { color: palette.text, usePointStyle: true, padding: 18 } } }, scales: { x: { ticks: { color: palette.dim, maxRotation: 38, minRotation: 0 }, grid: { color: withAlpha(palette.grid, .45) } }, y: { ticks: { color: palette.dim }, grid: { color: withAlpha(palette.grid, .65) }, title: { display: Boolean(field?.unit), text: field?.unit || '', color: palette.dim } } } };
  return <div className="market-line-chart"><Line role="img" aria-label={`${field?.label || measure}${CHART_TYPE_LABELS[chartType]}，實線為本期、虛線為比較期`} data={data} options={options} /></div>;
}

function MarketColorCards({ analysis, measure, field, paletteId, customColors }: { analysis: Analysis; measure: string; field?: FieldDefinition; paletteId: PaletteId; customColors: string[] }) {
  const palette = useResolvedPalette(paletteId, customColors);
  return <div className="market-result-cards">{analysis.rows.slice(0, 20).map((row, index) => <article key={index} style={{ '--market-card-accent': palette.colors[index % palette.colors.length] } as CSSProperties}><b>{chartRowLabel(row)}</b><strong>{numberText(row.values[measure])}<small>{field?.unit || ''}</small></strong><span>比較期 {numberText(row.compare_values[measure])}</span><small>變化 {row.changes[measure] === null ? '—' : numberText(row.changes[measure])}</small></article>)}</div>;
}

function MarketSimulation({ analysis, sources, measures, fieldMap, paletteId, customColors }: { analysis: Analysis; sources: Source[]; measures: string[]; fieldMap: Map<string, FieldDefinition>; paletteId: PaletteId; customColors: string[] }) {
  const palette = useResolvedPalette(paletteId, customColors);
  const [scenarioName, setScenarioName] = useState(`${analysis.source.source_name} ${periodText(analysis.periods)} 情境`);
  const [adjustments, setAdjustments] = useState<Record<string, number>>({});
  const [runs, setRuns] = useState<SimulationRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { setAdjustments(current => Object.fromEntries(measures.map(measure => [measure, Number(current[measure]) || 0]))); }, [measures]);
  useEffect(() => { setScenarioName(`${analysis.source.source_name} ${periodText(analysis.periods)} 情境`); }, [analysis.source.source_name, analysis.periods.from, analysis.periods.to]);
  const loadRuns = useCallback(async () => {
    try { setRuns(await invokeAppApi<SimulationRun[]>('market_simulation_list')); }
    catch (error) { setMessage(error instanceof Error ? error.message : '模擬紀錄載入失敗'); }
  }, []);
  useEffect(() => { void loadRuns(); }, [loadRuns]);
  const projectedTotals = useMemo(() => Object.fromEntries(measures.map(measure => {
    const base = finiteNumber(analysis.totals.values[measure]);
    return [measure, base === null ? null : base * (1 + (Number(adjustments[measure]) || 0) / 100)];
  })), [analysis.totals.values, adjustments, measures]);
  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const measureLabels = Object.fromEntries(measures.map(measure => [measure, fieldMap.get(measure)?.label || measure]));
      await invokeAppApi<SimulationRun>('market_simulation_save', {
        name: scenarioName,
        source_id: analysis.source.source_id,
        period_from: analysis.periods.from,
        period_to: analysis.periods.to,
        base_totals: analysis.totals.values,
        assumptions: { model: '百分比情境推估', model_version: 1, adjustments, measure_labels: measureLabels },
        projected_totals: projectedTotals,
      });
      setMessage('行情模擬快照已保存，可於下方追蹤回查。'); await loadRuns();
    } catch (error) { setMessage(error instanceof Error ? error.message : '行情模擬保存失敗'); }
    finally { setBusy(false); }
  };
  const assumptionSummary = (run: SimulationRun) => {
    const values = run.assumptions.adjustments && typeof run.assumptions.adjustments === 'object' && !Array.isArray(run.assumptions.adjustments) ? run.assumptions.adjustments as Record<string, unknown> : {};
    const labels = run.assumptions.measure_labels && typeof run.assumptions.measure_labels === 'object' && !Array.isArray(run.assumptions.measure_labels) ? run.assumptions.measure_labels as Record<string, unknown> : {};
    const items = Object.entries(values).filter(([, value]) => Number(value) !== 0).map(([key, value]) => `${String(labels[key] || fieldMap.get(key)?.label || '分析指標')} ${Number(value) > 0 ? '+' : ''}${numberText(value)}%`);
    return items.length ? items.join('、') : '維持基準行情';
  };
  return <section className="panel market-simulation-panel">
    <header className="market-result-heading"><div><span className="market-kicker">SCENARIO SIMULATOR</span><h2>行情情境模擬</h2><p>以本期實際行情為基準調整指標，保存每次假設與結果，供後續追蹤比較。</p></div><span>百分比情境推估 v1</span></header>
    <div className="market-simulation-name"><label>情境名稱<input value={scenarioName} maxLength={120} onChange={event => setScenarioName(event.target.value)} /></label><p>此區為情境模擬，不代表統計預測；接入足夠歷史資料後可再升級預測模型。</p></div>
    <div className="market-simulation-grid">{measures.map((measure, index) => { const field = fieldMap.get(measure); const base = finiteNumber(analysis.totals.values[measure]); const projected = projectedTotals[measure]; const adjustment = Number(adjustments[measure]) || 0; return <article key={measure} style={{ '--market-card-accent': palette.colors[index % palette.colors.length] } as CSSProperties}><div><b>{field?.label || measure}</b><span>基準 {numberText(base, field?.aggregation === 'avg' ? 1 : 0)} {field?.unit || ''}</span></div><label>調整幅度<input type="number" min="-100" max="500" step="1" value={adjustment} onChange={event => setAdjustments(current => ({ ...current, [measure]: Math.max(-100, Math.min(500, Number(event.target.value) || 0)) }))} /><small>%</small></label><strong>{numberText(projected, field?.aggregation === 'avg' ? 1 : 0)}<small>{field?.unit || ''}</small></strong><em>{adjustment === 0 ? '維持' : `${adjustment > 0 ? '▲' : '▼'} ${numberText(Math.abs(adjustment))}%`}</em></article>; })}</div>
    <div className="market-simulation-actions"><span>保存後會記錄期間、假設、結果、建立者與時間，紀錄不可覆寫。</span><button type="button" className="primary-btn" disabled={busy || !scenarioName.trim()} onClick={() => void save()}>{busy ? '保存中…' : '保存模擬快照'}</button></div>
    {message && <p className="market-inline-message" role="status">{message}</p>}
    <div className="market-simulation-history"><header><h3>最近模擬紀錄</h3><button type="button" className="secondary-btn compact" onClick={() => void loadRuns()}>重新載入</button></header>{runs.length ? runs.slice(0, 8).map(run => <article key={run.simulation_id}><div><b>{run.name}</b><span>{sources.find(source => source.source_id === run.source_id)?.source_name || '市場行情資料'}　{periodText({ from: run.period_from, to: run.period_to })}</span></div><p>{assumptionSummary(run)}</p><time dateTime={run.created_at}>{dateTimeText(run.created_at)}</time></article>) : <p className="market-empty">尚未保存模擬紀錄。</p>}</div>
  </section>;
}

function MarketBars({ analysis, measure, field, paletteId, customColors }: { analysis: Analysis; measure: string; field?: FieldDefinition; paletteId: PaletteId; customColors: string[] }) {
  const palette = useResolvedPalette(paletteId, customColors);
  const rows = analysis.rows.filter(row => Number.isFinite(Number(row.values[measure])) || Number.isFinite(Number(row.compare_values[measure]))).slice(0, 20);
  const max = Math.max(1, ...rows.flatMap(row => [Number(row.values[measure]) || 0, Number(row.compare_values[measure]) || 0]));
  if (!rows.length) return <p className="market-empty">此期間沒有可繪製的資料。</p>;
  return <div className="market-bars" style={{ '--market-current-color': palette.colors[0], '--market-compare-color': palette.colors[1 % palette.colors.length] } as CSSProperties}>{rows.map((row, index) => {
    const name = Object.values(row.dimensions).join('／') || '全部';
    const current = Number(row.values[measure]) || 0, compare = Number(row.compare_values[measure]) || 0;
    return <div className="market-bar-row" key={`${name}-${index}`}>
      <div className="market-bar-label" title={name}>{name}</div>
      <div className="market-bar-pair" aria-label={`${name} 本期 ${numberText(current)}，比較期 ${numberText(compare)}`}>
        <svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true"><rect className="market-bar-current" x="0" y="0" width={Math.max(0, current / max * 100)} height="5" rx="2" /><rect className="market-bar-compare" x="0" y="7" width={Math.max(0, compare / max * 100)} height="5" rx="2" /></svg>
      </div>
      <div className="market-bar-values"><b>{numberText(current)}</b><small>{numberText(compare)} {field?.unit || ''}</small></div>
    </div>;
  })}</div>;
}

function AnalysisWorkspace({ sources, templates, reloadCatalog }: { sources: Source[]; templates: Template[]; reloadCatalog: () => Promise<void> }) {
  const [sourceId, setSourceId] = useState('');
    const [from, setFrom] = useState(TODAY);
  const [to, setTo] = useState(TODAY);
  const [compareFrom, setCompareFrom] = useState(addDays(TODAY, -1));
  const [compareTo, setCompareTo] = useState(addDays(TODAY, -1));
  const [compareMode, setCompareMode] = useState<'previous' | 'next' | 'same' | 'custom'>('previous');
  const [dimensions, setDimensions] = useState<string[]>([]);
  const [measures, setMeasures] = useState<string[]>([]);
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [chartMeasure, setChartMeasure] = useState('');
  const [paletteId, setPaletteId] = useState<PaletteId>('market');
  const [customColors, setCustomColors] = useState(DEFAULT_CUSTOM_COLORS);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const source = sources.find(item => item.source_id === sourceId) || sources[0];
  const dimensionFields = useMemo(() => (source?.field_definitions || []).filter(field => field.kind === 'dimension'), [source]);
  const measureFields = useMemo(() => (source?.field_definitions || []).filter(field => field.kind === 'measure'), [source]);
  const fieldMap = useMemo(() => new Map((source?.field_definitions || []).map(field => [field.key, field])), [source]);

  useEffect(() => {
    if (!source) return;
    setSourceId(current => current || source.source_id);
    setDimensions(current => current.length ? current.filter(key => dimensionFields.some(field => field.key === key)) : dimensionFields.slice(0, 2).map(field => field.key));
    setMeasures(current => current.length ? current.filter(key => measureFields.some(field => field.key === key)) : measureFields.slice(0, 2).map(field => field.key));
  }, [source, dimensionFields, measureFields]);
  useEffect(() => { setChartMeasure(current => measures.includes(current) ? current : measures[0] || measureFields[0]?.key || ''); }, [measures, measureFields]);

  const applyCompare = (mode: 'previous' | 'next' | 'same' | 'custom') => {
    setCompareMode(mode);
    if (mode === 'previous' || mode === 'next') {
      const offset = mode === 'previous' ? -rangeLength(from, to) : rangeLength(from, to);
      setCompareFrom(addDays(from, offset)); setCompareTo(addDays(to, offset));
    } else if (mode === 'same') {
      setCompareFrom(addYears(from, -1)); setCompareTo(addYears(to, -1));
    }
  };
  const load = useCallback(async () => {
    if (!source?.source_id) return;
    setBusy(true); setMessage('');
    try {
      const result = await invokeAppApi<Analysis>('market_analysis', { source_id: source.source_id, from, to, compare_from: compareFrom, compare_to: compareTo, dimensions, measures });
      setAnalysis(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : '行情分析載入失敗'); }
    finally { setBusy(false); }
  }, [source?.source_id, from, to, compareFrom, compareTo, dimensions, measures]);
  useEffect(() => { if (source?.source_id && !analysis && dimensions.length && measures.length) void load(); }, [source?.source_id, analysis, dimensions.length, measures.length, load]);

  const applyTemplate = (template: Template) => {
    if (template.source_id && sources.some(sourceItem => sourceItem.source_id === template.source_id)) setSourceId(template.source_id);
    setAnalysis(null);
    setDimensions(template.dimensions || []); setMeasures(template.measures || []); setChartType(template.chart_type || 'bar');
    setChartMeasure(chartMeasureFrom(template.default_config, template.measures || []));
    setPaletteId(paletteIdFrom(template.default_config));
    setCustomColors(normalizeCustomColors(template.default_config?.custom_colors));
    const compare = String(template.default_config?.compare || 'previous');
    if (['previous', 'next', 'same'].includes(compare)) applyCompare(compare as 'previous' | 'next' | 'same');
    setMessage(`已套用模板「${template.template_name}」，正在依新設定更新結果。`);
  };
  const primaryMeasure = measures.includes(chartMeasure) ? chartMeasure : measures[0] || measureFields[0]?.key || '';
  const primaryField = fieldMap.get(primaryMeasure);
  const demoTemplate = templates.find(template => template.template_code === 'market-demo-produce-share');

  return <div className="market-analysis-workspace">
    <section className="market-control-panel panel">
      <div className="market-section-heading"><div><span className="market-kicker">ANALYSIS WORKBENCH</span><h2>交易行情比較</h2><p>用同一套來源設定切換品項、市場、日期與指標；新增品項只要匯入資料，不必修改畫面。</p></div><div className="market-template-quick"><label>快速套用模板<select value="" onChange={event => { const template = templates.find(item => item.template_id === event.target.value); if (template) applyTemplate(template); }}><option value="">選擇分析模板</option>{templates.map(template => <option key={template.template_id} value={template.template_id}>{template.template_name}</option>)}</select></label>{demoTemplate && <button type="button" className="secondary-btn compact" onClick={() => applyTemplate(demoTemplate)}>載入非正式示範行情</button>}</div></div>
      <div className="market-control-grid">
        <label>資料來源<select value={source?.source_id || ''} onChange={event => { setSourceId(event.target.value); setAnalysis(null); }}><option value="">請選擇資料來源</option>{sources.map(item => <option key={item.source_id} value={item.source_id}>{item.source_name}</option>)}</select></label>
        <div className="market-period-group"><span>分析期間</span><div className="market-date-pair"><LocalizedDateInput aria-label="分析起始日期" value={from} onChange={event => { setFrom(event.target.value); setAnalysis(null); }} /><span>至</span><LocalizedDateInput aria-label="分析結束日期" value={to} onChange={event => { setTo(event.target.value); setAnalysis(null); }} /></div></div>
        <div className="market-period-group"><span>比較期間</span><div className="market-date-pair"><LocalizedDateInput aria-label="比較起始日期" value={compareFrom} onChange={event => { setCompareMode('custom'); setCompareFrom(event.target.value); setAnalysis(null); }} /><span>至</span><LocalizedDateInput aria-label="比較結束日期" value={compareTo} onChange={event => { setCompareMode('custom'); setCompareTo(event.target.value); setAnalysis(null); }} /></div></div>
      </div>
      <div className="market-compare-actions"><span>快速比較：</span><button type="button" className={compareMode === 'previous' ? 'active' : ''} onClick={() => applyCompare('previous')}>前一段期間</button><button type="button" className={compareMode === 'next' ? 'active' : ''} onClick={() => applyCompare('next')}>後一段期間</button><button type="button" className={compareMode === 'same' ? 'active' : ''} onClick={() => applyCompare('same')}>去年同期</button><button type="button" className={compareMode === 'custom' ? 'active' : ''} onClick={() => setCompareMode('custom')}>自訂</button></div>
      <div className="market-selector-grid"><fieldset><legend>分析維度（最多 4 個）</legend><div className="market-check-list">{dimensionFields.map(field => <label key={field.key}><input type="checkbox" checked={dimensions.includes(field.key)} disabled={!dimensions.includes(field.key) && dimensions.length >= 4} onChange={event => setDimensions(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key))} />{field.label}</label>)}</div></fieldset><fieldset><legend>分析指標（最多 4 個）</legend><div className="market-check-list">{measureFields.map(field => <label key={field.key}><input type="checkbox" checked={measures.includes(field.key)} disabled={!measures.includes(field.key) && measures.length >= 4} onChange={event => setMeasures(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key))} />{field.label}{field.unit ? `（${field.unit}）` : ''}</label>)}</div></fieldset></div>
      <div className="market-chart-settings"><label>圖表類型<select value={chartType} onChange={event => setChartType(event.target.value as ChartType)}>{CHART_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>圖表指標<select value={primaryMeasure} onChange={event => setChartMeasure(event.target.value)}>{measures.map(measure => <option key={measure} value={measure}>{fieldMap.get(measure)?.label || measure}</option>)}</select></label></div>
      <PalettePicker value={paletteId} customColors={customColors} onChange={setPaletteId} onCustomColorsChange={setCustomColors} />
      <div className="market-control-footer"><span>本期：{periodText({ from, to })}　比較：{periodText({ from: compareFrom, to: compareTo })}</span><button type="button" className="primary-btn" disabled={busy || !source} onClick={() => void load()}>{busy ? '分析中…' : '執行分析'}</button></div>
      {source?.source_code === 'market_demo' && <p className="market-demo-notice">目前使用非正式示範行情，僅供體驗圖表、色卡與情境模擬，不得作為實際交易決策。</p>}
      {message && <p className="market-inline-message" role="status">{message}</p>}
    </section>
    {analysis && <>
      <section className="market-kpi-grid">{measures.map(measure => { const field = fieldMap.get(measure); const current = analysis.totals.values[measure], compare = analysis.totals.compare_values[measure], change = analysis.totals.changes[measure]; const percent = current !== null && compare !== null && compare !== 0 ? (Number(change) / Number(compare) * 100) : null; return <article className="market-kpi-card" key={measure}><span>{field?.label || measure}</span><strong>{numberText(current, field?.aggregation === 'avg' ? 1 : 0)}<small>{field?.unit || ''}</small></strong><p>比較期 {numberText(compare, field?.aggregation === 'avg' ? 1 : 0)}　<span className={Number(change) >= 0 ? 'up' : 'down'}>{change === null ? '—' : `${Number(change) >= 0 ? '▲' : '▼'} ${numberText(Math.abs(Number(change)), field?.aggregation === 'avg' ? 1 : 0)}${percent === null ? '' : `（${Math.abs(percent).toFixed(1)}%）`}`}</span></p></article>; })}<article className="market-kpi-card market-kpi-neutral"><span>資料筆數</span><strong>{numberText(analysis.counts.current)}<small>筆</small></strong><p>比較期 {numberText(analysis.counts.compare)} 筆</p></article></section>
      <section className="panel market-result-panel"><header className="market-result-heading"><div><span className="market-kicker">RESULT</span><h2>{analysis.source.source_name}</h2><p>本期 {periodText(analysis.periods)}　｜　比較期 {periodText({ from: analysis.periods.compare_from, to: analysis.periods.compare_to })}</p></div><span>{analysis.rows.length} 組比較結果</span></header>{chartType === 'bar' && <MarketBars analysis={analysis} measure={primaryMeasure} field={primaryField} paletteId={paletteId} customColors={customColors} />}{(chartType === 'pie' || chartType === 'doughnut') && <MarketArcCharts analysis={analysis} measure={primaryMeasure} field={primaryField} chartType={chartType} paletteId={paletteId} customColors={customColors} />}{(chartType === 'line' || chartType === 'area') && <MarketLineChart analysis={analysis} measure={primaryMeasure} field={primaryField} chartType={chartType} paletteId={paletteId} customColors={customColors} />}{chartType === 'cards' && <MarketColorCards analysis={analysis} measure={primaryMeasure} field={primaryField} paletteId={paletteId} customColors={customColors} />}{chartType === 'table' && <div className="responsive-table market-result-table"><table><thead><tr>{dimensions.map(key => <th key={key}>{fieldMap.get(key)?.label || key}</th>)}{measures.map(key => <th key={key}>{fieldMap.get(key)?.label || key}（本期／比較）</th>)}<th>變化</th></tr></thead><tbody>{analysis.rows.map((row, index) => <tr key={index}>{dimensions.map(key => <td key={key}>{row.dimensions[key] || '未分類'}</td>)}{measures.map(key => <td key={key}>{numberText(row.values[key])} ／ {numberText(row.compare_values[key])}</td>)}<td>{numberText(row.changes[primaryMeasure])}</td></tr>)}</tbody></table></div>}</section>
      <MarketSimulation analysis={analysis} sources={sources} measures={measures} fieldMap={fieldMap} paletteId={paletteId} customColors={customColors} />
    </>}
    {!analysis && !busy && <div className="market-empty-panel panel">請選擇資料來源與比較期間，再執行分析。</div>}
  </div>;
}

function SourcesWorkspace({ sources, onSaved, reloadCatalog }: { sources: Source[]; onSaved: () => Promise<void>; reloadCatalog: () => Promise<void> }) {
  const [sourceCode, setSourceCode] = useState('market_daily_custom');
  const [sourceName, setSourceName] = useState('自訂交易行情');
  const [sourceType, setSourceType] = useState('csv');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [fieldText, setFieldText] = useState(fieldLines(DEFAULT_FIELDS));
  const [selectedId, setSelectedId] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const fields = useMemo(() => parseFieldLines(fieldText), [fieldText]);
  const selectedSource = selectedId ? sources.find(source => source.source_id === selectedId) : undefined;
  const openSource = (source: Source) => { setSelectedId(source.source_id); setSourceCode(source.source_code); setSourceName(source.source_name); setSourceType(source.source_type); setEndpointUrl(source.endpoint_url || ''); setFieldText(fieldLines(source.field_definitions)); setMessage(`已載入「${source.source_name}」設定，可直接修改後儲存。`); };
  const saveSource = async () => {
    setBusy(true); setMessage('');
    try {
      const saved = await invokeAppApi<Source>('market_source_save', { source_id: selectedId || undefined, source_code: sourceCode, source_name: sourceName, source_type: sourceType, endpoint_url: endpointUrl, field_definitions: fields });
      setSelectedId(saved.source_id);
      setMessage('資料來源設定已儲存。'); await onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : '資料來源儲存失敗'); }
    finally { setBusy(false); }
  };
  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    const parsed = file.name.toLowerCase().endsWith('.json') ? parseJsonRows(await file.text()) : parseCsv(await file.text()); setHeaders(parsed.headers); setCsvRows(parsed.rows);
    const next: Record<string, string> = {};
    const dateHeader = parsed.headers.find(header => /日期|date|day/i.test(header)) || parsed.headers[0] || '';
    next.observed_on = dateHeader;
    fields.forEach(field => { next[field.key] = parsed.headers.find(header => header.toLowerCase() === field.key || header === field.label) || ''; });
    setMapping(next); setMessage(`已讀取 ${parsed.rows.length} 筆 CSV，請確認欄位對應後匯入。`);
  };
  const importCsv = async () => {
    if (!selectedSource?.source_id || !csvRows.length) return;
    setBusy(true); setMessage('');
    try {
      const fieldList = selectedSource.field_definitions || fields;
      const rows = csvRows.map(values => { const value = (header: string) => header ? values[headers.indexOf(header)] || '' : ''; return { observed_on: dateText(value(mapping.observed_on)), dimensions: Object.fromEntries(fieldList.filter(field => field.kind === 'dimension').map(field => [field.key, value(mapping[field.key])])), measures: Object.fromEntries(fieldList.filter(field => field.kind === 'measure').map(field => [field.key, value(mapping[field.key])])), metadata: { import_file: 'csv' } }; });
      const result = await invokeAppApi<{ imported: number }>('market_import_rows', { source_id: selectedSource.source_id, rows });
      setMessage(`匯入完成，共 ${result.imported} 筆。`); setCsvRows([]); setHeaders([]); await reloadCatalog();
    } catch (error) { setMessage(error instanceof Error ? error.message : '行情資料匯入失敗'); }
    finally { setBusy(false); }
  };
  return <div className="market-sources-workspace">
    <section className="panel market-source-editor"><header className="market-result-heading"><div><span className="market-kicker">DATA CONNECTOR</span><h2>資料來源與欄位定義</h2><p>每個來源可以有自己的分類欄位與數值欄位，欄位以設定驅動，不綁定特定菜名。</p></div></header><div className="market-source-layout"><div className="market-source-list"><div className="market-source-list-head"><b>已建立來源</b><button type="button" className="secondary-btn compact" onClick={() => { setSelectedId(''); setSourceCode('market_daily_custom'); setSourceName('自訂交易行情'); setSourceType('csv'); setEndpointUrl(''); setFieldText(fieldLines(DEFAULT_FIELDS)); }}>＋ 新增來源</button></div>{sources.map(source => <button type="button" className={`market-source-item${selectedSource?.source_id === source.source_id ? ' active' : ''}`} key={source.source_id} onClick={() => openSource(source)}><b>{source.source_name}</b><span>{SOURCE_TYPE_LABELS[source.source_type] || source.source_type} ・ {source.field_definitions.length} 個欄位</span></button>)}</div><div className="market-source-form"><div className="market-form-grid"><label>介接代碼<input value={sourceCode} onChange={event => setSourceCode(event.target.value)} placeholder="例如 market_daily" /></label><label>來源名稱<input value={sourceName} onChange={event => setSourceName(event.target.value)} placeholder="例如 每日交易行情" /></label><label>來源類型<select value={sourceType} onChange={event => setSourceType(event.target.value)}><option value="csv">CSV 檔案</option><option value="json">JSON 資料</option><option value="api">外部 API</option><option value="manual">手動輸入</option></select></label><label>外部網址（選填）<input value={endpointUrl} onChange={event => setEndpointUrl(event.target.value)} placeholder="https://…" /></label></div><label className="market-field-definition">欄位定義（每行：代碼｜顯示名稱｜分類／數值｜單位｜彙總方式）<textarea value={fieldText} onChange={event => setFieldText(event.target.value)} rows={9} /><small>例如：item｜品項｜分類｜　　或　average_price｜平均價｜數值｜元／公斤｜平均</small></label><div className="market-field-preview"><b>目前辨識 {fields.length} 個欄位</b>{fields.map(field => <span key={field.key} className={field.kind}>{field.label}{field.unit ? `・${field.unit}` : ''}</span>)}</div><div className="market-form-actions"><button type="button" className="primary-btn" disabled={busy || fields.length < 2} onClick={() => void saveSource()}>{busy ? '儲存中…' : '儲存資料來源'}</button></div></div></div>{message && <p className="market-inline-message" role="status">{message}</p>}</section>
    <section className="panel market-import-panel"><header className="market-result-heading"><div><span className="market-kicker">IMPORT</span><h2>匯入 CSV／JSON 行情資料</h2><p>先選取上方資料來源，再上傳檔案；系統會保留原始資料摘要並依欄位定義轉換。JSON 可使用陣列或 <code>{'{ data: [...] }'}</code> 格式。</p></div></header><div className="market-import-toolbar"><label className="market-file-input">選擇 CSV／JSON 檔案<input type="file" accept=".csv,.json,text/csv,application/json" onChange={event => void handleFile(event)} /></label>{selectedSource && <span>目前來源：<b>{selectedSource.source_name}</b></span>}</div>{headers.length > 0 && <div className="market-mapping"><h3>欄位對應</h3><div className="market-mapping-grid"><label>交易日期<select value={mapping.observed_on || ''} onChange={event => setMapping(current => ({ ...current, observed_on: event.target.value }))}><option value="">請選擇</option>{headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>{(selectedSource?.field_definitions || fields).map(field => <label key={field.key}>{field.label}<select value={mapping[field.key] || ''} onChange={event => setMapping(current => ({ ...current, [field.key]: event.target.value }))}><option value="">不匯入</option>{headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>)}</div><div className="market-import-actions"><span>預覽 {csvRows.length} 筆資料</span><button type="button" className="primary-btn" disabled={busy || !selectedSource} onClick={() => void importCsv()}>{busy ? '匯入中…' : '確認匯入'}</button></div></div>}{message && <p className="market-inline-message" role="status">{message}</p>}</section>
  </div>;
}

function TemplatesWorkspace({ sources, templates, onSaved }: { sources: Source[]; templates: Template[]; onSaved: () => Promise<void> }) {
  const [templateCode, setTemplateCode] = useState('market_compare_custom');
  const [templateName, setTemplateName] = useState('自訂行情比較');
  const [description, setDescription] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [dimensions, setDimensions] = useState<string[]>([]);
  const [measures, setMeasures] = useState<string[]>([]);
  const [chartType, setChartType] = useState<ChartType>('bar');
  const [chartMeasure, setChartMeasure] = useState('');
  const [paletteId, setPaletteId] = useState<PaletteId>('market');
  const [customColors, setCustomColors] = useState(DEFAULT_CUSTOM_COLORS);
  const [compare, setCompare] = useState('previous');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const source = sources.find(item => item.source_id === sourceId) || sources[0];
  const fields = source?.field_definitions || [];
  useEffect(() => { setChartMeasure(current => measures.includes(current) ? current : measures[0] || ''); }, [measures]);
  const chooseTemplate = (template: Template) => {
    setTemplateCode(template.template_code); setTemplateName(template.template_name); setDescription(template.description || ''); setSourceId(template.source_id || '');
    setDimensions(template.dimensions || []); setMeasures(template.measures || []); setChartType(template.chart_type); setChartMeasure(chartMeasureFrom(template.default_config, template.measures || []));
    setCompare(String(template.default_config?.compare || 'previous')); setPaletteId(paletteIdFrom(template.default_config)); setCustomColors(normalizeCustomColors(template.default_config?.custom_colors));
    setMessage(`已載入「${template.template_name}」設定。`);
  };
  const save = async () => {
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('market_template_save', {
        template_code: templateCode, template_name: templateName, description, source_id: source?.source_id || undefined, dimensions, measures, chart_type: chartType,
        default_config: { compare, limit: 20, chart_measure: chartMeasure || measures[0] || '', palette_id: paletteId, custom_colors: paletteId === 'custom' ? normalizeCustomColors(customColors) : undefined },
      });
      setMessage('分析模板已儲存。'); await onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : '分析模板儲存失敗'); }
    finally { setBusy(false); }
  };
  return <div className="market-templates-workspace">
    <section className="panel market-template-editor">
      <header className="market-result-heading"><div><span className="market-kicker">TEMPLATE BUILDER</span><h2>分析模板設計</h2><p>把常用的品項、市場、指標、圖表與色卡保存起來，之後一鍵套用。</p></div><label>載入既有模板<select value="" onChange={event => { const template = templates.find(item => item.template_id === event.target.value); if (template) chooseTemplate(template); }}><option value="">選擇模板</option>{templates.map(template => <option key={template.template_id} value={template.template_id}>{template.template_name}</option>)}</select></label></header>
      <div className="market-form-grid"><label>模板代碼<input value={templateCode} onChange={event => setTemplateCode(event.target.value)} /></label><label>模板名稱<input value={templateName} onChange={event => setTemplateName(event.target.value)} /></label><label>資料來源<select value={source?.source_id || ''} onChange={event => setSourceId(event.target.value)}><option value="">選擇來源</option>{sources.map(item => <option key={item.source_id} value={item.source_id}>{item.source_name}</option>)}</select></label><label>比較預設<select value={compare} onChange={event => setCompare(event.target.value)}><option value="previous">前一段期間</option><option value="next">後一段期間</option><option value="same">去年同期</option><option value="custom">自訂</option></select></label></div>
      <label className="market-template-description">模板說明<textarea rows={2} value={description} onChange={event => setDescription(event.target.value)} placeholder="說明此模板適合的分析情境" /></label>
      <div className="market-selector-grid"><fieldset><legend>預設分析維度</legend><div className="market-check-list">{fields.filter(field => field.kind === 'dimension').map(field => <label key={field.key}><input type="checkbox" checked={dimensions.includes(field.key)} onChange={event => setDimensions(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key))} />{field.label}</label>)}</div></fieldset><fieldset><legend>預設分析指標</legend><div className="market-check-list">{fields.filter(field => field.kind === 'measure').map(field => <label key={field.key}><input type="checkbox" checked={measures.includes(field.key)} onChange={event => setMeasures(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key))} />{field.label}</label>)}</div></fieldset></div>
      <div className="market-chart-settings"><label>預設圖表<select value={chartType} onChange={event => setChartType(event.target.value as ChartType)}>{CHART_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>預設圖表指標<select value={chartMeasure || measures[0] || ''} onChange={event => setChartMeasure(event.target.value)}>{measures.map(measure => <option key={measure} value={measure}>{fields.find(field => field.key === measure)?.label || measure}</option>)}</select></label></div>
      <PalettePicker value={paletteId} customColors={customColors} onChange={setPaletteId} onCustomColorsChange={setCustomColors} />
      <div className="market-form-actions"><span>模板會同步保存圖表、指標、比較方式與色卡。</span><button type="button" className="primary-btn" disabled={busy || !measures.length} onClick={() => void save()}>{busy ? '儲存中…' : '儲存分析模板'}</button></div>
      {message && <p className="market-inline-message" role="status">{message}</p>}
    </section>
    <section className="market-template-library"><header><h2>模板庫</h2><span>{templates.length} 個已啟用模板</span></header>{templates.map(template => { const templatePaletteId = paletteIdFrom(template.default_config); return <article className="market-template-card" key={template.template_id}><div><span className="market-kicker">{CHART_TYPE_LABELS[template.chart_type] || '比較圖表'}</span><h3>{template.template_name}</h3><p>{template.description || '尚未填寫說明'}</p><PaletteStrip paletteId={templatePaletteId} customColors={normalizeCustomColors(template.default_config?.custom_colors)} /></div><button type="button" className="secondary-btn compact" onClick={() => chooseTemplate(template)}>編輯</button></article>; })}</section>
  </div>;
}

export function MarketAnalyticsWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  function Workspace({ profile }: { profile: Profile }) {
    const [sources, setSources] = useState<Source[]>([]);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const loadCatalog = useCallback(async () => { setLoading(true); setError(''); try { const result = await invokeAppApi<{ sources: Source[]; templates: Template[] }>('market_catalog'); setSources(result.sources || []); setTemplates(result.templates || []); } catch (loadError) { setError(loadError instanceof Error ? loadError.message : '市場分析設定載入失敗'); } finally { setLoading(false); } }, []);
    useEffect(() => { void loadCatalog(); }, [loadCatalog]);
    const page = module.key === 'sources' ? <SourcesWorkspace sources={sources} onSaved={loadCatalog} reloadCatalog={loadCatalog} /> : module.key === 'templates' ? <TemplatesWorkspace sources={sources} templates={templates} onSaved={loadCatalog} /> : <AnalysisWorkspace sources={sources} templates={templates} reloadCatalog={loadCatalog} />;
    return <AppShell profile={profile} title={system.title}><div className="page-actions"><div><p>{module.description}</p>{error && <span className="inline-message danger">{error}</span>}</div><div className="action-cluster"><button type="button" className="secondary-btn" disabled={loading} onClick={() => void loadCatalog()}>{loading ? '載入中…' : '重新載入設定'}</button></div></div>{loading && !sources.length ? <div className="market-empty-panel panel">正在載入市場分析設定…</div> : page}</AppShell>;
  }
  return <AuthGate>{profile => <Workspace profile={profile} />}</AuthGate>;
}
