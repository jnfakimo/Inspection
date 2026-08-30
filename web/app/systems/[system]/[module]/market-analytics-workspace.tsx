'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
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
  aggregation?: 'sum' | 'avg' | 'weighted_avg' | 'min' | 'max';
  weight_key?: string;
  required?: boolean;
};
type Source = {
  source_id: string;
  source_code: string;
  source_name: string;
  source_type: string;
  endpoint_url?: string | null;
  field_definitions: FieldDefinition[];
  config?: Record<string, unknown>;
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
  filters?: Record<string, string>;
  totals: { values: Record<string, number | null>; compare_values: Record<string, number | null>; changes: Record<string, number | null> };
  counts: { current: number; compare: number };
  quality?: {
    latest_observed_on?: string | null;
    current_loaded_count?: number;
    compare_loaded_count?: number;
    is_truncated?: boolean;
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
  market_summary?: Array<{
    market: string;
    values: Record<string, number | null>;
    compare_values: Record<string, number | null>;
  }>;
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
const CHART_TYPE_IDS = new Set<ChartType>(CHART_TYPE_OPTIONS.map(([value]) => value));
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
  { key: 'average_price', label: '平均價', kind: 'measure', unit: '元／公斤', aggregation: 'weighted_avg', weight_key: 'quantity' },
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
function configuredDate(value: unknown) {
  const normalized = dateText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return '';
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === normalized ? normalized : '';
}
function parseFieldLines(value: string): FieldDefinition[] {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [keyRaw, labelRaw, kindRaw, unitRaw, aggregationRaw, weightKeyRaw, requiredRaw] = line.split('|').map(part => part.trim());
    const key = keyRaw.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
    const kind: FieldDefinition['kind'] = kindRaw === '數值' || kindRaw === 'measure' ? 'measure' : 'dimension';
    const aggregationValue = ({ 總和: 'sum', 平均: 'avg', 加權平均: 'weighted_avg', 最低: 'min', 最高: 'max' } as Record<string, string>)[aggregationRaw || ''] || aggregationRaw;
    const aggregation = ['sum', 'avg', 'weighted_avg', 'min', 'max'].includes(aggregationValue || '') ? aggregationValue as FieldDefinition['aggregation'] : kind === 'measure' ? 'sum' : undefined;
    const weightKey = String(weightKeyRaw || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
    const required = ['必填', 'required', 'true', '1', '是'].includes(String(requiredRaw || '').toLowerCase());
    return { key, label: labelRaw || key, kind, unit: unitRaw || undefined, aggregation, weight_key: aggregation === 'weighted_avg' && weightKey ? weightKey : undefined, required };
  }).filter(field => /^[a-z][a-z0-9_-]{0,59}$/.test(field.key));
}
function fieldLines(fields: FieldDefinition[]) {
  const aggregationLabels = { sum: '總和', avg: '平均', weighted_avg: '加權平均', min: '最低', max: '最高' } as const;
  return fields.map(field => [field.key, field.label, field.kind === 'measure' ? '數值' : '分類', field.unit || '', field.aggregation ? aggregationLabels[field.aggregation] : '', field.weight_key || '', field.required ? '必填' : ''].join('|')).join('\n');
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
function marketSourceSchemaKey(source?: Source) {
  return source ? `${source.source_id}:${source.updated_at || ''}:${source.field_definitions.map(field => `${field.key}:${field.label}:${field.kind}:${field.unit || ''}:${field.aggregation || ''}:${field.weight_key || ''}:${field.required ? '1' : '0'}`).join('|')}` : '';
}
function validSelections(source: Source, requestedDimensions: string[] = [], requestedMeasures: string[] = []) {
  const dimensionFields = source.field_definitions.filter(field => field.kind === 'dimension');
  const measureFields = source.field_definitions.filter(field => field.kind === 'measure');
  const dimensionKeys = new Set(dimensionFields.map(field => field.key));
  const measureKeys = new Set(measureFields.map(field => field.key));
  const configuredDimensions = Array.isArray(source.config?.default_dimensions) ? source.config.default_dimensions.map(String) : [];
  const configuredMeasures = Array.isArray(source.config?.default_measures) ? source.config.default_measures.map(String) : [];
  const requestedDimensionKeys = [...new Set(requestedDimensions.length ? requestedDimensions : configuredDimensions)].slice(0, 4);
  const requestedMeasureKeys = [...new Set(requestedMeasures.length ? requestedMeasures : configuredMeasures)].slice(0, 4);
  const validDimensions = requestedDimensionKeys.filter(key => dimensionKeys.has(key));
  const validMeasures = requestedMeasureKeys.filter(key => measureKeys.has(key));
  return {
    dimensions: validDimensions.length ? validDimensions : dimensionFields.slice(0, 2).map(field => field.key),
    measures: validMeasures.length ? validMeasures : measureFields.slice(0, 2).map(field => field.key),
    validRequestedMeasures: validMeasures,
    invalidCount: requestedDimensionKeys.length - validDimensions.length + requestedMeasureKeys.length - validMeasures.length,
  };
}
function chartRowLabel(row: AnalysisRow) { return Object.values(row.dimensions).join('／') || '全部'; }
function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
function changePercent(currentValue: unknown, compareValue: unknown) {
  const current = finiteNumber(currentValue), compare = finiteNumber(compareValue);
  if (current === null || compare === null || compare === 0) return null;
  return (current - compare) / Math.abs(compare) * 100;
}
function signedPercentText(value: number | null) {
  if (value === null) return '無比較基準';
  if (Math.abs(value) < .05) return '持平 0.0%';
  return `${value > 0 ? '▲' : '▼'} ${Math.abs(value).toFixed(1)}%`;
}
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
function chartRows(analysis: Analysis, measure: string, limit: number, positiveOnly = false, aggregateRemainder = false, sortBy: 'combined' | 'current' = 'combined'): ChartRow[] {
  const rows = analysis.rows.map(row => ({ label: chartRowLabel(row), current: finiteNumber(row.values[measure]), compare: finiteNumber(row.compare_values[measure]) }))
    .filter(row => positiveOnly ? Number(row.current) > 0 || Number(row.compare) > 0 : row.current !== null || row.compare !== null)
    .sort((left, right) => sortBy === 'current'
      ? Math.abs(Number(right.current) || 0) - Math.abs(Number(left.current) || 0)
      : Math.max(Math.abs(Number(right.current) || 0), Math.abs(Number(right.compare) || 0)) - Math.max(Math.abs(Number(left.current) || 0), Math.abs(Number(left.compare) || 0)));
  if (rows.length <= limit) return rows;
  if (!aggregateRemainder) return rows.slice(0, limit);
  const visible = rows.slice(0, Math.max(1, limit - 1));
  const remainder = rows.slice(Math.max(1, limit - 1));
  visible.push({ label: `其他（${remainder.length} 類）`, current: remainder.reduce((sum, row) => sum + (Number(row.current) || 0), 0), compare: remainder.reduce((sum, row) => sum + (Number(row.compare) || 0), 0) });
  return visible;
}

function MarketArcCharts({ analysis, measure, field, chartType, paletteId, customColors }: { analysis: Analysis; measure: string; field?: FieldDefinition; chartType: 'pie' | 'doughnut'; paletteId: PaletteId; customColors: string[] }) {
  const palette = useResolvedPalette(paletteId, customColors);
  const rows = useMemo(() => chartRows(analysis, measure, 10, true, true), [analysis, measure]);
  if (analysis.quality?.groups_truncated) return <p className="market-empty">分類結果超過顯示上限，請縮小期間或減少維度後再查看占比。</p>;
  if (field?.aggregation !== 'sum') return <p className="market-empty">占比圖僅適用於交易量、交易金額等總和型指標，平均、最低或最高值不會合併為占比。</p>;
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
    { label: '本期', data: rows.map(row => row.current), borderColor: palette.colors[0], backgroundColor: withAlpha(palette.colors[0], .18), borderWidth: 2, pointRadius: 3, pointStyle: 'circle' as const, tension: .28, fill: chartType === 'area', spanGaps: false },
    { label: '比較期', data: rows.map(row => row.compare), borderColor: palette.colors[1 % palette.colors.length], backgroundColor: withAlpha(palette.colors[1 % palette.colors.length], .1), borderDash: [7, 5], borderWidth: 2, pointRadius: 3, pointStyle: 'rectRot' as const, tension: .28, fill: chartType === 'area', spanGaps: false },
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
    <header className="market-result-heading"><div><span className="market-kicker">情境模擬</span><h2>行情情境模擬</h2><p>以本期實際行情為基準調整指標，保存每次假設與結果，供後續追蹤比較。</p></div><span>百分比情境推估 v1</span></header>
    <div className="market-simulation-name"><label>情境名稱<input value={scenarioName} maxLength={120} onChange={event => setScenarioName(event.target.value)} /></label><p>此區為情境模擬，不代表統計預測；接入足夠歷史資料後可再升級預測模型。</p></div>
    <div className="market-simulation-grid">{measures.map((measure, index) => { const field = fieldMap.get(measure); const base = finiteNumber(analysis.totals.values[measure]); const projected = projectedTotals[measure]; const adjustment = Number(adjustments[measure]) || 0; const fraction = field?.aggregation === 'avg' || field?.aggregation === 'weighted_avg' ? 1 : 0; return <article key={measure} style={{ '--market-card-accent': palette.colors[index % palette.colors.length] } as CSSProperties}><div><b>{field?.label || measure}</b><span>基準 {numberText(base, fraction)} {field?.unit || ''}</span></div><label>調整幅度<input type="number" min="-100" max="500" step="1" value={adjustment} onChange={event => setAdjustments(current => ({ ...current, [measure]: Math.max(-100, Math.min(500, Number(event.target.value) || 0)) }))} /><small>%</small></label><strong>{numberText(projected, fraction)}<small>{field?.unit || ''}</small></strong><em>{adjustment === 0 ? '維持' : `${adjustment > 0 ? '▲' : '▼'} ${numberText(Math.abs(adjustment))}%`}</em></article>; })}</div>
    <div className="market-simulation-actions"><span>保存後會記錄期間、假設、結果、建立者與時間，紀錄不可覆寫。</span><button type="button" className="primary-btn" disabled={busy || !scenarioName.trim()} onClick={() => void save()}>{busy ? '保存中…' : '保存模擬快照'}</button></div>
    {message && <p className="market-inline-message" role="status">{message}</p>}
    <div className="market-simulation-history"><header><h3>最近模擬紀錄</h3><button type="button" className="secondary-btn compact" onClick={() => void loadRuns()}>重新載入</button></header>{runs.length ? runs.slice(0, 8).map(run => <article key={run.simulation_id}><div><b>{run.name}</b><span>{sources.find(source => source.source_id === run.source_id)?.source_name || '市場行情資料'}　{periodText({ from: run.period_from, to: run.period_to })}</span></div><p>{assumptionSummary(run)}</p><time dateTime={run.created_at}>{dateTimeText(run.created_at)}</time></article>) : <p className="market-empty">尚未保存模擬紀錄。</p>}</div>
  </section>;
}

function MarketBars({ analysis, measure, field, paletteId, customColors, limit = 20 }: { analysis: Analysis; measure: string; field?: FieldDefinition; paletteId: PaletteId; customColors: string[]; limit?: number }) {
  const palette = useResolvedPalette(paletteId, customColors);
  const rows = chartRows(analysis, measure, limit);
  const max = Math.max(1, ...rows.flatMap(row => [Number(row.current) || 0, Number(row.compare) || 0]));
  if (!rows.length) return <p className="market-empty">此期間沒有可繪製的資料。</p>;
  return <div className="market-bars" style={{ '--market-current-color': palette.colors[0], '--market-compare-color': palette.colors[1 % palette.colors.length] } as CSSProperties}>{rows.map((row, index) => {
    const name = row.label;
    const current = Number(row.current) || 0, compare = Number(row.compare) || 0;
    return <div className="market-bar-row" key={`${name}-${index}`}>
      <div className="market-bar-label" title={name}>{name}</div>
      <div className="market-bar-pair" aria-label={`${name} 本期 ${numberText(current)}，比較期 ${numberText(compare)}`}>
        <svg viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true"><rect className="market-bar-current" x="0" y="0" width={Math.max(0, current / max * 100)} height="5" rx="2" /><rect className="market-bar-compare" x="0" y="7" width={Math.max(0, compare / max * 100)} height="5" rx="2" /></svg>
      </div>
      <div className="market-bar-values"><b>{numberText(current)}</b><small>{numberText(compare)} {field?.unit || ''}</small></div>
    </div>;
  })}</div>;
}

function MarketDailyTrend({ analysis, measure, field, paletteId, customColors }: { analysis: Analysis; measure: string; field?: FieldDefinition; paletteId: PaletteId; customColors: string[] }) {
  const palette = useResolvedPalette(paletteId, customColors);
  const series = analysis.series || [];
  if (!series.length) return <MarketBars analysis={analysis} measure={measure} field={field} paletteId={paletteId} customColors={customColors} limit={8} />;
  const data = {
    labels: series.map(point => point.observed_on.slice(5).replace('-', '/')),
    datasets: [
      { label: '本期每日行情', data: series.map(point => finiteNumber(point.values[measure])), borderColor: palette.colors[0], backgroundColor: withAlpha(palette.colors[0], .16), borderWidth: 2.5, pointRadius: series.length > 45 ? 0 : 2.5, tension: .3, fill: true, spanGaps: false },
      { label: '比較期每日行情', data: series.map(point => finiteNumber(point.compare_values[measure])), borderColor: palette.colors[1 % palette.colors.length], backgroundColor: withAlpha(palette.colors[1 % palette.colors.length], .06), borderDash: [7, 5], borderWidth: 2, pointRadius: series.length > 45 ? 0 : 2.5, tension: .3, fill: false, spanGaps: false },
    ],
  };
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom', labels: { color: palette.text, usePointStyle: true, padding: 16 } } },
    scales: {
      x: { ticks: { color: palette.dim, maxTicksLimit: 10, maxRotation: 0 }, grid: { color: withAlpha(palette.grid, .35) } },
      y: { ticks: { color: palette.dim }, grid: { color: withAlpha(palette.grid, .55) }, title: { display: Boolean(field?.unit), text: field?.unit || '', color: palette.dim } },
    },
  };
  return <div className="market-daily-trend"><Line role="img" aria-label={`${field?.label || measure}每日行情，本期實線、比較期虛線`} data={data} options={options} /></div>;
}

function MarketShareSnapshot({ analysis, measure, field, paletteId, customColors }: { analysis: Analysis; measure: string; field?: FieldDefinition; paletteId: PaletteId; customColors: string[] }) {
  const palette = useResolvedPalette(paletteId, customColors);
  const rows = useMemo(() => chartRows(analysis, measure, 7, true, true, 'current').filter(row => Number(row.current) > 0), [analysis, measure]);
  const total = rows.reduce((sum, row) => sum + (Number(row.current) || 0), 0);
  if (analysis.quality?.groups_truncated) return <p className="market-empty">分類結果超過顯示上限，為避免誤判占比，請先縮小期間或減少分析維度。</p>;
  if (field?.aggregation !== 'sum') return <p className="market-empty">分類占比適用於交易量、交易金額等總和型指標；請在分析設定加入一項總和型指標。</p>;
  if (!rows.length || total <= 0) return <p className="market-empty">本期沒有可計算占比的正值資料。</p>;
  const data = { labels: rows.map(row => row.label), datasets: [{ data: rows.map(row => row.current), backgroundColor: rows.map((_, index) => palette.colors[index % palette.colors.length]), borderColor: palette.panel, borderWidth: 2 }] };
  const options: ChartOptions<'doughnut'> = { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false }, tooltip: { enabled: true } } };
  return <div className="market-share-layout">
    <div className="market-share-canvas"><Doughnut role="img" aria-label={`${field?.label || measure}本期分類占比`} data={data} options={options} /><div className="market-share-total"><span>本期合計</span><strong>{numberText(total)}</strong><small>{field?.unit || ''}</small></div></div>
    <ol className="market-share-legend">{rows.slice(0, 5).map((row, index) => <li key={row.label}><i className="market-share-dot" style={{ '--market-card-accent': palette.colors[index % palette.colors.length] } as CSSProperties} /><span title={row.label}>{row.label}</span><b>{(Number(row.current) / total * 100).toFixed(1)}%</b></li>)}</ol>
  </div>;
}

