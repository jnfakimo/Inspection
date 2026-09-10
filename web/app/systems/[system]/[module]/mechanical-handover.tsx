'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const [printData, setPrintData] = useState<{ entries: Row[]; signatures: Row[] } | null>(null);
  const [printBusy, setPrintBusy] = useState(false);

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
    setPrintBusy(true);
    const client = getSupabase();
    const [work, signs] = await Promise.all([
      client.from('mechanical_handover_entries').select('*').gte('work_date', printFrom).lte('work_date', printTo).order('work_date').order('shift_code').order('sort_order').order('created_at'),
      client.from('mechanical_handover_signatures').select('*').gte('work_date', printFrom).lte('work_date', printTo),
    ]);
    setPrintData({ entries: work.data || [], signatures: signs.data || [] }); setPrintBusy(false); setPrintOpen(false);
    setTimeout(() => window.print(), 120);
  };

  return <AppShell profile={profile} title={module.title} heading={{ system, module, title: module.title, metaTitle: system.title }}>
    <div className="mechanical-page">
      <AdminHeader module={module} busy={busy} note={note} onReload={load}
        action={<button className="primary-btn compact mechanical-print-button" onClick={() => { setPrintFrom(date); setPrintTo(date); setPrintOpen(true); }}>列印每日報表</button>} />
      <section className="panel mechanical-toolbar">
        <div className="mechanical-date-nav"><button className="secondary-btn compact" aria-label="前一天" onClick={() => setDate(current => shiftDate(current, -1))}>‹</button><label>報表日期<LocalizedDateInput aria-label="報表日期（年/月/日）" value={date} onChange={event => setDate(event.target.value)} /></label><button className="secondary-btn compact" aria-label="後一天" onClick={() => setDate(current => shiftDate(current, 1))}>›</button></div>
        <span>{rocDate(date)}</span>
        <button className="secondary-btn compact" onClick={() => setDate(todayTaipei())}>回到今天</button>
        <div className="mechanical-legend" aria-label="班別色彩說明"><b>班別</b><span className="legend-chip shift-0109">早班 01–09</span><span className="legend-chip shift-0917">中班 09–17</span><span className="legend-chip shift-1701">晚班 17–01</span></div>
      </section>
      {frequentItems.length > 0 && <section className="panel mechanical-frequent"><div><b>我的常用工作項目</b><small>依個人紀錄累計 3 次以上</small></div><div className="mechanical-frequent-list">{frequentItems.slice(0, 6).map(item => <button key={item} className="secondary-btn compact" onClick={() => { setPresetItem(item); setEditingShift('01-09'); }}>{item}</button>)}</div></section>}

      <section className="mechanical-broadsheet" aria-label="機電設備交接紀錄">
        <header className="mechanical-broadsheet-head"><div><span>臺北農產運銷公司　第二批發市場</span><h2>機電設備交接紀錄表</h2></div><div className="mechanical-broadsheet-date"><b>{rocDate(date)}</b><small>機電課　交接班紀錄</small></div></header>
        {SHIFTS.map((shift, index) => { const rows = byShift(shift.code); return <section className={`mechanical-shift mechanical-shift-${index + 1}`} key={shift.code}><div className="mechanical-shift-head"><div className="mechanical-shift-title"><strong>{['一', '二', '三'][index]}</strong><span><b>{['早班', '中班', '晚班'][index]}</b><small>{shift.label}　{rows.length} 筆</small></span></div><button className="primary-btn compact" onClick={() => setEditingShift(shift.code)}>＋ 新增工作</button></div><div className="mechanical-entry-list">{rows.length ? rows.map(row => <article className="mechanical-entry-card" key={String(row.entry_id)}><div className="mechanical-entry-main"><small>{String(row.category || '其他')}</small><h3>{String(row.work_item || '')}</h3>{row.details && <p>{String(row.details)}</p>}</div><div className="mechanical-entry-people"><small>維修人員</small><p>{(Array.isArray(row.technician_ids) ? row.technician_ids : []).map(userName).join('、') || '—'}</p>{row.notes && <p className="mechanical-entry-note">備註：{String(row.notes)}</p>}</div><div className="mechanical-entry-result"><small>處理結果</small><b className={`result-badge result-${RESULT_TONES[String(row.result || '')] || 'neutral'}`}>{String(row.result || '—')}</b></div></article>) : <p className="mechanical-empty">本班尚無工作紀錄，請按「新增工作」建立。</p>}</div><div className="mechanical-shift-sign"><span>值班簽名</span><select aria-label={`${shift.label}值班人員`} value={String(signFor(shift.code)?.signer_id || '')} onChange={event => void saveSignature(shift.code, event.target.value)}><option value="">— 選擇值班人員 —</option>{mechanicalUsers.map(user => <option key={String(user.user_id)} value={String(user.user_id)}>{user.name}{user.department ? `（${user.department}）` : ''}</option>)}</select><b>{userName(signFor(shift.code)?.signer_id)}</b></div></section>; })}
      </section>

      <section className="mechanical-report" aria-label="機電設備養護紀錄表">
        <header><h2>臺北農產運銷股份有限公司第二批發市場機電設備養護紀錄表</h2><p>{rocDate(date)}</p></header>
        <table>
          <thead><tr><th className="shift-column">項目</th><th>維修養護工作內容</th><th className="people-column">維修人員</th><th className="result-column">處理結果</th><th className="note-column">備註</th></tr></thead>
          <tbody>{SHIFTS.map(shift => {
            const rows = byShift(shift.code);
            return <tr key={shift.code} className={`shift-row shift-${shift.code.replace('-', '')}`}>
              <th><span>{shift.label}</span><small>工作紀錄 · {rows.length} 筆</small><button className="secondary-btn compact no-print" onClick={() => setEditingShift(shift.code)}>新增工作</button></th>
              <td data-label="維修養護工作內容">{rows.length ? <ol>{rows.map(row => <li key={String(row.entry_id)}><b>{String(row.work_item || '')}</b>{row.details ? <span>－{String(row.details)}</span> : null}</li>)}</ol> : <p className="empty-row">尚無工作紀錄</p>}</td>
              <td data-label="維修人員">{rows.length ? rows.map(row => <p key={String(row.entry_id)}>{(Array.isArray(row.technician_ids) ? row.technician_ids : []).map(userName).join('、') || '—'}</p>) : '—'}</td>
              <td data-label="處理結果">{rows.length ? rows.map(row => { const result = String(row.result || '—'); return <p key={String(row.entry_id)}><span className={`result-badge result-${RESULT_TONES[result] || 'neutral'}`}>{result}</span></p>; }) : '—'}</td>
              <td data-label="備註">{rows.length ? rows.map(row => <p key={String(row.entry_id)}>{String(row.notes || '—')}</p>) : '—'}</td>
            </tr>;
          })}</tbody>
          <tfoot><tr><th>其他</th><td colSpan={4}>{entries.filter(row => row.category === '其他').map(row => String(row.details || row.work_item)).join('；') || '—'}</td></tr></tfoot>
        </table>
        <div className="mechanical-signatures"><strong>值班簽名</strong>{SHIFTS.map(shift => <label key={shift.code}><span>{shift.label}</span><select value={String(signFor(shift.code)?.signer_id || '')} onChange={event => void saveSignature(shift.code, event.target.value)}><option value="">— 選擇值班人員 —</option>{mechanicalUsers.map(user => <option key={String(user.user_id)} value={String(user.user_id)}>{user.name}{user.department ? `（${user.department}）` : ''}</option>)}</select><b>{userName(signFor(shift.code)?.signer_id)}</b></label>)}</div>
      </section>
      {printData && <section className="mechanical-print-preview" aria-hidden="true">{dateRange(printFrom, printTo).map(printDate => <PrintSheet key={printDate} date={printDate} entries={printData.entries.filter(row => String(row.work_date) === printDate)} signatures={printData.signatures.filter(row => String(row.work_date) === printDate)} userName={userName} />)}</section>}
    </div>
    {printOpen && <PrintRangeModal from={printFrom} to={printTo} busy={printBusy} onFrom={setPrintFrom} onTo={setPrintTo} onClose={() => setPrintOpen(false)} onPrint={() => void preparePrint()} />}
    {editingShift && <WorkEntryModal date={date} shiftCode={editingShift} users={mechanicalUsers} profile={profile} presetItem={presetItem} onClose={() => { setEditingShift(null); setPresetItem(''); }} onDone={async () => { setEditingShift(null); setPresetItem(''); await load(); setNote('維修養護工作已新增'); }} />}
  </AppShell>;
}

