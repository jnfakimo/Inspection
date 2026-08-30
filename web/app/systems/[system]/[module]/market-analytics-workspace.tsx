'use client';

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { invokeAppApi } from '@/lib/supabase';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import './market-analytics.css';

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
  chart_type: 'bar' | 'table' | 'cards';
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

function MarketBars({ analysis, measure, field }: { analysis: Analysis; measure: string; field?: FieldDefinition }) {
  const rows = analysis.rows.filter(row => Number.isFinite(Number(row.values[measure])) || Number.isFinite(Number(row.compare_values[measure]))).slice(0, 20);
  const max = Math.max(1, ...rows.flatMap(row => [Number(row.values[measure]) || 0, Number(row.compare_values[measure]) || 0]));
  if (!rows.length) return <p className="market-empty">此期間沒有可繪製的資料。</p>;
  return <div className="market-bars">{rows.map((row, index) => {
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
  const [chartType, setChartType] = useState<'bar' | 'table' | 'cards'>('bar');
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
    setDimensions(template.dimensions || []); setMeasures(template.measures || []); setChartType(template.chart_type || 'bar');
    const compare = String(template.default_config?.compare || 'previous');
    if (['previous', 'next', 'same'].includes(compare)) applyCompare(compare as 'previous' | 'next' | 'same');
    setMessage(`已套用模板「${template.template_name}」，按下分析即可更新結果。`);
  };
  const primaryMeasure = measures[0] || measureFields[0]?.key || '';
  const primaryField = fieldMap.get(primaryMeasure);

  return <div className="market-analysis-workspace">
    <section className="market-control-panel panel">
      <div className="market-section-heading"><div><span className="market-kicker">ANALYSIS WORKBENCH</span><h2>交易行情比較</h2><p>用同一套來源設定切換品項、市場、日期與指標；新增品項只要匯入資料，不必修改畫面。</p></div><div className="market-template-quick"><label>快速套用模板<select value="" onChange={event => { const template = templates.find(item => item.template_id === event.target.value); if (template) applyTemplate(template); }}><option value="">選擇分析模板</option>{templates.map(template => <option key={template.template_id} value={template.template_id}>{template.template_name}</option>)}</select></label></div></div>
      <div className="market-control-grid">
        <label>資料來源<select value={source?.source_id || ''} onChange={event => { setSourceId(event.target.value); setAnalysis(null); }}><option value="">請選擇資料來源</option>{sources.map(item => <option key={item.source_id} value={item.source_id}>{item.source_name}</option>)}</select></label>
        <label>分析圖表<select value={chartType} onChange={event => setChartType(event.target.value as 'bar' | 'table' | 'cards')}><option value="bar">比較長條</option><option value="table">明細表格</option><option value="cards">摘要卡片</option></select></label>
        <div className="market-period-group"><span>分析期間</span><div className="market-date-pair"><LocalizedDateInput aria-label="分析起始日期" value={from} onChange={event => { setFrom(event.target.value); setAnalysis(null); }} /><span>至</span><LocalizedDateInput aria-label="分析結束日期" value={to} onChange={event => { setTo(event.target.value); setAnalysis(null); }} /></div></div>
        <div className="market-period-group"><span>比較期間</span><div className="market-date-pair"><LocalizedDateInput aria-label="比較起始日期" value={compareFrom} onChange={event => { setCompareMode('custom'); setCompareFrom(event.target.value); setAnalysis(null); }} /><span>至</span><LocalizedDateInput aria-label="比較結束日期" value={compareTo} onChange={event => { setCompareMode('custom'); setCompareTo(event.target.value); setAnalysis(null); }} /></div></div>
      </div>
      <div className="market-compare-actions"><span>快速比較：</span><button type="button" className={compareMode === 'previous' ? 'active' : ''} onClick={() => applyCompare('previous')}>前一段期間</button><button type="button" className={compareMode === 'next' ? 'active' : ''} onClick={() => applyCompare('next')}>後一段期間</button><button type="button" className={compareMode === 'same' ? 'active' : ''} onClick={() => applyCompare('same')}>去年同期</button><button type="button" className={compareMode === 'custom' ? 'active' : ''} onClick={() => setCompareMode('custom')}>自訂</button></div>
      <div className="market-selector-grid"><fieldset><legend>分析維度（最多 4 個）</legend><div className="market-check-list">{dimensionFields.map(field => <label key={field.key}><input type="checkbox" checked={dimensions.includes(field.key)} disabled={!dimensions.includes(field.key) && dimensions.length >= 4} onChange={event => setDimensions(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key))} />{field.label}</label>)}</div></fieldset><fieldset><legend>分析指標（最多 4 個）</legend><div className="market-check-list">{measureFields.map(field => <label key={field.key}><input type="checkbox" checked={measures.includes(field.key)} disabled={!measures.includes(field.key) && measures.length >= 4} onChange={event => setMeasures(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key))} />{field.label}{field.unit ? `（${field.unit}）` : ''}</label>)}</div></fieldset></div>
      <div className="market-control-footer"><span>本期：{periodText({ from, to })}　比較：{periodText({ from: compareFrom, to: compareTo })}</span><button type="button" className="primary-btn" disabled={busy || !source} onClick={() => void load()}>{busy ? '分析中…' : '執行分析'}</button></div>
      {message && <p className="market-inline-message" role="status">{message}</p>}
    </section>
    {analysis && <>
      <section className="market-kpi-grid">{measures.map(measure => { const field = fieldMap.get(measure); const current = analysis.totals.values[measure], compare = analysis.totals.compare_values[measure], change = analysis.totals.changes[measure]; const percent = current !== null && compare !== null && compare !== 0 ? (Number(change) / Number(compare) * 100) : null; return <article className="market-kpi-card" key={measure}><span>{field?.label || measure}</span><strong>{numberText(current, field?.aggregation === 'avg' ? 1 : 0)}<small>{field?.unit || ''}</small></strong><p>比較期 {numberText(compare, field?.aggregation === 'avg' ? 1 : 0)}　<span className={Number(change) >= 0 ? 'up' : 'down'}>{change === null ? '—' : `${Number(change) >= 0 ? '▲' : '▼'} ${numberText(Math.abs(Number(change)), field?.aggregation === 'avg' ? 1 : 0)}${percent === null ? '' : `（${Math.abs(percent).toFixed(1)}%）`}`}</span></p></article>; })}<article className="market-kpi-card market-kpi-neutral"><span>資料筆數</span><strong>{numberText(analysis.counts.current)}<small>筆</small></strong><p>比較期 {numberText(analysis.counts.compare)} 筆</p></article></section>
      <section className="panel market-result-panel"><header className="market-result-heading"><div><span className="market-kicker">RESULT</span><h2>{analysis.source.source_name}</h2><p>本期 {periodText(analysis.periods)}　｜　比較期 {periodText({ from: analysis.periods.compare_from, to: analysis.periods.compare_to })}</p></div><span>{analysis.rows.length} 組比較結果</span></header>{chartType === 'bar' && <MarketBars analysis={analysis} measure={primaryMeasure} field={primaryField} />}{chartType === 'cards' && <div className="market-result-cards">{analysis.rows.slice(0, 20).map((row, index) => <article key={index}><b>{Object.values(row.dimensions).join('／') || '全部'}</b><strong>{numberText(row.values[primaryMeasure])}</strong><small>比較期 {numberText(row.compare_values[primaryMeasure])}　變化 {row.changes[primaryMeasure] === null ? '—' : numberText(row.changes[primaryMeasure])}</small></article>)}</div>}{chartType === 'table' && <div className="responsive-table market-result-table"><table><thead><tr>{dimensions.map(key => <th key={key}>{fieldMap.get(key)?.label || key}</th>)}{measures.map(key => <th key={key}>{fieldMap.get(key)?.label || key}（本期／比較）</th>)}<th>變化</th></tr></thead><tbody>{analysis.rows.map((row, index) => <tr key={index}>{dimensions.map(key => <td key={key}>{row.dimensions[key] || '未分類'}</td>)}{measures.map(key => <td key={key}>{numberText(row.values[key])} ／ {numberText(row.compare_values[key])}</td>)}<td>{numberText(row.changes[primaryMeasure])}</td></tr>)}</tbody></table></div>}</section>
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
    <section className="panel market-source-editor"><header className="market-result-heading"><div><span className="market-kicker">DATA CONNECTOR</span><h2>資料來源與欄位定義</h2><p>每個來源可以有自己的分類欄位與數值欄位，欄位以設定驅動，不綁定特定菜名。</p></div></header><div className="market-source-layout"><div className="market-source-list"><div className="market-source-list-head"><b>已建立來源</b><button type="button" className="secondary-btn compact" onClick={() => { setSelectedId(''); setSourceCode('market_daily_custom'); setSourceName('自訂交易行情'); setSourceType('csv'); setEndpointUrl(''); setFieldText(fieldLines(DEFAULT_FIELDS)); }}>＋ 新增來源</button></div>{sources.map(source => <button type="button" className={`market-source-item${selectedSource?.source_id === source.source_id ? ' active' : ''}`} key={source.source_id} onClick={() => openSource(source)}><b>{source.source_name}</b><span>{source.source_type.toUpperCase()} ・ {source.field_definitions.length} 個欄位</span></button>)}</div><div className="market-source-form"><div className="market-form-grid"><label>介接代碼<input value={sourceCode} onChange={event => setSourceCode(event.target.value)} placeholder="例如 market_daily" /></label><label>來源名稱<input value={sourceName} onChange={event => setSourceName(event.target.value)} placeholder="例如 每日交易行情" /></label><label>來源類型<select value={sourceType} onChange={event => setSourceType(event.target.value)}><option value="csv">CSV 檔案</option><option value="json">JSON 資料</option><option value="api">外部 API</option><option value="manual">手動輸入</option></select></label><label>外部網址（選填）<input value={endpointUrl} onChange={event => setEndpointUrl(event.target.value)} placeholder="https://…" /></label></div><label className="market-field-definition">欄位定義（每行：代碼｜顯示名稱｜分類／數值｜單位｜彙總方式）<textarea value={fieldText} onChange={event => setFieldText(event.target.value)} rows={9} /><small>例如：item｜品項｜分類｜　　或　average_price｜平均價｜數值｜元／公斤｜平均</small></label><div className="market-field-preview"><b>目前辨識 {fields.length} 個欄位</b>{fields.map(field => <span key={field.key} className={field.kind}>{field.label}{field.unit ? `・${field.unit}` : ''}</span>)}</div><div className="market-form-actions"><button type="button" className="primary-btn" disabled={busy || fields.length < 2} onClick={() => void saveSource()}>{busy ? '儲存中…' : '儲存資料來源'}</button></div></div></div>{message && <p className="market-inline-message" role="status">{message}</p>}</section>
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
  const [chartType, setChartType] = useState<'bar' | 'table' | 'cards'>('bar');
  const [compare, setCompare] = useState('previous');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const source = sources.find(item => item.source_id === sourceId) || sources[0];
  const fields = source?.field_definitions || [];
  const chooseTemplate = (template: Template) => { setTemplateCode(template.template_code); setTemplateName(template.template_name); setDescription(template.description || ''); setSourceId(template.source_id || ''); setDimensions(template.dimensions || []); setMeasures(template.measures || []); setChartType(template.chart_type); setCompare(String(template.default_config?.compare || 'previous')); setMessage(`已載入「${template.template_name}」設定。`); };
  const save = async () => { setBusy(true); setMessage(''); try { await invokeAppApi('market_template_save', { template_code: templateCode, template_name: templateName, description, source_id: source?.source_id || undefined, dimensions, measures, chart_type: chartType, default_config: { compare, limit: 20 } }); setMessage('分析模板已儲存。'); await onSaved(); } catch (error) { setMessage(error instanceof Error ? error.message : '分析模板儲存失敗'); } finally { setBusy(false); } };
  return <div className="market-templates-workspace"><section className="panel market-template-editor"><header className="market-result-heading"><div><span className="market-kicker">TEMPLATE BUILDER</span><h2>分析模板設計</h2><p>把常用的品項、市場、指標與比較方式保存起來，之後一鍵套用。</p></div><label>載入既有模板<select value="" onChange={event => { const template = templates.find(item => item.template_id === event.target.value); if (template) chooseTemplate(template); }}><option value="">選擇模板</option>{templates.map(template => <option key={template.template_id} value={template.template_id}>{template.template_name}</option>)}</select></label></header><div className="market-form-grid"><label>模板代碼<input value={templateCode} onChange={event => setTemplateCode(event.target.value)} /></label><label>模板名稱<input value={templateName} onChange={event => setTemplateName(event.target.value)} /></label><label>資料來源<select value={source?.source_id || ''} onChange={event => setSourceId(event.target.value)}><option value="">選擇來源</option>{sources.map(item => <option key={item.source_id} value={item.source_id}>{item.source_name}</option>)}</select></label><label>比較預設<select value={compare} onChange={event => setCompare(event.target.value)}><option value="previous">前一段期間</option><option value="next">後一段期間</option><option value="same">去年同期</option><option value="custom">自訂</option></select></label></div><label className="market-template-description">模板說明<textarea rows={2} value={description} onChange={event => setDescription(event.target.value)} placeholder="說明此模板適合的分析情境" /></label><div className="market-selector-grid"><fieldset><legend>預設分析維度</legend><div className="market-check-list">{fields.filter(field => field.kind === 'dimension').map(field => <label key={field.key}><input type="checkbox" checked={dimensions.includes(field.key)} onChange={event => setDimensions(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key))} />{field.label}</label>)}</div></fieldset><fieldset><legend>預設分析指標</legend><div className="market-check-list">{fields.filter(field => field.kind === 'measure').map(field => <label key={field.key}><input type="checkbox" checked={measures.includes(field.key)} onChange={event => setMeasures(current => event.target.checked ? [...current, field.key] : current.filter(key => key !== field.key))} />{field.label}</label>)}</div></fieldset></div><div className="market-form-actions"><label>預設圖表<select value={chartType} onChange={event => setChartType(event.target.value as 'bar' | 'table' | 'cards')}><option value="bar">比較長條</option><option value="table">明細表格</option><option value="cards">摘要卡片</option></select></label><button type="button" className="primary-btn" disabled={busy || !measures.length} onClick={() => void save()}>{busy ? '儲存中…' : '儲存分析模板'}</button></div>{message && <p className="market-inline-message" role="status">{message}</p>}</section><section className="market-template-library"><header><h2>模板庫</h2><span>{templates.length} 個已啟用模板</span></header>{templates.map(template => <article className="market-template-card" key={template.template_id}><div><span className="market-kicker">{template.chart_type.toUpperCase()}</span><h3>{template.template_name}</h3><p>{template.description || '尚未填寫說明'}</p></div><button type="button" className="secondary-btn compact" onClick={() => chooseTemplate(template)}>編輯</button></article>)}</section></div>;
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