type MarketMovement = { label: string; current: number | null; compare: number | null; percent: number | null; state: 'comparable' | 'new' | 'disappeared' | 'zero-baseline' };
function marketMovements(analysis: Analysis, measure: string): MarketMovement[] {
  return analysis.rows.map((row): MarketMovement | null => {
    const current = finiteNumber(row.values[measure]), compare = finiteNumber(row.compare_values[measure]);
    if (current === null && compare === null) return null;
    if (compare === null) return { label: chartRowLabel(row), current, compare, percent: null, state: 'new' as const };
    if (current === null || (current === 0 && compare > 0)) return { label: chartRowLabel(row), current, compare, percent: null, state: 'disappeared' as const };
    if (compare === 0 && current !== 0) return { label: chartRowLabel(row), current, compare, percent: null, state: 'zero-baseline' as const };
    return { label: chartRowLabel(row), current, compare, percent: compare === 0 ? 0 : changePercent(current, compare), state: 'comparable' as const };
  }).filter((row): row is MarketMovement => Boolean(row)).sort((left, right) => Math.abs(right.percent || 0) - Math.abs(left.percent || 0));
}
function movementStateLabel(state: MarketMovement['state']) {
  return ({ new: '本期新增', disappeared: '本期消失', 'zero-baseline': '比較期為 0', comparable: '可比較' } as Record<MarketMovement['state'], string>)[state];
}