function PrintRangeModal({ from, to, busy, onFrom, onTo, onClose, onPrint }: { from: string; to: string; busy: boolean; onFrom: (value: string) => void; onTo: (value: string) => void; onClose: () => void; onPrint: () => void }) {
  const pages = from && to && from <= to ? dateRange(from, to).length : 0;
  return <AdminModal title="列印機電交接報表" onClose={onClose}>
    <div className="mechanical-print-range"><label>開始日期<LocalizedDateInput aria-label="列印開始日期" value={from} onChange={event => onFrom(event.target.value)} /></label><label>結束日期<LocalizedDateInput aria-label="列印結束日期" value={to} onChange={event => onTo(event.target.value)} /></label></div>
    <p className="mechanical-print-hint">每一天會產生一頁 A4 報表，最多可列印 31 天（目前 {pages} 頁）。</p>
    {(!pages || pages > 31) && <p className="inline-message danger">請確認日期順序，且列印區間不可超過 31 天。</p>}
    <footer><button className="secondary-btn" onClick={onClose}>取消</button><button className="primary-btn compact" disabled={busy || !pages || pages > 31} onClick={onPrint}>{busy ? '準備中…' : '開始列印'}</button></footer>
  </AdminModal>;
}

function PrintSheet({ date, entries, signatures, userName }: { date: string; entries: Row[]; signatures: Row[]; userName: (id: unknown) => string }) {
  return <article className="mechanical-print-sheet"><header><h2>臺北農產運銷股份有限公司第二批發市場機電設備養護紀錄表</h2><p>{rocDate(date)}</p></header><table><thead><tr><th>班別</th><th>維修養護工作內容</th><th>維修人員</th><th>處理結果</th><th>備註</th></tr></thead><tbody>{SHIFTS.map(shift => { const rows = entries.filter(row => row.shift_code === shift.code); return <tr key={shift.code}><th>{shift.label}</th><td>{rows.length ? rows.map(row => <p key={String(row.entry_id)}>{String(row.work_item || '')}{row.details ? `－${String(row.details)}` : ''}</p>) : '—'}</td><td>{rows.length ? rows.map(row => <p key={String(row.entry_id)}>{(Array.isArray(row.technician_ids) ? row.technician_ids : []).map(userName).join('、') || '—'}</p>) : '—'}</td><td>{rows.length ? rows.map(row => <p key={String(row.entry_id)}>{String(row.result || '—')}</p>) : '—'}</td><td>{rows.length ? rows.map(row => <p key={String(row.entry_id)}>{String(row.notes || '—')}</p>) : '—'}</td></tr>; })}</tbody></table><div className="mechanical-print-signatures"><b>值班簽名</b>{SHIFTS.map(shift => <span key={shift.code}>{shift.label}：{userName(signatures.find(sign => sign.shift_code === shift.code)?.signer_id)}</span>)}</div></article>;
}

