'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { AdminHeader, AdminModal, errorMessage, type Row } from '@/components/admin/shared';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import './business-handover.css';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };
const SHIFTS = [
  { code: '01-09', name: '早班', label: '01:00–09:00' },
  { code: '09-17', name: '中班', label: '09:00–17:00' },
  { code: '17-01', name: '晚班', label: '17:00–01:00' },
] as const;
const CATEGORIES = ['事務事項', '維修', '其他'] as const;

function todayTaipei() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function moveDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setDate(value.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
function rocDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'long' }).format(new Date(`${date}T12:00:00+08:00`));
  return `${year - 1911} 年 ${month} 月 ${day} 日（${weekday}）`;
}
function activityTime(value: unknown) {
  if (!value) return '—';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(parsed);
}
function attendanceLine(expected: number, absent: number) {
  return `本日應出勤人數：${expected} 人；未出勤人數：${absent} 人。`;
}
function withAttendanceLine(value: string, expected: number, absent: number) {
  const content = value.replace(/^本日應出勤人數：\d+ 人；未出勤人數：\d+ 人。\s*/u, '').trim();
  return `${attendanceLine(expected, absent)}${content ? `\n${content}` : ''}`;
}
function isDeleted(row: Row) { return row.is_deleted === true; }

export function BusinessHandover({ system, module, profile }: Props) {
  const [date, setDate] = useState(todayTaipei());
  const [entries, setEntries] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');
  const [editingShift, setEditingShift] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [entryResult, userResult] = await Promise.all([
      client.from('business_handover_entries').select('*').eq('handover_date', date).order('shift_code').order('created_at'),
      client.from('users').select('user_id,name').eq('status', 'active').order('name').limit(1000),
    ]);
    if (entryResult.error || userResult.error) setNote(`失敗：${errorMessage(entryResult.error || userResult.error, '業管組交接資料載入失敗')}`);
    setEntries(entryResult.data || []); setUsers(userResult.data || []); setBusy(false);
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  const userName = useCallback((id: unknown) => users.find(user => String(user.user_id) === String(id))?.name || (String(id || '') === profile.user_id ? profile.name : '—'), [profile.name, profile.user_id, users]);
  const validEntries = useMemo(() => entries.filter(row => !isDeleted(row)), [entries]);
  const print = () => { window.print(); };

  return <AppShell profile={profile} title={system.title} heading={{ system, module }}>
    <div className="business-page">
      <AdminHeader module={module} busy={busy} note={note} onReload={load} action={<button className="primary-btn compact business-print-button" onClick={print}>列印本日報表</button>} />
      <section className="panel business-toolbar">
        <button className="secondary-btn compact" aria-label="前一天" onClick={() => setDate(current => moveDate(current, -1))}>‹</button>
        <label>交接日期<LocalizedDateInput aria-label="交接日期（年/月/日）" value={date} onChange={event => setDate(event.target.value)} /></label>
        <button className="secondary-btn compact" aria-label="後一天" onClick={() => setDate(current => moveDate(current, 1))}>›</button>
        <button className="secondary-btn compact" onClick={() => setDate(todayTaipei())}>回到今天</button>
        <span>{rocDate(date)} · 本日共 {validEntries.length} 件交接</span>
      </section>

      <section className="business-sheet" aria-label="業管組電子交接簿">
        <header><div><small>臺北農產運銷股份有限公司　第一果菜市場</small><h2>業管組交接紀錄表</h2></div><b>{rocDate(date)}</b></header>
        {SHIFTS.map((shift, index) => {
          const rows = entries.filter(row => row.shift_code === shift.code);
          const active = rows.filter(row => !isDeleted(row));
          return <section className={`business-shift business-shift-${index + 1}`} key={shift.code}>
            <div className="business-shift-head"><div><strong>{['一', '二', '三'][index]}</strong><span><b>{shift.name}</b><small>{shift.label} · {active.length} 件交接</small></span></div><button className="primary-btn compact" onClick={() => { setEditingEntry(null); setEditingShift(shift.code); }}>＋ 新增交接</button></div>
            <div className="business-entry-list">{rows.length ? rows.map((row, itemIndex) => <article className={`business-entry${isDeleted(row) ? ' is-deleted' : ''}`} key={String(row.entry_id)} role="button" tabIndex={0} onClick={() => { setEditingEntry(row); setEditingShift(shift.code); }} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setEditingEntry(row); setEditingShift(shift.code); } }}>
              <div className="business-entry-main"><small><b>第 {itemIndex + 1} 件</b>{String(row.category || '其他')}</small><p>{String(row.description || '—')}</p></div>
              <div className="business-attendance"><span>應出勤 <b>{Number(row.expected_attendance || 0)}</b> 人</span><span>未出勤 <b>{Number(row.absent_attendance || 0)}</b> 人</span></div>
              <div className="business-audit"><span>建立 {activityTime(row.created_at)} · {userName(row.created_by)}</span>{row.updated_at && new Date(String(row.updated_at)).getTime() > new Date(String(row.created_at)).getTime() && !isDeleted(row) && <span>修改 {activityTime(row.updated_at)} · {userName(row.updated_by)}</span>}{isDeleted(row) && <span>刪除 {activityTime(row.deleted_at)} · {userName(row.deleted_by)}</span>}<b>{isDeleted(row) ? '已刪除，保留紀錄' : '點擊修改'}</b></div>
            </article>) : <p className="business-empty">本班尚無交接紀錄，請按「新增交接」建立。</p>}</div>
          </section>;
        })}
      </section>

      <section className="business-print-sheet" aria-label="業管組每日列印報表">
        <header><h2>臺北農產運銷股份有限公司第一果菜市場<br />業管組交接紀錄表</h2><p>{rocDate(date)}</p></header>
        <table><thead><tr><th>班別</th><th>交接分類</th><th>交接說明</th><th>應出勤</th><th>未出勤</th></tr></thead><tbody>{SHIFTS.flatMap(shift => {
          const rows = entries.filter(row => row.shift_code === shift.code);
          return (rows.length ? rows : [null]).map((row, index) => <tr className={row && isDeleted(row) ? 'is-deleted' : ''} key={row ? String(row.entry_id) : `${shift.code}-empty`}>
            {index === 0 && <th rowSpan={Math.max(rows.length, 1)}>{shift.name}<br />{shift.label}</th>}<td>{row ? String(row.category || '—') : '—'}</td><td>{row ? String(row.description || '—') : '尚無交接紀錄'}</td><td>{row ? `${Number(row.expected_attendance || 0)} 人` : '—'}</td><td>{row ? `${Number(row.absent_attendance || 0)} 人` : '—'}</td>
          </tr>);
        })}</tbody></table>
      </section>
    </div>
    {editingShift && <BusinessEntryModal date={date} shiftCode={editingShift} entry={editingEntry} userName={userName} onClose={() => { setEditingShift(null); setEditingEntry(null); }} onDone={async action => { setEditingShift(null); setEditingEntry(null); await load(); setNote(action === 'deleted' ? '交接紀錄已標記刪除並保留時間紀錄' : action === 'updated' ? '交接紀錄已修改並保留時間紀錄' : '交接紀錄已新增'); }} />}
  </AppShell>;
}

