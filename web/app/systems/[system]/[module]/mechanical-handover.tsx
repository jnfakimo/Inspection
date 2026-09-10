'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { repairCostCents, repairCostTotal, formatRepairCost } from '@/lib/mechanical-cost';
import { AppShell } from '@/components/AppShell';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { AdminHeader, AdminModal, errorMessage, type Row } from '@/components/admin/shared';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import './mechanical-handover.css';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };
type Shift = { code: string; label: string };

const SHIFTS: Shift[] = [
  { code: '01-09', label: '01:00–09:00' },
  { code: '09-17', label: '09:00–17:00' },
  { code: '17-01', label: '17:00–01:00' },
];
const WORK_ITEMS: Record<string, string[]> = {
  '冷凍冷藏設備': ['B1F 冷藏主機巡檢、運轉壓力溫度紀錄', '4F 冷藏庫主機巡檢壓力紀錄', '4F 西側冷藏庫、東側冷凍庫巡查及溫度紀錄', '冷凍空調設備異常處理'],
  '供配電設備': ['B2F 東西側配電室巡查', 'B3F 東西側發電機及消防室巡查', '2F 東西側發電機室巡查', '發電機啟動測試', '配電盤及電氣設備檢查'],
  '給排水設備': ['污廢水井、抽水泵及逆止閥檢查', '排水管路及積水巡查', '飲水及排水設備疏通'],
  '電梯設備': ['電梯運轉巡查', '電梯故障緊急處理'],
  '消防設備': ['消防設備巡查', '消防警報及泵浦測試'],
  '環境與例行工作': ['工具清點', '機電辦公室清潔', '設備機房清潔'],
  '修繕與臨時工作': ['門窗及五金修繕', '照明設備修繕', '現場臨時交辦事項'],
  '其他': ['其他維修養護工作'],
};
const RESULT_OPTIONS = ['正常', '已完成', '處理中', '待料', '待廠商', '交下班續辦', '無法處理'];
const RESULT_TONES: Record<string, string> = {
  '正常': 'ok', '已完成': 'done', '處理中': 'working', '待料': 'waiting', '待廠商': 'waiting', '交下班續辦': 'handoff', '無法處理': 'danger',
};

