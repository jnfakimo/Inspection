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

export function MechanicalHandover({ system, module, profile }: Props) {
  const [date, setDate] = useState(todayTaipei());
  const [entries, setEntries] = useState<Row[]>([]);
  const [signatures, setSignatures] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');
  const [editingShift, setEditingShift] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [work, signs, people, departments] = await Promise.all([
      client.from('mechanical_handover_entries').select('*').eq('work_date', date).order('shift_code').order('sort_order').order('created_at'),
      client.from('mechanical_handover_signatures').select('*').eq('work_date', date),
      client.from('users').select('user_id,name,department,dept_id').eq('status', 'active').order('name').limit(1000),
      client.from('departments').select('dept_id,name,parent_id,status').eq('name', '機電課').eq('status', 'active').limit(20),
    ]);
    const mechanicalDeptIds = new Set((departments.data || []).map(department => String(department.dept_id)));
    const scopedPeople = (people.data || []).filter(person => mechanicalDeptIds.has(String(person.dept_id)));
    const failure = work.error || signs.error || people.error || departments.error;
    if (failure) setNote(`失敗：${errorMessage(failure, '機電交接資料載入失敗')}`);
    setEntries(work.data || []); setSignatures(signs.data || []); setUsers(scopedPeople); setBusy(false);
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  const userName = useCallback((id: unknown) => users.find(user => String(user.user_id) === String(id))?.name || '—', [users]);
  const mechanicalUsers = useMemo(() => [...users].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW')), [users]);
  const byShift = (code: string) => entries.filter(entry => entry.shift_code === code);
  const signFor = (code: string) => signatures.find(sign => sign.shift_code === code);

  const saveSignature = async (shiftCode: string, userId: string) => {
    setBusy(true); setNote('');
    try {
      await invokeAppApi('handover_save', { kind: 'mechanical_sign', work_date: date, shift_code: shiftCode, signer_id: userId || null });
      await load(); setNote(userId ? '值班人員已簽名' : '已清除值班簽名');
    } catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };

  return <AppShell profile={profile} title={module.title} heading={{ system, module, title: module.title, metaTitle: system.title }}>
    <div className="mechanical-page">
      <AdminHeader module={module} busy={busy} note={note} onReload={load}
        action={<button className="primary-btn compact mechanical-print-button" onClick={() => window.print()}>列印每日報表</button>} />
      <section className="panel mechanical-toolbar">
        <label>報表日期<LocalizedDateInput aria-label="報表日期（年/月/日）" value={date} onChange={event => setDate(event.target.value)} /></label>
        <span>{rocDate(date)}</span>
        <button className="secondary-btn compact" onClick={() => setDate(todayTaipei())}>回到今天</button>
      </section>

      <section className="mechanical-report" aria-label="機電設備養護紀錄表">
        <header><h2>臺北農產運銷股份有限公司第二批發市場機電設備養護紀錄表</h2><p>{rocDate(date)}</p></header>
        <table>
          <thead><tr><th className="shift-column">項目</th><th>維修養護工作內容</th><th className="people-column">維修人員</th><th className="result-column">處理結果</th><th className="note-column">備註</th></tr></thead>
          <tbody>{SHIFTS.map(shift => {
            const rows = byShift(shift.code);
            return <tr key={shift.code}>
              <th><span>{shift.label}</span><small>工作紀錄</small><button className="secondary-btn compact no-print" onClick={() => setEditingShift(shift.code)}>新增工作</button></th>
              <td>{rows.length ? <ol>{rows.map(row => <li key={String(row.entry_id)}><b>{String(row.work_item || '')}</b>{row.details ? <span>－{String(row.details)}</span> : null}</li>)}</ol> : <p className="empty-row">尚無工作紀錄</p>}</td>
              <td>{rows.length ? rows.map(row => <p key={String(row.entry_id)}>{(Array.isArray(row.technician_ids) ? row.technician_ids : []).map(userName).join('、') || '—'}</p>) : '—'}</td>
              <td>{rows.length ? rows.map(row => <p key={String(row.entry_id)}>{String(row.result || '—')}</p>) : '—'}</td>
              <td>{rows.length ? rows.map(row => <p key={String(row.entry_id)}>{String(row.notes || '—')}</p>) : '—'}</td>
            </tr>;
          })}</tbody>
          <tfoot><tr><th>其他</th><td colSpan={4}>{entries.filter(row => row.category === '其他').map(row => String(row.details || row.work_item)).join('；') || '—'}</td></tr></tfoot>
        </table>
        <div className="mechanical-signatures"><strong>值班簽名</strong>{SHIFTS.map(shift => <label key={shift.code}><span>{shift.label}</span><select value={String(signFor(shift.code)?.signer_id || '')} onChange={event => void saveSignature(shift.code, event.target.value)}><option value="">— 選擇值班人員 —</option>{mechanicalUsers.map(user => <option key={String(user.user_id)} value={String(user.user_id)}>{user.name}{user.department ? `（${user.department}）` : ''}</option>)}</select><b>{userName(signFor(shift.code)?.signer_id)}</b></label>)}</div>
      </section>
    </div>
    {editingShift && <WorkEntryModal date={date} shiftCode={editingShift} users={mechanicalUsers} profile={profile} onClose={() => setEditingShift(null)} onDone={async () => { setEditingShift(null); await load(); setNote('維修養護工作已新增'); }} />}
  </AppShell>;
}

function WorkEntryModal({ date, shiftCode, users, profile: _profile, onClose, onDone }: { date: string; shiftCode: string; users: Row[]; profile: Profile; onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState(Object.keys(WORK_ITEMS)[0]);
  const [item, setItem] = useState(WORK_ITEMS[Object.keys(WORK_ITEMS)[0]][0]);
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