function MarketComparisonStrip({ analysis, fieldMap }: { analysis: Analysis; fieldMap: Map<string, FieldDefinition> }) {
  if (!analysis.dimensions.includes('market') || !analysis.measures.includes('quantity')) return null;
  const rows = (analysis.market_summary || []).map(row => ({
    market: row.market,
    quantity: finiteNumber(row.values.quantity) || 0,
    compareQuantity: finiteNumber(row.compare_values.quantity) || 0,
    value: finiteNumber(row.values.total_value),
    averagePrice: finiteNumber(row.values.average_price),
  })).sort((left, right) => right.quantity - left.quantity);
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  if (!rows.length) return null;
  return <section className="market-market-comparison" aria-label="市場別營運比較"><header><div><span className="market-kicker">市場別比較</span><h3>市場別營運比較</h3></div><span>成交額為推估值</span></header><div>{rows.map(row => {
    const quantityChange = changePercent(row.quantity, row.compareQuantity);
    return <article key={row.market}><div><b>{row.market}</b><span>占總成交量 {totalQuantity > 0 ? `${(row.quantity / totalQuantity * 100).toFixed(1)}%` : '—'}</span></div><dl><div><dt>{fieldMap.get('quantity')?.label || '成交量'}</dt><dd>{numberText(row.quantity)}<small>{fieldMap.get('quantity')?.unit || '公斤'}</small></dd></div>{analysis.measures.includes('total_value') && <div><dt>推估成交額</dt><dd>{numberText(row.value)}<small>{fieldMap.get('total_value')?.unit || '元'}</small></dd></div>}{analysis.measures.includes('average_price') && <div><dt>加權平均價</dt><dd>{numberText(row.averagePrice, 1)}<small>{fieldMap.get('average_price')?.unit || '元／公斤'}</small></dd></div>}</dl><p><span>相較比較期成交量</span><b className={quantityChange === null || Math.abs(quantityChange) < .05 ? 'steady' : quantityChange > 0 ? 'rise' : 'fall'}>{signedPercentText(quantityChange)}</b></p></article>;
  })}</div></section>;
}

