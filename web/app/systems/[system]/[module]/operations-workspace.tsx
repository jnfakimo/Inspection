'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import { PatrolWorkspace } from './patrol-workspace';
import { HandoverModules } from './handover-workspace';

type Row = Record<string, any>;
type Point = { marker_id: string; floor_id?: string | null; label?: string | null; note?: string | null };
type PatrolSchedule = { shift_id: string; name: string; start_time: string; end_time: string };

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const text = (v: unknown) => v == null || v === '' ? '—' : String(v);

function GuardPatrolWorkspace({ system, module, profile }: { system: SystemDefinition; module: ModuleDefinition; profile: Profile }) {
  const client = getSupabase();
  const [rows, setRows] = useState<Row[]>([]); const [points, setPoints] = useState<Point[]>([]); const [schedules, setSchedules] = useState<PatrolSchedule[]>([]); const [selected, setSelected] = useState(''); const [exportFrom, setExportFrom] = useState(today()); const [exportTo, setExportTo] = useState(today()); const [date, setDate] = useState(today()); const [floor, setFloor] = useState(''); const [shift, setShift] = useState(''); const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  const load = useCallback(async () => { setBusy(true); try { const [data, markerResult, scheduleResult] = await Promise.all([invokeAppApi<{ rows: Row[] }>('module_data', { system: 'guardpatrol', module: 'checkins' }), client.from('plan_markers').select('marker_id,floor_id,label,note').eq('kind', 'patrol').order('floor_id').order('label').limit(1000), client.from('patrol_shifts').select('shift_id,name,start_time,end_time').eq('shift_date', date).order('sort_order').order('start_time')]); setRows(data.rows || []); setPoints(markerResult.data || []); setSchedules(scheduleResult.data || []); } catch (error) { setNote(error instanceof Error ? error.message : '巡檢資料載入失敗'); } finally { setBusy(false); } }, [client, date]);
  useEffect(() => { void load(); }, [load]);
  const visibleRows = useMemo(() => rows.filter(row => (!floor || String(row.floor_id || '') === floor) && (!date || String(row.checkin_at || '').slice(0, 10) === date) && (!shift || !row.shift_type || String(row.shift_type) === shift) && (!status || status === 'ok')), [rows, floor, date, shift, status]);
  const floors = useMemo(() => [...new Set(points.map(point => String(point.floor_id || '未分類')))].sort(), [points]);
  const floorGroups = useMemo(() => floors.map(value => ({ floor: value, points: points.filter(point => String(point.floor_id || '未分類') === value) })), [floors, points]);
  const statusFor = (point: Point, schedule: PatrolSchedule) => { const checked = rows.some(row => String(row.checkin_at || '').slice(0, 10) === date && String(row.floor_id || '未分類') === String(point.floor_id || '未分類') && String(row.label || '') === String(point.label || '') && (!row.shift_type || String(row.shift_type) === schedule.shift_id || String(row.shift_type) === schedule.name)); if (checked) return 'ok'; const day = new Date(`${date}T00:00:00`); const todayDay = new Date(`${today()}T00:00:00`); const [sh, sm] = String(schedule.start_time).slice(0, 5).split(':').map(Number); const [eh, em] = String(schedule.end_time).slice(0, 5).split(':').map(Number); const now = new Date(); const endMinutes = eh * 60 + em; const nowMinutes = now.getHours() * 60 + now.getMinutes(); return day < todayDay || (day.getTime() === todayDay.getTime() && nowMinutes >= endMinutes && endMinutes > sh * 60 + sm) ? 'overdue' : 'pending'; };
  // 當班即時統計：沿用 V1 guardpatrol.html 的 renderDutyStats 語意——
  // 只有「所選日期是今天且此刻落在某個班別時段內」才統計，否則顯示無進行中班別。
  // 原本三個數字是用打卡筆數粗算、逾期恆為 0，與矩陣裡逐格算出的狀態對不起來。
  const minutesOf = (value: unknown) => { const [h, m] = String(value).slice(0, 5).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const activeSchedule = useMemo(() => {
    if (date !== today()) return null;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const inRange = (item: PatrolSchedule) => {
      const start = minutesOf(item.start_time), end = minutesOf(item.end_time);
      return end > start ? nowMinutes >= start && nowMinutes <= end : nowMinutes >= start || nowMinutes <= end;
    };
    return (shift ? schedules.filter(item => item.shift_id === shift) : schedules).find(inRange) || null;
  }, [schedules, date, shift]);
  const dutyPoints = useMemo(() => points.filter(point => !floor || String(point.floor_id || '未分類') === floor), [points, floor]);
  const dutyCounts = activeSchedule
    ? dutyPoints.reduce((acc, point) => { acc[statusFor(point, activeSchedule) as 'ok' | 'pending' | 'overdue'] += 1; return acc; }, { ok: 0, pending: 0, overdue: 0 })
    : null;

  const matrixSchedules = shift ? schedules.filter(item => item.shift_id === shift) : schedules;
  const matrixGroups = floorGroups.map(group => ({ ...group, points: group.points.filter(point => !status || matrixSchedules.some(item => statusFor(point, item) === status)) })).filter(group => group.points.length);
  // 按鈕原本寫「匯出 XLSX」卻輸出 CSV，與 2026-08-17 全站統一 XLSX 的決定不符，已改為真的產出 xlsx。
  // ExcelJS 以動態 import 載入，只有實際匯出時才下載。
  const exportXlsx = async (source: Row[], filename: string) => {
    setNote('');
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = '臺北農產公司'; wb.created = new Date();
      const ws = wb.addWorksheet('巡檢打卡');
      ws.addRow(['打卡時間', '巡檢人員', '樓層', '巡檢點', '類型', '狀態']);
      source.forEach(row => ws.addRow([text(row.checkin_at), text(row.user_name), text(row.floor_id), text(row.label), text(row.target_type), '已打卡']));
      ws.getRow(1).font = { bold: true };
      ws.columns.forEach(col => { col.width = 18; });
      const buffer = await wb.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = filename;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setNote(error instanceof Error ? `匯出失敗：${error.message}` : '匯出失敗'); }
  };  const checkin = async () => { const point = points.find(item => item.marker_id === selected); if (!point) { setNote('請先選擇巡檢點'); return; } setBusy(true); setNote(''); const { error } = await client.from('checkin_logs').insert({ target_type: 'marker', target_id: point.marker_id, floor_id: point.floor_id || null, label: point.label || null, user_id: profile.user_id, user_name: profile.name }); if (error) setNote(`打卡失敗：${error.message}`); else { setNote(`已完成「${point.label || '巡檢點'}」打卡`); setSelected(''); await load(); } setBusy(false); };
  return <AppShell profile={profile} title={system.title}><div className='content v1-content operations-page'><header className='operations-header'><img src={system.icon} alt='' /><div><h1>{system.title}</h1><p>依班別排程管理巡邏點，記錄各樓層巡檢打卡與逾期狀態。</p></div></header>{note && <p className='operations-note' role='status'>{note}</p>}<section className='operations-panel'><div className='operations-panel-title'><h2>{module.title}</h2><button onClick={() => void load()} disabled={busy}>重新載入</button></div><p className='operations-hint'>依「班別排程管理」巡邏點，記錄各樓層巡檢打卡與逾期狀態。</p><div className='operations-datebar'><button onClick={() => setDate(current => { const value = new Date(current + 'T00:00:00'); value.setDate(value.getDate() - 1); return value.toISOString().slice(0, 10); })}>◀</button><input type='date' value={date} onChange={e => setDate(e.target.value)} /><button onClick={() => setDate(current => { const value = new Date(current + 'T00:00:00'); value.setDate(value.getDate() + 1); return value.toISOString().slice(0, 10); })}>▶</button><button onClick={() => setDate(today())}>今天</button></div><div className='operations-filter-row'><label>樓層<select value={floor} onChange={e => setFloor(e.target.value)}><option value=''>全部樓層</option>{floors.map(value => <option key={value} value={value}>{value}</option>)}</select></label><label>班別<select value={shift} onChange={e => setShift(e.target.value)}><option value=''>全部班別</option>{schedules.map(item => <option key={item.shift_id} value={item.shift_id}>{item.name} {String(item.start_time).slice(0, 5)}–{String(item.end_time).slice(0, 5)}</option>)}</select></label><label>打卡狀態<select value={status} onChange={e => setStatus(e.target.value)}><option value=''>全部狀態</option><option value='ok'>已打卡</option><option value='pending'>待打卡</option><option value='overdue'>逾期未打卡</option></select></label><label className='export-date'>匯出起日<input type='date' value={exportFrom} onChange={e => setExportFrom(e.target.value)} /></label><label className='export-date'>匯出迄日<input type='date' value={exportTo} onChange={e => setExportTo(e.target.value)} /></label><button className='operations-export' onClick={() => void exportXlsx(visibleRows, `巡檢打卡_${date}.xlsx`)}>匯出當日 XLSX</button><button className='operations-export' onClick={() => void exportXlsx(rows.filter(row => String(row.checkin_at || '').slice(0, 10) >= exportFrom && String(row.checkin_at || '').slice(0, 10) <= exportTo), `巡檢打卡_${exportFrom}_${exportTo}.xlsx`)}>匯出期間 XLSX</button></div><div className='operations-stat-row'><span>當班即時統計<b>{activeSchedule ? `${activeSchedule.name} ${String(activeSchedule.start_time).slice(0, 5)}–${String(activeSchedule.end_time).slice(0, 5)}` : '目前無進行中班別'}</b></span><span className='stat-done'>已打卡 <b>{dutyCounts ? dutyCounts.ok : '—'}</b></span><span className='stat-pending'>待打卡 <b>{dutyCounts ? dutyCounts.pending : '—'}</b></span><span className='stat-overdue'>逾期未打卡 <b>{dutyCounts ? dutyCounts.overdue : '—'}</b></span><span>當日打卡紀錄 <b>{visibleRows.length}</b></span></div><div className='operations-legend'><span className='ok'>● 已打卡</span><span className='pending'>● 待打卡（班別進行中）</span><span className='overdue'>● 逾期未打卡</span></div><div className='operations-table-wrap'><table className='operations-matrix'><thead><tr><th>樓層</th><th>巡檢點</th>{matrixSchedules.map(item => <th key={item.shift_id}>{item.name}<br />{String(item.start_time).slice(0, 5)}–{String(item.end_time).slice(0, 5)}</th>)}</tr></thead><tbody>{matrixGroups.map(group => <tr key={group.floor}><td className='floor-name'>▶ {group.floor}</td><td>{group.points.length} 個巡檢點</td>{matrixSchedules.map(item => <td key={item.shift_id}>{group.points.some(point => statusFor(point, item) === 'ok') ? <span className='operations-dot done'>✓</span> : statusFor(group.points[0], item) === 'overdue' ? <span className='operations-dot overdue'>✕</span> : <span className='operations-dot pending'>…</span>}</td>)}</tr>)}</tbody></table></div><div className='operations-checkin-bar'><label>巡檢點<select value={selected} onChange={e => setSelected(e.target.value)}><option value=''>— 選擇巡檢點 —</option>{points.map(point => <option key={point.marker_id} value={point.marker_id}>{point.floor_id || '未分類'}｜{point.label || point.marker_id}</option>)}</select></label><button className='primary' disabled={busy} onClick={() => void checkin()}>✓ 完成打卡</button></div><div className='operations-table-wrap'><table className='operations-table'><thead><tr><th>打卡時間</th><th>巡檢人員</th><th>樓層</th><th>巡檢點</th><th>類型</th><th>狀態</th></tr></thead><tbody>{visibleRows.map((row, index) => <tr key={String(row.checkin_id || index)}><td>{text(row.checkin_at)}</td><td>{text(row.user_name)}</td><td>{text(row.floor_id)}</td><td>{text(row.label)}</td><td>{text(row.target_type)}</td><td><span className='operations-status done'>已打卡</span></td></tr>)}</tbody></table>{!visibleRows.length && <p className='operations-empty'>{busy ? '載入中…' : '目前沒有符合條件的巡檢資料。'}</p>}</div></section></div></AppShell>;
}

// SYS-03 除了 checkins 之外的五個模組皆由 PatrolWorkspace 承接：
// points 與 records 原本誤渲染成打卡畫面，shifts 繞過 save_patrol_shift，
// notifications 走 module_data 導致多數欄位取不到，map3d 原本只是清單佔位。
// checkins 維持既有的打卡矩陣，未更動。
const PATROL_MODULES = new Set(['points', 'records', 'shifts', 'notifications', 'map3d']);

export function OperationsWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  return <AuthGate>{profile => system.key === 'handover'
    ? <HandoverModules system={system} module={module} profile={profile} />
    : PATROL_MODULES.has(module.key)
      ? <PatrolWorkspace system={system} module={module} profile={profile} />
      : <GuardPatrolWorkspace system={system} module={module} profile={profile} />}</AuthGate>;
}
