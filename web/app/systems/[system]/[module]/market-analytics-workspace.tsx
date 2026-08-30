'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
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
  type PointStyle,
} from 'chart.js';
import { Doughnut, Line, Pie } from 'react-chartjs-2';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { MarketMovementBadge } from '@/components/MarketMovementBadge';
import { marketMovementPresentation } from '@/lib/market-movement';
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
  hidden?: boolean;
  filterable?: boolean;
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
type MarketDrillLevel = { key: string; label: string };
type MarketDrillStep = MarketDrillLevel & { value: string };
type AnalysisPeriodPreset = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

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
function periodBounds(anchor: string, preset: Exclude<AnalysisPeriodPreset, 'custom'>) {
  const parsed = new Date(`${anchor}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return { from: anchor, to: anchor };
  if (preset === 'day') return { from: anchor, to: anchor };
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth();
  if (preset === 'week') {
    const mondayOffset = (parsed.getUTCDay() + 6) % 7;
    const from = new Date(parsed);
    from.setUTCDate(from.getUTCDate() - mondayOffset);
    const to = new Date(from);
    to.setUTCDate(to.getUTCDate() + 6);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  if (preset === 'month') {
    return { from: `${year}-${String(month + 1).padStart(2, '0')}-01`, to: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10) };
  }
  if (preset === 'quarter') {
    const firstMonth = Math.floor(month / 3) * 3;
    return { from: `${year}-${String(firstMonth + 1).padStart(2, '0')}-01`, to: new Date(Date.UTC(year, firstMonth + 3, 0)).toISOString().slice(0, 10) };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
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
const IMPORT_HEADER_ALIASES: Record<string, string[]> = {
  observed_on: ['交易日期', '日期(西元)', '日期（西元）', '日期', 'date', 'day'],
  market: ['市場', '市場別', '市場名稱'],
  category: ['果菜類別', '蔬果大類', '蔬果類別', '品類', '類別'],
  item: ['品名', '品項', '品名名稱', '品項名稱'],
  item_key: ['品名代號', '品項代號', '品名編號', '品項編號', '代號'],
  quantity: ['成交量(公斤)', '成交量（公斤）', '成交量', '交易量', '數量'],
  average_price: ['平均價(元/公斤)', '平均價（元／公斤）', '平均價', '加權平均價'],
  high_price: ['上價', '最高上價', '最高價'],
  middle_price: ['中價', '成交量加權中價', '中間價'],
  low_price: ['下價', '最低下價', '最低價'],
  total_value: ['成交金額', '交易金額', '推估成交額', '成交額'],
};
function normalizedHeader(value: unknown) {
  return String(value || '').toLowerCase().replace(/[\s_()（）/／.,:：-]+/g, '');
}
function inferImportHeader(key: string, label: string, headers: string[]) {
  const candidates = [key, label, ...(IMPORT_HEADER_ALIASES[key] || [])].filter(Boolean);
  const normalizedCandidates = candidates.map(normalizedHeader).filter(Boolean);
  for (const candidate of normalizedCandidates) {
    const exact = headers.find(header => normalizedHeader(header) === candidate);
    if (exact) return exact;
  }
  const aliases = (IMPORT_HEADER_ALIASES[key] || []).map(normalizedHeader).filter(candidate => candidate.length >= 2);
  return headers.find(header => aliases.some(alias => normalizedHeader(header).includes(alias))) || '';
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
async function parseXlsxFile(file: File) {
  const { Workbook } = await import('exceljs');
  const workbook = new Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return { headers: [] as string[], rows: [] as string[][] };
  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, row => {
    const values = Array.from({ length: worksheet.columnCount }, (_, index) => {
      const value = row.getCell(index + 1).value;
      if (value instanceof Date) return value.toISOString().slice(0, 10);
      if (value && typeof value === 'object' && 'text' in value) return String((value as { text?: unknown }).text || '');
      return value === null || value === undefined ? '' : String(value);
    });
    if (values.some(Boolean)) rows.push(values);
  });
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
  return source ? `${source.source_id}:${source.updated_at || ''}:${source.field_definitions.map(field => `${field.key}:${field.label}:${field.kind}:${field.unit || ''}:${field.aggregation || ''}:${field.weight_key || ''}:${field.required ? '1' : '0'}:${field.hidden ? '1' : '0'}:${field.filterable === false ? '0' : '1'}`).join('|')}` : '';
}
function validSelections(source: Source, requestedDimensions: string[] = [], requestedMeasures: string[] = []) {
  const dimensionFields = source.field_definitions.filter(field => field.kind === 'dimension' && field.hidden !== true);
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
function signedNumberText(value: unknown, fraction = 0) {
  const numeric = finiteNumber(value);
  if (numeric === null) return '—';
  const sign = numeric > 0 ? '+' : numeric < 0 ? '−' : '';
  return `${sign}${numberText(Math.abs(numeric), fraction)}`;
}
function withAlpha(color: string, alpha: number) {
  const hex = color.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) return `rgba(${Number.parseInt(hex.slice(0, 2), 16)}, ${Number.parseInt(hex.slice(2, 4), 16)}, ${Number.parseInt(hex.slice(4, 6), 16)}, ${alpha})`;
  const rgb = color.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  return rgb ? `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})` : color;
}

function configuredFieldKeys(configured: unknown) {
  return Array.isArray(configured) ? [...new Set(configured.map(String).map(value => value.trim()).filter(Boolean))] : [];
}

function marketDrillHierarchy(fields: FieldDefinition[], configured?: unknown): MarketDrillLevel[] {
  const dimensions = fields.filter(field => field.kind === 'dimension' && field.hidden !== true);
  const configuredLevels = configuredFieldKeys(configured).flatMap(key => {
    const field = dimensions.find(candidate => candidate.key === key);
    return field ? [{ key: field.key, label: field.label }] : [];
  });
  if (configuredLevels.length >= 2) return configuredLevels;
  const definitions: Array<{ keys: string[]; labels: RegExp }> = [
    { keys: ['market', 'market_name', 'marketplace', 'venue'], labels: /市場|場別/u },
    { keys: ['category', 'item_category', 'product_category', 'commodity_category'], labels: /品類|商品分類|類別/u },
    { keys: ['item', 'item_name', 'product', 'product_name', 'commodity', 'commodity_name'], labels: /品項|品名|商品名稱|菜名/u },
  ];
  const used = new Set<string>();
  return definitions.flatMap(definition => {
    const field = dimensions.find(candidate => !used.has(candidate.key) && definition.keys.includes(candidate.key.toLowerCase()))
      || dimensions.find(candidate => !used.has(candidate.key) && definition.labels.test(candidate.label));
    if (!field) return [];
    used.add(field.key);
    return [{ key: field.key, label: field.label }];
  });
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
      current: colors[0],
      comparison: colors[1 % colors.length],
      rise: style?.getPropertyValue('--red').trim() || fallbacks['--red'],
      fall: style?.getPropertyValue('--green').trim() || fallbacks['--green'],
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

type ChartRow = { label: string; drillValue: string; current: number | null; compare: number | null };
function chartRows(analysis: Analysis, measure: string, limit: number, positiveOnly = false, aggregateRemainder = false, sortBy: 'combined' | 'current' = 'combined'): ChartRow[] {
  const drillDimension = analysis.dimensions.length === 1 ? analysis.dimensions[0] : '';
  const rows = analysis.rows.map(row => ({ label: chartRowLabel(row), drillValue: drillDimension ? row.dimensions[drillDimension] || '' : '', current: finiteNumber(row.values[measure]), compare: finiteNumber(row.compare_values[measure]) }))
    .filter(row => positiveOnly ? Number(row.current) > 0 || Number(row.compare) > 0 : row.current !== null || row.compare !== null)
    .sort((left, right) => sortBy === 'current'
      ? Math.abs(Number(right.current) || 0) - Math.abs(Number(left.current) || 0)
      : Math.max(Math.abs(Number(right.current) || 0), Math.abs(Number(right.compare) || 0)) - Math.max(Math.abs(Number(left.current) || 0), Math.abs(Number(left.compare) || 0)));
  if (rows.length <= limit) return rows;
  if (!aggregateRemainder) return rows.slice(0, limit);
  const visible = rows.slice(0, Math.max(1, limit - 1));
  const remainder = rows.slice(Math.max(1, limit - 1));
  visible.push({ label: `其他（${remainder.length} 類）`, drillValue: '', current: remainder.reduce((sum, row) => sum + (Number(row.current) || 0), 0), compare: remainder.reduce((sum, row) => sum + (Number(row.compare) || 0), 0) });
  return visible;
}

function MarketArcCharts({ analysis, measure, field, chartType, paletteId, customColors, canDrill = false, onDrill }: { analysis: Analysis; measure: string; field?: FieldDefinition; chartType: 'pie' | 'doughnut'; paletteId: PaletteId; customColors: string[]; canDrill?: boolean; onDrill?: (value: string) => void }) {
  const palette = useResolvedPalette(paletteId, customColors);
  const rows = useMemo(() => chartRows(analysis, measure, 10, true, true), [analysis, measure]);
  if (analysis.quality?.groups_truncated) return <p className="market-empty">分類結果超過顯示上限，請縮小期間或減少維度後再查看占比。</p>;
  if (field?.aggregation !== 'sum') return <p className="market-empty">占比圖僅適用於交易量、交易金額等總和型指標，平均、最低或最高值不會合併為占比。</p>;
  if (!rows.length) return <p className="market-empty">圓餅圖只呈現大於 0 的數值，此期間沒有可繪製資料。</p>;
  const drillFromElement = (index: number | undefined) => {
    const value = typeof index === 'number' ? rows[index]?.drillValue : '';
    if (canDrill && value) onDrill?.(value);
  };
  const pieOptions: ChartOptions<'pie'> = { responsive: true, maintainAspectRatio: false, onClick: (_event, elements) => drillFromElement(elements[0]?.index), plugins: { legend: { position: 'bottom', labels: { color: palette.text, boxWidth: 13, padding: 12 } }, tooltip: { enabled: true } } };
  const doughnutOptions: ChartOptions<'doughnut'> = { responsive: true, maintainAspectRatio: false, onClick: (_event, elements) => drillFromElement(elements[0]?.index), plugins: { legend: { position: 'bottom', labels: { color: palette.text, boxWidth: 13, padding: 12 } }, tooltip: { enabled: true } } };
  const renderChart = (period: 'current' | 'compare', title: string) => {
    const values = rows.map(row => Math.max(0, Number(row[period]) || 0));
    const data = { labels: rows.map(row => row.label), datasets: [{ label: `${title}${field?.unit ? `（${field.unit}）` : ''}`, data: values, backgroundColor: rows.map((_, index) => palette.colors[index % palette.colors.length]), borderColor: palette.panel, borderWidth: 2 }] };
    return <article className={`market-chart-card${canDrill ? ' market-chart-drillable' : ''}`}><h3>{title}{canDrill && <small>點選區塊下鑽</small>}</h3><div className="market-arc-canvas">{values.some(value => value > 0) ? chartType === 'pie' ? <Pie role="img" aria-label={`${title}${field?.label || measure}占比圓餅圖`} data={data} options={pieOptions} /> : <Doughnut role="img" aria-label={`${title}${field?.label || measure}占比甜甜圈圖`} data={data} options={doughnutOptions} /> : <p className="market-empty">此期間沒有大於 0 的資料。</p>}</div></article>;
  };
  const currentTotal = rows.reduce((sum, row) => sum + Math.max(0, Number(row.current) || 0), 0);
  const compareTotal = rows.reduce((sum, row) => sum + Math.max(0, Number(row.compare) || 0), 0);
  return <><div className="market-chart-grid">{renderChart('current', '本期')}{renderChart('compare', '比較期')}</div><details className="market-chart-summary"><summary>{canDrill ? '查看占比數值、百分比與鍵盤下鑽' : '查看占比數值與百分比'}</summary><div className="responsive-table"><table><thead><tr><th>分類</th><th>本期</th><th>本期占比</th><th>比較期</th><th>比較期占比</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><td>{canDrill && row.drillValue ? <button type="button" className="market-table-drill-button" onClick={() => onDrill?.(row.drillValue)}>{row.label}<span>展開下一層</span></button> : row.label}</td><td>{numberText(row.current)}</td><td>{currentTotal > 0 ? `${(Math.max(0, Number(row.current) || 0) / currentTotal * 100).toFixed(1)}%` : '—'}</td><td>{numberText(row.compare)}</td><td>{compareTotal > 0 ? `${(Math.max(0, Number(row.compare) || 0) / compareTotal * 100).toFixed(1)}%` : '—'}</td></tr>)}</tbody></table></div></details></>;
}

function MarketLineChart({ analysis, measure, field, chartType, paletteId, customColors, canDrill = false, onDrill }: { analysis: Analysis; measure: string; field?: FieldDefinition; chartType: 'line' | 'area'; paletteId: PaletteId; customColors: string[]; canDrill?: boolean; onDrill?: (value: string) => void }) {
  const palette = useResolvedPalette(paletteId, customColors);
  const rows = useMemo(() => chartRows(analysis, measure, 20), [analysis, measure]);
  if (!rows.length) return <p className="market-empty">此期間沒有可繪製的分類資料。</p>;
  const data = { labels: rows.map(row => row.label), datasets: [
    { label: '本期', data: rows.map(row => row.current), borderColor: palette.colors[0], backgroundColor: withAlpha(palette.colors[0], .18), borderWidth: 2, pointRadius: 3, pointStyle: 'circle' as const, tension: .28, fill: chartType === 'area', spanGaps: false },
    { label: '比較期', data: rows.map(row => row.compare), borderColor: palette.colors[1 % palette.colors.length], backgroundColor: withAlpha(palette.colors[1 % palette.colors.length], .1), borderDash: [7, 5], borderWidth: 2, pointRadius: 3, pointStyle: 'rectRot' as const, tension: .28, fill: chartType === 'area', spanGaps: false },
  ] };
  const options: ChartOptions<'line'> = { responsive: true, maintainAspectRatio: false, onClick: (_event, elements) => { const index = elements[0]?.index; const value = typeof index === 'number' ? rows[index]?.drillValue : ''; if (canDrill && value) onDrill?.(value); }, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { color: palette.text, usePointStyle: true, padding: 18 } } }, scales: { x: { ticks: { color: palette.dim, maxRotation: 38, minRotation: 0 }, grid: { color: withAlpha(palette.grid, .45) } }, y: { ticks: { color: palette.dim }, grid: { color: withAlpha(palette.grid, .65) }, title: { display: Boolean(field?.unit), text: field?.unit || '', color: palette.dim } } } };
  return <><div className={`market-line-chart${canDrill ? ' market-chart-drillable' : ''}`}><Line role="img" aria-label={`${field?.label || measure}${CHART_TYPE_LABELS[chartType]}，實線為本期、虛線為比較期${canDrill ? '，點選資料點可下鑽' : ''}`} data={data} options={options} /></div><details className="market-chart-summary"><summary>{canDrill ? '查看圖表數值與鍵盤下鑽' : '查看圖表數值'}</summary><div className="responsive-table"><table><thead><tr><th>分類</th><th>本期</th><th>比較期</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><td>{canDrill && row.drillValue ? <button type="button" className="market-table-drill-button" onClick={() => onDrill?.(row.drillValue)}>{row.label}<span>展開下一層</span></button> : row.label}</td><td>{numberText(row.current)}</td><td>{numberText(row.compare)}</td></tr>)}</tbody></table></div></details></>;
}

function MarketDifferenceSummary({ current, compare, difference, field }: { current: unknown; compare: unknown; difference?: unknown; field?: FieldDefinition }) {
  const fraction = field?.aggregation === 'avg' || field?.aggregation === 'weighted_avg' ? 1 : 0;
  const currentNumber = finiteNumber(current), compareNumber = finiteNumber(compare);
  const absoluteDifference = finiteNumber(difference) ?? (currentNumber !== null && compareNumber !== null ? currentNumber - compareNumber : null);
  return <span className="market-stock-difference"><MarketMovementBadge value={changePercent(currentNumber, compareNumber)} /><small>絕對差異 {signedNumberText(absoluteDifference, fraction)}{field?.unit ? ` ${field.unit}` : ''}</small></span>;
}

function MarketAbsoluteMovementBadge({ value, unit }: { value: unknown; unit: string }) {
  const numeric = finiteNumber(value);
  const tone = numeric === null ? 'neutral' : numeric > 0 ? 'rise' : numeric < 0 ? 'fall' : 'steady';
  const symbol = numeric === null ? '' : numeric > 0 ? '▲' : numeric < 0 ? '▼' : '—';
  const label = numeric === null ? '無比較基準' : numeric > 0 ? '增加' : numeric < 0 ? '減少' : '持平';
  const valueText = numeric === null || numeric === 0 ? '' : ` ${numberText(Math.abs(numeric))} ${unit}`;
  return <span className={`market-movement-badge ${tone}`} aria-label={`${label}${valueText}`}>
    {symbol && <span className="market-movement-glyph" aria-hidden="true">{symbol}</span>}
    <span>{label}{valueText}</span>
  </span>;
}

function MarketColorCards({ analysis, measure, field, paletteId, customColors, canDrill = false, onDrill }: { analysis: Analysis; measure: string; field?: FieldDefinition; paletteId: PaletteId; customColors: string[]; canDrill?: boolean; onDrill?: (value: string) => void }) {
  const palette = useResolvedPalette(paletteId, customColors);
  const drillDimension = analysis.dimensions.length === 1 ? analysis.dimensions[0] : '';
  return <div className="market-result-cards">{analysis.rows.slice(0, 20).map((row, index) => {
    const value = drillDimension ? row.dimensions[drillDimension] || '' : '';
    const name = chartRowLabel(row), current = row.values[measure], compare = row.compare_values[measure], difference = row.changes[measure];
    const movement = marketMovementPresentation(changePercent(current, compare));
    const classes = [canDrill && value ? 'market-result-card-drillable' : '', `market-card-${movement.tone}`].filter(Boolean).join(' ');
    const content = <><b>{name}</b><strong>{numberText(current)}<small>{field?.unit || ''}</small></strong><span>比較期 {numberText(compare)}</span><MarketDifferenceSummary current={current} compare={compare} difference={difference} field={field} /></>;
    return <article className={classes} key={index} style={{ '--market-card-accent': palette.colors[index % palette.colors.length] } as CSSProperties}>{canDrill && value ? <button type="button" onClick={() => onDrill?.(value)} aria-label={`展開「${name}」下一層；本期 ${numberText(current)} ${field?.unit || ''}；比較期 ${numberText(compare)} ${field?.unit || ''}；${movement.ariaLabel}`}>{content}</button> : content}</article>;
  })}</div>;
}

function MarketSimulation({ analysis, sources, measures, fieldMap, paletteId, customColors }: { analysis: Analysis; sources: Source[]; measures: string[]; fieldMap: Map<string, FieldDefinition>; paletteId: PaletteId; customColors: string[] }) {
  const palette = useResolvedPalette(paletteId, customColors);
  const [scenarioName, setScenarioName] = useState(`${analysis.source.source_name} ${periodText(analysis.periods)} 情境`);
  const [adjustments, setAdjustments] = useState<Record<string, number>>({});
  const [runs, setRuns] = useState<SimulationRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const allowedSourceIds = useMemo(() => new Set(sources.map(source => source.source_id)), [sources]);
  useEffect(() => { setAdjustments(current => Object.fromEntries(measures.map(measure => [measure, Number(current[measure]) || 0]))); }, [measures]);
  useEffect(() => { setScenarioName(`${analysis.source.source_name} ${periodText(analysis.periods)} 情境`); }, [analysis.source.source_name, analysis.periods.from, analysis.periods.to]);
  const loadRuns = useCallback(async () => {
    try {
      const result = await invokeAppApi<SimulationRun[]>('market_simulation_list');
      setRuns(result.filter(run => allowedSourceIds.has(run.source_id)));
    }
    catch (error) { setMessage(error instanceof Error ? error.message : '模擬紀錄載入失敗'); }
  }, [allowedSourceIds]);
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
    <div className="market-simulation-grid">{measures.map((measure, index) => { const field = fieldMap.get(measure); const base = finiteNumber(analysis.totals.values[measure]); const projected = projectedTotals[measure]; const adjustment = Number(adjustments[measure]) || 0; const fraction = field?.aggregation === 'avg' || field?.aggregation === 'weighted_avg' ? 1 : 0; const direction = adjustment > 0 ? 'rise' : adjustment < 0 ? 'fall' : 'steady'; const symbol = adjustment > 0 ? '▲' : adjustment < 0 ? '▼' : '—'; const label = adjustment > 0 ? '上調' : adjustment < 0 ? '下調' : '維持'; return <article className={`market-card-${direction}`} key={measure} style={{ '--market-card-accent': palette.colors[index % palette.colors.length] } as CSSProperties}><div><b>{field?.label || measure}</b><span>基準 {numberText(base, fraction)} {field?.unit || ''}</span></div><label>調整幅度<input type="number" min="-100" max="500" step="1" value={adjustment} onChange={event => setAdjustments(current => ({ ...current, [measure]: Math.max(-100, Math.min(500, Number(event.target.value) || 0)) }))} /><small>%</small></label><strong>{numberText(projected, fraction)}<small>{field?.unit || ''}</small></strong><em><span className={`market-movement-badge ${direction}`} aria-label={`${label} ${numberText(Math.abs(adjustment))}%`}><span className="market-movement-glyph" aria-hidden="true">{symbol}</span><span>{label} {numberText(Math.abs(adjustment))}%</span></span></em></article>; })}</div>
    <div className="market-simulation-actions"><span>保存後會記錄期間、假設、結果、建立者與時間，紀錄不可覆寫。</span><button type="button" className="primary-btn" disabled={busy || !scenarioName.trim()} onClick={() => void save()}>{busy ? '保存中…' : '保存模擬快照'}</button></div>
    {message && <p className="market-inline-message" role="status">{message}</p>}
    <div className="market-simulation-history"><header><h3>最近模擬紀錄</h3><button type="button" className="secondary-btn compact" onClick={() => void loadRuns()}>重新載入</button></header>{runs.length ? runs.slice(0, 8).map(run => <article key={run.simulation_id}><div><b>{run.name}</b><span>{sources.find(source => source.source_id === run.source_id)?.source_name || '市場行情資料'}　{periodText({ from: run.period_from, to: run.period_to })}</span></div><p>{assumptionSummary(run)}</p><time dateTime={run.created_at}>{dateTimeText(run.created_at)}</time></article>) : <p className="market-empty">尚未保存模擬紀錄。</p>}</div>
  </section>;
}

function MarketBars({ analysis, measure, field, paletteId, customColors, limit = 20, canDrill = false, onDrill }: { analysis: Analysis; measure: string; field?: FieldDefinition; paletteId: PaletteId; customColors: string[]; limit?: number; canDrill?: boolean; onDrill?: (value: string) => void }) {
  const guideId = useId();
  const palette = useResolvedPalette(paletteId, customColors);
  const rows = chartRows(analysis, measure, limit);
  const max = Math.max(1, ...rows.flatMap(row => [Number(row.current) || 0, Number(row.compare) || 0]));
  if (!rows.length) return <p className="market-empty">此期間沒有可繪製的資料。</p>;
  const dimensionLabel = analysis.dimensions.map(key => analysis.fields.find(item => item.key === key)?.label || key).join('／') || '分類項目';
  const measureLabel = field?.label || measure;
  const unitLabel = field?.unit || '無單位';
  const unitHeading = field?.unit ? `（${field.unit}）` : '';
  const valueFraction = field?.aggregation === 'avg' || field?.aggregation === 'weighted_avg' ? 1 : 0;
  const currentPeriod = periodText(analysis.periods);
  const comparePeriod = periodText({ from: analysis.periods.compare_from, to: analysis.periods.compare_to });
  const rowSummary = analysis.rows.length > rows.length
    ? `顯示前 ${rows.length} 組，共 ${analysis.rows.length} 組；依兩期較大值由高到低排序。`
    : `共 ${rows.length} 組；依兩期較大值由高到低排序。`;
  const scaleTicks = [0, .25, .5, .75, 1];
  return <figure className="market-bar-chart" aria-labelledby={guideId} style={{ '--market-current-color': palette.colors[0], '--market-compare-color': palette.colors[1 % palette.colors.length] } as CSSProperties}>
    <figcaption className="market-bar-guide">
      <h3 id={guideId}>如何閱讀這張比較圖</h3>
      <div className="market-bar-legend" aria-label="圖例">
        <div><i className="market-bar-legend-current" aria-hidden="true" /><span><b>本期（上方長條）</b><small>{currentPeriod}</small></span></div>
        <div><i className="market-bar-legend-compare" aria-hidden="true" /><span><b>比較期（下方長條）</b><small>{comparePeriod}</small></span></div>
      </div>
      <dl className="market-bar-axis-help">
        <div><dt>X 軸（橫向）</dt><dd>{measureLabel}（{unitLabel}）；長條越長，代表數值越高。</dd></div>
        <div><dt>Y 軸（縱向）</dt><dd>{dimensionLabel}；每一列代表一個比較項目。</dd></div>
      </dl>
      <p className="market-bar-reading"><b>讀圖方式：</b>同一列先比較上、下兩條的長度，再看右側「本期／比較期」精確數字。兩種顏色代表比較期間，不代表第一／第二市場；市場範圍以上方篩選條件為準。長條以全圖最大值同比例縮放；{rowSummary}{canDrill ? ' 點選任一列或按 Enter，可展開下一層分類。' : ''}</p>
    </figcaption>
    <div className="market-bar-axis" aria-label={`Y 軸為${dimensionLabel}，X 軸為${measureLabel}，單位${unitLabel}`}>
      <b>Y 軸 · {dimensionLabel}</b>
      <div className="market-bar-axis-main"><strong>X 軸 · {measureLabel}（{unitLabel}）</strong><div className="market-bar-scale" aria-hidden="true">{scaleTicks.map((tick, index) => <span className={index % 2 ? 'minor' : ''} key={tick}>{numberText(max * tick, valueFraction)}</span>)}</div></div>
      <b>右側 · 精確值</b>
    </div>
    <div className="market-bars">{rows.map((row, index) => {
      const name = row.label;
      const current = Number(row.current) || 0, compare = Number(row.compare) || 0;
      const spokenUnit = field?.unit ? ` ${field.unit}` : '';
      const currentText = row.current === null ? '—' : numberText(row.current, valueFraction);
      const compareText = row.compare === null ? '—' : numberText(row.compare, valueFraction);
      const currentSpoken = row.current === null ? '無資料' : `${currentText}${spokenUnit}`;
      const compareSpoken = row.compare === null ? '無資料' : `${compareText}${spokenUnit}`;
      return <div className={`market-bar-row${canDrill && row.drillValue ? ' market-bar-drillable' : ''}`} role="group" aria-label={`${name}，本期 ${currentSpoken}，比較期 ${compareSpoken}`} key={`${name}-${index}`}>
        {canDrill && row.drillValue && <button type="button" className="market-bar-drill-button" aria-label={`展開「${name}」的下一層分類`} onClick={() => onDrill?.(row.drillValue)} />}
        <div className="market-bar-label" title={name}>{name}</div>
        <div className="market-bar-pair" aria-hidden="true">
          <svg viewBox="0 0 100 12" preserveAspectRatio="none"><rect className="market-bar-current" x="0" y="0" width={Math.max(0, current / max * 100)} height="5" rx="2" /><rect className="market-bar-compare" x="0" y="7" width={Math.max(0, compare / max * 100)} height="5" rx="2" /></svg>
        </div>
        <div className="market-bar-values"><span className="current"><em>本期</em><b>{currentText}<small>{row.current === null ? '無資料' : field?.unit || ''}</small></b></span><span className="compare"><em>比較期</em><b>{compareText}<small>{row.compare === null ? '無資料' : field?.unit || ''}</small></b></span></div>
      </div>;
    })}</div>
    <details className="market-chart-summary market-bar-summary"><summary>查看圖中 {rows.length} 組完整數值{canDrill ? '與鍵盤下鑽' : ''}</summary><div className="responsive-table"><table><thead><tr><th>{dimensionLabel}</th><th>本期{unitHeading}</th><th>比較期{unitHeading}</th></tr></thead><tbody>{rows.map(row => <tr key={row.label}><th scope="row">{canDrill && row.drillValue ? <button type="button" className="market-table-drill-button" onClick={() => onDrill?.(row.drillValue)}>{row.label}<span>展開下一層</span></button> : row.label}</th><td>{row.current === null ? '—' : numberText(row.current, valueFraction)}</td><td>{row.compare === null ? '—' : numberText(row.compare, valueFraction)}</td></tr>)}</tbody></table></div></details>
  </figure>;
}

function MarketDailyTrend({ analysis, measure, field, paletteId, customColors }: { analysis: Analysis; measure: string; field?: FieldDefinition; paletteId: PaletteId; customColors: string[] }) {
  const palette = useResolvedPalette(paletteId, customColors);
  const series = analysis.series || [];
  if (!series.length) return <MarketBars analysis={analysis} measure={measure} field={field} paletteId={paletteId} customColors={customColors} limit={8} />;
  const fraction = field?.aggregation === 'avg' || field?.aggregation === 'weighted_avg' ? 1 : 0;
  const currentValues = series.map(point => finiteNumber(point.values[measure]));
  const compareValues = series.map(point => finiteNumber(point.compare_values[measure]));
  const movements = currentValues.map((current, index) => marketMovementPresentation(changePercent(current, compareValues[index])));
  const pointStyles: PointStyle[] = movements.map(movement => movement.tone === 'rise' || movement.tone === 'fall' ? 'triangle' : movement.tone === 'steady' ? 'dash' : 'circle');
  const pointRotations = movements.map(movement => movement.tone === 'fall' ? 180 : 0);
  const pointColors = movements.map(movement => movement.tone === 'rise' ? palette.rise : movement.tone === 'fall' ? palette.fall : palette.dim);
  const validCurrentIndices = currentValues.flatMap((value, index) => value === null ? [] : [index]);
  const markerStep = Math.max(1, Math.ceil(validCurrentIndices.length / 45));
  const visiblePointIndices = new Set(validCurrentIndices.filter((_index, position) => position === 0 || position === validCurrentIndices.length - 1 || position % markerStep === 0));
  const pointRadii = series.map((_point, index) => visiblePointIndices.has(index) ? 4 : 0);
  const data = {
    labels: series.map(point => point.observed_on.slice(5).replace('-', '/')),
    datasets: [
      { label: '本期每日行情（實線）', data: currentValues, borderColor: palette.current, backgroundColor: withAlpha(palette.current, .12), borderWidth: 2.5, pointBackgroundColor: pointColors, pointBorderColor: palette.panel, pointBorderWidth: 1.5, pointStyle: pointStyles, pointRotation: pointRotations, pointRadius: pointRadii, pointHoverRadius: 6, pointHitRadius: 10, tension: .3, fill: true, spanGaps: false },
      { label: '比較期每日行情（虛線）', data: compareValues, borderColor: palette.comparison, backgroundColor: withAlpha(palette.comparison, .06), borderDash: [7, 5], borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 10, pointStyle: 'circle' as const, tension: .3, fill: false, spanGaps: false },
    ],
  };
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: {
        title: items => {
          const point = series[items[0]?.dataIndex ?? -1];
          return point ? [`本期 ${point.observed_on}`, `比較期 ${point.compare_observed_on || '無對應日期'}`] : '';
        },
        label: context => `${context.dataset.label}: ${numberText(context.parsed.y, fraction)}${field?.unit ? ` ${field.unit}` : ''}`,
        afterBody: items => {
          const index = items[0]?.dataIndex ?? -1;
          const current = currentValues[index], compare = compareValues[index];
          const movement = movements[index];
          if (!movement || current === null || compare === null) return ['差異：無比較基準'];
          return [`差異：${signedNumberText(current - compare, fraction)}${field?.unit ? ` ${field.unit}` : ''}`, `方向：${movement.ariaLabel}`];
        },
      } },
    },
    scales: {
      x: { ticks: { color: palette.dim, maxTicksLimit: 10, maxRotation: 0 }, grid: { color: withAlpha(palette.grid, .35) }, title: { display: true, text: '本期日期', color: palette.dim } },
      y: { ticks: { color: palette.dim }, grid: { color: withAlpha(palette.grid, .55) }, title: { display: true, text: `${field?.label || measure}${field?.unit ? `（${field.unit}）` : ''}`, color: palette.dim } },
    },
  };
  return <div className="market-stock-trend" style={{ '--market-current-color': palette.current, '--market-compare-color': palette.comparison } as CSSProperties}>
    <div className="market-stock-legend" role="note">
      <b>台股式差異標示</b>
      <span data-series="current"><i aria-hidden="true" /> 本期（實線）</span>
      <span data-series="comparison"><i aria-hidden="true" /> 比較期（虛線）</span>
      <span data-direction="rise"><i aria-hidden="true">▲</i> 本期高於比較期</span>
      <span data-direction="fall"><i aria-hidden="true">▼</i> 本期低於比較期</span>
      <span data-direction="steady"><i aria-hidden="true">—</i> 持平</span>
      <span data-direction="neutral"><i aria-hidden="true">●</i> 無比較基準</span>
      <small>紅漲綠跌僅表示相對變化，並非漲停／跌停；實線為本期、虛線為比較期。</small>
    </div>
    <div className="market-daily-trend"><Line role="img" aria-label={`${field?.label || measure}每日行情趨勢；本期實線、比較期虛線；紅色向上三角形代表本期高於比較期，綠色向下三角形代表本期低於比較期`} data={data} options={options} /></div>
    <details className="market-chart-summary market-trend-summary"><summary>查看每日行情、比較日期與漲跌差異</summary><div className="responsive-table"><table><thead><tr><th>本期日期</th><th>比較期日期</th><th>本期{field?.unit ? `（${field.unit}）` : ''}</th><th>比較期{field?.unit ? `（${field.unit}）` : ''}</th><th>絕對差異{field?.unit ? `（${field.unit}）` : ''}</th><th>漲跌幅</th></tr></thead><tbody>{series.map((point, index) => {
      const current = currentValues[index], compare = compareValues[index], percent = changePercent(current, compare);
      return <tr key={`${point.observed_on}-${index}`}><th scope="row">{point.observed_on}</th><td>{point.compare_observed_on || '—'}</td><td>{numberText(current, fraction)}</td><td>{numberText(compare, fraction)}</td><td>{current === null || compare === null ? '—' : signedNumberText(current - compare, fraction)}</td><td><MarketMovementBadge value={percent} /></td></tr>;
    })}</tbody></table></div></details>
  </div>;
}

function MarketShareSnapshot({ analysis, measure, field, paletteId, customColors, canDrill = false, onDrill }: { analysis: Analysis; measure: string; field?: FieldDefinition; paletteId: PaletteId; customColors: string[]; canDrill?: boolean; onDrill?: (value: string) => void }) {
  const palette = useResolvedPalette(paletteId, customColors);
  const rows = useMemo(() => chartRows(analysis, measure, 7, true, true, 'current').filter(row => Number(row.current) > 0), [analysis, measure]);
  const total = rows.reduce((sum, row) => sum + (Number(row.current) || 0), 0);
  if (analysis.quality?.groups_truncated) return <p className="market-empty">分類結果超過顯示上限，為避免誤判占比，請先縮小期間或減少分析維度。</p>;
  if (field?.aggregation !== 'sum') return <p className="market-empty">分類占比適用於交易量、交易金額等總和型指標；請在分析設定加入一項總和型指標。</p>;
  if (!rows.length || total <= 0) return <p className="market-empty">本期沒有可計算占比的正值資料。</p>;
  const data = { labels: rows.map(row => row.label), datasets: [{ data: rows.map(row => row.current), backgroundColor: rows.map((_, index) => palette.colors[index % palette.colors.length]), borderColor: palette.panel, borderWidth: 2 }] };
  const options: ChartOptions<'doughnut'> = { responsive: true, maintainAspectRatio: false, cutout: '68%', onClick: (_event, elements) => { const index = elements[0]?.index; const value = typeof index === 'number' ? rows[index]?.drillValue : ''; if (canDrill && value) onDrill?.(value); }, plugins: { legend: { display: false }, tooltip: { enabled: true } } };
  return <div className="market-share-layout">
    <div className="market-share-canvas"><Doughnut role="img" aria-label={`${field?.label || measure}本期分類占比`} data={data} options={options} /><div className="market-share-total"><span>本期合計</span><strong>{numberText(total)}</strong><small>{field?.unit || ''}</small></div></div>
    <ol className="market-share-legend">{rows.slice(0, 5).map((row, index) => <li key={row.label}>{canDrill && row.drillValue ? <button type="button" onClick={() => onDrill?.(row.drillValue)} aria-label={`下鑽查看${row.label}`}><i className="market-share-dot" style={{ '--market-card-accent': palette.colors[index % palette.colors.length] } as CSSProperties} /><span title={row.label}>{row.label}</span><b>{(Number(row.current) / total * 100).toFixed(1)}%</b></button> : <><i className="market-share-dot" style={{ '--market-card-accent': palette.colors[index % palette.colors.length] } as CSSProperties} /><span title={row.label}>{row.label}</span><b>{(Number(row.current) / total * 100).toFixed(1)}%</b></>}</li>)}</ol>
  </div>;
}

type MarketMovement = { label: string; drillValue: string; current: number | null; compare: number | null; percent: number | null; state: 'comparable' | 'new' | 'disappeared' | 'zero-baseline' };
function marketMovements(analysis: Analysis, measure: string): MarketMovement[] {
  const drillDimension = analysis.dimensions.length === 1 ? analysis.dimensions[0] : '';
  return analysis.rows.map((row): MarketMovement | null => {
    const current = finiteNumber(row.values[measure]), compare = finiteNumber(row.compare_values[measure]);
    const drillValue = drillDimension ? row.dimensions[drillDimension] || '' : '';
    if (current === null && compare === null) return null;
    if (compare === null) return { label: chartRowLabel(row), drillValue, current, compare, percent: null, state: 'new' as const };
    if (current === null || (current === 0 && compare > 0)) return { label: chartRowLabel(row), drillValue, current, compare, percent: null, state: 'disappeared' as const };
    if (compare === 0 && current !== 0) return { label: chartRowLabel(row), drillValue, current, compare, percent: null, state: 'zero-baseline' as const };
    return { label: chartRowLabel(row), drillValue, current, compare, percent: compare === 0 ? 0 : changePercent(current, compare), state: 'comparable' as const };
  }).filter((row): row is MarketMovement => Boolean(row)).sort((left, right) => Math.abs(right.percent || 0) - Math.abs(left.percent || 0));
}
function movementStateLabel(state: MarketMovement['state']) {
  return ({ new: '本期新增', disappeared: '本期消失', 'zero-baseline': '比較期為 0', comparable: '可比較' } as Record<MarketMovement['state'], string>)[state];
}

function MarketComparisonStrip({ analysis, fieldMap, canDrill = false, onDrill }: { analysis: Analysis; fieldMap: Map<string, FieldDefinition>; canDrill?: boolean; onDrill?: (value: string) => void }) {
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
    const movement = marketMovementPresentation(quantityChange);
    return <article className={[canDrill ? 'market-market-drillable' : '', `market-card-${movement.tone}`].filter(Boolean).join(' ')} key={row.market}>{canDrill && <button type="button" className="market-market-drill-button" aria-label={`下鑽查看${row.market}`} onClick={() => onDrill?.(row.market)} />}<div><b>{row.market}</b><span>占總成交量 {totalQuantity > 0 ? `${(row.quantity / totalQuantity * 100).toFixed(1)}%` : '—'}</span></div><dl><div><dt>{fieldMap.get('quantity')?.label || '成交量'}</dt><dd>{numberText(row.quantity)}<small>{fieldMap.get('quantity')?.unit || '公斤'}</small></dd></div>{analysis.measures.includes('total_value') && <div><dt>推估成交額</dt><dd>{numberText(row.value)}<small>{fieldMap.get('total_value')?.unit || '元'}</small></dd></div>}{analysis.measures.includes('average_price') && <div><dt>加權平均價</dt><dd>{numberText(row.averagePrice, 1)}<small>{fieldMap.get('average_price')?.unit || '元／公斤'}</small></dd></div>}</dl><p><span>相較比較期成交量</span><MarketMovementBadge value={quantityChange} /></p>{canDrill && <span className="market-drill-hint">展開下一層</span>}</article>;
  })}</div></section>;
}

function MarketDrillToolbar({ enabled, hierarchy, path, busy, onToggle, onBack, onReset, onDepth }: { enabled: boolean; hierarchy: MarketDrillLevel[]; path: MarketDrillStep[]; busy: boolean; onToggle: () => void; onBack: () => void; onReset: () => void; onDepth: (depth: number) => void }) {
  if (hierarchy.length < 2) return null;
  const currentLevel = hierarchy[Math.min(path.length, hierarchy.length - 1)];
  const atLeaf = path.length >= hierarchy.length - 1;
  return <section className="market-drill-toolbar" aria-label="市場行情下鑽工具列" aria-busy={busy}>
    <div className="market-drill-mode"><button type="button" className={enabled ? 'active' : ''} aria-pressed={enabled} onClick={onToggle}><span aria-hidden="true">↧</span> 下鑽模式：{enabled ? '已開啟' : '已關閉'}</button><p>{enabled ? atLeaf ? `目前聚焦單一${currentLevel.label}層級，可向上鑽取後重新選擇` : `點選${currentLevel.label}資料即可展開下一層` : `開啟後可依${hierarchy.map(level => level.label).join('、')}逐層查看`}</p></div>
    {enabled && <><nav aria-label="目前下鑽路徑"><ol><li><button type="button" onClick={() => onDepth(0)} disabled={!path.length}>整體行情</button></li>{path.map((step, index) => <li key={`${step.key}-${index}`}><span aria-hidden="true">›</span><button type="button" onClick={() => onDepth(index + 1)} disabled={index === path.length - 1}>{step.value}</button></li>)}<li><span aria-hidden="true">›</span><strong aria-current="page">查看{currentLevel.label}</strong></li></ol></nav><div className="market-drill-actions"><button type="button" className="secondary-btn compact" disabled={!path.length || busy} onClick={onBack}>向上鑽取</button><button type="button" className="secondary-btn compact" disabled={!path.length || busy} onClick={onReset}>清除下鑽</button></div></>}
    {busy && enabled && <span className="market-drill-loading" role="status">正在更新下鑽資料…</span>}
  </section>;
}

function MarketExecutiveDashboard({ analysis, measures, fieldMap, primaryMeasure, paletteId, customColors, generatedAt, canDrill = false, marketCanDrill = false, onDrill }: { analysis: Analysis; measures: string[]; fieldMap: Map<string, FieldDefinition>; primaryMeasure: string; paletteId: PaletteId; customColors: string[]; generatedAt: string; canDrill?: boolean; marketCanDrill?: boolean; onDrill: (value: string) => void }) {
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
    <div className="market-stock-legend market-stock-legend-compact" role="note">
      <b>台股式圖卡差異</b><span data-direction="rise"><i aria-hidden="true">▲</i> 上漲（紅）</span><span data-direction="fall"><i aria-hidden="true">▼</i> 下跌（綠）</span><span data-direction="steady"><i aria-hidden="true">—</i> 持平</span><small>皆為本期相較比較期；借用紅漲綠跌視覺，不代表漲停／跌停。</small>
    </div>
    <section className="market-kpi-grid">{measures.map(measure => {
      const field = fieldMap.get(measure), current = analysis.totals.values[measure], compare = analysis.totals.compare_values[measure], percent = changePercent(current, compare);
      const fraction = field?.aggregation === 'avg' || field?.aggregation === 'weighted_avg' ? 1 : 0;
      const movement = marketMovementPresentation(percent);
      return <article className={`market-kpi-card market-card-${movement.tone}`} key={measure}><span>{field?.label || measure}</span><strong>{numberText(current, fraction)}<small>{field?.unit || ''}</small></strong><p><span>比較期 {numberText(compare, fraction)}</span><MarketMovementBadge value={percent} /></p></article>;
    })}<article className={`market-kpi-card market-kpi-neutral market-card-${activeDayChange > 0 ? 'rise' : activeDayChange < 0 ? 'fall' : 'steady'}`}><span>有交易日數</span><strong>{numberText(activeDays)}<small>日</small></strong><p><span>比較期 {numberText(compareActiveDays)} 日</span><MarketAbsoluteMovementBadge value={activeDayChange} unit="日" /></p></article></section>
    <MarketComparisonStrip analysis={analysis} fieldMap={fieldMap} canDrill={marketCanDrill} onDrill={onDrill} />
    <div className="market-command-grid">
      <article className="market-command-card market-command-trend"><header><div><span className="market-kicker">每日趨勢比較</span><h3>{analysis.series?.length ? '每日行情走勢' : '主要分類比較'}</h3></div><span>{primaryField?.label || primaryMeasure}・{primaryField?.unit || '數值'}</span></header><MarketDailyTrend analysis={analysis} measure={primaryMeasure} field={primaryField} paletteId={paletteId} customColors={customColors} /></article>
      <article className="market-command-card market-command-attention"><header><div><span className="market-kicker">變動觀察</span><h3>行情變動觀察</h3></div><span>{priceMovement ? priceReliabilityReady ? '門檻 ±10%・各期 ≥1,000 公斤' : '價格判讀需搭配成交量' : '門檻 ±10%'}</span></header>{groupsTruncated ? <div className="market-steady-state market-incomplete-state"><span>!</span><p><b>分類結果範圍過大</b>目前僅回傳 {numberText(returnedGroupCount)}／{numberText(totalGroupCount)} 組，請縮小期間或減少維度後再判讀。</p></div> : !priceReliabilityReady ? <div className="market-steady-state market-incomplete-state"><span>!</span><p><b>請加入成交量指標</b>價格預警需確認本期與比較期交易量皆達 1,000 公斤，避免用微量交易誤判行情。</p></div> : watchRows.length ? <ol className="market-attention-list">{watchRows.map(row => <li className={canDrill && row.drillValue ? 'market-attention-drillable' : ''} key={`${row.state}-${row.label}`}>{canDrill && row.drillValue && <button type="button" className="market-attention-drill-button" aria-label={`下鑽查看${row.label}`} onClick={() => onDrill(row.drillValue)} />}<div><b title={row.label}>{row.label}</b><span>本期 {numberText(row.current)}・比較期 {numberText(row.compare)}</span></div><strong className={row.percent === null ? 'neutral' : ''}>{row.percent === null ? movementStateLabel(row.state) : <MarketMovementBadge value={row.percent} />}</strong>{row.percent !== null && <progress className={marketMovementPresentation(row.percent).tone} max="100" value={Math.min(100, Math.abs(row.percent))} aria-label={`${row.label}${marketMovementPresentation(row.percent).ariaLabel}`} />}</li>)}</ol> : comparableMovements.length ? <div className="market-steady-state"><span>✓</span><p><b>目前波動平穩</b>所選指標沒有分類項目超過 ±10%。</p></div> : <div className="market-steady-state market-incomplete-state"><span>!</span><p><b>比較資料不足</b>{priceMovement ? '兩期成交量皆達 1,000 公斤的共同分類不足，暫不判定價格波動。' : '本期與比較期沒有可對照的共同分類，暫不判定波動。'}</p></div>}</article>
      <article className="market-command-card market-command-share"><header><div><span className="market-kicker">本期結構</span><h3>本期分類占比</h3></div><span>{shareField?.label || shareMeasure}</span></header><MarketShareSnapshot analysis={analysis} measure={shareMeasure} field={shareField} paletteId={paletteId} customColors={customColors} canDrill={canDrill} onDrill={onDrill} /></article>
      <article className="market-command-card market-command-insights"><header><div><span className="market-kicker">快速判讀</span><h3>快速判讀</h3></div><span>依目前篩選結果</span></header>{groupsTruncated ? <div className="market-steady-state market-incomplete-state"><span>!</span><p><b>暫停分類結論</b>分類結果尚未完整載入，主要分類與最大漲跌不會以部分資料推論。</p></div> : <><div className="market-insight-grid"><div className={canDrill && leader?.drillValue ? 'market-insight-drillable' : ''}>{canDrill && leader?.drillValue && <button type="button" aria-label={`下鑽查看${leader.label}`} onClick={() => onDrill(leader.drillValue)} />}<span>{primaryIsAdditive ? '本期主要分類' : '本期最高分類'}</span><strong>{leader?.label || '資料不足'}</strong><p>{leader ? primaryIsAdditive && positiveTotal > 0 ? `占本期 ${primaryField?.label || '指標'} ${(Number(leader.current) / positiveTotal * 100).toFixed(1)}%` : `${primaryField?.label || '本期值'} ${numberText(leader.current, primaryField?.aggregation === 'avg' || primaryField?.aggregation === 'weighted_avg' ? 1 : 0)} ${primaryField?.unit || ''}` : '尚無可判讀的資料'}</p></div><div className={canDrill && rising?.drillValue ? 'market-insight-drillable market-card-rise' : 'market-card-rise'}>{canDrill && rising?.drillValue && <button type="button" aria-label={`下鑽查看${rising.label}`} onClick={() => onDrill(rising.drillValue)} />}<span>最大上升幅度</span><strong>{rising?.label || '無比較資料'}</strong><p>{rising ? <MarketMovementBadge value={rising.percent} /> : '—'}</p></div><div className={canDrill && falling?.drillValue ? 'market-insight-drillable market-card-fall' : 'market-card-fall'}>{canDrill && falling?.drillValue && <button type="button" aria-label={`下鑽查看${falling.label}`} onClick={() => onDrill(falling.drillValue)} />}<span>最大下降幅度</span><strong>{falling?.label || '無比較資料'}</strong><p>{falling ? <MarketMovementBadge value={falling.percent} /> : '—'}</p></div></div><p className="market-insight-note">上升或下降僅代表數值方向，不代表營運好壞；請搭配交易量、價格與市場情境判讀。</p></>}</article>
    </div>
  </section>;
}

function AnalysisWorkspace({ sources, templates, reloadCatalog }: { sources: Source[]; templates: Template[]; reloadCatalog: () => Promise<void> }) {
  const [sourceId, setSourceId] = useState('');
  const [periodPreset, setPeriodPreset] = useState<AnalysisPeriodPreset>('day');
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
  const [drillMode, setDrillMode] = useState(false);
  const [drillPath, setDrillPath] = useState<MarketDrillStep[]>([]);
  const [dimensionOptions, setDimensionOptions] = useState<Record<string, Array<{ value: string; count: number }>>>({});
  const [dimensionCatalogMessage, setDimensionCatalogMessage] = useState('');
  const [dimensionCatalogLoading, setDimensionCatalogLoading] = useState(false);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisGeneratedAt, setAnalysisGeneratedAt] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [configuredSchemaKey, setConfiguredSchemaKey] = useState('');
  const requestEpochRef = useRef(0);
  const decisionSources = useMemo(() => sources.filter(item => item.source_code !== 'market_demo' && item.config?.is_demo !== true), [sources]);
  const decisionSourceIds = useMemo(() => new Set(decisionSources.map(item => item.source_id)), [decisionSources]);
  const decisionTemplates = useMemo(() => templates.filter(template => template.template_code !== 'market-demo-produce-share'
    && template.default_config?.is_demo !== true
    && (!template.source_id || decisionSourceIds.has(template.source_id))), [templates, decisionSourceIds]);
  const source = decisionSources.find(item => item.source_id === sourceId);
  const sourceSchemaKey = useMemo(() => marketSourceSchemaKey(source), [source]);
  const dimensionFields = useMemo(() => (source?.field_definitions || []).filter(field => field.kind === 'dimension' && field.hidden !== true), [source]);
  const filterFields = useMemo(() => {
    const available = dimensionFields.filter(field => field.filterable !== false);
    const configured = configuredFieldKeys(source?.config?.filter_hierarchy ?? source?.config?.filter_dimensions);
    const ordered = configured.flatMap(key => {
      const field = available.find(candidate => candidate.key === key);
      return field ? [field] : [];
    });
    const used = new Set(ordered.map(field => field.key));
    return [...ordered, ...available.filter(field => !used.has(field.key))];
  }, [dimensionFields, source]);
  const measureFields = useMemo(() => (source?.field_definitions || []).filter(field => field.kind === 'measure'), [source]);
  const fieldMap = useMemo(() => new Map((source?.field_definitions || []).map(field => [field.key, field])), [source]);
  const drillHierarchy = useMemo(() => marketDrillHierarchy(source?.field_definitions || [], source?.config?.drill_hierarchy), [source]);
  const effectiveDrillMode = drillMode && drillHierarchy.length >= 2;
  const activeDrillLevel = effectiveDrillMode ? drillHierarchy[Math.min(drillPath.length, drillHierarchy.length - 1)] : undefined;
  const analysisDimensions = useMemo(() => activeDrillLevel ? [activeDrillLevel.key] : dimensions, [activeDrillLevel, dimensions]);
  const analysisFilters = useMemo(() => effectiveDrillMode
    ? { ...filters, ...Object.fromEntries(drillPath.map(step => [step.key, step.value])) }
    : filters, [effectiveDrillMode, filters, drillPath]);
  const catalogFilters = useMemo(() => Object.fromEntries(filterFields.flatMap(field => {
    const value = String(filterDrafts[field.key] || '').trim();
    return value ? [[field.key, value]] : [];
  })), [filterDrafts, filterFields]);
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
      const preferred = decisionSources.find(item => item.config?.is_default === true) || decisionSources[0];
      if (preferred) { setSourceId(preferred.source_id); setConfiguredSchemaKey(''); configureSourceDates(preferred); }
      return;
    }
    if (!source) {
      invalidateAnalysis(); setSourceId(decisionSources[0]?.source_id || ''); setConfiguredSchemaKey('');
      return;
    }
    if (!sourceSchemaKey || configuredSchemaKey === sourceSchemaKey) return;
    invalidateAnalysis();
    const next = validSelections(source, dimensions, measures);
    setDimensions(next.dimensions); setMeasures(next.measures);
    setChartMeasure(current => next.measures.includes(current) ? current : next.measures[0] || '');
    setConfiguredSchemaKey(sourceSchemaKey);
  }, [sourceId, decisionSources, source, sourceSchemaKey, configuredSchemaKey, dimensions, measures, invalidateAnalysis, configureSourceDates]);
  useEffect(() => { setChartMeasure(current => measures.includes(current) ? current : measures[0] || measureFields[0]?.key || ''); }, [measures, measureFields]);
  useEffect(() => { requestEpochRef.current += 1; setBusy(false); }, [sourceId, from, to, compareFrom, compareTo, dimensions, measures, filters, drillMode, drillPath]);
  useEffect(() => { setDimensionOptions({}); }, [source?.source_id]);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setDimensionCatalogMessage(''); setDimensionCatalogLoading(Boolean(source?.source_id));
    if (!source?.source_id) return () => { active = false; };
    timer = setTimeout(() => {
      void invokeAppApi<{ options: Record<string, Array<{ value: string; count: number }>> }>('market_dimension_catalog', { source_id: source.source_id, filters: catalogFilters })
        .then(result => { if (active) setDimensionOptions(result.options || {}); })
        .catch(error => { if (active) setDimensionCatalogMessage(error instanceof Error ? error.message : '篩選選項載入失敗，請重新整理設定後再試。'); })
        .finally(() => { if (active) setDimensionCatalogLoading(false); });
    }, 150);
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [source?.source_id, catalogFilters]);

  const updateFilterDraft = useCallback((key: string, value: string) => {
    setFilterDrafts(current => {
      const next = { ...current, [key]: value };
      const index = filterFields.findIndex(field => field.key === key);
      if (index >= 0) filterFields.slice(index + 1).forEach(field => { delete next[field.key]; });
      return next;
    });
  }, [filterFields]);

  const selectSource = (nextSourceId: string) => {
    const nextSource = decisionSources.find(item => item.source_id === nextSourceId);
    invalidateAnalysis(); setSourceId(nextSourceId); setConfiguredSchemaKey(''); setFilters({}); setFilterDrafts({}); setDrillPath([]); setFiltersOpen(true);
    if (nextSource) configureSourceDates(nextSource);
  };

  const applyPeriodPreset = useCallback((preset: Exclude<AnalysisPeriodPreset, 'custom'>) => {
    const next = periodBounds(to || TODAY, preset);
    invalidateAnalysis();
    setPeriodPreset(preset);
    setFrom(next.from);
    setTo(next.to);
    setCompareMode('previous');
  }, [invalidateAnalysis, to]);

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
  const analysisFiltersReady = Object.keys(analysisFilters).length <= 4;
  const sourceFieldsReady = Boolean(source && configuredSchemaKey === sourceSchemaKey && analysisDimensions.length && measures.length
    && analysisDimensions.every(key => fieldMap.get(key)?.kind === 'dimension')
    && measures.every(key => fieldMap.get(key)?.kind === 'measure'));
  const load = useCallback(async () => {
    if (!analysisFiltersReady) { setMessage('目前篩選與下鑽條件合計超過 4 個，請先移除較次要的資料內容篩選。'); return; }
    if (!source?.source_id || !sourceFieldsReady || !compareDatesReady) { setMessage('請確認資料來源、分析欄位，以及本期與比較期使用相同天數（最多 366 天）。'); return; }
    const requestEpoch = ++requestEpochRef.current;
    setBusy(true); setMessage('');
    try {
      const result = await invokeAppApi<Analysis>('market_analysis', { source_id: source.source_id, from, to, compare_from: compareFrom, compare_to: compareTo, dimensions: analysisDimensions, measures, filters: analysisFilters });
      if (requestEpoch !== requestEpochRef.current) return;
      setAnalysis(result); setAnalysisGeneratedAt(new Date().toISOString()); setFiltersOpen(false);
    } catch (error) { if (requestEpoch === requestEpochRef.current) setMessage(error instanceof Error ? error.message : '行情分析載入失敗'); }
    finally { if (requestEpoch === requestEpochRef.current) setBusy(false); }
  }, [analysisFiltersReady, source?.source_id, sourceFieldsReady, compareDatesReady, from, to, compareFrom, compareTo, analysisDimensions, measures, analysisFilters]);
  useEffect(() => { if (source?.source_id && !analysis && sourceFieldsReady && compareDatesReady && analysisFiltersReady) void load(); }, [source?.source_id, analysis, sourceFieldsReady, compareDatesReady, analysisFiltersReady, load]);

  const applyTemplate = (template: Template) => {
    const targetSource = template.source_id ? decisionSources.find(sourceItem => sourceItem.source_id === template.source_id) : source;
    if (!targetSource) { setMessage('模板資料來源已停用或不存在，請先修正模板設定。'); return; }
    const next = validSelections(targetSource, template.dimensions || [], template.measures || []);
    if (!next.validRequestedMeasures.length) { setMessage(`模板「${template.template_name}」沒有可套用至目前資料來源的分析指標。`); return; }
    invalidateAnalysis();
    setFilters({});
    setFilterDrafts({});
    setDrillPath([]);
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
  const replaceDrillPath = useCallback((nextPath: MarketDrillStep[]) => {
    invalidateAnalysis();
    setDrillPath(nextPath);
    setMessage('');
  }, [invalidateAnalysis]);
  const toggleDrill = useCallback(() => {
    invalidateAnalysis();
    setDrillPath([]);
    setDrillMode(current => !current);
    setMessage('');
  }, [invalidateAnalysis]);
  const drillToValue = useCallback((value: string) => {
    const normalized = value.trim();
    if (!effectiveDrillMode || !activeDrillLevel || !normalized || drillPath.length >= drillHierarchy.length - 1) return;
    replaceDrillPath([...drillPath, { ...activeDrillLevel, value: normalized }]);
  }, [activeDrillLevel, drillHierarchy.length, drillPath, effectiveDrillMode, replaceDrillPath]);
  const drillBack = useCallback(() => {
    if (drillPath.length) replaceDrillPath(drillPath.slice(0, -1));
  }, [drillPath, replaceDrillPath]);
  const drillReset = useCallback(() => {
    if (drillPath.length) replaceDrillPath([]);
  }, [drillPath, replaceDrillPath]);
  const drillToDepth = useCallback((depth: number) => {
    const nextDepth = Math.max(0, Math.min(drillPath.length, depth));
    if (nextDepth !== drillPath.length) replaceDrillPath(drillPath.slice(0, nextDepth));
  }, [drillPath, replaceDrillPath]);

  return <div className="market-analysis-workspace">
    <section className="market-control-panel panel">
      <div className="market-section-heading"><div><span className="market-kicker">分析工作台</span><h2>交易行情比較</h2><p>首頁先呈現營運結論；需要更換資料來源、期間、指標或色卡時再展開設定。</p></div><div className="market-filter-actions"><div className="market-template-quick"><label>快速套用模板<select value="" onChange={event => { const template = decisionTemplates.find(item => item.template_id === event.target.value); if (template) applyTemplate(template); }}><option value="">選擇分析模板</option>{decisionTemplates.map(template => <option key={template.template_id} value={template.template_id}>{template.template_name}</option>)}</select></label></div><button type="button" className="secondary-btn compact market-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)}>{filtersOpen ? '收合分析設定' : '調整分析條件'}</button></div></div>
      {!filtersOpen && analysis && <div className="market-filter-summary"><span>{analysis.source.source_name}</span><span>本期 {periodText(analysis.periods)}</span><span>比較期 {periodText({ from: analysis.periods.compare_from, to: analysis.periods.compare_to })}</span>{Object.entries(analysis.filters || {}).map(([key, value]) => <span key={key}>{analysisFieldMap.get(key)?.label || key}：{value}</span>)}<span>{analysis.measures.map(key => analysisFieldMap.get(key)?.label || key).join('、')}</span></div>}
      {filtersOpen && <div className="market-control-body">
        <div className="market-control-grid">
          <label>資料來源<select value={sourceId} onChange={event => selectSource(event.target.value)}><option value="">請選擇資料來源</option>{decisionSources.map(item => <option key={item.source_id} value={item.source_id}>{item.source_name}</option>)}</select></label>
          <div className="market-period-group"><span>分析期間</span><div className="market-date-pair"><LocalizedDateInput aria-label="分析起始日期" value={from} onChange={event => { invalidateAnalysis(); setPeriodPreset('custom'); setFrom(event.target.value); }} /><span>至</span><LocalizedDateInput aria-label="分析結束日期" value={to} onChange={event => { invalidateAnalysis(); setPeriodPreset('custom'); setTo(event.target.value); }} /></div></div>
          <div className="market-period-group"><span>比較期間</span><div className="market-date-pair"><LocalizedDateInput aria-label="比較起始日期" value={compareFrom} onChange={event => { invalidateAnalysis(); setCompareMode('custom'); setCompareFrom(event.target.value); }} /><span>至</span><LocalizedDateInput aria-label="比較結束日期" value={compareTo} onChange={event => { invalidateAnalysis(); setCompareMode('custom'); setCompareTo(event.target.value); }} /></div></div>
        </div>
        <div className="market-period-presets" role="group" aria-label="快速分析期間">
          <span>快速切換：</span>
          {([['day', '日'], ['week', '週'], ['month', '月'], ['quarter', '季'], ['year', '年']] as Array<[Exclude<AnalysisPeriodPreset, 'custom'>, string]>).map(([value, label]) => <button type="button" key={value} className={periodPreset === value ? 'active' : ''} aria-pressed={periodPreset === value} onClick={() => applyPeriodPreset(value)}>{label}</button>)}
          {periodPreset === 'custom' && <span className="market-period-custom-label">自訂</span>}
        </div>
        <div className="market-compare-actions"><span>快速比較：</span><button type="button" className={compareMode === 'previous' ? 'active' : ''} onClick={() => applyCompare('previous')}>前一段期間</button><button type="button" className={compareMode === 'next' ? 'active' : ''} onClick={() => applyCompare('next')}>後一段期間</button><button type="button" className={compareMode === 'same' ? 'active' : ''} onClick={() => applyCompare('same')}>去年同期</button><button type="button" className={compareMode === 'custom' ? 'active' : ''} onClick={() => setCompareMode('custom')}>自訂</button></div>
        <div className="market-selector-grid"><fieldset><legend>分析維度（最多 4 個）</legend><div className="market-check-list">{dimensionFields.map(field => <label key={field.key}><input type="checkbox" checked={dimensions.includes(field.key)} disabled={!dimensions.includes(field.key) && dimensions.length >= 4} onChange={event => { invalidateAnalysis(); setDimensions(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key)); }} />{field.label}</label>)}</div></fieldset><fieldset><legend>分析指標（最多 4 個）</legend><div className="market-check-list">{measureFields.map(field => <label key={field.key}><input type="checkbox" checked={measures.includes(field.key)} disabled={!measures.includes(field.key) && measures.length >= 4} onChange={event => { invalidateAnalysis(); setMeasures(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key)); }} />{field.label}{field.unit ? `（${field.unit}）` : ''}</label>)}</div></fieldset></div>
        <section className="market-value-filters"><header><div><b>資料內容篩選</b><span>請依「市場 → 蔬果大類 → 品項分類」選擇；下層選項會跟著上層連動，空白代表全部。</span></div><div className="market-value-filter-actions">{Object.values(filterDrafts).some(Boolean) && <button type="button" className="secondary-btn compact" onClick={() => { invalidateAnalysis(); setFilterDrafts({}); setFilters({}); setDrillPath([]); }}>清除篩選</button>}<button type="button" className="primary-btn compact" onClick={() => { invalidateAnalysis(); setFilters(Object.fromEntries(Object.entries(filterDrafts).map(([key, value]) => [key, value.trim()]).filter(([, value]) => Boolean(value)))); setDrillPath([]); }}>套用篩選</button></div></header><div>{filterFields.map(field => { const options = dimensionOptions[field.key] || []; return <label key={field.key}>{field.label}<select value={filterDrafts[field.key] || ''} disabled={dimensionCatalogLoading || Boolean(dimensionCatalogMessage) || !options.length} onChange={event => updateFilterDraft(field.key, event.target.value)}><option value="">{dimensionCatalogLoading && !options.length ? `載入${field.label}中…` : !options.length ? `目前沒有${field.label}資料` : `全部${field.label}`}</option>{options.map(option => <option key={option.value} value={option.value}>{option.value}（{numberText(option.count)} 筆）</option>)}</select></label>; })}</div>{dimensionCatalogMessage && <small>{dimensionCatalogMessage}</small>}</section>
        <div className="market-chart-settings"><label>詳細圖表類型<select value={chartType} onChange={event => setChartType(event.target.value as ChartType)}>{CHART_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>主要判讀指標<select value={primaryMeasure} onChange={event => setChartMeasure(event.target.value)}>{measures.map(measure => <option key={measure} value={measure}>{fieldMap.get(measure)?.label || measure}</option>)}</select></label></div>
        <PalettePicker value={paletteId} customColors={customColors} onChange={setPaletteId} onCustomColorsChange={setCustomColors} />
        <div className="market-control-footer"><span>本期：{periodText({ from, to })}　比較：{periodText({ from: compareFrom, to: compareTo })}{!compareDatesReady ? '　（兩個期間須為相同天數，且最多 366 天）' : ''}</span><button type="button" className="primary-btn" disabled={busy || !sourceFieldsReady || !compareDatesReady || !analysisFiltersReady} onClick={() => void load()}>{busy ? '分析中…' : '執行分析'}</button></div>
      </div>
      }
      {source?.config?.is_actual === true && <p className="market-actual-notice"><b>實際資料範圍：</b>{String(source.config.data_scope || '第一市場、第二市場')}；{String(source.config.value_note || '交易金額為平均價乘以成交量的推估值。')}{source.config.data_quality_note ? `　資料品質：${String(source.config.data_quality_note)}` : ''}</p>}
      {message && <p className="market-inline-message" role="status">{message}</p>}
    </section>
    <MarketDrillToolbar enabled={effectiveDrillMode} hierarchy={drillHierarchy} path={drillPath} busy={busy} onToggle={toggleDrill} onBack={drillBack} onReset={drillReset} onDepth={drillToDepth} />
    {analysis && <>
      <MarketExecutiveDashboard analysis={analysis} measures={analysis.measures} fieldMap={analysisFieldMap} primaryMeasure={resultPrimaryMeasure} paletteId={paletteId} customColors={customColors} generatedAt={analysisGeneratedAt || new Date().toISOString()} canDrill={effectiveDrillMode && drillPath.length < drillHierarchy.length - 1} marketCanDrill={effectiveDrillMode && activeDrillLevel?.key === 'market'} onDrill={drillToValue} />
      <section className="panel market-result-panel"><header className="market-result-heading"><div><span className="market-kicker">分析結果</span><h2>{analysis.source.source_name}</h2><p>本期 {periodText(analysis.periods)}　｜　比較期 {periodText({ from: analysis.periods.compare_from, to: analysis.periods.compare_to })}</p></div><span>{analysis.quality?.groups_truncated ? `共 ${numberText(analysis.quality.total_group_count)} 組，目前載入 ${numberText(analysis.quality.returned_group_count)} 組` : `${analysis.rows.length} 組比較結果`}</span></header>{analysis.quality?.groups_truncated ? <div className="market-result-incomplete" role="status"><b>分類結果超過顯示上限</b><p>為避免用部分資料產生排行、占比或漲跌結論，詳細分類圖表已暫停。請縮小日期範圍或減少分析維度後重新執行。</p></div> : <>{chartType === 'bar' && <MarketBars analysis={analysis} measure={resultPrimaryMeasure} field={resultPrimaryField} paletteId={paletteId} customColors={customColors} canDrill={effectiveDrillMode && drillPath.length < drillHierarchy.length - 1} onDrill={drillToValue} />}{(chartType === 'pie' || chartType === 'doughnut') && <MarketArcCharts analysis={analysis} measure={resultPrimaryMeasure} field={resultPrimaryField} chartType={chartType} paletteId={paletteId} customColors={customColors} canDrill={effectiveDrillMode && drillPath.length < drillHierarchy.length - 1} onDrill={drillToValue} />}{(chartType === 'line' || chartType === 'area') && <MarketLineChart analysis={analysis} measure={resultPrimaryMeasure} field={resultPrimaryField} chartType={chartType} paletteId={paletteId} customColors={customColors} canDrill={effectiveDrillMode && drillPath.length < drillHierarchy.length - 1} onDrill={drillToValue} />}{chartType === 'cards' && <MarketColorCards analysis={analysis} measure={resultPrimaryMeasure} field={resultPrimaryField} paletteId={paletteId} customColors={customColors} canDrill={effectiveDrillMode && drillPath.length < drillHierarchy.length - 1} onDrill={drillToValue} />}{chartType === 'table' && <div className="responsive-table market-result-table"><table><thead><tr>{analysis.dimensions.map(key => <th key={key}>{analysisFieldMap.get(key)?.label || key}</th>)}{analysis.measures.map(key => <th key={key}>{analysisFieldMap.get(key)?.label || key}（本期／比較）</th>)}<th>差異／漲跌幅</th></tr></thead><tbody>{analysis.rows.map((row, index) => { const drillValue = analysis.dimensions.length === 1 ? row.dimensions[analysis.dimensions[0]] || '' : ''; return <tr key={index}>{analysis.dimensions.map(key => <td key={key}>{effectiveDrillMode && drillPath.length < drillHierarchy.length - 1 && key === analysis.dimensions[0] && drillValue ? <button type="button" className="market-table-drill-button" onClick={() => drillToValue(drillValue)}>{row.dimensions[key] || '未分類'}<span>展開下一層</span></button> : row.dimensions[key] || '未分類'}</td>)}{analysis.measures.map(key => <td key={key}>{numberText(row.values[key])} ／ {numberText(row.compare_values[key])}</td>)}<td><MarketDifferenceSummary current={row.values[resultPrimaryMeasure]} compare={row.compare_values[resultPrimaryMeasure]} difference={row.changes[resultPrimaryMeasure]} field={resultPrimaryField} /></td></tr>; })}</tbody></table></div>}</>}</section>
      <MarketSimulation analysis={analysis} sources={decisionSources} measures={analysis.measures} fieldMap={analysisFieldMap} paletteId={paletteId} customColors={customColors} />
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
  const [importFileName, setImportFileName] = useState('');
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
    try {
      const lowerName = file.name.toLowerCase();
      const parsed = lowerName.endsWith('.json') ? parseJsonRows(await file.text()) : lowerName.endsWith('.xlsx') || lowerName.endsWith('.xlsm') ? await parseXlsxFile(file) : parseCsv(await file.text());
      setHeaders(parsed.headers); setCsvRows(parsed.rows);
      const next: Record<string, string> = {};
      setImportFileName(file.name);
      const dateHeader = inferImportHeader('observed_on', '交易日期', parsed.headers) || parsed.headers[0] || '';
      next.observed_on = dateHeader;
      fields.forEach(field => { next[field.key] = inferImportHeader(field.key, field.label, parsed.headers); });
      setMapping(next); setMessage(`已讀取 ${parsed.rows.length.toLocaleString('zh-TW')} 筆 ${lowerName.endsWith('.json') ? 'JSON' : lowerName.endsWith('.xlsx') || lowerName.endsWith('.xlsm') ? 'XLSX' : 'CSV'}，請確認欄位對應後匯入。`);
    } catch (error) { setMessage(error instanceof Error ? `檔案讀取失敗：${error.message}` : '檔案讀取失敗，請確認格式。'); }
  };
  const importCsv = async () => {
    if (!selectedSource?.source_id || !csvRows.length) return;
    setBusy(true); setMessage(''); let processed = 0;
    try {
      const fieldList = selectedSource.field_definitions || fields;
      const rows = csvRows.map(values => {
        const value = (header: string) => header ? values[headers.indexOf(header)] || '' : '';
        const dimensions = Object.fromEntries(fieldList.filter(field => field.kind === 'dimension').map(field => [field.key, value(mapping[field.key])]));
        const measures = Object.fromEntries(fieldList.filter(field => field.kind === 'measure').map(field => [field.key, value(mapping[field.key])]));
        // The historical market files do not carry a total-value column. Derive
        // the same estimated amount used by the actual source when both inputs
        // are available, while preserving an explicitly mapped value.
        if (!measures.total_value && measures.average_price && measures.quantity) {
          const averagePrice = Number(String(measures.average_price).replace(/,/g, ''));
          const quantity = Number(String(measures.quantity).replace(/,/g, ''));
          if (Number.isFinite(averagePrice) && Number.isFinite(quantity)) measures.total_value = String(averagePrice * quantity);
        }
        return { observed_on: dateText(value(mapping.observed_on)), dimensions, measures, metadata: { import_file: importFileName || 'uploaded' } };
      });
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
      setMessage(`匯入完成，共處理 ${numberText(processed)} 筆（新增 ${numberText(inserted)}、更新 ${numberText(updated)}）。`); setCsvRows([]); setHeaders([]); setImportFileName(''); await reloadCatalog();
    } catch (error) { setMessage(`${error instanceof Error ? error.message : '行情資料匯入失敗'}${processed ? `；已完成 ${numberText(processed)} 筆，可用同一檔案安全重試。` : ''}`); }
    finally { setBusy(false); }
  };
  return <div className="market-sources-workspace">
      <section className="panel market-source-editor"><header className="market-result-heading"><div><span className="market-kicker">資料介接</span><h2>資料來源與欄位定義</h2><p>每個來源可以有自己的分類欄位與數值欄位，欄位以設定驅動，不綁定特定菜名。</p></div></header><div className="market-source-layout"><div className="market-source-list"><div className="market-source-list-head"><b>已建立來源</b><button type="button" className="secondary-btn compact" onClick={() => { setSelectedId(''); setSourceCode('market_daily_custom'); setSourceName('自訂交易行情'); setSourceType('csv'); setEndpointUrl(''); setFieldText(fieldLines(DEFAULT_FIELDS)); }}>＋ 新增來源</button></div>{sources.map(source => <button type="button" className={`market-source-item${selectedSource?.source_id === source.source_id ? ' active' : ''}`} key={source.source_id} onClick={() => openSource(source)}><b>{source.source_name}</b><span>{SOURCE_TYPE_LABELS[source.source_type] || source.source_type} ・ {source.field_definitions.length} 個欄位</span></button>)}</div><div className="market-source-form"><div className="market-form-grid"><label>介接代碼<input value={sourceCode} onChange={event => setSourceCode(event.target.value)} placeholder="例如 market_daily" /></label><label>來源名稱<input value={sourceName} onChange={event => setSourceName(event.target.value)} placeholder="例如 每日交易行情" /></label><label>來源類型<select value={sourceType} onChange={event => setSourceType(event.target.value)}><option value="csv">CSV 檔案</option><option value="json">JSON 資料</option><option value="api">外部 API</option><option value="manual">手動輸入</option></select></label><label>外部網址（選填）<input value={endpointUrl} onChange={event => setEndpointUrl(event.target.value)} placeholder="https://…" /></label></div><label className="market-field-definition">欄位定義（每行：代碼｜顯示名稱｜分類／數值｜單位｜彙總方式｜權重欄位｜是否必填）<textarea value={fieldText} onChange={event => setFieldText(event.target.value)} rows={9} /><small>例如：item｜品項｜分類｜｜｜｜必填　　或　average_price｜平均價｜數值｜元／公斤｜加權平均｜quantity</small></label><div className="market-field-preview"><b>目前辨識 {fields.length} 個欄位</b>{fields.map(field => <span key={field.key} className={field.kind}>{field.label}{field.unit ? `・${field.unit}` : ''}{field.required ? '・必填' : ''}</span>)}</div><div className="market-form-actions"><button type="button" className="primary-btn" disabled={busy || fields.length < 2} onClick={() => void saveSource()}>{busy ? '儲存中…' : '儲存資料來源'}</button></div></div></div>{message && <p className="market-inline-message" role="status">{message}</p>}</section>
    <section className="panel market-import-panel"><header className="market-result-heading"><div><span className="market-kicker">資料匯入</span><h2>匯入 CSV／JSON／XLSX 行情資料</h2><p>先選取上方資料來源，再上傳檔案；系統會保留原始資料摘要並依欄位定義轉換。JSON 可使用陣列或 <code>{'{ data: [...] }'}</code> 格式，XLSX 讀取第一個工作表。</p></div></header><div className="market-import-toolbar"><label className="market-file-input">選擇 CSV／JSON／XLSX 檔案<input type="file" accept=".csv,.json,.xlsx,.xlsm,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => void handleFile(event)} /></label>{selectedSource && <span>目前來源：<b>{selectedSource.source_name}</b></span>}</div>{headers.length > 0 && <div className="market-mapping"><h3>欄位對應</h3><div className="market-mapping-grid"><label>交易日期<select value={mapping.observed_on || ''} onChange={event => setMapping(current => ({ ...current, observed_on: event.target.value }))}><option value="">請選擇</option>{headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>{(selectedSource?.field_definitions || fields).map(field => <label key={field.key}>{field.label}<select value={mapping[field.key] || ''} onChange={event => setMapping(current => ({ ...current, [field.key]: event.target.value }))}><option value="">不匯入</option>{headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>)}</div><div className="market-import-actions"><span>預覽 {csvRows.length.toLocaleString('zh-TW')} 筆資料</span><button type="button" className="primary-btn" disabled={busy || !selectedSource} onClick={() => void importCsv()}>{busy ? '匯入中…' : '確認匯入'}</button></div></div>}{message && <p className="market-inline-message" role="status">{message}</p>}</section>
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
  const visibleDimensionFields = fields.filter(field => field.kind === 'dimension' && field.hidden !== true);
  useEffect(() => { setChartMeasure(current => measures.includes(current) ? current : measures[0] || ''); }, [measures]);
  const chooseTemplate = (template: Template) => {
    const targetSource = sources.find(item => item.source_id === template.source_id) || source;
    const visibleDimensionKeys = new Set((targetSource?.field_definitions || []).filter(field => field.kind === 'dimension' && field.hidden !== true).map(field => field.key));
    setTemplateId(template.template_id); setTemplateCode(template.template_code); setTemplateName(template.template_name); setDescription(template.description || ''); setSourceId(template.source_id || '');
    setDimensions((template.dimensions || []).filter(key => visibleDimensionKeys.has(key))); setMeasures(template.measures || []); setChartType(template.chart_type); setChartMeasure(chartMeasureFrom(template.default_config, template.measures || []));
    setCompare(String(template.default_config?.compare || 'previous')); setPaletteId(paletteIdFrom(template.default_config)); setCustomColors(normalizeCustomColors(template.default_config?.custom_colors));
    setMessage(`已載入「${template.template_name}」設定。`);
  };
  const save = async () => {
    setBusy(true); setMessage('');
    try {
      const saved = await invokeAppApi<Template>('market_template_save', {
        template_id: templateId || undefined, template_code: templateCode, template_name: templateName, description, source_id: source?.source_id || undefined, dimensions: dimensions.filter(key => visibleDimensionFields.some(field => field.key === key)), measures, chart_type: chartType,
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
      <div className="market-selector-grid"><fieldset><legend>預設分析維度</legend><div className="market-check-list">{visibleDimensionFields.map(field => <label key={field.key}><input type="checkbox" checked={dimensions.includes(field.key)} onChange={event => setDimensions(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key))} />{field.label}</label>)}</div></fieldset><fieldset><legend>預設分析指標</legend><div className="market-check-list">{fields.filter(field => field.kind === 'measure').map(field => <label key={field.key}><input type="checkbox" checked={measures.includes(field.key)} onChange={event => setMeasures(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key))} />{field.label}</label>)}</div></fieldset></div>
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