function todayTaipei() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function weekday(date: string) {
  if (!date) return '';
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'long' }).format(new Date(`${date}T12:00:00+08:00`));
}
function rocDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return year ? `${year - 1911} 年 ${month} 月 ${day} 日（${weekday(date)}）` : '';
}
function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setDate(value.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
function dateRange(from: string, to: string) {
  const result: string[] = [];
  let cursor = from;
  for (let i = 0; i < 62 && cursor <= to; i += 1) { result.push(cursor); cursor = shiftDate(cursor, 1); }
  return result;
}

export function MechanicalHandover({ system, module, profile }: Props) {
  const [date, setDate] = useState(todayTaipei());
  const [entries, setEntries] = useState<Row[]>([]);
  const [signatures, setSignatures] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [historyItems, setHistoryItems] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');
  const [editingShift, setEditingShift] = useState<string | null>(null);
  const [presetItem, setPresetItem] = useState('');
  const [printOpen, setPrintOpen] = useState(false);
  const [printFrom, setPrintFrom] = useState(date);
  const [printTo, setPrintTo] = useState(date);
  const [printData, setPrintData] = useState<{ dates: string[]; entries: Row[]; signatures: Row[] } | null>(null);
  const [printError, setPrintError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [printRequested, setPrintRequested] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { setPrintData(null); }, [date]);
  useEffect(() => {
    const beforePrint = () => {
      document.body.classList.add('mechanical-printing');
      fitMechanicalPrint();
    };
    const afterPrint = () => document.body.classList.remove('mechanical-printing');
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    return () => {
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
      afterPrint();
    };
  }, []);
  useEffect(() => {
    if (!printRequested || !printData) return;
    let cancelled = false;
    void document.fonts.ready.then(() => requestAnimationFrame(() => {
      if (cancelled) return;
      document.body.classList.add('mechanical-printing');
      fitMechanicalPrint();
      window.print();
      document.body.classList.remove('mechanical-printing');
      setPrintRequested(false);
    }));
    return () => { cancelled = true; };
  }, [printRequested, printData]);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [work, signs, people, departments, history] = await Promise.all([
      client.from('mechanical_handover_entries').select('*').eq('work_date', date).order('shift_code').order('sort_order').order('created_at'),
      client.from('mechanical_handover_signatures').select('*').eq('work_date', date),
      client.from('users').select('user_id,name,department,dept_id').eq('status', 'active').order('name').limit(1000),
      client.from('departments').select('dept_id,name,parent_id,status,level').eq('name', '機電課').eq('level', 2).eq('status', 'active').limit(20),
      client.from('mechanical_handover_entries').select('work_item').eq('created_by', profile.user_id).limit(1000),
    ]);
    const mechanicalDeptIds = new Set((departments.data || []).map(department => String(department.dept_id)));
    const scopedPeople = (people.data || []).filter(person => mechanicalDeptIds.has(String(person.dept_id)));
    const failure = work.error || signs.error || people.error || departments.error || history.error;
    if (failure) setNote(`失敗：${errorMessage(failure, '機電交接資料載入失敗')}`);
    const itemCounts = new Map<string, number>();
    (history.data || []).forEach(row => { const item = String(row.work_item || ''); if (item) itemCounts.set(item, (itemCounts.get(item) || 0) + 1); });
    setEntries(work.data || []); setSignatures(signs.data || []); setUsers(scopedPeople);
    setHistoryItems([...itemCounts.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]).map(([item]) => item)); setBusy(false);
  }, [date, profile.user_id]);
  useEffect(() => { void load(); }, [load]);

  const userName = useCallback((id: unknown) => users.find(user => String(user.user_id) === String(id))?.name || '—', [users]);
  const mechanicalUsers = useMemo(() => [...users].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW')), [users]);
  const frequentItems = useMemo(() => historyItems.filter(item => Object.prototype.hasOwnProperty.call(WORK_ITEMS, item) || Object.values(WORK_ITEMS).some(items => items.includes(item))), [historyItems]);
  const byShift = (code: string) => entries.filter(entry => entry.shift_code === code);
  const signFor = (code: string) => signatures.find(sign => sign.shift_code === code);

  const saveSignature = async (shiftCode: string, userId: string) => {
    setBusy(true); setNote('');
    try {
      await invokeAppApi('handover_save', { kind: 'mechanical_sign', work_date: date, shift_code: shiftCode, signer_id: userId || null });
      await load(); setNote(userId ? '值班人員已簽名' : '已清除值班簽名');
    } catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };
  const preparePrint = async () => {
    if (!printFrom || !printTo || printFrom > printTo || dateRange(printFrom, printTo).length > 31) return;
    setPrintBusy(true); setPrintError('');
    try {
      const client = getSupabase();
      // Paginate so a multi-day report and its cost total cannot silently lose rows.
      const works: Row[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from('mechanical_handover_entries').select('*')
          .gte('work_date', printFrom).lte('work_date', printTo)
          .order('work_date').order('shift_code').order('sort_order').order('created_at').order('entry_id')
          .range(offset, offset + 499);
        if (error) throw error;
        works.push(...(data || []));
        if (!data || data.length < 500) break;
      }
      const { data: signs, error } = await client.from('mechanical_handover_signatures').select('*')
        .gte('work_date', printFrom).lte('work_date', printTo);
      if (error) throw error;
      setPrintData({ dates: dateRange(printFrom, printTo), entries: works, signatures: signs || [] });
      setPrintOpen(false); setPrintRequested(true);
    } catch (error) {
      setPrintError(errorMessage(error, '報表資料讀取失敗，請重試'));
    } finally { setPrintBusy(false); }
  };

  return <AppShell profile={profile} title={module.title} heading={{ system, module, title: module.title, metaTitle: system.title }}>
    <div className="mechanical-page">
      <AdminHeader module={module} busy={busy} note={note} onReload={load}
        action={<button className="primary-btn compact mechanical-print-button" onClick={() => { setPrintFrom(date); setPrintTo(date); setPrintError(''); setPrintOpen(true); }}>列印每日報表</button>} />
      <section className="panel mechanical-toolbar">
        <div className="mechanical-date-nav"><button className="secondary-btn compact" aria-label="前一天" onClick={() => setDate(current => shiftDate(current, -1))}>‹</button><label>報表日期<LocalizedDateInput aria-label="報表日期（年/月/日）" value={date} onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setDate(event.target.value); }} /></label><button className="secondary-btn compact" aria-label="後一天" onClick={() => setDate(current => shiftDate(current, 1))}>›</button></div>
        <span>{rocDate(date)}</span>
        <button className="secondary-btn compact" onClick={() => setDate(todayTaipei())}>回到今天</button>
        <div className="mechanical-legend" aria-label="班別色彩說明"><b>班別</b><span className="legend-chip shift-0109">早班 01–09</span><span className="legend-chip shift-0917">中班 09–17</span><span className="legend-chip shift-1701">晚班 17–01</span></div>
      </section>
      {frequentItems.length > 0 && <section className="panel mechanical-frequent"><div><b>我的常用工作項目</b><small>依個人紀錄累計 3 次以上</small></div><div className="mechanical-frequent-list">{frequentItems.slice(0, 6).map(item => <button key={item} className="secondary-btn compact" onClick={() => { setPresetItem(item); setEditingShift('01-09'); }}>{item}</button>)}</div></section>}

      <section className="mechanical-broadsheet" aria-label="機電設備交接紀錄">
        <header className="mechanical-broadsheet-head"><div><span>臺北農產運銷公司　第二批發市場</span><h2>機電設備交接紀錄表</h2></div><div className="mechanical-broadsheet-date"><b>{rocDate(date)}</b><small>機電課　交接班紀錄</small></div></header>
        <div className="mechanical-day-summary">
          <span>本日 <b>{entries.length}</b> 件工作</span>
          <span>本日維修費用合計 <strong>{formatRepairCost(repairCostTotal(entries))}</strong></span>
          {entries.some(row => row.repair_cost == null) && <small>含 {entries.filter(row => row.repair_cost == null).length} 件費用未填，合計僅計入已填金額。</small>}
        </div>
        {SHIFTS.map((shift, index) => {
          const rows = byShift(shift.code);
          return <section className={`mechanical-shift mechanical-shift-${index + 1}`} key={shift.code}>
            <div className="mechanical-shift-head">
              <div className="mechanical-shift-title"><strong>{['一', '二', '三'][index]}</strong><span><b>{['早班', '中班', '晚班'][index]}</b><small>{shift.label} · {rows.length} 件 · 費用 {formatRepairCost(repairCostTotal(rows))}</small></span></div>
              <button className="primary-btn compact" disabled={busy} onClick={() => setEditingShift(shift.code)}>＋ 新增工作</button>
            </div>
            <div className="mechanical-entry-list">{rows.length ? rows.map((row, entryIndex) =>
              <article className="mechanical-entry-card" key={String(row.entry_id)}>
                <div className="mechanical-entry-main"><small><b className="mechanical-entry-number">第 {entryIndex + 1} 件</b>{String(row.category || '其他')}</small><h3>{String(row.work_item || '')}</h3>{row.details && <p>{String(row.details)}</p>}</div>
                <div className="mechanical-entry-people"><small>維修人員</small><p>{(Array.isArray(row.technician_ids) ? row.technician_ids : []).map(userName).join('、') || '—'}</p>{row.notes && <p className="mechanical-entry-note">備註：{String(row.notes)}</p>}</div>
                <div className="mechanical-entry-result"><small>處理結果</small><b className={`result-badge result-${RESULT_TONES[String(row.result || '')] || 'neutral'}`}>{String(row.result || '—')}</b><small>維修費用</small><strong>{row.repair_cost == null ? '未填' : formatRepairCost(repairCostCents(row.repair_cost) || 0)}</strong></div>
              </article>
            ) : <p className="mechanical-empty">本班尚無工作紀錄，請按「新增工作」建立。</p>}</div>
            <div className="mechanical-shift-sign"><span>值班簽名</span><select disabled={busy} aria-label={`${shift.label}值班人員`} value={String(signFor(shift.code)?.signer_id || '')} onChange={event => void saveSignature(shift.code, event.target.value)}><option value="">— 選擇值班人員 —</option>{mechanicalUsers.map(user => <option key={String(user.user_id)} value={String(user.user_id)}>{user.name}（機電課）</option>)}</select><b>{userName(signFor(shift.code)?.signer_id)}</b></div>
          </section>;
        })}
      </section>

      {mounted && createPortal(<section className="mechanical-print-preview" aria-label="每日列印報表">
        {(printData?.dates || [date]).map(printDate => <PrintSheet key={printDate} date={printDate}
          entries={(printData?.entries || entries).filter(row => String(row.work_date) === printDate)}
          signatures={(printData?.signatures || signatures).filter(row => String(row.work_date) === printDate)}
          userName={userName} />)}
      </section>, document.body)}
    </div>
    {printOpen && <PrintRangeModal error={printError} from={printFrom} to={printTo} busy={printBusy} onFrom={setPrintFrom} onTo={setPrintTo} onClose={() => setPrintOpen(false)} onPrint={() => void preparePrint()} />}
    {editingShift && <WorkEntryModal date={date} shiftCode={editingShift} users={mechanicalUsers} profile={profile} presetItem={presetItem} onClose={() => { setEditingShift(null); setPresetItem(''); }} onDone={async () => { setEditingShift(null); setPresetItem(''); await load(); setNote('維修養護工作已新增'); }} />}
  </AppShell>;
}

