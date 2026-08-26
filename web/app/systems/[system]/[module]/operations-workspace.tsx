'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ComboboxSelect } from '@/components/ComboboxSelect';
import { AuthGate } from '@/components/AuthGate';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { checkinRange, getPatrolShiftsForDate, isDeletedShift, isNightShiftName, notificationRange, shiftRange, type PatrolShift } from '@/lib/patrol-status';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import type { Profile } from '@/types/app';
import { PatrolWorkspace } from './patrol-workspace';
import { HandoverModules } from './handover-workspace';
import { canonicalFloor, floorOrder } from '@/lib/floor';

type Row = Record<string, any>;
type Point = { marker_id: string; floor_id?: string | null; label?: string | null; note?: string | null };
type PatrolSchedule = PatrolShift;

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const text = (v: unknown) => v == null || v === '' ? '—' : String(v);

function GuardPatrolWorkspace({ system, module, profile }: { system: SystemDefinition; module: ModuleDefinition; profile: Profile }) {
  const client = getSupabase();
  // 樓層清單以 3D 建模系統的 floor_models 為準：那邊新增或移除樓層，這裡跟著變。
  const [floorModels, setFloorModels] = useState<Array<{ floor_id: string; name?: string | null; level?: number | null }>>([]);
  const [expandedFloors, setExpandedFloors] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<Row[]>([]); const [points, setPoints] = useState<Point[]>([]); const [schedules, setSchedules] = useState<PatrolSchedule[]>([]); const [selected, setSelected] = useState(''); const [exportFrom, setExportFrom] = useState(today()); const [exportTo, setExportTo] = useState(today()); const [date, setDate] = useState(today()); const [floor, setFloor] = useState(''); const [shift, setShift] = useState(''); const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  const load = useCallback(async () => { setBusy(true); try { const [data, markerResult, scheduleResult, floorResult] = await Promise.all([invokeAppApi<{ rows: Row[] }>('module_data', { system: 'guardpatrol', module: 'checkins' }), client.from('plan_markers').select('marker_id,floor_id,label,note').eq('kind', 'patrol').order('floor_id').order('label').limit(1000), getPatrolShiftsForDate(client, date), client.from('floor_models').select('floor_id,name,level').limit(200)]); setRows((data.rows || []).map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) }))); setPoints((markerResult.data || []).map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) }))); setFloorModels((floorResult.data || []).map(row => ({ ...row, floor_id: canonicalFloor(row.floor_id) }))); setSchedules(scheduleResult.filter(row => !isDeletedShift(row.name))); } catch (error) { setNote(error instanceof Error ? error.message : '巡檢資料載入失敗'); } finally { setBusy(false); } }, [client, date]);
  useEffect(() => { void load(); }, [load]);
  // 打卡明細表只有已打卡的記錄，狀態篩選（待打卡／逾期）是給下方巡檢點矩陣用的；
  // 若在此套用 status，選待打卡或逾期未打卡時明細表會恆空。
  // 值班日的打卡明細要涵蓋該日白天，以及隔日凌晨的夜班；不能只用
  // checkin_at 的曆日切片，否則 8/26 00:00–08:00 會被錯放到 8/26 而不屬於 8/25 夜班。
  const visibleRows = useMemo(() => {
    const selectedSchedule = shift ? schedules.find(item => item.shift_id === shift) : null;
    const ranges = (selectedSchedule ? [selectedSchedule] : schedules).map(item => {
      const base = new Date(`${item.base_date}T00:00:00`);
      return { item, range: checkinRange(item, base) };
    });
    return rows.filter(row => {
      if (floor && String(row.floor_id || '') !== floor) return false;
      const checkinAt = new Date(String(row.checkin_at || ''));
      if (Number.isNaN(checkinAt.getTime())) return false;
      const matchesSchedule = ranges.some(({ item, range }) => {
        if (row.shift_type && String(row.shift_type) !== item.shift_id && String(row.shift_type) !== item.name) return false;
        return checkinAt >= range.start && checkinAt <= range.end;
      });
      // 沒有班表時保留原本的曆日查詢，避免設定尚未載入時整張明細誤顯示為空。
      return ranges.length ? matchesSchedule : String(row.checkin_at || '').slice(0, 10) === date;
    });
  }, [rows, floor, date, shift, schedules]);
  // 樓層以 3D 建模系統的 floor_models 為單一來源，依 floorOrder 排序（B1 在 1F 之前）。
  // 巡邏點若落在建模系統已經沒有的樓層，仍然列出並標示未建模——直接濾掉會讓
  // 現場的巡邏點無聲消失，看不出是資料有問題還是真的沒有點。
  const floors = useMemo(() => {
    const modelled = floorModels.map(item => String(item.floor_id));
    const orphans = [...new Set(points.map(point => String(point.floor_id || '未分類')))]
      .filter(value => !modelled.includes(value));
    return [...modelled, ...orphans].sort((a, b) => floorOrder(a) - floorOrder(b));
  }, [floorModels, points]);
  const modelledFloors = useMemo(() => new Set(floorModels.map(item => String(item.floor_id))), [floorModels]);
  const floorGroups = useMemo(() => floors.map(value => ({ floor: value, points: points.filter(point => String(point.floor_id || '未分類') === value) })), [floors, points]);
  const statusFor = (point: Point, schedule: PatrolSchedule) => {
    const day = new Date(`${schedule.base_date}T00:00:00`);
    const accepted = checkinRange(schedule, day);
    const checked = rows.some(row => {
      if (String(row.floor_id || '未分類') !== String(point.floor_id || '未分類') || String(row.label || '') !== String(point.label || '')) return false;
      const shiftMatch = !row.shift_type || String(row.shift_type) === schedule.shift_id || String(row.shift_type) === schedule.name;
      if (!shiftMatch) return false;
      // 夜班的實際打卡日期可能是 duty_date 的下一天，所有班別一律以實際
      // 時間區間勾稽，避免跨日班被當成當日或誤套到另一班。
      const checkinAt = new Date(String(row.checkin_at || ''));
      return !Number.isNaN(checkinAt.getTime()) && checkinAt >= accepted.start && checkinAt <= accepted.end;
    });
    if (checked) return 'ok';
    const now = new Date();
    const notice = notificationRange(schedule, day);
    return now >= notice.end ? 'overdue' : 'pending';
  };
  // 當班即時統計：此刻落在所選值班日的班別時段內才統計；夜班以隔日實際時間軸判定。
  // 原本三個數字是用打卡筆數粗算、逾期恆為 0，與矩陣裡逐格算出的狀態對不起來。
  const activeSchedule = useMemo(() => {
    const now = new Date();
    return (shift ? schedules.filter(item => item.shift_id === shift) : schedules).find(item => {
      const range = shiftRange(item, new Date(`${item.base_date}T00:00:00`));
      return now >= range.start && now <= range.end;
    }) || null;
  }, [schedules, shift]);
  const dutyPoints = useMemo(() => points.filter(point => !floor || String(point.floor_id || '未分類') === floor), [points, floor]);
  const dutyCounts = activeSchedule
    ? dutyPoints.reduce((acc, point) => { acc[statusFor(point, activeSchedule) as 'ok' | 'pending' | 'overdue'] += 1; return acc; }, { ok: 0, pending: 0, overdue: 0 })
    : null;

  const matrixSchedules = shift ? schedules.filter(item => item.shift_id === shift) : schedules;
  const matrixGroups = floorGroups.map(group => ({ ...group, points: group.points.filter(point => !status || matrixSchedules.some(item => statusFor(point, item) === status)) })).filter(group => group.points.length);
  const groupState = (group: { points: Point[] }, schedule: PatrolSchedule) => {
    const states = group.points.map(point => statusFor(point, schedule));
    if (states.every(state => state === 'ok')) return 'ok';
    if (states.some(state => state === 'overdue')) return 'overdue';
    return 'pending';
  };
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
  };  const checkin = async () => { const point = points.find(item => item.marker_id === selected); if (!point) { setNote('請先選擇巡檢點'); return; } setBusy(true); setNote(''); try { await invokeAppApi('guardpatrol_checkin', { target_type: 'marker', target_id: point.marker_id }); setNote(`已完成「${point.label || '巡檢點'}」打卡`); setSelected(''); await load(); } catch (error) { setNote(`打卡失敗：${error instanceof Error ? error.message : String(error)}`); } setBusy(false); };
  return <AppShell profile={profile} title={system.title}><div className='content v1-content operations-page'><header className='operations-header'><img src={system.icon} alt='' /><div><h1>{system.title}</h1><p>依班別排程管理巡邏點，記錄各樓層巡檢打卡與逾期狀態。</p></div></header>{note && <p className='operations-note' role='status'>{note}</p>}<section className='operations-panel'><div className='operations-panel-title'><h2>{module.title}</h2><button onClick={() => void load()} disabled={busy}>重新載入</button></div><p className='operations-hint'>依「巡檢排班」的班別時段與通報時段記錄；夜班歸屬前一日的隔夜班。</p><div className='operations-datebar'><button onClick={() => setDate(current => { const value = new Date(current + 'T00:00:00'); value.setDate(value.getDate() - 1); return value.toISOString().slice(0, 10); })}>◀</button><LocalizedDateInput aria-label='巡檢日期（年/月/日）' value={date} onChange={e => setDate(e.target.value)} /><button onClick={() => setDate(current => { const value = new Date(current + 'T00:00:00'); value.setDate(value.getDate() + 1); return value.toISOString().slice(0, 10); })}>▶</button><button onClick={() => setDate(today())}>今天</button></div><div className='operations-filter-row'><label>樓層<ComboboxSelect value={floor} onChange={setFloor} options={[{value:'',label:'全部樓層'},...floors.map(value => ({value,label:value}))]} /></label><label>班別<ComboboxSelect value={shift} onChange={setShift} options={[{value:'',label:'全部班別'},...schedules.map(item => ({value:item.shift_id,label:`${item.name}${isNightShiftName(item.name) ? '（隔夜）' : ''} ${String(item.start_time).slice(0, 5)}–${String(item.end_time).slice(0, 5)}`}))]} /></label><label>打卡狀態<ComboboxSelect value={status} onChange={setStatus} options={[{value:'',label:'全部狀態'},{value:'ok',label:'已打卡'},{value:'pending',label:'待打卡'},{value:'overdue',label:'逾期未打卡'}]} /></label><label className='export-date'>匯出起日<LocalizedDateInput aria-label='匯出起日（年/月/日）' value={exportFrom} onChange={e => setExportFrom(e.target.value)} /></label><label className='export-date'>匯出迄日<LocalizedDateInput aria-label='匯出迄日（年/月/日）' value={exportTo} onChange={e => setExportTo(e.target.value)} /></label><button className='operations-export' onClick={() => void exportXlsx(visibleRows, `巡檢打卡_${date}.xlsx`)}>匯出值班日 XLSX</button><button className='operations-export' onClick={() => void exportXlsx(rows.filter(row => String(row.checkin_at || '').slice(0, 10) >= exportFrom && String(row.checkin_at || '').slice(0, 10) <= exportTo), `巡檢打卡_${exportFrom}_${exportTo}.xlsx`)}>匯出期間 XLSX</button></div><div className='operations-stat-row'><span>當班即時統計<b>{activeSchedule ? `${activeSchedule.name}${isNightShiftName(activeSchedule.name) ? '（隔夜）' : ''} ${String(activeSchedule.start_time).slice(0, 5)}–${String(activeSchedule.end_time).slice(0, 5)}` : '目前無進行中班別'}</b></span><span className='stat-done'>已打卡 <b>{dutyCounts ? dutyCounts.ok : '—'}</b></span><span className='stat-pending'>待打卡 <b>{dutyCounts ? dutyCounts.pending : '—'}</b></span><span className='stat-overdue'>逾期未打卡 <b>{dutyCounts ? dutyCounts.overdue : '—'}</b></span><span>值班日打卡紀錄 <b>{visibleRows.length}</b></span></div><div className='operations-legend'><span className='ok'>● 已打卡</span><span className='pending'>● 待打卡（通報時段尚未結束）</span><span className='overdue'>● 逾期未打卡</span></div><div className='operations-table-wrap'><table className='operations-matrix'><thead><tr><th>樓層</th><th>巡檢點</th>{matrixSchedules.map(item => <th key={item.shift_id}><strong>{item.name}{isNightShiftName(item.name) ? '（隔夜）' : ''}</strong><small>班別 {String(item.start_time).slice(0, 5)}–{String(item.end_time).slice(0, 5)}</small><small>通報 {String(item.notify_start_time).slice(0, 5)}–{String(item.notify_end_time).slice(0, 5)}</small></th>)}</tr></thead><tbody>{matrixGroups.flatMap(group => {
              const open = expandedFloors.has(group.floor);
              const toggle = () => setExpandedFloors(current => { const next = new Set(current); if (next.has(group.floor)) next.delete(group.floor); else next.add(group.floor); return next; });
              return [
                <tr key={group.floor} className={open ? 'floor-row is-open' : 'floor-row'}>
                  <td className='floor-name'>
                    <button type='button' className='floor-toggle' onClick={toggle} aria-expanded={open}
                      disabled={!group.points.length}>{open ? '▼' : '▶'} {group.floor}</button>
                    {!modelledFloors.has(group.floor) && <small className='floor-orphan'>未建模</small>}
                  </td>
                  <td>{group.points.length} 個巡檢點</td>
                  {matrixSchedules.map(item => { const state = groupState(group, item); return <td key={item.shift_id}>{state === 'ok' ? <span className='operations-dot done'>✓</span> : state === 'overdue' ? <span className='operations-dot overdue'>✕</span> : <span className='operations-dot pending'>…</span>}</td>; })}
                </tr>,
                ...(open ? group.points.map(point => <tr key={`${group.floor}-${point.marker_id}`} className='point-row'>
                  <td />
                  <td className='point-name'>{point.label || point.marker_id}</td>
                  {matrixSchedules.map(item => { const state = statusFor(point, item); return <td key={item.shift_id}>{state === 'ok' ? <span className='operations-dot done'>✓</span> : state === 'overdue' ? <span className='operations-dot overdue'>✕</span> : <span className='operations-dot pending'>…</span>}</td>; })}
                </tr>) : []),
              ];
            })}</tbody></table></div><div className='operations-checkin-bar'><label>巡檢點<ComboboxSelect value={selected} onChange={setSelected} options={[{value:'',label:'— 選擇巡檢點 —'},...points.map(point => ({value:point.marker_id,label:`${point.floor_id || '未分類'}｜${point.label || point.marker_id}`}))]} /></label><button className='primary' disabled={busy} onClick={() => void checkin()}>✓ 完成打卡</button></div><div className='operations-table-wrap'><table className='operations-table'><thead><tr><th>打卡時間</th><th>巡檢人員</th><th>樓層</th><th>巡檢點</th><th>類型</th><th>狀態</th></tr></thead><tbody>{visibleRows.map((row, index) => <tr key={String(row.checkin_id || index)}><td>{text(row.checkin_at)}</td><td>{text(row.user_name)}</td><td>{text(row.floor_id)}</td><td>{text(row.label)}</td><td>{text(row.target_type)}</td><td><span className='operations-status done'>已打卡</span></td></tr>)}</tbody></table>{!visibleRows.length && <p className='operations-empty'>{busy ? '載入中…' : '目前沒有符合條件的巡檢資料。'}</p>}</div></section></div></AppShell>;
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
