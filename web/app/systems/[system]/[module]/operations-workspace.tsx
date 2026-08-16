'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Row = Record<string, any>;
type HandoverForm = { date: string; shift: string; handoverBy: string; takeoverBy: string; issues: string[]; pending: string[]; notes: string };
type Point = { marker_id: string; floor_id?: string | null; label?: string | null; note?: string | null };
type PatrolSchedule = { shift_id: string; name: string; start_time: string; end_time: string };

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const shifts = [
  { id: 'morning', label: '早班', time: '06:00–14:00' },
  { id: 'afternoon', label: '中班', time: '14:00–22:00' },
  { id: 'night', label: '夜班', time: '22:00–06:00' },
];
const patrolShifts = [
  { id: 'morning', label: '早班', time: '08:00–12:00' },
  { id: 'noon', label: '午班', time: '12:00–16:00' },
  { id: 'evening', label: '晚班', time: '16:00–22:00' },
  { id: 'night', label: '夜班', time: '22:00–08:00' },
];
const text = (v: unknown) => v == null || v === '' ? '—' : String(v);
const handoverStatus = (row: Row) => row.confirmed_at || row.confirmed_by ? '交接完成' : row.status === 'confirmed' ? '待接班人接收' : '草稿';

export function HandoverWorkspace({ system, module, profile }: { system: SystemDefinition; module: ModuleDefinition; profile: Profile }) {
  const client = getSupabase();
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [form, setForm] = useState<HandoverForm>({ date: today(), shift: 'morning', handoverBy: profile.user_id, takeoverBy: '', issues: [], pending: [], notes: '' });
  const [issue, setIssue] = useState('');
  const [pending, setPending] = useState('');
  const [activeTab, setActiveTab] = useState(module.key === 'open-items' ? 'open' : 'new');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const isRecords = module.key === 'records';
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [data, people] = await Promise.all([
        invokeAppApi<{ rows: Row[] }>('module_data', { system: 'handover', module: 'records' }),
        client.from('users').select('user_id,name,department').eq('status', 'active').order('name').limit(500),
      ]);
      setRows(data.rows || []); setUsers(people.data || []);
    } catch (error) { setNote(error instanceof Error ? error.message : '交接資料載入失敗'); }
    finally { setBusy(false); }
  }, [client]);
  useEffect(() => { void load(); }, [load]);
  const add = (kind: 'issues' | 'pending') => {
    const value = (kind === 'issues' ? issue : pending).trim();
    if (!value) return;
    setForm(current => ({ ...current, [kind]: [...current[kind], value] }));
    kind === 'issues' ? setIssue('') : setPending('');
  };
  const save = async (status: 'draft' | 'confirmed') => {
    if (!form.date || !form.handoverBy || !form.takeoverBy) { setNote('請選擇交接日期、交接人與接班人'); return; }
    if (form.handoverBy === form.takeoverBy) { setNote('交接人與接班人不可為同一人'); return; }
    setBusy(true); setNote('');
    const { error } = await client.from('handover_records').insert({ shift_date: form.date, shift_type: form.shift, handover_by: form.handoverBy, takeover_by: form.takeoverBy, issues: form.issues.join('\n'), pending: form.pending.join('\n'), notes: form.notes, status });
    if (error) setNote(`儲存失敗：${error.message}`); else { setNote(status === 'draft' ? '草稿已儲存' : '交接單已送出，等待指定接班人接收'); setForm(current => ({ ...current, issues: [], pending: [], notes: '' })); await load(); }
    setBusy(false);
  };
  const receive = async (row: Row) => {
    if (String(row.takeover_by) !== profile.user_id) { setNote('只有指定接班人可以接收此交接單'); return; }
    setBusy(true); setNote('');
    const { error } = await client.from('handover_records').update({ confirmed_by: profile.user_id, confirmed_at: new Date().toISOString() }).eq('record_id', row.record_id).eq('takeover_by', profile.user_id).eq('status', 'confirmed');
    if (error) setNote(`接收失敗：${error.message}`); else { setNote('接班人已接收，交接正式完成'); await load(); }
    setBusy(false);
  };
  const visible = useMemo(() => activeTab === 'open' ? rows.filter(row => row.pending || row.issues) : rows, [activeTab, rows]);
  return <AppShell profile={profile} title={system.title}><div className='content v1-content operations-page'>
    <header className='operations-header'><img src={system.icon} alt='' /><div><h1>{system.title}</h1><p>沿用 V1 的班別交接、雙層接收與待辦稽核流程。</p></div></header>
    {note && <p className='operations-note' role='status'>{note}</p>}
    <nav className='operations-tabs'><button className={activeTab === 'new' ? 'active' : ''} onClick={() => setActiveTab('new')}>新增交接</button><button className={activeTab === 'open' ? 'active' : ''} onClick={() => setActiveTab('open')}>未結事項</button><button className={activeTab === 'history' ? 'active' : ''} onClick={() => setActiveTab('history')}>交接記錄</button></nav>
    {activeTab === 'new' && <section className='operations-panel'>
      <div className='operations-panel-title'><h2>基本資訊</h2><span>填表日期：<b>{today()}</b></span></div>
      <div className='operations-form-grid'><label>班別<select value={form.shift} onChange={e => setForm({ ...form, shift: e.target.value })}>{shifts.map(shift => <option key={shift.id} value={shift.id}>{shift.label} {shift.time}</option>)}</select></label><label>交接日期<input type='date' value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></label><label>交接人（離班）<select value={form.handoverBy} onChange={e => setForm({ ...form, handoverBy: e.target.value })}><option value=''>— 選擇人員 —</option>{users.map(user => <option key={user.user_id} value={user.user_id}>{user.name}{user.department ? `（${user.department}）` : ''}</option>)}</select></label><label>接班人（到班）<select value={form.takeoverBy} onChange={e => setForm({ ...form, takeoverBy: e.target.value })}><option value=''>— 選擇人員 —</option>{users.map(user => <option key={user.user_id} value={user.user_id}>{user.name}{user.department ? `（${user.department}）` : ''}</option>)}</select></label></div>
      <div className='operations-panel-title compact'><h2>異常事項</h2></div><div className='operations-add-row'><input value={issue} placeholder='輸入異常事項，按 Enter 新增' onChange={e => setIssue(e.target.value)} onKeyDown={e => e.key === 'Enter' && add('issues')} /><button onClick={() => add('issues')}>＋ 新增</button></div><div className='operations-tags'>{form.issues.map((item, i) => <span key={`${item}-${i}`}>{item}<button onClick={() => setForm({ ...form, issues: form.issues.filter((_, index) => index !== i) })}>×</button></span>)}</div>
      <div className='operations-panel-title compact'><h2>待辦事項</h2></div><div className='operations-add-row'><input value={pending} placeholder='輸入待辦事項，按 Enter 新增' onChange={e => setPending(e.target.value)} onKeyDown={e => e.key === 'Enter' && add('pending')} /><button onClick={() => add('pending')}>＋ 新增</button></div><div className='operations-tags'>{form.pending.map((item, i) => <span key={`${item}-${i}`}>{item}<button onClick={() => setForm({ ...form, pending: form.pending.filter((_, index) => index !== i) })}>×</button></span>)}</div>
      <label className='operations-wide'>備註<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder='其他需要說明的事項…' /></label><p className='operations-flow'>雙層交接稽核：交接人送出填單 → 指定接班人登入並點選接收 → 系統才登記交接完成。</p><div className='operations-actions'><button disabled={busy} onClick={() => void save('draft')}>儲存草稿</button><button className='primary' disabled={busy} onClick={() => void save('confirmed')}>送出交接（待接班人接收）</button></div>
    </section>}
    {activeTab !== 'new' && <section className='operations-panel'><div className='operations-panel-title'><h2>{activeTab === 'open' ? '未結事項' : '交接記錄'}</h2><button onClick={() => void load()} disabled={busy}>重新載入</button></div><div className='operations-table-wrap'><table className='operations-table'><thead><tr><th>日期</th><th>班別</th><th>異常事項</th><th>待辦</th><th>備註</th><th>狀態</th><th>操作</th></tr></thead><tbody>{visible.map((row, index) => <tr key={String(row.record_id || index)}><td>{text(row.shift_date)}</td><td>{shifts.find(shift => shift.id === row.shift_type)?.label || text(row.shift_type)}</td><td>{text(row.issues)}</td><td>{text(row.pending)}</td><td>{text(row.notes)}</td><td><span className={`operations-status ${row.confirmed_at ? 'done' : row.status === 'confirmed' ? 'waiting' : 'draft'}`}>{handoverStatus(row)}</span></td><td>{row.status === 'confirmed' && !row.confirmed_at && String(row.takeover_by) === profile.user_id && <button onClick={() => void receive(row)}>接收交接</button>}</td></tr>)}</tbody></table>{!visible.length && <p className='operations-empty'>{busy ? '載入中…' : '目前沒有交接資料。'}</p>}</div></section>}
  </div></AppShell>;
}