export function PrintRangeModal({ error, from, to, busy, onFrom, onTo, onClose, onPrint }: { error?: string; from: string; to: string; busy: boolean; onFrom: (value: string) => void; onTo: (value: string) => void; onClose: () => void; onPrint: () => void }) {
  const pages = from && to && from <= to ? dateRange(from, to).length : 0;
  return <AdminModal className="mechanical-modal mechanical-print-modal" title="列印機電交接報表" onClose={onClose}>
    <div className="mechanical-print-range"><label>開始日期<LocalizedDateInput aria-label="列印開始日期" value={from} onChange={event => onFrom(event.target.value)} /></label><label>結束日期<LocalizedDateInput aria-label="列印結束日期" value={to} onChange={event => onTo(event.target.value)} /></label></div>
    {error && <p role="alert" className="mechanical-modal-message">{error}</p>}
    <p className="mechanical-print-hint">每一天會產生一頁 A4 報表，最多可列印 31 天（目前 {pages} 頁）。</p>
    {(!pages || pages > 31) && <p className="inline-message danger">請確認日期順序，且列印區間不可超過 31 天。</p>}
    <footer><button className="secondary-btn" onClick={onClose}>取消</button><button className="primary-btn compact" disabled={busy || !pages || pages > 31} onClick={onPrint}>{busy ? '準備中…' : '開始列印'}</button></footer>
  </AdminModal>;
}

