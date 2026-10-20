'use client';

// SYS-04 水果組（日後蔬菜組）電子交接簿的第二批單據：存貨交接明細表（HOL-2-09）、
// 果菜報廢報告表（HEM-2-11）、果菜產地運回放行單。
// 流程：填表 → 送出（內容鎖定）→ 小組長 → 組(副)長 →（報廢報告再加）主(副)任；放行單開立後不可改，只能作廢。
// 紙本格式的預覽與列印（存貨交接、放行單一式三聯）都在本檔；資料表與 RPC 見
// supabase/migrations/20261022090000_produce_handover_documents.sql。

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AdminModal, errorMessage, type Row } from '@/components/admin/shared';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { getSupabase } from '@/lib/supabase';
import { PRODUCE_MARKET_NAMES, type ProduceGroup, type ProduceMarket } from '@/lib/produce-handover';
import {
  LINE_LIMIT, PRODUCE_DOC_STAGES, PRODUCE_DOC_STAGE_LABELS, PRODUCE_DOC_STATUS_LABELS, SCRAP_FORM_NO, SLIP_COPIES,
  STOCK_COPIES, STOCK_FORM_NO, blankScrapLine, blankStockLine, compactLines, docGateReason, docProgressLabel, lineProblem,
  monthDay, nextDocStage, rocDateLabel, slipTimeLabel, sumLines, taipeiLocalToIso, taipeiNowLocal,
  type ProduceDocStage, type ProduceDocStatus, type ProduceDocType, type ScrapLine, type StockLine,
} from '@/lib/produce-documents';
import type { Profile } from '@/types/app';
import { HandoverIcon, HandoverPrintPage } from './handover-sheet';
import './produce-documents.css';

type Scope = { group: ProduceGroup; market: ProduceMarket };
type PanelProps = Scope & { profile: Profile };
type Suggestions = { products: string[]; suppliers: string[] };

const today = () => taipeiNowLocal().slice(0, 10);
const dateTime = (value: unknown) => (value ? slipTimeLabel(value) : '—');
const staffNote = (value: unknown, fallback = '—') => String(value || '').trim() || fallback;

/* ───────────── 共用：資料載入、品名建議、列印 ───────────── */

function useDocuments(table: string, docType: ProduceDocType | null, { group, market }: Scope, dateField: string) {
  const [rows, setRows] = useState<Row[]>([]);
  const [signatures, setSignatures] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const client = getSupabase();
      const [docs, sigs] = await Promise.all([
        client.from(table).select('*').eq('group_code', group).eq('market_code', market)
          .order(dateField, { ascending: false }).order('created_at', { ascending: false }).limit(200),
        docType ? client.from('produce_document_signatures').select('*').eq('group_code', group).eq('market_code', market).eq('doc_type', docType).limit(2000)
          : Promise.resolve({ data: [] as Row[], error: null }),
      ]);
      if (docs.error) throw docs.error;
      if (sigs.error) throw sigs.error;
      setRows(docs.data || []); setSignatures(sigs.data || []); setNote('');
    } catch (error) {
      setRows([]); setSignatures([]); setNote(`失敗：${errorMessage(error, '單據載入失敗')}`);
    } finally { setBusy(false); }
  }, [dateField, docType, group, market, table]);
  useEffect(() => { void load(); }, [load]);
  return { rows, signatures, busy, note, setNote, load };
}

function useSuggestions({ group, market }: Scope) {
  const [value, setValue] = useState<Suggestions>({ products: [], suppliers: [] });
  const reload = useCallback(async () => {
    const { data, error } = await getSupabase().rpc('produce_name_suggestions', { p_group: group, p_market: market });
    if (!error && data) setValue({ products: (data as Suggestions).products || [], suppliers: (data as Suggestions).suppliers || [] });
  }, [group, market]);
  useEffect(() => { void reload(); }, [reload]);
  return value;
}

function Suggest({ suggestions }: { suggestions: Suggestions }) {
  return <>
    <datalist id="produce-products">{suggestions.products.map(name => <option key={name} value={name} />)}</datalist>
    <datalist id="produce-suppliers">{suggestions.suppliers.map(name => <option key={name} value={name} />)}</datalist>
  </>;
}

/** 列印：先把要印的內容渲染到 .produce-doc-print，再呼叫瀏覽器列印；列印完成（或取消）後移除。 */
function usePrintTarget<T>() {
  const [target, setTarget] = useState<T | null>(null);
  useEffect(() => {
    if (!target) return undefined;
    const done = () => setTarget(null);
    window.addEventListener('afterprint', done, { once: true });
    const timer = setTimeout(() => window.print(), 150);
    return () => { clearTimeout(timer); window.removeEventListener('afterprint', done); };
  }, [target]);
  return [target, setTarget] as const;
}

function sigMap(signatures: Row[], docId: unknown) {
  const map: Record<string, Row> = {};
  for (const sig of signatures) if (String(sig.doc_id) === String(docId)) map[String(sig.stage)] = sig;
  return map;
}

function StatusPill({ type, doc, signatures }: { type: ProduceDocType; doc: Row; signatures: Row[] }) {
  const signed = Object.keys(sigMap(signatures, doc.stock_id ?? doc.scrap_id));
  const label = docProgressLabel(type, doc.status as ProduceDocStatus, signed);
  const tone = doc.status === 'void' ? 'cancelled' : doc.status === 'draft' ? 'pending' : label === '簽核完成' ? 'closed' : 'review';
  return <span className={`status-pill ${tone}`}>{label}</span>;
}