function MarketExecutiveDashboard({ analysis, measures, fieldMap, primaryMeasure, paletteId, customColors, generatedAt }: { analysis: Analysis; measures: string[]; fieldMap: Map<string, FieldDefinition>; primaryMeasure: string; paletteId: PaletteId; customColors: string[]; generatedAt: string }) {
  const movements = useMemo(() => marketMovements(analysis, primaryMeasure), [analysis, primaryMeasure]);
  const primaryField = fieldMap.get(primaryMeasure);
  const priceMovement = primaryMeasure.includes('price') || primaryField?.unit === '元／公斤';
  const priceReliabilityReady = !priceMovement || analysis.measures.includes('quantity');
  const reliablePriceLabels = new Set(analysis.rows.filter(row => (finiteNumber(row.values.quantity) || 0) >= 1000 && (finiteNumber(row.compare_values.quantity) || 0) >= 1000).map(chartRowLabel));
  const decisionMovements = priceMovement ? priceReliabilityReady ? movements.filter(row => reliablePriceLabels.has(row.label)) : [] : movements;
  const comparableMovements = decisionMovements.filter((row): row is MarketMovement & { percent: number } => row.state === 'comparable' && row.percent !== null);
  const attentionRows = comparableMovements.filter(row => Math.abs(row.percent) >= 10);
  const exceptionalRows = decisionMovements.filter(row => row.state !== 'comparable');
  const watchRows = [...attentionRows, ...exceptionalRows].slice(0, 5);
  const rising = comparableMovements.filter(row => row.percent > 0).sort((left, right) => right.percent - left.percent)[0];
  const falling = comparableMovements.filter(row => row.percent < 0).sort((left, right) => left.percent - right.percent)[0];
  const shareMeasure = measures.find(measure => fieldMap.get(measure)?.aggregation === 'sum') || primaryMeasure;
  const shareField = fieldMap.get(shareMeasure);
  const primaryIsAdditive = primaryField?.aggregation === 'sum';
  const groupsTruncated = Boolean(analysis.quality?.groups_truncated);
  const totalGroupCount = analysis.quality?.total_group_count ?? analysis.rows.length;
  const returnedGroupCount = analysis.quality?.returned_group_count ?? analysis.rows.length;
  const positiveRows = chartRows(analysis, primaryMeasure, Math.max(1, analysis.rows.length), true).filter(row => Number(row.current) > 0);
  const positiveTotal = positiveRows.reduce((sum, row) => sum + (Number(row.current) || 0), 0);
  const leader = [...positiveRows].sort((left, right) => Number(right.current) - Number(left.current))[0];
  const activeDays = (analysis.series || []).filter(point => measures.some(measure => finiteNumber(point.values[measure]) !== null)).length;
  const compareActiveDays = (analysis.series || []).filter(point => measures.some(measure => finiteNumber(point.compare_values[measure]) !== null)).length;
  const activeDayChange = activeDays - compareActiveDays;
  const latestDate = analysis.quality ? analysis.quality.latest_observed_on || '本期無資料' : analysis.periods.to;
  const contextStatus = groupsTruncated
    ? `共 ${numberText(totalGroupCount)} 組，僅載入 ${numberText(returnedGroupCount)} 組`
    : watchRows.length
      ? `${attentionRows.length} 個大幅變動、${exceptionalRows.length} 個基準差異`
      : comparableMovements.length
        ? '未發現超過 10% 項目'
        : '比較資料不足';
  return <section className="panel market-command-center" aria-label="市場營運行情總覽">
    <header className="market-command-header">
      <div><span className="market-kicker">市場決策總覽</span><h2>市場營運行情總覽</h2><p>先掌握整體量價、占比與變動，再展開進階分析或情境模擬。</p></div>
      <div className="market-command-status"><span className="ready"><i />分析結果已更新</span><time dateTime={generatedAt}>{dateTimeText(generatedAt)}</time></div>
    </header>
    <div className="market-context-strip"><span><b>資料來源</b>{analysis.source.source_name}</span><span><b>本期</b>{periodText(analysis.periods)}</span><span><b>比較期</b>{periodText({ from: analysis.periods.compare_from, to: analysis.periods.compare_to })}</span><span><b>資料截止</b>{latestDate}</span><span><b>分析資料</b>{numberText(analysis.counts.current)} 筆</span><span className={!groupsTruncated && !watchRows.length && comparableMovements.length ? 'stable' : 'watching'}><b>變動觀察</b>{contextStatus}</span></div>
    <section className="market-kpi-grid">{measures.map(measure => {
      const field = fieldMap.get(measure), current = analysis.totals.values[measure], compare = analysis.totals.compare_values[measure], percent = changePercent(current, compare);
      const fraction = field?.aggregation === 'avg' || field?.aggregation === 'weighted_avg' ? 1 : 0;
      return <article className="market-kpi-card" key={measure}><span>{field?.label || measure}</span><strong>{numberText(current, fraction)}<small>{field?.unit || ''}</small></strong><p><span>比較期 {numberText(compare, fraction)}</span><b className={percent === null || Math.abs(percent) < .05 ? 'steady' : percent > 0 ? 'rise' : 'fall'}>{signedPercentText(percent)}</b></p></article>;
    })}<article className="market-kpi-card market-kpi-neutral"><span>有交易日數</span><strong>{numberText(activeDays)}<small>日</small></strong><p><span>比較期 {numberText(compareActiveDays)} 日</span><b className={activeDayChange === 0 ? 'steady' : activeDayChange > 0 ? 'rise' : 'fall'}>{activeDayChange === 0 ? '持平' : `${activeDayChange > 0 ? '▲' : '▼'} ${numberText(Math.abs(activeDayChange))} 日`}</b></p></article></section>
    <MarketComparisonStrip analysis={analysis} fieldMap={fieldMap} />
    <div className="market-command-grid">
      <article className="market-command-card market-command-trend"><header><div><span className="market-kicker">每日趨勢比較</span><h3>{analysis.series?.length ? '每日行情走勢' : '主要分類比較'}</h3></div><span>{primaryField?.label || primaryMeasure}・{primaryField?.unit || '數值'}</span></header><MarketDailyTrend analysis={analysis} measure={primaryMeasure} field={primaryField} paletteId={paletteId} customColors={customColors} /></article>
      <article className="market-command-card market-command-attention"><header><div><span className="market-kicker">變動觀察</span><h3>行情變動觀察</h3></div><span>{priceMovement ? priceReliabilityReady ? '門檻 ±10%・各期 ≥1,000 公斤' : '價格判讀需搭配成交量' : '門檻 ±10%'}</span></header>{groupsTruncated ? <div className="market-steady-state market-incomplete-state"><span>!</span><p><b>分類結果範圍過大</b>目前僅回傳 {numberText(returnedGroupCount)}／{numberText(totalGroupCount)} 組，請縮小期間或減少維度後再判讀。</p></div> : !priceReliabilityReady ? <div className="market-steady-state market-incomplete-state"><span>!</span><p><b>請加入成交量指標</b>價格預警需確認本期與比較期交易量皆達 1,000 公斤，避免用微量交易誤判行情。</p></div> : watchRows.length ? <ol className="market-attention-list">{watchRows.map(row => <li key={`${row.state}-${row.label}`}><div><b title={row.label}>{row.label}</b><span>本期 {numberText(row.current)}・比較期 {numberText(row.compare)}</span></div><strong className={row.state === 'disappeared' || (row.percent !== null && row.percent < 0) ? 'fall' : 'rise'}>{row.percent === null ? movementStateLabel(row.state) : signedPercentText(row.percent)}</strong>{row.percent !== null && <progress className={row.percent > 0 ? 'rise' : 'fall'} max="100" value={Math.min(100, Math.abs(row.percent))} aria-label={`${row.label}變動幅度 ${Math.abs(row.percent).toFixed(1)}%`} />}</li>)}</ol> : comparableMovements.length ? <div className="market-steady-state"><span>✓</span><p><b>目前波動平穩</b>所選指標沒有分類項目超過 ±10%。</p></div> : <div className="market-steady-state market-incomplete-state"><span>!</span><p><b>比較資料不足</b>{priceMovement ? '兩期成交量皆達 1,000 公斤的共同分類不足，暫不判定價格波動。' : '本期與比較期沒有可對照的共同分類，暫不判定波動。'}</p></div>}</article>
      <article className="market-command-card market-command-share"><header><div><span className="market-kicker">本期結構</span><h3>本期分類占比</h3></div><span>{shareField?.label || shareMeasure}</span></header><MarketShareSnapshot analysis={analysis} measure={shareMeasure} field={shareField} paletteId={paletteId} customColors={customColors} /></article>
      <article className="market-command-card market-command-insights"><header><div><span className="market-kicker">快速判讀</span><h3>快速判讀</h3></div><span>依目前篩選結果</span></header>{groupsTruncated ? <div className="market-steady-state market-incomplete-state"><span>!</span><p><b>暫停分類結論</b>分類結果尚未完整載入，主要分類與最大漲跌不會以部分資料推論。</p></div> : <><div className="market-insight-grid"><div><span>{primaryIsAdditive ? '本期主要分類' : '本期最高分類'}</span><strong>{leader?.label || '資料不足'}</strong><p>{leader ? primaryIsAdditive && positiveTotal > 0 ? `占本期 ${primaryField?.label || '指標'} ${(Number(leader.current) / positiveTotal * 100).toFixed(1)}%` : `${primaryField?.label || '本期值'} ${numberText(leader.current, primaryField?.aggregation === 'avg' || primaryField?.aggregation === 'weighted_avg' ? 1 : 0)} ${primaryField?.unit || ''}` : '尚無可判讀的資料'}</p></div><div><span>最大上升幅度</span><strong>{rising?.label || '無比較資料'}</strong><p className="rise">{rising ? signedPercentText(rising.percent) : '—'}</p></div><div><span>最大下降幅度</span><strong>{falling?.label || '無比較資料'}</strong><p className="fall">{falling ? signedPercentText(falling.percent) : '—'}</p></div></div><p className="market-insight-note">上升或下降僅代表數值方向，不代表營運好壞；請搭配交易量、價格與市場情境判讀。</p></>}</article>
    </div>
  </section>;
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
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [filterDrafts, setFilterDrafts] = useState<Record<string, string>>({});
  const [dimensionOptions, setDimensionOptions] = useState<Record<string, Array<{ value: string; count: number }>>>({});
  const [dimensionCatalogMessage, setDimensionCatalogMessage] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisGeneratedAt, setAnalysisGeneratedAt] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [configuredSchemaKey, setConfiguredSchemaKey] = useState('');
  const requestEpochRef = useRef(0);
  const source = sources.find(item => item.source_id === sourceId);
  const sourceSchemaKey = useMemo(() => marketSourceSchemaKey(source), [source]);
  const dimensionFields = useMemo(() => (source?.field_definitions || []).filter(field => field.kind === 'dimension'), [source]);
  const measureFields = useMemo(() => (source?.field_definitions || []).filter(field => field.kind === 'measure'), [source]);
  const fieldMap = useMemo(() => new Map((source?.field_definitions || []).map(field => [field.key, field])), [source]);
  const invalidateAnalysis = useCallback(() => { requestEpochRef.current += 1; setAnalysis(null); setBusy(false); }, []);
  const configureSourceDates = useCallback((nextSource: Source) => {
    const nextFrom = configuredDate(nextSource.config?.default_from);
    const nextTo = configuredDate(nextSource.config?.default_to);
    const nextCompareFrom = configuredDate(nextSource.config?.default_compare_from);
    const nextCompareTo = configuredDate(nextSource.config?.default_compare_to);
    if (nextFrom && nextTo && nextFrom <= nextTo) { setFrom(nextFrom); setTo(nextTo); }
    if (nextCompareFrom && nextCompareTo && nextCompareFrom <= nextCompareTo) {
      setCompareMode('custom'); setCompareFrom(nextCompareFrom); setCompareTo(nextCompareTo);
    } else {
      setCompareMode('previous');
    }
  }, []);

  useEffect(() => {
    if (!sourceId) {
      const preferred = sources.find(item => item.config?.is_default === true) || sources[0];
      if (preferred) { setSourceId(preferred.source_id); setConfiguredSchemaKey(''); configureSourceDates(preferred); }
      return;
    }
    if (!source) {
      invalidateAnalysis(); setSourceId(sources[0]?.source_id || ''); setConfiguredSchemaKey('');
      return;
    }
    if (!sourceSchemaKey || configuredSchemaKey === sourceSchemaKey) return;
    invalidateAnalysis();
    const next = validSelections(source, dimensions, measures);
    setDimensions(next.dimensions); setMeasures(next.measures);
    setChartMeasure(current => next.measures.includes(current) ? current : next.measures[0] || '');
    setConfiguredSchemaKey(sourceSchemaKey);
  }, [sourceId, sources, source, sourceSchemaKey, configuredSchemaKey, dimensions, measures, invalidateAnalysis, configureSourceDates]);
  useEffect(() => { setChartMeasure(current => measures.includes(current) ? current : measures[0] || measureFields[0]?.key || ''); }, [measures, measureFields]);
  useEffect(() => { requestEpochRef.current += 1; setBusy(false); }, [sourceId, from, to, compareFrom, compareTo, dimensions, measures, filters]);
  useEffect(() => {
    let active = true;
    setDimensionOptions({}); setDimensionCatalogMessage('');
    if (!source?.source_id) return () => { active = false; };
    void invokeAppApi<{ options: Record<string, Array<{ value: string; count: number }>> }>('market_dimension_catalog', { source_id: source.source_id })
      .then(result => { if (active) setDimensionOptions(result.options || {}); })
      .catch(error => { if (active) setDimensionCatalogMessage(error instanceof Error ? error.message : '篩選選項載入失敗，仍可直接輸入文字。'); });
    return () => { active = false; };
  }, [source?.source_id]);

  const selectSource = (nextSourceId: string) => {
    const nextSource = sources.find(item => item.source_id === nextSourceId);
    invalidateAnalysis(); setSourceId(nextSourceId); setConfiguredSchemaKey(''); setFilters({}); setFilterDrafts({}); setFiltersOpen(true);
    if (nextSource) configureSourceDates(nextSource);
  };

  const applyCompare = (mode: 'previous' | 'next' | 'same' | 'custom') => { setCompareMode(mode); if (mode !== 'custom') invalidateAnalysis(); };
  useEffect(() => {
    if (compareMode === 'previous' || compareMode === 'next') {
      const offset = compareMode === 'previous' ? -rangeLength(from, to) : rangeLength(from, to);
      setCompareFrom(addDays(from, offset)); setCompareTo(addDays(to, offset));
    } else if (compareMode === 'same') {
      const samePeriodFrom = addYears(from, -1);
      setCompareFrom(samePeriodFrom); setCompareTo(addDays(samePeriodFrom, rangeLength(from, to) - 1));
    }
  }, [from, to, compareMode]);
  const analysisRangeLength = rangeLength(from, to);
  const compareRangeLength = rangeLength(compareFrom, compareTo);
  const rangesValid = Boolean(from && to && compareFrom && compareTo && from <= to && compareFrom <= compareTo && analysisRangeLength <= 366 && compareRangeLength === analysisRangeLength);
  const compareDatesReady = rangesValid && (compareMode === 'custom' || (compareMode === 'same'
    ? compareFrom === addYears(from, -1) && compareTo === addDays(addYears(from, -1), analysisRangeLength - 1)
    : compareFrom === addDays(from, compareMode === 'previous' ? -analysisRangeLength : analysisRangeLength)
      && compareTo === addDays(to, compareMode === 'previous' ? -analysisRangeLength : analysisRangeLength)));
  const sourceFieldsReady = Boolean(source && configuredSchemaKey === sourceSchemaKey && dimensions.length && measures.length
    && dimensions.every(key => fieldMap.get(key)?.kind === 'dimension')
    && measures.every(key => fieldMap.get(key)?.kind === 'measure'));
  const load = useCallback(async () => {
    if (!source?.source_id || !sourceFieldsReady || !compareDatesReady) { setMessage('請確認資料來源、分析欄位，以及本期與比較期使用相同天數（最多 366 天）。'); return; }
    const requestEpoch = ++requestEpochRef.current;
    setBusy(true); setMessage('');
    try {
      const result = await invokeAppApi<Analysis>('market_analysis', { source_id: source.source_id, from, to, compare_from: compareFrom, compare_to: compareTo, dimensions, measures, filters });
      if (requestEpoch !== requestEpochRef.current) return;
      setAnalysis(result); setAnalysisGeneratedAt(new Date().toISOString()); setFiltersOpen(false);
    } catch (error) { if (requestEpoch === requestEpochRef.current) setMessage(error instanceof Error ? error.message : '行情分析載入失敗'); }
    finally { if (requestEpoch === requestEpochRef.current) setBusy(false); }
  }, [source?.source_id, sourceFieldsReady, compareDatesReady, from, to, compareFrom, compareTo, dimensions, measures, filters]);
  useEffect(() => { if (source?.source_id && !analysis && sourceFieldsReady && compareDatesReady) void load(); }, [source?.source_id, analysis, sourceFieldsReady, compareDatesReady, load]);

  const applyTemplate = (template: Template) => {
    const targetSource = template.source_id ? sources.find(sourceItem => sourceItem.source_id === template.source_id) : source;
    if (!targetSource) { setMessage('模板資料來源已停用或不存在，請先修正模板設定。'); return; }
    const next = validSelections(targetSource, template.dimensions || [], template.measures || []);
    if (!next.validRequestedMeasures.length) { setMessage(`模板「${template.template_name}」沒有可套用至目前資料來源的分析指標。`); return; }
    invalidateAnalysis();
    setFilters({});
    setFilterDrafts({});
    setSourceId(targetSource.source_id); setConfiguredSchemaKey(marketSourceSchemaKey(targetSource));
    setDimensions(next.dimensions); setMeasures(next.measures); setChartType(CHART_TYPE_IDS.has(template.chart_type) ? template.chart_type : 'bar');
    setChartMeasure(chartMeasureFrom(template.default_config, next.measures));
    setPaletteId(paletteIdFrom(template.default_config));
    setCustomColors(normalizeCustomColors(template.default_config?.custom_colors));
    const compare = String(template.default_config?.compare || 'previous');
    if (['previous', 'next', 'same'].includes(compare)) applyCompare(compare as 'previous' | 'next' | 'same');
    setMessage(`已套用模板「${template.template_name}」${next.invalidCount ? `，已忽略 ${next.invalidCount} 個不相容欄位` : ''}，正在依新設定更新結果。`);
  };
  const primaryMeasure = measures.includes(chartMeasure) ? chartMeasure : measures[0] || measureFields[0]?.key || '';
  const primaryField = fieldMap.get(primaryMeasure);
  const analysisFieldMap = useMemo(() => new Map((analysis?.fields || []).map(field => [field.key, field])), [analysis]);
  const resultPrimaryMeasure = analysis?.measures.includes(primaryMeasure) ? primaryMeasure : analysis?.measures[0] || primaryMeasure;
  const resultPrimaryField = analysisFieldMap.get(resultPrimaryMeasure) || primaryField;
  const demoTemplate = templates.find(template => template.template_code === 'market-demo-produce-share');

  return <div className="market-analysis-workspace">
    <section className="market-control-panel panel">
      <div className="market-section-heading"><div><span className="market-kicker">分析工作台</span><h2>交易行情比較</h2><p>首頁先呈現營運結論；需要更換資料來源、期間、指標或色卡時再展開設定。</p></div><div className="market-filter-actions"><div className="market-template-quick"><label>快速套用模板<select value="" onChange={event => { const template = templates.find(item => item.template_id === event.target.value); if (template) applyTemplate(template); }}><option value="">選擇分析模板</option>{templates.map(template => <option key={template.template_id} value={template.template_id}>{template.template_name}</option>)}</select></label>{demoTemplate && <button type="button" className="secondary-btn compact" onClick={() => applyTemplate(demoTemplate)}>載入非正式示範行情</button>}</div><button type="button" className="secondary-btn compact market-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)}>{filtersOpen ? '收合分析設定' : '調整分析條件'}</button></div></div>
      {!filtersOpen && analysis && <div className="market-filter-summary"><span>{analysis.source.source_name}</span><span>本期 {periodText(analysis.periods)}</span><span>比較期 {periodText({ from: analysis.periods.compare_from, to: analysis.periods.compare_to })}</span>{Object.entries(analysis.filters || {}).map(([key, value]) => <span key={key}>{analysisFieldMap.get(key)?.label || key}：{value}</span>)}<span>{analysis.measures.map(key => analysisFieldMap.get(key)?.label || key).join('、')}</span></div>}
      {filtersOpen && <div className="market-control-body">
        <div className="market-control-grid">
          <label>資料來源<select value={sourceId} onChange={event => selectSource(event.target.value)}><option value="">請選擇資料來源</option>{sources.map(item => <option key={item.source_id} value={item.source_id}>{item.source_name}</option>)}</select></label>
          <div className="market-period-group"><span>分析期間</span><div className="market-date-pair"><LocalizedDateInput aria-label="分析起始日期" value={from} onChange={event => { invalidateAnalysis(); setFrom(event.target.value); }} /><span>至</span><LocalizedDateInput aria-label="分析結束日期" value={to} onChange={event => { invalidateAnalysis(); setTo(event.target.value); }} /></div></div>
          <div className="market-period-group"><span>比較期間</span><div className="market-date-pair"><LocalizedDateInput aria-label="比較起始日期" value={compareFrom} onChange={event => { invalidateAnalysis(); setCompareMode('custom'); setCompareFrom(event.target.value); }} /><span>至</span><LocalizedDateInput aria-label="比較結束日期" value={compareTo} onChange={event => { invalidateAnalysis(); setCompareMode('custom'); setCompareTo(event.target.value); }} /></div></div>
        </div>
        <div className="market-compare-actions"><span>快速比較：</span><button type="button" className={compareMode === 'previous' ? 'active' : ''} onClick={() => applyCompare('previous')}>前一段期間</button><button type="button" className={compareMode === 'next' ? 'active' : ''} onClick={() => applyCompare('next')}>後一段期間</button><button type="button" className={compareMode === 'same' ? 'active' : ''} onClick={() => applyCompare('same')}>去年同期</button><button type="button" className={compareMode === 'custom' ? 'active' : ''} onClick={() => setCompareMode('custom')}>自訂</button></div>
        <div className="market-selector-grid"><fieldset><legend>分析維度（最多 4 個）</legend><div className="market-check-list">{dimensionFields.map(field => <label key={field.key}><input type="checkbox" checked={dimensions.includes(field.key)} disabled={!dimensions.includes(field.key) && dimensions.length >= 4} onChange={event => { invalidateAnalysis(); setDimensions(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key)); }} />{field.label}</label>)}</div></fieldset><fieldset><legend>分析指標（最多 4 個）</legend><div className="market-check-list">{measureFields.map(field => <label key={field.key}><input type="checkbox" checked={measures.includes(field.key)} disabled={!measures.includes(field.key) && measures.length >= 4} onChange={event => { invalidateAnalysis(); setMeasures(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key)); }} />{field.label}{field.unit ? `（${field.unit}）` : ''}</label>)}</div></fieldset></div>
        <section className="market-value-filters"><header><div><b>資料內容篩選</b><span>可從選項挑選，也可直接輸入來源中的市場、品類或品項；空白代表全部。</span></div><div className="market-value-filter-actions">{Object.values(filterDrafts).some(Boolean) && <button type="button" className="secondary-btn compact" onClick={() => { invalidateAnalysis(); setFilterDrafts({}); setFilters({}); }}>清除篩選</button>}<button type="button" className="primary-btn compact" onClick={() => { invalidateAnalysis(); setFilters(Object.fromEntries(Object.entries(filterDrafts).map(([key, value]) => [key, value.trim()]).filter(([, value]) => Boolean(value)))); }}>套用篩選</button></div></header><div>{dimensionFields.map(field => { const listId = `market-filter-${source?.source_id || 'source'}-${field.key}`; return <label key={field.key}>{field.label}<input list={listId} value={filterDrafts[field.key] || ''} onChange={event => setFilterDrafts(current => ({ ...current, [field.key]: event.target.value }))} placeholder={`全部${field.label}`} /><datalist id={listId}>{(dimensionOptions[field.key] || []).map(option => <option key={option.value} value={option.value}>{option.value}（{numberText(option.count)} 筆）</option>)}</datalist></label>; })}</div>{dimensionCatalogMessage && <small>{dimensionCatalogMessage}</small>}</section>
        <div className="market-chart-settings"><label>詳細圖表類型<select value={chartType} onChange={event => setChartType(event.target.value as ChartType)}>{CHART_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>主要判讀指標<select value={primaryMeasure} onChange={event => setChartMeasure(event.target.value)}>{measures.map(measure => <option key={measure} value={measure}>{fieldMap.get(measure)?.label || measure}</option>)}</select></label></div>
        <PalettePicker value={paletteId} customColors={customColors} onChange={setPaletteId} onCustomColorsChange={setCustomColors} />
        <div className="market-control-footer"><span>本期：{periodText({ from, to })}　比較：{periodText({ from: compareFrom, to: compareTo })}{!compareDatesReady ? '　（兩個期間須為相同天數，且最多 366 天）' : ''}</span><button type="button" className="primary-btn" disabled={busy || !sourceFieldsReady || !compareDatesReady} onClick={() => void load()}>{busy ? '分析中…' : '執行分析'}</button></div>
      </div>
      }
      {source?.source_code === 'market_demo' && <p className="market-demo-notice">目前使用非正式示範行情，僅供體驗圖表、色卡與情境模擬，不得作為實際交易決策。</p>}
      {source?.config?.is_actual === true && <p className="market-actual-notice"><b>實際資料範圍：</b>{String(source.config.data_scope || '第一市場、第二市場')}；{String(source.config.value_note || '交易金額為平均價乘以成交量的推估值。')}{source.config.data_quality_note ? `　資料品質：${String(source.config.data_quality_note)}` : ''}</p>}
      {message && <p className="market-inline-message" role="status">{message}</p>}
    </section>
    {analysis && <>
      <MarketExecutiveDashboard analysis={analysis} measures={analysis.measures} fieldMap={analysisFieldMap} primaryMeasure={resultPrimaryMeasure} paletteId={paletteId} customColors={customColors} generatedAt={analysisGeneratedAt || new Date().toISOString()} />
      <section className="panel market-result-panel"><header className="market-result-heading"><div><span className="market-kicker">分析結果</span><h2>{analysis.source.source_name}</h2><p>本期 {periodText(analysis.periods)}　｜　比較期 {periodText({ from: analysis.periods.compare_from, to: analysis.periods.compare_to })}</p></div><span>{analysis.quality?.groups_truncated ? `共 ${numberText(analysis.quality.total_group_count)} 組，目前載入 ${numberText(analysis.quality.returned_group_count)} 組` : `${analysis.rows.length} 組比較結果`}</span></header>{analysis.quality?.groups_truncated ? <div className="market-result-incomplete" role="status"><b>分類結果超過顯示上限</b><p>為避免用部分資料產生排行、占比或漲跌結論，詳細分類圖表已暫停。請縮小日期範圍或減少分析維度後重新執行。</p></div> : <>{chartType === 'bar' && <MarketBars analysis={analysis} measure={resultPrimaryMeasure} field={resultPrimaryField} paletteId={paletteId} customColors={customColors} />}{(chartType === 'pie' || chartType === 'doughnut') && <MarketArcCharts analysis={analysis} measure={resultPrimaryMeasure} field={resultPrimaryField} chartType={chartType} paletteId={paletteId} customColors={customColors} />}{(chartType === 'line' || chartType === 'area') && <MarketLineChart analysis={analysis} measure={resultPrimaryMeasure} field={resultPrimaryField} chartType={chartType} paletteId={paletteId} customColors={customColors} />}{chartType === 'cards' && <MarketColorCards analysis={analysis} measure={resultPrimaryMeasure} field={resultPrimaryField} paletteId={paletteId} customColors={customColors} />}{chartType === 'table' && <div className="responsive-table market-result-table"><table><thead><tr>{analysis.dimensions.map(key => <th key={key}>{analysisFieldMap.get(key)?.label || key}</th>)}{analysis.measures.map(key => <th key={key}>{analysisFieldMap.get(key)?.label || key}（本期／比較）</th>)}<th>變化</th></tr></thead><tbody>{analysis.rows.map((row, index) => <tr key={index}>{analysis.dimensions.map(key => <td key={key}>{row.dimensions[key] || '未分類'}</td>)}{analysis.measures.map(key => <td key={key}>{numberText(row.values[key])} ／ {numberText(row.compare_values[key])}</td>)}<td>{numberText(row.changes[resultPrimaryMeasure])}</td></tr>)}</tbody></table></div>}</>}</section>
      <MarketSimulation analysis={analysis} sources={sources} measures={analysis.measures} fieldMap={analysisFieldMap} paletteId={paletteId} customColors={customColors} />
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
    setBusy(true); setMessage(''); let processed = 0;
    try {
      const fieldList = selectedSource.field_definitions || fields;
      const rows = csvRows.map(values => { const value = (header: string) => header ? values[headers.indexOf(header)] || '' : ''; return { observed_on: dateText(value(mapping.observed_on)), dimensions: Object.fromEntries(fieldList.filter(field => field.kind === 'dimension').map(field => [field.key, value(mapping[field.key])])), measures: Object.fromEntries(fieldList.filter(field => field.kind === 'measure').map(field => [field.key, value(mapping[field.key])])), metadata: { import_file: 'csv' } }; });
      const dimensionKeys = new Set(fieldList.filter(field => field.kind === 'dimension').map(field => field.key));
      const configuredNaturalKeys = Array.isArray(selectedSource.config?.natural_key_fields)
        ? selectedSource.config.natural_key_fields.map(value => String(value)).filter(key => dimensionKeys.has(key))
        : [];
      const naturalKeyFields = configuredNaturalKeys.length ? [...new Set(configuredNaturalKeys)] : [...dimensionKeys];
      const rowIndexes = new Map<string, number>();
      rows.forEach((row, index) => {
        const naturalKey = JSON.stringify([row.observed_on, ...naturalKeyFields.map(key => `${key}=${row.dimensions[key] || ''}`)]);
        const previousIndex = rowIndexes.get(naturalKey);
        if (previousIndex !== undefined) throw new Error(`檔案第 ${previousIndex + 1} 列與第 ${index + 1} 列的日期及分類欄位重複；請先合併該筆行情後再匯入。`);
        rowIndexes.set(naturalKey, index);
      });
      const batchSize = 1500; let inserted = 0, updated = 0;
      for (let offset = 0; offset < rows.length; offset += batchSize) {
        const batch = rows.slice(offset, offset + batchSize);
        setMessage(`匯入中：${numberText(processed)}／${numberText(rows.length)} 筆；中斷後可安全重試。`);
        const result = await invokeAppApi<{ imported: number; inserted: number; updated: number }>('market_import_rows', { source_id: selectedSource.source_id, rows: batch });
        processed += result.imported; inserted += result.inserted; updated += result.updated;
      }
      setMessage(`匯入完成，共處理 ${numberText(processed)} 筆（新增 ${numberText(inserted)}、更新 ${numberText(updated)}）。`); setCsvRows([]); setHeaders([]); await reloadCatalog();
    } catch (error) { setMessage(`${error instanceof Error ? error.message : '行情資料匯入失敗'}${processed ? `；已完成 ${numberText(processed)} 筆，可用同一檔案安全重試。` : ''}`); }
    finally { setBusy(false); }
  };
  return <div className="market-sources-workspace">
      <section className="panel market-source-editor"><header className="market-result-heading"><div><span className="market-kicker">資料介接</span><h2>資料來源與欄位定義</h2><p>每個來源可以有自己的分類欄位與數值欄位，欄位以設定驅動，不綁定特定菜名。</p></div></header><div className="market-source-layout"><div className="market-source-list"><div className="market-source-list-head"><b>已建立來源</b><button type="button" className="secondary-btn compact" onClick={() => { setSelectedId(''); setSourceCode('market_daily_custom'); setSourceName('自訂交易行情'); setSourceType('csv'); setEndpointUrl(''); setFieldText(fieldLines(DEFAULT_FIELDS)); }}>＋ 新增來源</button></div>{sources.map(source => <button type="button" className={`market-source-item${selectedSource?.source_id === source.source_id ? ' active' : ''}`} key={source.source_id} onClick={() => openSource(source)}><b>{source.source_name}</b><span>{SOURCE_TYPE_LABELS[source.source_type] || source.source_type} ・ {source.field_definitions.length} 個欄位</span></button>)}</div><div className="market-source-form"><div className="market-form-grid"><label>介接代碼<input value={sourceCode} onChange={event => setSourceCode(event.target.value)} placeholder="例如 market_daily" /></label><label>來源名稱<input value={sourceName} onChange={event => setSourceName(event.target.value)} placeholder="例如 每日交易行情" /></label><label>來源類型<select value={sourceType} onChange={event => setSourceType(event.target.value)}><option value="csv">CSV 檔案</option><option value="json">JSON 資料</option><option value="api">外部 API</option><option value="manual">手動輸入</option></select></label><label>外部網址（選填）<input value={endpointUrl} onChange={event => setEndpointUrl(event.target.value)} placeholder="https://…" /></label></div><label className="market-field-definition">欄位定義（每行：代碼｜顯示名稱｜分類／數值｜單位｜彙總方式｜權重欄位｜是否必填）<textarea value={fieldText} onChange={event => setFieldText(event.target.value)} rows={9} /><small>例如：item｜品項｜分類｜｜｜｜必填　　或　average_price｜平均價｜數值｜元／公斤｜加權平均｜quantity</small></label><div className="market-field-preview"><b>目前辨識 {fields.length} 個欄位</b>{fields.map(field => <span key={field.key} className={field.kind}>{field.label}{field.unit ? `・${field.unit}` : ''}{field.required ? '・必填' : ''}</span>)}</div><div className="market-form-actions"><button type="button" className="primary-btn" disabled={busy || fields.length < 2} onClick={() => void saveSource()}>{busy ? '儲存中…' : '儲存資料來源'}</button></div></div></div>{message && <p className="market-inline-message" role="status">{message}</p>}</section>
    <section className="panel market-import-panel"><header className="market-result-heading"><div><span className="market-kicker">資料匯入</span><h2>匯入 CSV／JSON 行情資料</h2><p>先選取上方資料來源，再上傳檔案；系統會保留原始資料摘要並依欄位定義轉換。JSON 可使用陣列或 <code>{'{ data: [...] }'}</code> 格式。</p></div></header><div className="market-import-toolbar"><label className="market-file-input">選擇 CSV／JSON 檔案<input type="file" accept=".csv,.json,text/csv,application/json" onChange={event => void handleFile(event)} /></label>{selectedSource && <span>目前來源：<b>{selectedSource.source_name}</b></span>}</div>{headers.length > 0 && <div className="market-mapping"><h3>欄位對應</h3><div className="market-mapping-grid"><label>交易日期<select value={mapping.observed_on || ''} onChange={event => setMapping(current => ({ ...current, observed_on: event.target.value }))}><option value="">請選擇</option>{headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>{(selectedSource?.field_definitions || fields).map(field => <label key={field.key}>{field.label}<select value={mapping[field.key] || ''} onChange={event => setMapping(current => ({ ...current, [field.key]: event.target.value }))}><option value="">不匯入</option>{headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>)}</div><div className="market-import-actions"><span>預覽 {csvRows.length} 筆資料</span><button type="button" className="primary-btn" disabled={busy || !selectedSource} onClick={() => void importCsv()}>{busy ? '匯入中…' : '確認匯入'}</button></div></div>}{message && <p className="market-inline-message" role="status">{message}</p>}</section>
  </div>;
}

function TemplatesWorkspace({ sources, templates, onSaved }: { sources: Source[]; templates: Template[]; onSaved: () => Promise<void> }) {
  const [templateId, setTemplateId] = useState('');
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
    setTemplateId(template.template_id); setTemplateCode(template.template_code); setTemplateName(template.template_name); setDescription(template.description || ''); setSourceId(template.source_id || '');
    setDimensions(template.dimensions || []); setMeasures(template.measures || []); setChartType(template.chart_type); setChartMeasure(chartMeasureFrom(template.default_config, template.measures || []));
    setCompare(String(template.default_config?.compare || 'previous')); setPaletteId(paletteIdFrom(template.default_config)); setCustomColors(normalizeCustomColors(template.default_config?.custom_colors));
    setMessage(`已載入「${template.template_name}」設定。`);
  };
  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const saved = await invokeAppApi<Template>('market_template_save', {
        template_id: templateId || undefined, template_code: templateCode, template_name: templateName, description, source_id: source?.source_id || undefined, dimensions, measures, chart_type: chartType,
        default_config: { compare, limit: 20, chart_measure: chartMeasure || measures[0] || '', palette_id: paletteId, custom_colors: paletteId === 'custom' ? normalizeCustomColors(customColors) : undefined },
      });
      setTemplateId(saved.template_id); setMessage(templateId ? '分析模板已更新。' : '分析模板已建立。'); await onSaved();
    } catch (error) { setMessage(error instanceof Error ? error.message : '分析模板儲存失敗'); }
    finally { setBusy(false); }
  };
  return <div className="market-templates-workspace">
    <section className="panel market-template-editor">
      <header className="market-result-heading"><div><span className="market-kicker">模板設計</span><h2>分析模板設計</h2><p>把常用的品項、市場、指標、圖表與色卡保存起來，之後一鍵套用。</p></div><label>載入既有模板<select value="" onChange={event => { const template = templates.find(item => item.template_id === event.target.value); if (template) chooseTemplate(template); }}><option value="">選擇模板</option>{templates.map(template => <option key={template.template_id} value={template.template_id}>{template.template_name}</option>)}</select></label></header>
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