export function fitMechanicalPrint() {
  document.querySelectorAll<HTMLElement>('.mechanical-print-sheet').forEach(sheet => {
    const content = sheet.querySelector<HTMLElement>('.mechanical-print-content');
    if (!content) return;
    content.style.removeProperty('--mechanical-print-scale');
    if (!sheet.clientHeight || !content.scrollHeight) return;
    const ratio = Math.min(1, (sheet.clientHeight - 2) / content.scrollHeight);
    content.style.setProperty('--mechanical-print-scale', String(ratio));
  });
}

export function PrintSheet({ date, entries, signatures, userName }: { date: string; entries: Row[]; signatures: Row[]; userName: (id: unknown) => string }) {
  return <article className="mechanical-print-sheet"><div className="mechanical-print-content">
    <header><h2>臺北農產運銷股份有限公司第二批發市場<br />機電設備養護紀錄表</h2><p>{rocDate(date)}</p></header>
    <table><colgroup><col className="print-shift" /><col className="print-work" /><col className="print-people" /><col className="print-result" /><col className="print-notes" /><col className="print-cost" /></colgroup>
      <thead><tr><th>班別</th><th>維修養護工作內容</th><th>維修人員</th><th>處理結果</th><th>備註</th><th>費用（元）</th></tr></thead>
      {SHIFTS.map((shift, index) => {
        const rows = entries.filter(row => row.shift_code === shift.code);
        return <tbody className="mechanical-print-shift" key={shift.code}>{(rows.length ? rows : [null]).map((row, rowIndex) => <tr key={row ? String(row.entry_id) : 'empty'}>
          {rowIndex === 0 && <th rowSpan={Math.max(1, rows.length)}>{['早班', '中班', '晚班'][index]}<br />{shift.label}<br />共 {rows.length} 件</th>}
          <td>{row ? <><b>{rowIndex + 1}. {String(row.work_item || '')}</b>{row.details && <p>{String(row.details)}</p>}</> : '尚無工作紀錄'}</td>
          <td>{row ? (Array.isArray(row.technician_ids) ? row.technician_ids : []).map(userName).join('、') || '—' : '—'}</td>
          <td>{row ? String(row.result || '—') : '—'}</td><td>{row ? String(row.notes || '—') : '—'}</td>
          <td>{row && row.repair_cost != null ? formatRepairCost(repairCostCents(row.repair_cost) || 0).replace('NT$ ', '') : '未填'}</td>
        </tr>)}</tbody>;
      })}
    </table>
    <div className="mechanical-print-total"><strong>本日維修費用合計：{formatRepairCost(repairCostTotal(entries))}</strong><span>費用未填 {entries.filter(row => row.repair_cost == null).length} 件（不計入合計）</span></div>
    <div className="mechanical-print-signatures"><b>值班簽名</b>{SHIFTS.map(shift => <span key={shift.code}>{shift.label}<strong>{userName(signatures.find(sign => sign.shift_code === shift.code)?.signer_id)}</strong></span>)}</div>
  </div></article>;
}