function Toolbar({ from, to, status, onFrom, onTo, onStatus, onNew, newLabel, count }: {
  from: string; to: string; status: string; onFrom: (v: string) => void; onTo: (v: string) => void; onStatus: (v: string) => void;
  onNew: () => void; newLabel: string; count: number;
}) {
  return <div className="admin-toolbar produce-doc-toolbar">
    <label>起日<LocalizedDateInput aria-label="起始日期（年/月/日）" value={from} onChange={event => onFrom(event.target.value)} /></label>
    <label>迄日<LocalizedDateInput aria-label="結束日期（年/月/日）" value={to} onChange={event => onTo(event.target.value)} /></label>
    <select aria-label="狀態" value={status} onChange={event => onStatus(event.target.value)}>
      <option value="">全部狀態</option>
      {Object.entries(PRODUCE_DOC_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
    <button type="button" className="secondary-btn" onClick={() => { onFrom(''); onTo(''); onStatus(''); }}>清除</button>
    <span>共 {count} 筆</span>
    <button type="button" className="primary-btn compact produce-doc-new" onClick={onNew}>{newLabel}</button>
  </div>;
}

/* ───────────── 紙本格式（預覽與列印共用） ───────────── */

function SheetHead({ formNo, title, market, extra, date }: { formNo: string; title: string; market: ProduceMarket; extra?: ReactNode; date: string }) {
  return <header className="produce-print-head">
    <div><span>表號：{formNo}</span><span>使用單位：{PRODUCE_MARKET_NAMES[market].name}</span></div>
    <h2>{title}</h2>
    <div><span>{extra}</span><span>{rocDateLabel(date)}</span></div>
  </header>;
}

function SignCell({ label, sig, name }: { label: string; sig?: Row; name?: string }) {
  return <div className="produce-print-sign-cell">
    <span>{label}</span>
    <b>{sig?.signer_name || name || '　'}</b>
    <small>{sig ? dateTime(sig.signed_at) : '　'}</small>
  </div>;
}

function StockSheet({ doc, signatures, market, copy }: { doc: Row; signatures: Row[]; market: ProduceMarket; copy?: { no: string; name: string } }) {
  const lines = (doc.lines || []) as StockLine[];
  const total = sumLines(lines);
  const sigs = sigMap(signatures, doc.stock_id);
  return <div className="produce-print-form">
    {copy && <span className="produce-print-copy">{copy.no}　{copy.name}</span>}
    <SheetHead formNo={STOCK_FORM_NO} title="臺北農產運銷股份有限公司存貨交接明細表" market={market} date={String(doc.handover_date)}
      extra={<>第 {staffNote(doc.area_label, '　　')} 區組　（公斤·元）</>} />
    <table className="produce-print-table">
      <thead><tr><th>進貨表編號</th><th>供應代號</th><th>品名</th><th>等級</th><th>件數</th><th>容器</th><th>重量</th><th>貨品位置</th><th>存貨原因</th></tr></thead>
      <tbody>
        {lines.map((line, index) => <tr key={index}>
          <td>{line.purchase_no}</td><td>{line.supplier_code}</td><td>{line.product_name}</td><td>{line.grade}</td>
          <td className="num">{line.pieces}</td><td>{line.container}</td><td className="num">{line.weight}</td><td>{line.location}</td><td>{line.reason}</td>
        </tr>)}
        {!lines.length && <tr><td colSpan={9}>（無明細）</td></tr>}
      </tbody>
      <tfoot><tr><th colSpan={4}>合　計</th><th className="num">{total.pieces}</th><th></th><th className="num">{total.weight}</th><th colSpan={2}></th></tr></tfoot>
    </table>
    <div className="produce-print-signs is-three">
      <SignCell label="填表人員" name={String(doc.submitted_name || doc.created_name)} sig={doc.submitted_at ? { signer_name: doc.submitted_name, signed_at: doc.submitted_at } : undefined} />
      <SignCell label="小組長" sig={sigs.small_leader} /><SignCell label="組(副)長" sig={sigs.group_leader} />
    </div>
    <p className="produce-print-foot">一、一份自存或列入交代（移交）。二、一份送核算小組。三、一份呈閱後送業務部。四、一式三份。</p>
  </div>;
}

function ScrapSheet({ doc, signatures, market }: { doc: Row; signatures: Row[]; market: ProduceMarket }) {
  const lines = (doc.lines || []) as ScrapLine[];
  const total = sumLines(lines);
  const sigs = sigMap(signatures, doc.scrap_id);
  return <div className="produce-print-form">
    <SheetHead formNo={SCRAP_FORM_NO} title="臺北農產運銷公司果菜報廢報告表" market={market} date={String(doc.report_date)} />
    <table className="produce-print-table">
      <thead><tr><th>進貨日期（月/日）</th><th>供應代號</th><th>品名</th><th>件數</th><th>容器</th><th>重量</th><th>報廢日期（月/日）</th><th>報廢原因</th></tr></thead>
      <tbody>
        {lines.map((line, index) => <tr key={index}>
          <td>{monthDay(line.receive_date)}</td><td>{line.supplier_code}</td><td>{line.product_name}</td>
          <td className="num">{line.pieces}</td><td>{line.container}</td><td className="num">{line.weight}</td><td>{monthDay(line.scrap_date)}</td><td>{line.reason}</td>
        </tr>)}
        {!lines.length && <tr><td colSpan={8}>（無明細）</td></tr>}
      </tbody>
      <tfoot><tr><th colSpan={3}>合　計</th><th className="num">{total.pieces}</th><th></th><th className="num">{total.weight}</th><th colSpan={2}></th></tr></tfoot>
    </table>
    <p className="produce-print-remark"><b>督導人員：</b>{staffNote(doc.supervisor_name, '　')}　<b>備註：</b>{staffNote(doc.remark, '　')}</p>
    <div className="produce-print-signs is-five">
      <SignCell label="拍賣員" name={String(doc.auctioneer_name || '')} />
      <SignCell label="檢驗員（證明者）" name={String(doc.inspector_name || '')} />
      <SignCell label="小組長" sig={sigs.small_leader} /><SignCell label="組(副)長" sig={sigs.group_leader} /><SignCell label="主(副)任" sig={sigs.director} />
    </div>
  </div>;
}

function SlipSheet({ slip, market, copy }: { slip: Row; market: ProduceMarket; copy?: { no: string; name: string } }) {
  return <div className="produce-print-form is-slip">
    {copy && <span className="produce-print-copy">{copy.no}　{copy.name}</span>}
    <header className="produce-print-head"><h2>臺北農產運銷股份有限公司<br />果菜產地運回放行單</h2>
      <div><span>使用單位：{PRODUCE_MARKET_NAMES[market].name}</span><span className="produce-print-serial">NO {String(slip.serial_no)}{slip.paper_no ? `（紙本 ${String(slip.paper_no)}）` : ''}</span></div></header>
    <table className="produce-print-table is-slip">
      <tbody>
        <tr><th>處理時間</th><td>{slipTimeLabel(slip.processed_at)}</td></tr>
        <tr><th>車行、車號</th><td>{String(slip.vehicle || '')}</td></tr>
        <tr><th>品名</th><td>{String(slip.product_name || '')}</td></tr>
        <tr><th>供應單位</th><td>{String(slip.supplier_unit || '')}</td></tr>
        <tr><th>件數、重量</th><td>{String(slip.qty_weight || '')}</td></tr>
        <tr><th>收貨人簽章</th><td>{String(slip.receiver_name || '')}</td></tr>
        <tr><th>備註</th><td>{String(slip.remark || '')}{slip.status === 'void' ? `（已作廢：${String(slip.void_reason || '')}）` : ''}</td></tr>
      </tbody>
    </table>
    <p className="produce-print-remark"><b>簽放人：</b>{String(slip.issuer_name || '')}</p>
  </div>;
}

function PrintHost({ title, date, landscape, children }: { title: string; date: string; landscape: boolean; children: ReactNode }) {
  return <section className="hs-print-sheet produce-doc-print" aria-label="列印內容">
    <HandoverPrintPage title={title} date={date} selector=".produce-doc-print" landscape={landscape} />
    {children}
  </section>;
}

function Preview({ title, landscape, onClose, onPrint, children }: { title: string; landscape: boolean; onClose: () => void; onPrint: () => void; children: ReactNode }) {
  return <div className="hs-preview produce-doc-preview" role="dialog" aria-modal="true" aria-label={title}>
    <div className="hs-preview-bar">
      <div><strong>{title}</strong><span>A4 {landscape ? '橫式' : '直式'}；列印時依聯別各印一份</span></div>
      <div>
        <button type="button" className="primary-btn compact" onClick={onPrint}><HandoverIcon name="printer" size={14} />列印</button>
        <button type="button" className="secondary-btn compact" onClick={onClose}>關閉預覽</button>
      </div>
    </div>
    <div className="hs-preview-scroll"><div className={`hs-preview-paper produce-doc-paper${landscape ? ' is-landscape' : ''}`}>{children}</div></div>
  </div>;
}

/* ───────────── 共用：明細編輯表格 ───────────── */

type ColumnDef = { key: string; label: string; kind?: 'text' | 'num' | 'date'; list?: string; wide?: boolean };

function LinesEditor<T extends Record<string, string | number>>({ lines, columns, onChange, blank }: {
  lines: T[]; columns: ColumnDef[]; onChange: (lines: T[]) => void; blank: () => T;
}) {
  const set = (index: number, key: string, value: string) => onChange(lines.map((line, i) => (i === index ? { ...line, [key]: value } : line)));
  const total = sumLines(lines);
  return <div className="produce-lines-wrap">
    <table className="produce-lines">
      <thead><tr><th>#</th>{columns.map(col => <th key={col.key}>{col.label}</th>)}<th><span className="sr-only">移除</span></th></tr></thead>
      <tbody>{lines.map((line, index) => <tr key={index}>
        <td className="num">{index + 1}</td>
        {columns.map(col => <td key={col.key} className={col.wide ? 'is-wide' : undefined}>
          {col.kind === 'date'
            ? <LocalizedDateInput aria-label={`第 ${index + 1} 列${col.label}`} value={String(line[col.key] ?? '')} onChange={event => set(index, col.key, event.target.value)} />
            : <input aria-label={`第 ${index + 1} 列${col.label}`} value={String(line[col.key] ?? '')} list={col.list} inputMode={col.kind === 'num' ? 'decimal' : undefined}
              maxLength={col.key === 'reason' ? 500 : 80} onChange={event => set(index, col.key, event.target.value)} />}
        </td>)}
        <td><button type="button" className="secondary-btn compact" aria-label={`移除第 ${index + 1} 列`}
          onClick={() => onChange(lines.length > 1 ? lines.filter((_, i) => i !== index) : [blank()])}>移除</button></td>
      </tr>)}</tbody>
    </table>
    <div className="produce-lines-foot">
      <button type="button" className="secondary-btn compact" disabled={lines.length >= LINE_LIMIT} onClick={() => onChange([...lines, blank()])}>＋ 新增一列</button>
      <span>合計：件數 <b>{total.pieces}</b>　重量 <b>{total.weight}</b> 公斤　（共 {compactLinesCount(lines)} 列，上限 {LINE_LIMIT} 列）</span>
    </div>
  </div>;
}
const compactLinesCount = (lines: ReadonlyArray<Record<string, unknown>>) => compactLines(lines).length;

/* ───────────── 共用：單據詳細（簽核、送出、作廢） ───────────── */

function DocDetail({ type, doc, signatures, group, market, profile, sheet, onClose, onEdit, onPreview, onChanged, extra }: PanelProps & {
  type: ProduceDocType; doc: Row; signatures: Row[]; sheet: ReactNode;
  onClose: () => void; onEdit: () => void; onPreview: () => void; onChanged: (message: string) => void | Promise<void>; extra?: ReactNode;
}) {
  const id = String(doc.stock_id ?? doc.scrap_id);
  const sigs = sigMap(signatures, id);
  const status = doc.status as ProduceDocStatus;
  const next = nextDocStage(type, Object.keys(sigs));
  const gate = next ? docGateReason(type, next, Object.keys(sigs), status) : '';
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const mine = String(doc.created_by) === profile.user_id;

  const run = async (name: string, args: Record<string, unknown>, success: string) => {
    setBusy(true); setMessage('');
    try {
      const { error } = await getSupabase().rpc(name, args);
      if (error) throw error;
      await onChanged(success);
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  };
  const base = { p_group: group, p_market: market, p_doc_type: type, p_doc: id };

  return <AdminModal className="produce-doc-modal" title={`${type === 'stock' ? '存貨交接明細表' : '果菜報廢報告表'}｜${rocDateLabel(doc.handover_date ?? doc.report_date)}`} onClose={onClose}>
    <div className="produce-doc-detail">
      <p className="produce-doc-meta">建立：{staffNote(doc.created_name)} · {dateTime(doc.created_at)}　{doc.submitted_at ? `送出：${staffNote(doc.submitted_name)} · ${dateTime(doc.submitted_at)}` : ''}
        {status === 'void' ? `　作廢原因：${staffNote(doc.void_reason)}` : ''}</p>
      <div className="produce-doc-sheetwrap">{sheet}</div>
      <ol className="produce-doc-chain">
        {PRODUCE_DOC_STAGES[type].map(stage => {
          const sig = sigs[stage as ProduceDocStage];
          return <li key={stage} className={sig ? 'is-signed' : undefined}><b>{PRODUCE_DOC_STAGE_LABELS[stage]}</b>
            <span>{sig ? `${String(sig.signer_name)} · ${dateTime(sig.signed_at)}${sig.note ? `　說明：${String(sig.note)}` : ''}` : '尚未簽核'}</span></li>;
        })}
      </ol>
      {status === 'submitted' && next && <div className="produce-doc-sign">
        <label>{PRODUCE_DOC_STAGE_LABELS[next]}簽核說明（可留白）
          <input value={note} maxLength={500} disabled={busy || Boolean(gate)} onChange={event => setNote(event.target.value)} /></label>
        <button type="button" className="primary-btn compact" disabled={busy || Boolean(gate)} title={gate || undefined}
          onClick={() => void run('produce_doc_sign', { ...base, p_stage: next, p_note: note.trim() || null }, `已以${PRODUCE_DOC_STAGE_LABELS[next]}身分簽核`)}>
          <HandoverIcon name="check" size={14} />以{PRODUCE_DOC_STAGE_LABELS[next]}身分簽核</button>
        {gate && <p className="produce-doc-hint" role="status">{gate}</p>}
        {type === 'stock' && next === 'small_leader' && mine && <p className="produce-doc-hint" role="status">小組長須由填表人以外的同仁簽核。</p>}
      </div>}
      {extra}
      {status === 'draft' && voiding && <label className="produce-doc-void">作廢原因（2 至 200 字）
        <input value={reason} maxLength={200} onChange={event => setReason(event.target.value)} /></label>}
      {message && <p role="alert" className="inline-message danger">{message}</p>}
    </div>
    <footer>
      <button type="button" className="secondary-btn" onClick={onClose}>關閉</button>
      <button type="button" className="secondary-btn" onClick={onPreview}><HandoverIcon name="eye" size={14} />預覽／列印</button>
      {status === 'draft' && <>
        <button type="button" className="danger-btn compact" disabled={busy}
          onClick={() => { if (!voiding) { setVoiding(true); setMessage('作廢後仍保留紀錄；請填寫原因再按一次「確認作廢」。'); } else void run('produce_doc_void', { ...base, p_reason: reason }, '草稿已作廢'); }}>{voiding ? '確認作廢' : '作廢草稿'}</button>
        <button type="button" className="secondary-btn" disabled={busy} onClick={onEdit}>編輯草稿</button>
        <button type="button" className="primary-btn compact" disabled={busy} onClick={() => void run('produce_doc_submit', base, '已送出，內容鎖定')}>送出（內容鎖定）</button>
      </>}
    </footer>
  </AdminModal>;
}

/* ───────────── 存貨交接明細表 ───────────── */

const STOCK_COLUMNS: ColumnDef[] = [
  { key: 'purchase_no', label: '進貨表編號' }, { key: 'supplier_code', label: '供應代號', list: 'produce-suppliers' },
  { key: 'product_name', label: '品名', list: 'produce-products' }, { key: 'grade', label: '等級' },
  { key: 'pieces', label: '件數', kind: 'num' }, { key: 'container', label: '容器' }, { key: 'weight', label: '重量（公斤）', kind: 'num' },
  { key: 'location', label: '貨品位置' }, { key: 'reason', label: '存貨原因', wide: true },
];

export function ProduceStockPanel({ group, market, profile }: PanelProps) {
  const { rows, signatures, busy, note, setNote, load } = useDocuments('produce_stock_handovers', 'stock', { group, market }, 'handover_date');
  const suggestions = useSuggestions({ group, market });
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [status, setStatus] = useState('');
  const [editor, setEditor] = useState<{ doc: Row | null } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [printDoc, setPrintDoc] = usePrintTarget<Row>();
  const filtered = useMemo(() => rows.filter(row => (!status || row.status === status) && (!from || String(row.handover_date) >= from) && (!to || String(row.handover_date) <= to)), [rows, status, from, to]);
  const detail = rows.find(row => String(row.stock_id) === detailId) || null;
  const preview = rows.find(row => String(row.stock_id) === previewId) || null;
  const sigsOf = (row: Row) => signatures.filter(sig => String(sig.doc_id) === String(row.stock_id));

  const distribute = async (target: 'accounting' | 'business') => {
    if (!detail) return;
    const { error } = await getSupabase().rpc('produce_stock_distribute', { p_group: group, p_market: market, p_stock: detail.stock_id, p_target: target });
    if (error) throw error;
    await load();
  };

  return <div className="produce-doc-panel">
    <Suggest suggestions={suggestions} />
    <section className="panel admin-panel">
      <Toolbar from={from} to={to} status={status} onFrom={setFrom} onTo={setTo} onStatus={setStatus} count={filtered.length}
        onNew={() => setEditor({ doc: null })} newLabel="＋ 新增存貨交接" />
      {note && <p className={`inline-message${note.startsWith('失敗') ? ' danger' : ''}`}>{note}</p>}
      <div className="responsive-table"><table className="center-head">
        <thead><tr><th className="nowrap">交接日期</th><th>區組</th><th>品名摘要</th><th className="nowrap">件數／重量</th><th className="nowrap">填表人</th><th className="nowrap">狀態</th><th className="nowrap">送出</th><th className="nowrap">操作</th></tr></thead>
        <tbody>{filtered.map(row => {
          const lines = (row.lines || []) as StockLine[];
          const total = sumLines(lines);
          return <tr key={String(row.stock_id)}>
            <td className="nowrap"><strong>{rocDateLabel(row.handover_date)}</strong></td>
            <td>{staffNote(row.area_label)}</td>
            <td>{lines.slice(0, 3).map(line => line.product_name).join('、') || '—'}{lines.length > 3 ? `等 ${lines.length} 項` : ''}</td>
            <td className="nowrap num">{total.pieces} 件／{total.weight} 公斤</td>
            <td className="nowrap">{staffNote(row.created_name)}</td>
            <td className="nowrap"><StatusPill type="stock" doc={row} signatures={signatures} /></td>
            <td className="nowrap"><small>{row.sent_accounting_at ? '核算✓ ' : ''}{row.sent_business_at ? '業務✓' : ''}{!row.sent_accounting_at && !row.sent_business_at ? '—' : ''}</small></td>
            <td className="nowrap"><div className="admin-row-actions"><button type="button" onClick={() => setDetailId(String(row.stock_id))}>詳細</button></div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && filtered.length === 0 && <p className="empty">目前沒有符合條件的存貨交接明細表</p>}
    </section>

    {editor && <StockEditor group={group} market={market} doc={editor.doc} suggestions={suggestions} onClose={() => setEditor(null)}
      onSaved={async (message, id) => { setEditor(null); await load(); setNote(message); if (id) setDetailId(id); }} />}
    {detail && <DocDetail type="stock" doc={detail} signatures={sigsOf(detail)} group={group} market={market} profile={profile}
      sheet={<StockSheet doc={detail} signatures={sigsOf(detail)} market={market} />}
      onClose={() => setDetailId(null)} onEdit={() => { setEditor({ doc: detail }); setDetailId(null); }} onPreview={() => { setPreviewId(String(detail.stock_id)); setDetailId(null); }}
      onChanged={async message => { await load(); setNote(message); setDetailId(null); }}
      extra={detail.status === 'submitted' ? <StockDistribution doc={detail} signatures={sigsOf(detail)} onDistribute={async target => { try { await distribute(target); setNote('已登記送出'); } catch (error) { setNote(`失敗：${errorMessage(error)}`); } }} /> : null} />}
    {preview && <Preview title="存貨交接明細表預覽（一式三份）" landscape onClose={() => setPreviewId(null)} onPrint={() => { setPreviewId(null); setPrintDoc(preview); }}>
      <StockSheet doc={preview} signatures={sigsOf(preview)} market={market} copy={STOCK_COPIES[0]} /></Preview>}
    {printDoc && <PrintHost title="存貨交接明細表" date={String(printDoc.handover_date)} landscape>
      {STOCK_COPIES.map(copy => <div className="produce-print-copyblock" key={copy.no}><StockSheet doc={printDoc} signatures={sigsOf(printDoc)} market={market} copy={copy} /></div>)}
    </PrintHost>}
  </div>;
}

function StockDistribution({ doc, signatures, onDistribute }: { doc: Row; signatures: Row[]; onDistribute: (target: 'accounting' | 'business') => Promise<void> }) {
  const finished = signatures.some(sig => sig.stage === 'group_leader');
  const [busy, setBusy] = useState(false);
  const go = async (target: 'accounting' | 'business') => { setBusy(true); try { await onDistribute(target); } finally { setBusy(false); } };
  return <div className="produce-doc-distribute">
    <b>一式三份送出紀錄</b>
    <span>自存：不記錄</span>
    <span>{doc.sent_accounting_at ? `已送核算小組：${staffNote(doc.sent_accounting_name)} · ${dateTime(doc.sent_accounting_at)}` : '尚未送核算小組'}
      {!doc.sent_accounting_at && <button type="button" className="secondary-btn compact" disabled={busy || !finished} title={finished ? undefined : '須先由組(副)長簽核'} onClick={() => void go('accounting')}>登記已送核算小組</button>}</span>
    <span>{doc.sent_business_at ? `已呈業務部：${staffNote(doc.sent_business_name)} · ${dateTime(doc.sent_business_at)}` : '尚未呈業務部'}
      {!doc.sent_business_at && <button type="button" className="secondary-btn compact" disabled={busy || !finished} title={finished ? undefined : '須先由組(副)長簽核'} onClick={() => void go('business')}>登記已呈業務部</button>}</span>
  </div>;
}

function StockEditor({ group, market, doc, suggestions, onClose, onSaved }: Scope & {
  doc: Row | null; suggestions: Suggestions; onClose: () => void; onSaved: (message: string, id?: string) => void | Promise<void>;
}) {
  const [date, setDate] = useState(String(doc?.handover_date || today()));
  const [area, setArea] = useState(String(doc?.area_label || ''));
  const [lines, setLines] = useState<StockLine[]>(() => (doc?.lines?.length ? (doc.lines as StockLine[]) : Array.from({ length: 5 }, blankStockLine)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const save = async (submit: boolean) => {
    const problem = lineProblem(lines);
    if (problem) { setMessage(problem); return; }
    if (submit && !compactLines(lines).length) { setMessage('請至少填寫一列存貨明細'); return; }
    setBusy(true); setMessage('');
    try {
      const client = getSupabase();
      const saved = await client.rpc('produce_stock_save', { p_group: group, p_market: market, p_stock: doc?.stock_id ?? null, p_date: date, p_area: area, p_lines: compactLines(lines) });
      if (saved.error) throw saved.error;
      const id = String((saved.data as Row).stock_id);
      if (submit) {
        const sent = await client.rpc('produce_doc_submit', { p_group: group, p_market: market, p_doc_type: 'stock', p_doc: id });
        if (sent.error) throw sent.error;
      }
      await onSaved(submit ? '已送出，內容鎖定' : '草稿已儲存', id);
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  };
  return <AdminModal className="produce-doc-modal is-wide" title={doc ? '編輯存貨交接明細（草稿）' : '新增存貨交接明細'} onClose={onClose}>
    <Suggest suggestions={suggestions} />
    <div className="admin-form-grid produce-form">
      <label>交接日期（必填）<LocalizedDateInput aria-label="交接日期（年/月/日）" value={date} onChange={event => setDate(event.target.value)} /></label>
      <label>第　區組<input value={area} maxLength={40} onChange={event => setArea(event.target.value)} placeholder="例如：一區一組" /></label>
    </div>
    <LinesEditor lines={lines as unknown as Record<string, string | number>[]} columns={STOCK_COLUMNS} blank={blankStockLine as never}
      onChange={next => setLines(next as unknown as StockLine[])} />
    <p className="inline-message">送出後內容鎖定，再依序由小組長（填表人以外的同仁）、組(副)長簽核。</p>
    {message && <p role="alert" className="inline-message danger">{message}</p>}
    <footer>
      <button type="button" className="secondary-btn" onClick={onClose}>取消</button>
      <button type="button" className="secondary-btn" disabled={busy} onClick={() => void save(false)}>儲存草稿</button>
      <button type="button" className="primary-btn compact" disabled={busy} onClick={() => void save(true)}>{busy ? '處理中…' : '儲存並送出'}</button>
    </footer>
  </AdminModal>;
}

/* ───────────── 果菜報廢報告表 ───────────── */

const SCRAP_COLUMNS: ColumnDef[] = [
  { key: 'receive_date', label: '進貨日期', kind: 'date' }, { key: 'supplier_code', label: '供應代號', list: 'produce-suppliers' },
  { key: 'product_name', label: '品名', list: 'produce-products' }, { key: 'pieces', label: '件數', kind: 'num' },
  { key: 'container', label: '容器' }, { key: 'weight', label: '重量（公斤）', kind: 'num' },
  { key: 'scrap_date', label: '報廢日期', kind: 'date' }, { key: 'reason', label: '報廢原因', wide: true },
];

export function ProduceScrapPanel({ group, market, profile }: PanelProps) {
  const { rows, signatures, busy, note, setNote, load } = useDocuments('produce_scrap_reports', 'scrap', { group, market }, 'report_date');
  const suggestions = useSuggestions({ group, market });
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [status, setStatus] = useState('');
  const [editor, setEditor] = useState<{ doc: Row | null } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [printDoc, setPrintDoc] = usePrintTarget<Row>();
  const filtered = useMemo(() => rows.filter(row => (!status || row.status === status) && (!from || String(row.report_date) >= from) && (!to || String(row.report_date) <= to)), [rows, status, from, to]);
  const detail = rows.find(row => String(row.scrap_id) === detailId) || null;
  const preview = rows.find(row => String(row.scrap_id) === previewId) || null;
  const sigsOf = (row: Row) => signatures.filter(sig => String(sig.doc_id) === String(row.scrap_id));

  return <div className="produce-doc-panel">
    <Suggest suggestions={suggestions} />
    <section className="panel admin-panel">
      <Toolbar from={from} to={to} status={status} onFrom={setFrom} onTo={setTo} onStatus={setStatus} count={filtered.length}
        onNew={() => setEditor({ doc: null })} newLabel="＋ 新增報廢報告" />
      {note && <p className={`inline-message${note.startsWith('失敗') ? ' danger' : ''}`}>{note}</p>}
      <div className="responsive-table"><table className="center-head">
        <thead><tr><th className="nowrap">報告日期</th><th>品名摘要</th><th className="nowrap">件數／重量</th><th>報廢原因</th><th className="nowrap">填表人</th><th className="nowrap">狀態</th><th className="nowrap">操作</th></tr></thead>
        <tbody>{filtered.map(row => {
          const lines = (row.lines || []) as ScrapLine[];
          const total = sumLines(lines);
          return <tr key={String(row.scrap_id)}>
            <td className="nowrap"><strong>{rocDateLabel(row.report_date)}</strong></td>
            <td>{lines.slice(0, 3).map(line => line.product_name).join('、') || '—'}{lines.length > 3 ? `等 ${lines.length} 項` : ''}</td>
            <td className="nowrap num">{total.pieces} 件／{total.weight} 公斤</td>
            <td>{staffNote(lines[0]?.reason)}</td>
            <td className="nowrap">{staffNote(row.created_name)}</td>
            <td className="nowrap"><StatusPill type="scrap" doc={row} signatures={signatures} /></td>
            <td className="nowrap"><div className="admin-row-actions"><button type="button" onClick={() => setDetailId(String(row.scrap_id))}>詳細</button></div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && filtered.length === 0 && <p className="empty">目前沒有符合條件的報廢報告表</p>}
    </section>

    {editor && <ScrapEditor group={group} market={market} doc={editor.doc} suggestions={suggestions} onClose={() => setEditor(null)}
      onSaved={async (message, id) => { setEditor(null); await load(); setNote(message); if (id) setDetailId(id); }} />}
    {detail && <DocDetail type="scrap" doc={detail} signatures={sigsOf(detail)} group={group} market={market} profile={profile}
      sheet={<ScrapSheet doc={detail} signatures={sigsOf(detail)} market={market} />}
      onClose={() => setDetailId(null)} onEdit={() => { setEditor({ doc: detail }); setDetailId(null); }} onPreview={() => { setPreviewId(String(detail.scrap_id)); setDetailId(null); }}
      onChanged={async message => { await load(); setNote(message); setDetailId(null); }} />}
    {preview && <Preview title="果菜報廢報告表預覽" landscape onClose={() => setPreviewId(null)} onPrint={() => { setPreviewId(null); setPrintDoc(preview); }}>
      <ScrapSheet doc={preview} signatures={sigsOf(preview)} market={market} /></Preview>}
    {printDoc && <PrintHost title="果菜報廢報告表" date={String(printDoc.report_date)} landscape>
      <ScrapSheet doc={printDoc} signatures={sigsOf(printDoc)} market={market} /></PrintHost>}
  </div>;
}

function ScrapEditor({ group, market, doc, suggestions, onClose, onSaved }: Scope & {
  doc: Row | null; suggestions: Suggestions; onClose: () => void; onSaved: (message: string, id?: string) => void | Promise<void>;
}) {
  const [date, setDate] = useState(String(doc?.report_date || today()));
  const [remark, setRemark] = useState(String(doc?.remark || ''));
  const [supervisor, setSupervisor] = useState(String(doc?.supervisor_name || ''));
  const [auctioneer, setAuctioneer] = useState(String(doc?.auctioneer_name || ''));
  const [inspector, setInspector] = useState(String(doc?.inspector_name || ''));
  const [lines, setLines] = useState<ScrapLine[]>(() => (doc?.lines?.length ? (doc.lines as ScrapLine[]) : Array.from({ length: 3 }, () => blankScrapLine(today()))));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const save = async (submit: boolean) => {
    const problem = lineProblem(lines);
    if (problem) { setMessage(problem); return; }
    if (submit && !compactLines(lines).length) { setMessage('請至少填寫一列報廢明細'); return; }
    if (submit && (!auctioneer.trim() || !inspector.trim())) { setMessage('送出前請填寫拍賣員與檢驗員姓名'); return; }
    setBusy(true); setMessage('');
    try {
      const client = getSupabase();
      const saved = await client.rpc('produce_scrap_save', {
        p_group: group, p_market: market, p_scrap: doc?.scrap_id ?? null, p_date: date, p_remark: remark, p_supervisor: supervisor,
        p_auctioneer: auctioneer, p_inspector: inspector, p_lines: compactLines(lines),
      });
      if (saved.error) throw saved.error;
      const id = String((saved.data as Row).scrap_id);
      if (submit) {
        const sent = await client.rpc('produce_doc_submit', { p_group: group, p_market: market, p_doc_type: 'scrap', p_doc: id });
        if (sent.error) throw sent.error;
      }
      await onSaved(submit ? '已送出，內容鎖定' : '草稿已儲存', id);
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  };
  return <AdminModal className="produce-doc-modal is-wide" title={doc ? '編輯報廢報告（草稿）' : '新增果菜報廢報告'} onClose={onClose}>
    <Suggest suggestions={suggestions} />
    <div className="admin-form-grid produce-form">
      <label>報告日期（必填）<LocalizedDateInput aria-label="報告日期（年/月/日）" value={date} onChange={event => setDate(event.target.value)} /></label>
      <label>督導人員<input value={supervisor} maxLength={40} onChange={event => setSupervisor(event.target.value)} /></label>
      <label>拍賣員（輸入姓名）<input value={auctioneer} maxLength={40} onChange={event => setAuctioneer(event.target.value)} /></label>
      <label>檢驗員／證明者（輸入姓名）<input value={inspector} maxLength={40} onChange={event => setInspector(event.target.value)} /></label>
    </div>
    <LinesEditor lines={lines as unknown as Record<string, string | number>[]} columns={SCRAP_COLUMNS} blank={(() => blankScrapLine(date)) as never}
      onChange={next => setLines(next as unknown as ScrapLine[])} />
    <div className="admin-form-grid produce-form"><label className="wide">備註<textarea rows={2} maxLength={1000} value={remark} onChange={event => setRemark(event.target.value)} /></label></div>
    <p className="inline-message">拍賣員與檢驗員先以姓名記載；送出後內容鎖定，再依序由小組長（填表人以外的同仁）、組(副)長、主(副)任簽核。</p>
    {message && <p role="alert" className="inline-message danger">{message}</p>}
    <footer>
      <button type="button" className="secondary-btn" onClick={onClose}>取消</button>
      <button type="button" className="secondary-btn" disabled={busy} onClick={() => void save(false)}>儲存草稿</button>
      <button type="button" className="primary-btn compact" disabled={busy} onClick={() => void save(true)}>{busy ? '處理中…' : '儲存並送出'}</button>
    </footer>
  </AdminModal>;
}

/* ───────────── 果菜產地運回放行單 ───────────── */

export function ProduceSlipPanel({ group, market }: PanelProps) {
  const { rows, busy, note, setNote, load } = useDocuments('produce_release_slips', null, { group, market }, 'processed_at');
  const suggestions = useSuggestions({ group, market });
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [status, setStatus] = useState(''), [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [printSlip, setPrintSlip] = usePrintTarget<Row>();
  const filtered = useMemo(() => rows.filter(row => {
    const day = taipeiNowLocal(new Date(String(row.processed_at))).slice(0, 10);
    const q = query.trim().toLowerCase();
    return (!status || row.status === status) && (!from || day >= from) && (!to || day <= to)
      && (!q || [row.serial_no, row.paper_no, row.vehicle, row.product_name, row.supplier_unit, row.receiver_name].some(value => String(value || '').toLowerCase().includes(q)));
  }), [rows, status, from, to, query]);
  const detail = rows.find(row => String(row.slip_id) === detailId) || null;
  const preview = rows.find(row => String(row.slip_id) === previewId) || null;

  return <div className="produce-doc-panel">
    <Suggest suggestions={suggestions} />
    <section className="panel admin-panel">
      <div className="admin-toolbar produce-doc-toolbar">
        <input aria-label="搜尋" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋單號、車號、品名或供應單位" />
        <label>起日<LocalizedDateInput aria-label="起始日期（年/月/日）" value={from} onChange={event => setFrom(event.target.value)} /></label>
        <label>迄日<LocalizedDateInput aria-label="結束日期（年/月/日）" value={to} onChange={event => setTo(event.target.value)} /></label>
        <select aria-label="狀態" value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">全部狀態</option><option value="issued">已開立</option><option value="void">已作廢</option>
        </select>
        <button type="button" className="secondary-btn" onClick={() => { setQuery(''); setFrom(''); setTo(''); setStatus(''); }}>清除</button>
        <span>共 {filtered.length} 筆</span>
        <button type="button" className="primary-btn compact produce-doc-new" onClick={() => setCreating(true)}>＋ 開立放行單</button>
      </div>
      {note && <p className={`inline-message${note.startsWith('失敗') ? ' danger' : ''}`}>{note}</p>}
      <div className="responsive-table"><table className="center-head">
        <thead><tr><th className="nowrap">單號</th><th className="nowrap">處理時間</th><th>車行、車號</th><th>品名</th><th>供應單位</th><th>件數、重量</th><th className="nowrap">開單人</th><th className="nowrap">狀態</th><th className="nowrap">操作</th></tr></thead>
        <tbody>{filtered.map(row => <tr key={String(row.slip_id)} className={row.status === 'void' ? 'is-void' : undefined}>
          <td className="nowrap"><strong>{String(row.serial_no)}</strong>{row.paper_no ? <small>紙本 {String(row.paper_no)}</small> : null}</td>
          <td className="nowrap">{slipTimeLabel(row.processed_at)}</td><td>{staffNote(row.vehicle)}</td><td>{String(row.product_name)}</td>
          <td>{staffNote(row.supplier_unit)}</td><td>{staffNote(row.qty_weight)}</td><td className="nowrap">{staffNote(row.issuer_name)}</td>
          <td className="nowrap"><span className={`status-pill ${row.status === 'void' ? 'cancelled' : 'closed'}`}>{row.status === 'void' ? '已作廢' : '已開立'}</span></td>
          <td className="nowrap"><div className="admin-row-actions"><button type="button" onClick={() => setDetailId(String(row.slip_id))}>詳細</button></div></td>
        </tr>)}</tbody>
      </table></div>
      {!busy && filtered.length === 0 && <p className="empty">目前沒有符合條件的運回放行單</p>}
    </section>

    {creating && <SlipForm group={group} market={market} suggestions={suggestions} onClose={() => setCreating(false)}
      onIssued={async slip => { setCreating(false); await load(); setNote(`已開立放行單 ${String(slip.serial_no)}`); setDetailId(String(slip.slip_id)); }} />}
    {detail && <SlipDetail slip={detail} group={group} market={market} onClose={() => setDetailId(null)}
      onPreview={() => { setPreviewId(String(detail.slip_id)); setDetailId(null); }}
      onVoided={async () => { setDetailId(null); await load(); setNote('放行單已作廢，保留紀錄'); }} />}
    {preview && <Preview title="運回放行單預覽（三聯）" landscape={false} onClose={() => setPreviewId(null)} onPrint={() => { setPreviewId(null); setPrintSlip(preview); }}>
      <SlipSheet slip={preview} market={market} copy={SLIP_COPIES[0]} /></Preview>}
    {printSlip && <PrintHost title="果菜產地運回放行單" date={String(printSlip.serial_no)} landscape={false}>
      {SLIP_COPIES.map(copy => <div className="produce-print-copyblock" key={copy.no}><SlipSheet slip={printSlip} market={market} copy={copy} /></div>)}
    </PrintHost>}
  </div>;
}

function SlipForm({ group, market, suggestions, onClose, onIssued }: Scope & { suggestions: Suggestions; onClose: () => void; onIssued: (slip: Row) => void | Promise<void> }) {
  const [form, setForm] = useState({ paper_no: '', processed_at: taipeiNowLocal(), vehicle: '', product_name: '', supplier_unit: '', qty_weight: '', receiver_name: '', remark: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const set = (key: keyof typeof form, value: string) => setForm(prev => ({ ...prev, [key]: value }));
  const issue = async () => {
    if (!form.product_name.trim()) { setMessage('請填寫品名'); return; }
    const iso = taipeiLocalToIso(form.processed_at);
    if (!iso) { setMessage('請填寫處理時間'); return; }
    setBusy(true); setMessage('');
    try {
      const { data, error } = await getSupabase().rpc('produce_slip_issue', {
        p_group: group, p_market: market, p_paper_no: form.paper_no, p_processed_at: iso, p_vehicle: form.vehicle, p_product: form.product_name,
        p_supplier: form.supplier_unit, p_qty: form.qty_weight, p_receiver: form.receiver_name, p_remark: form.remark,
      });
      if (error) throw error;
      await onIssued(data as Row);
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  };
  return <AdminModal className="produce-doc-modal" title="開立運回放行單" onClose={onClose}>
    <Suggest suggestions={suggestions} />
    <div className="admin-form-grid produce-form">
      <label>處理時間（必填）<input type="datetime-local" value={form.processed_at} onChange={event => set('processed_at', event.target.value)} /></label>
      <label>紙本單號（選填，例如 001485）<input value={form.paper_no} maxLength={30} onChange={event => set('paper_no', event.target.value)} /></label>
      <label>車行、車號<input value={form.vehicle} maxLength={80} onChange={event => set('vehicle', event.target.value)} /></label>
      <label>品名（必填）<input list="produce-products" value={form.product_name} maxLength={80} onChange={event => set('product_name', event.target.value)} /></label>
      <label>供應單位<input value={form.supplier_unit} maxLength={80} onChange={event => set('supplier_unit', event.target.value)} /></label>
      <label>件數、重量<input value={form.qty_weight} maxLength={80} onChange={event => set('qty_weight', event.target.value)} placeholder="例如：12 件／120 公斤" /></label>
      <label>收貨人（輸入姓名）<input value={form.receiver_name} maxLength={40} onChange={event => set('receiver_name', event.target.value)} /></label>
      <label className="wide">備註<textarea rows={2} maxLength={500} value={form.remark} onChange={event => set('remark', event.target.value)} /></label>
    </div>
    <p className="inline-message">單號由系統自動編列；簽放人為目前登入者。開立後不可修改，錯誤時只能作廢並留原因。</p>
    {message && <p role="alert" className="inline-message danger">{message}</p>}
    <footer>
      <button type="button" className="secondary-btn" onClick={onClose}>取消</button>
      <button type="button" className="primary-btn compact" disabled={busy} onClick={() => void issue()}>{busy ? '開立中…' : '開立放行單'}</button>
    </footer>
  </AdminModal>;
}

function SlipDetail({ slip, group, market, onClose, onPreview, onVoided }: Scope & { slip: Row; onClose: () => void; onPreview: () => void; onVoided: () => void | Promise<void> }) {
  const [reason, setReason] = useState('');
  const [voiding, setVoiding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const voidSlip = async () => {
    if (!voiding) { setVoiding(true); setMessage('作廢後仍保留紀錄；請填寫原因再按一次「確認作廢」。'); return; }
    setBusy(true); setMessage('');
    try {
      const { error } = await getSupabase().rpc('produce_slip_void', { p_group: group, p_market: market, p_slip: slip.slip_id, p_reason: reason });
      if (error) throw error;
      await onVoided();
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  };
  return <AdminModal className="produce-doc-modal" title={`運回放行單｜${String(slip.serial_no)}`} onClose={onClose}>
    <div className="produce-doc-detail">
      <p className="produce-doc-meta">開立：{staffNote(slip.issuer_name)} · {dateTime(slip.created_at)}
        {slip.status === 'void' ? `　已作廢：${staffNote(slip.voided_name)} · ${dateTime(slip.voided_at)}（${staffNote(slip.void_reason)}）` : ''}</p>
      <div className="produce-doc-sheetwrap"><SlipSheet slip={slip} market={market} /></div>
      {slip.status === 'issued' && voiding && <label className="produce-doc-void">作廢原因（2 至 200 字）<input value={reason} maxLength={200} onChange={event => setReason(event.target.value)} /></label>}
      {message && <p role="alert" className="inline-message danger">{message}</p>}
    </div>
    <footer>
      <button type="button" className="secondary-btn" onClick={onClose}>關閉</button>
      <button type="button" className="secondary-btn" onClick={onPreview}><HandoverIcon name="eye" size={14} />預覽／列印三聯</button>
      {slip.status === 'issued' && <button type="button" className="danger-btn compact" disabled={busy} onClick={() => void voidSlip()}>{voiding ? '確認作廢' : '作廢'}</button>}
    </footer>
  </AdminModal>;
}