function GuardPatrolWorkspace({ system, module, profile }: { system: SystemDefinition; module: ModuleDefinition; profile: Profile }) {
  const client = getSupabase();
  const [rows, setRows] = useState<Row[]>([]); const [points, setPoints] = useState<Point[]>([]); const [schedules, setSchedules] = useState<PatrolSchedule[]>([]); const [selected, setSelected] = useState(''); const [exportFrom, setExportFrom] = useState(today()); const [exportTo, setExportTo] = useState(today()); const [date, setDate] = useState(today()); const [floor, setFloor] = useState(''); const [shift, setShift] = useState(''); const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  const load = useCallback(async () => { setBusy(true); try { const [data, markerResult, scheduleResult] = await Promise.all([invokeAppApi<{ rows: Row[] }>('module_data', { system: 'guardpatrol', module: 'checkins' }), client.from('plan_markers').select('marker_id,floor_id,label,note').eq('kind', 'patrol').order('floor_id').order('label').limit(1000), client.from('patrol_shifts').select('shift_id,name,start_time,end_time').eq('shift_date', date).order('sort_order').order('start_time')]); setRows(data.rows || []); setPoints(markerResult.data || []); setSchedules(scheduleResult.data || []); } catch (error) { setNote(error instanceof Error ? error.message : '巡檢資料載入失敗'); } finally { setBusy(false); } }, [client, date]);
  useEffect(() => { void load(); }, [load]);
  const visibleRows = useMemo(() => rows.filter(row => (!floor || String(row.floor_id || '') === floor) && (!date || String(row.checkin_at || '').slice(0, 10) === date) && (!shift || !row.shift_type || String(row.shift_type) === shift) && (!status || status === 'ok')), [rows, floor, date, shift, status]);
  const floors = useMemo(() => [...new Set(points.map(point => String(point.floor_id || '未分類')))].sort(), [points]);
  const floorGroups = useMemo(() => floors.map(value => ({ floor: value, points: points.filter(point => String(point.floor_id || '未分類') === value) })), [floors, points]);
  const statusFor = (point: Point, schedule: PatrolSchedule) => { const checked = rows.some(row => String(row.floor_id || '未分類') === String(point.floor_id || '未分類') && String(row.label || '') === String(point.label || '') && (!row.shift_type || String(row.shift_type) === schedule.shift_id || String(row.shift_type) === schedule.name)); if (checked) return 'ok'; const day = new Date(`${date}T00:00:00`); const todayDay = new Date(`${today()}T00:00:00`); const [sh, sm] = String(schedule.start_time).slice(0, 5).split(':').map(Number); const [eh, em] = String(schedule.end_time).slice(0, 5).split(':').map(Number); const now = new Date(); const endMinutes = eh * 60 + em; const nowMinutes = now.getHours() * 60 + now.getMinutes(); return day < todayDay || (day.getTime() === todayDay.getTime() && nowMinutes >= endMinutes && endMinutes > sh * 60 + sm) ? 'overdue' : 'pending'; };
  const matrixSchedules = shift ? schedules.filter(item => item.shift_id === shift) : schedules;
  const matrixGroups = floorGroups.map(group => ({ ...group, points: group.points.filter(point => !status || matrixSchedules.some(item => statusFor(point, item) === status)) })).filter(group => group.points.length);
  const exportCsv = (source: Row[]) => { const header = ['打卡時間', '巡檢人員', '樓層', '巡檢點', '類型', '狀態']; const body = source.map(row => [row.checkin_at, row.user_name, row.floor_id, row.label, row.target_type, '已打卡']); const csv = [header, ...body].map(line => line.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n'); const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `巡檢打卡_${date}.csv`; link.click(); URL.revokeObjectURL(url); };
  const checkin = async () => { const point = points.find(item => item.marker_id === selected); if (!point) { setNote('請先選擇巡檢點'); return; } setBusy(true); setNote(''); const { error } = await client.from('checkin_logs').insert({ target_type: 'marker', target_id: point.marker_id, floor_id: point.floor_id || null, label: point.label || null, user_id: profile.user_id, user_name: profile.name }); if (error) setNote(`打卡失敗：${error.message}`); else { setNote(`已完成「${point.label || '巡檢點'}」打卡`); setSelected(''); await load(); } setBusy(false); };
  return <AppShell profile={profile} title={system.title}><div className='content v1-content operations-page'><header className='operations-header'><img src={system.icon} alt='' /><div><h1>{system.title}</h1><p>依班別排程管理巡邏點，記錄各樓層巡檢打卡與逾期狀態。</p></div></header>{note && <p className='operations-note' role='status'>{note}</p>}<section className='operations-panel'><div className='operations-panel-title'><h2>{module.title}</h2><button onClick={() => void load()} disabled={busy}>重新載入</button></div><p className='operations-hint'>依「班別排程管理」巡邏點，記錄各樓層巡檢打卡與逾期狀態。</p><div className='operations-datebar'><button onClick={() => setDate(current => { const value = new Date(current + 'T00:00:00'); value.setDate(value.getDate() - 1); return value.toISOString().slice(0, 10); })}>◀</button><input type='date' value={date} onChange={e => setDate(e.target.value)} /><button onClick={() => setDate(current => { const value = new Date(current + 'T00:00:00'); value.setDate(value.getDate() + 1); return value.toISOString().slice(0, 10); })}>▶</button><button onClick={() => setDate(today())}>今天</button></div><div className='operations-filter-row'><label>樓層<select value={floor} onChange={e => setFloor(e.target.value)}><option value=''>全部樓層</option>{floors.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>班別<select value={shift} onChange={e => setShift(e.target.value)}><option value=''>全部班別</option>{schedules.map(item => <option key={item.shift_id} value={item.shift_id}>{item.name} {String(item.start_time).slice(0, 5)}–{String(item.end_time).slice(0, 5)}</option>)}</select></label><label>打卡狀態<select value={status} onChange={e => setStatus(e.target.value)}><option value=''>全部狀態</option><option value='ok'>已打卡</option><option value='pending'>待打卡</option><option value='overdue'>逾期未打卡</option></select></label><label className='export-date'>匯出起日<input type='date' value={exportFrom} onChange={e => setExportFrom(e.target.value)} /></label><label className='export-date'>匯出迄日<input type='date' value={exportTo} onChange={e => setExportTo(e.target.value)} /></label><button className='operations-export' onClick={() => exportCsv(visibleRows)}>匯出當日 XLSX</button><button className='operations-export' onClick={() => exportCsv(rows.filter(row => String(row.checkin_at || '').slice(0, 10) >= exportFrom && String(row.checkin_at || '').slice(0, 10) <= exportTo))}>匯出期間 XLSX</button></div><div className='operations-stat-row'><span>{shift ? schedules.find(item => item.shift_id === shift)?.name : '當班即時統計'}<b>{shift ? `${String(schedules.find(item => item.shift_id === shift)?.start_time || '').slice(0, 5)}–${String(schedules.find(item => item.shift_id === shift)?.end_time || '').slice(0, 5)}` : '目前無進行中班別'}</b></span><span className='stat-done'>已打卡 <b>{visibleRows.length}</b></span><span className='stat-pending'>待打卡 <b>{Math.max(points.length - visibleRows.length, 0)}</b></span><span className='stat-overdue'>逾期未打卡 <b>0</b></span></div><div className='operations-legend'><span className='ok'>● 已打卡</span><span className='pending'>● 待打卡（班別進行中）</span><span className='overdue'>● 逾期未打卡</span></div><div className='operations-table-wrap'><table className='operations-matrix'><thead><tr><th>樓層</th><th>巡檢點</th>{matrixSchedules.map(item => <th key={item.shift_id}>{item.name}<br />{String(item.start_time).slice(0, 5)}–{String(item.end_time).slice(0, 5)}</th>)}</tr></thead><tbody>{matrixGroups.map(group => <tr key={group.floor}><td className='floor-name'>▶ {group.floor}</td><td>{group.points.length} 個巡檢點</td>{matrixSchedules.map(item => <td key={item.shift_id}>{group.points.some(point => statusFor(point, item) === 'ok') ? <span className='operations-dot done'>✓</span> : statusFor(group.points[0], item) === 'overdue' ? <span className='operations-dot overdue'>✕</span> : <span className='operations-dot pending'>…</span>}</td>)}</tr>)}</tbody></table></div><div className='operations-checkin-bar'><label>巡檢點<select value={selected} onChange={e => setSelected(e.target.value)}><option value=''>— 選擇巡檢點 —</option>{points.map(point => <option key={point.marker_id} value={point.marker_id}>{point.floor_id || '未分類'}｜{point.label || point.marker_id}</option>)}</select></label><button className='primary' disabled={busy} onClick={() => void checkin()}>✓ 完成打卡</button></div><div className='operations-table-wrap'><table className='operations-table'><thead><tr><th>打卡時間</th><th>巡檢人員</th><th>樓層</th><th>巡檢點</th><th>類型</th><th>狀態</th></tr></thead><tbody>{visibleRows.map((row, index) => <tr key={String(row.checkin_id || index)}><td>{text(row.checkin_at)}</td><td>{text(row.user_name)}</td><td>{text(row.floor_id)}</td><td>{text(row.label)}</td><td>{text(row.target_type)}</td><td><span className='operations-status done'>已打卡</span></td></tr>)}</tbody></table>{!visibleRows.length && <p className='operations-empty'>{busy ? '載入中…' : '目前沒有符合條件的巡檢資料。'}</p>}</div></section></div></AppShell>;
}

export function OperationsWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  return <AuthGate>{profile => system.key === 'handover' ? <HandoverWorkspace system={system} module={module} profile={profile} /> : <GuardPatrolWorkspace system={system} module={module} profile={profile} />}</AuthGate>;
}