export function WorkEntryModal({ date, shiftCode, users, profile: _profile, presetItem = '', onClose, onDone }: { date: string; shiftCode: string; users: Row[]; profile: Profile; presetItem?: string; onClose: () => void; onDone: () => void }) {
  const initialCategory = Object.keys(WORK_ITEMS).find(category => WORK_ITEMS[category].includes(presetItem)) || Object.keys(WORK_ITEMS)[0];
  const [category, setCategory] = useState(initialCategory);
  const [item, setItem] = useState(presetItem || WORK_ITEMS[initialCategory][0]);
  const [details, setDetails] = useState('');
  const [technicians, setTechnicians] = useState<string[]>([]);
  const [result, setResult] = useState('正常');
  const [notes, setNotes] = useState('');
  const [repairCost, setRepairCost] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const changeCategory = (value: string) => { setCategory(value); setItem(WORK_ITEMS[value]?.[0] || ''); };
  const toggleTechnician = (id: string) => setTechnicians(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const submit = async () => {
    if (!item || !technicians.length) { setMessage('請選擇工作項目及至少一位維修人員'); return; }
    if (repairCostCents(repairCost) === undefined) { setMessage('維修費用請輸入 0 至 999,999,999.99 的金額，最多兩位小數'); return; }
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('handover_save', { kind: 'mechanical_entry', work_date: date, shift_code: shiftCode, category, work_item: item, details, technician_ids: technicians, result, notes, repair_cost: repairCost.trim() || null });
      await onDone();
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  };
  return <AdminModal className="mechanical-modal mechanical-work-modal" title={`新增機電工作｜${SHIFTS.find(shift => shift.code === shiftCode)?.label}`} onClose={onClose}>
    <div className="admin-form-grid mechanical-form">
      <label>工作分類<select value={category} onChange={event => changeCategory(event.target.value)}>{Object.keys(WORK_ITEMS).map(value => <option key={value}>{value}</option>)}</select></label>
      <label>常用工作項目<select value={item} onChange={event => setItem(event.target.value)}>{WORK_ITEMS[category].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="wide">工作補充說明<textarea rows={3} value={details} onChange={event => setDetails(event.target.value)} placeholder="例如：設備位置、異常狀況或實際處理內容" /></label>
      <fieldset className="wide"><legend>維修人員（可複選） · 已選 {technicians.length} 人</legend><div className="mechanical-person-grid">{users.map(user => <label key={String(user.user_id)}><input type="checkbox" checked={technicians.includes(String(user.user_id))} onChange={() => toggleTechnician(String(user.user_id))} /><span>{user.name}</span><small>機電課</small></label>)}</div></fieldset>
      <label>處理結果<select value={result} onChange={event => setResult(event.target.value)}>{RESULT_OPTIONS.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>維修費用（新臺幣元）<input aria-label="維修費用（新臺幣元）" inputMode="decimal" value={repairCost} onChange={event => setRepairCost(event.target.value)} placeholder="未填可留白，無費用填 0" /></label>
      <label className="wide">備註<input value={notes} onChange={event => setNotes(event.target.value)} placeholder="待辦、交班或其他說明" /></label>
    </div>
    {message && <p role="alert" className="mechanical-modal-message">{message}</p>}
    <footer><button className="secondary-btn" onClick={onClose}>取消</button><button className="primary-btn compact" disabled={busy} onClick={() => void submit()}>{busy ? '儲存中…' : '新增工作紀錄'}</button></footer>
  </AdminModal>;
}