function BusinessEntryModal({ date, shiftCode, entry, userName, onClose, onDone }: { date: string; shiftCode: string; entry: Row | null; userName: (id: unknown) => string; onClose: () => void; onDone: (action: 'created' | 'updated' | 'deleted') => void }) {
  const [category, setCategory] = useState(String(entry?.category || ''));
  const [expected, setExpected] = useState(Number(entry?.expected_attendance || 0));
  const [absent, setAbsent] = useState(Number(entry?.absent_attendance || 0));
  const [description, setDescription] = useState(String(entry?.description || attendanceLine(0, 0)));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [confirmDelete, setConfirmDelete] = useState(false);
  const locked = Boolean(entry && isDeleted(entry));
  const setAttendance = (nextExpected: number, nextAbsent: number) => {
    const safeAbsent = Math.min(nextExpected, nextAbsent);
    setExpected(nextExpected); setAbsent(safeAbsent); setDescription(current => withAttendanceLine(current, nextExpected, safeAbsent));
  };
  const submit = async () => {
    if (!category) return setMessage('請選擇交接分類');
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('handover_save', { kind: entry ? 'business_entry_update' : 'business_entry', entry_id: entry?.entry_id, handover_date: date, shift_code: shiftCode, category, description: withAttendanceLine(description, expected, absent), expected_attendance: expected, absent_attendance: absent });
      await onDone(entry ? 'updated' : 'created');
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  };
  const remove = async () => {
    if (!entry || locked) return;
    if (!confirmDelete) { setConfirmDelete(true); setMessage('刪除後仍會保留紀錄並以刪除線顯示；請再按一次確認。'); return; }
    setBusy(true); setMessage('');
    try { await invokeAppApi('handover_save', { kind: 'business_entry_delete', entry_id: entry.entry_id }); await onDone('deleted'); }
    catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  };
  return <AdminModal className="business-modal" title={`${entry ? locked ? '查看交接' : '修改交接' : '新增交接'}｜${SHIFTS.find(shift => shift.code === shiftCode)?.label}`} onClose={onClose}>
    {entry && <div className={`business-history${locked ? ' is-deleted' : ''}`}><b>{locked ? '已刪除紀錄' : '異動時間紀錄'}</b><span>建立：{activityTime(entry.created_at)} · {userName(entry.created_by)}</span>{entry.updated_at && <span>最後修改：{activityTime(entry.updated_at)} · {userName(entry.updated_by)}</span>}{locked && <span>刪除：{activityTime(entry.deleted_at)} · {userName(entry.deleted_by)}</span>}</div>}
    <div className="admin-form-grid business-form">
      <label>交接分類<select disabled={locked} value={category} onChange={event => setCategory(event.target.value)}><option value="">— 請選擇 —</option>{CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <div className="business-attendance-fields"><label>本日應出勤人數<select disabled={locked} value={expected} onChange={event => setAttendance(Number(event.target.value), absent)}>{Array.from({ length: 51 }, (_, value) => <option key={value} value={value}>{value} 人</option>)}</select></label><label>未出勤人數<select disabled={locked} value={absent} onChange={event => setAttendance(expected, Number(event.target.value))}>{Array.from({ length: expected + 1 }, (_, value) => <option key={value} value={value}>{value} 人</option>)}</select></label></div>
      <label className="wide">交接說明<textarea disabled={locked} rows={7} value={description} onChange={event => setDescription(event.target.value)} placeholder="請填寫交接事項、維修狀況或其他說明" /><small>出勤人數會自動帶入交接說明第一行。</small></label>
    </div>
    {message && <p role="alert" className="inline-message danger">{message}</p>}
    <footer><button className="secondary-btn" onClick={onClose}>{locked ? '關閉' : '取消'}</button>{entry && !locked && <button className="danger-btn compact" disabled={busy} onClick={() => void remove()}>{confirmDelete ? '確認刪除' : '刪除紀錄'}</button>}{!locked && <button className="primary-btn compact" disabled={busy} onClick={() => void submit()}>{busy ? '儲存中…' : entry ? '儲存修改' : '新增交接紀錄'}</button>}</footer>
  </AdminModal>;
}