function WorkEntryModal({ date, shiftCode, users, profile: _profile, presetItem = '', onClose, onDone }: { date: string; shiftCode: string; users: Row[]; profile: Profile; presetItem?: string; onClose: () => void; onDone: () => void }) {
  const initialCategory = Object.keys(WORK_ITEMS).find(category => WORK_ITEMS[category].includes(presetItem)) || Object.keys(WORK_ITEMS)[0];
  const [category, setCategory] = useState(initialCategory);
  const [item, setItem] = useState(presetItem || WORK_ITEMS[initialCategory][0]);
  const [details, setDetails] = useState('');
  const [technicians, setTechnicians] = useState<string[]>([]);
  const [result, setResult] = useState('正常');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const changeCategory = (value: string) => { setCategory(value); setItem(WORK_ITEMS[value]?.[0] || ''); };
  const toggleTechnician = (id: string) => setTechnicians(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const submit = async () => {
    if (!item || !technicians.length) { setMessage('請選擇工作項目及至少一位維修人員'); return; }
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('handover_save', { kind: 'mechanical_entry', work_date: date, shift_code: shiftCode, category, work_item: item, details, technician_ids: technicians, result, notes });
      await onDone();
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  };
  return <AdminModal title={`新增機電工作｜${SHIFTS.find(shift => shift.code === shiftCode)?.label}`} onClose={onClose}>
    <div className="admin-form-grid mechanical-form">
      <label>工作分類<select value={category} onChange={event => changeCategory(event.target.value)}>{Object.keys(WORK_ITEMS).map(value => <option key={value}>{value}</option>)}</select></label>
      <label>常用工作項目<select value={item} onChange={event => setItem(event.target.value)}>{WORK_ITEMS[category].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="wide">工作補充說明<textarea rows={3} value={details} onChange={event => setDetails(event.target.value)} placeholder="例如：設備位置、異常狀況或實際處理內容" /></label>
      <fieldset className="wide"><legend>維修人員（可複選）</legend><div className="mechanical-person-grid">{users.map(user => <label key={String(user.user_id)}><input type="checkbox" checked={technicians.includes(String(user.user_id))} onChange={() => toggleTechnician(String(user.user_id))} />{user.name}<small>{String(user.department || '')}</small></label>)}</div></fieldset>
      <label>處理結果<select value={result} onChange={event => setResult(event.target.value)}>{RESULT_OPTIONS.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>備註<input value={notes} onChange={event => setNotes(event.target.value)} placeholder="待辦、交班或其他說明" /></label>
    </div>
    {message && <p className="inline-message danger">{message}</p>}
    <footer><button className="secondary-btn" onClick={onClose}>取消</button><button className="primary-btn compact" disabled={busy} onClick={() => void submit()}>{busy ? '儲存中…' : '新增工作紀錄'}</button></footer>
  </AdminModal>;
}
