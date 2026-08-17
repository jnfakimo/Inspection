'use client';

// SYS-07 公務車派車 V2 工作區。
//
// 五個模組（申請／車輛／駕駛／管理員／紀錄）由此檔統一承接，取代原本只能唯讀列表的
// 通用 ModuleWorkspace。狀態轉移一律走既有的資料庫函式，不在前端自行拼裝寫入：
//   vehicle_request_action  —— 核可／退回／派車／接單／取消（security definer，內含 RLS 等價檢查）
//   complete_vehicle_trip   —— 司機行車回報（單一交易內更新申請單、車輛里程與流程歷程）
// 兩支函式的 guard trigger（approval / assignment_and_driver / time_window）仍照常觸發，
// 因此畫面上的按鈕僅作為操作提示，真正的權限與流程判斷以資料庫回傳的錯誤為準。

import { useCallback, useEffect, useMemo, useState } from 'react';
// 沿用後台既有的面板／表格／彈窗樣式；該檔原本只在 /systems/admin 的 layout 匯入，
// 這裡一併帶入，避免把同一套版面重寫一份。檔內全部為 class 選擇器，不會污染其他頁。
import '@/app/admin-workspace.css';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { getSupabase } from '@/lib/supabase';
import { AdminHeader, AdminModal, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from '@/components/admin/shared';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿', pending_approval: '待主管核可', returned: '已退回', approved: '待派車',
  assigned: '已派車', completed: '已完成', cancelled: '已取消',
};
const STATUS_TONE: Record<string, string> = {
  draft: 'pending', pending_approval: 'pending', returned: 'cancelled', approved: 'review',
  assigned: 'assigned', completed: 'closed', cancelled: 'cancelled',
};
const VEHICLE_STATUS_LABEL: Record<string, string> = { active: '可派用', maintenance: '維修中', inactive: '停用' };
const VEHICLE_STATUS_TONE: Record<string, string> = { active: 'closed', maintenance: 'in-progress', inactive: 'cancelled' };

function Pill({ value, labels, tones }: { value: unknown; labels: Record<string, string>; tones: Record<string, string> }) {
  const key = String(value || '');
  return <span className={`status-pill ${tones[key] || 'pending'}`}>{labels[key] || fmt(value)}</span>;
}

// 一律以台北時區組出 YYYY-MM-DD，不用 toISOString（那會轉 UTC，台灣清晨會退一天）。
function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((acc, part) => (acc[part.type] = part.value, acc), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function timeText(value: unknown) { return value ? String(value).slice(0, 5) : '—'; }
// datetime-local 的值是本地時間字串，交給 Date 解析後轉 ISO 即為正確的絕對時間。
function localToIso(value: string) { return value ? new Date(value).toISOString() : null; }
function isoToLocalInput(value: unknown) {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function numberOrNull(value: string) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function VehicleWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  return <AuthGate>{profile => {
    if (module.key === 'requests') return <RequestsModule system={system} module={module} profile={profile} />;
    if (module.key === 'vehicles') return <VehiclesModule system={system} module={module} profile={profile} />;
    if (module.key === 'drivers' || module.key === 'managers') return <RosterModule system={system} module={module} profile={profile} />;
    return <LogsModule system={system} module={module} profile={profile} />;
  }}</AuthGate>;
}

function useFleetRole(profile: Profile) {
  const [isManager, setIsManager] = useState(false);
  const role = String(profile.rbac_role || profile.role || '');
  const isAdmin = role === 'sysadmin' || role === 'admin';
  useEffect(() => {
    let active = true;
    getSupabase().from('vehicle_dispatch_managers').select('user_id,active').eq('user_id', profile.user_id).eq('active', true).maybeSingle()
      .then(({ data }) => { if (active) setIsManager(Boolean(data)); });
    return () => { active = false; };
  }, [profile.user_id]);
  // 車輛主檔的 RLS（vehicles_manager_update）要求 is_admin() 或啟用中的派車管理員。
  return { isAdmin, isManager, canManageFleet: isAdmin || isManager };
}

/* ──────────────────────────── 派車申請 ──────────────────────────── */

function RequestsModule({ module, profile }: Props) {
  const { isAdmin, canManageFleet } = useFleetRole(profile);
  const [rows, setRows] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<Row[]>([]);
  const [drivers, setDrivers] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);
  const [logs, setLogs] = useState<Row[]>([]);
  const [tripFor, setTripFor] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [r, v, d] = await Promise.all([
      client.from('vehicle_dispatch_requests').select('*').order('application_date', { ascending: false }).order('created_at', { ascending: false }).limit(500),
      client.from('official_vehicles').select('vehicle_id,plate_no,vehicle_name,seats,current_odometer,status').order('plate_no'),
      client.from('vehicle_dispatch_drivers').select('user_id,active,users(name,username,department)').eq('active', true),
    ]);
    if (r.error || v.error || d.error) setNote(`失敗：${errorMessage(r.error || v.error || d.error, '派車資料載入失敗')}`);
    setRows(r.data || []); setVehicles(v.data || []); setDrivers(d.data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [query, status]);

  const filtered = useMemo(() => rows.filter(row => {
    const q = query.trim().toLowerCase();
    return (!status || row.status === status) && (!q || [row.request_no, row.applicant_name, row.applicant_department, row.destination_location, row.trip_purpose, row.plate_no, row.driver_name].some(v => String(v || '').toLowerCase().includes(q)));
  }), [rows, query, status]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const act = async (requestId: string, action: string, extra: { note?: string; vehicleId?: string; driverId?: string } = {}, success = '已完成') => {
    setBusy(true); setNote('');
    const { error } = await getSupabase().rpc('vehicle_request_action', {
      p_request_id: requestId, p_action: action,
      p_note: extra.note ?? null, p_vehicle_id: extra.vehicleId ?? null, p_driver_id: extra.driverId ?? null,
    });
    if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return false; }
    setDetail(null); await load(); setNote(success); return true;
  };

  const openDetail = async (row: Row) => {
    setDetail(row); setLogs([]);
    const { data } = await getSupabase().from('vehicle_dispatch_logs').select('*').eq('request_id', row.request_id).order('created_at');
    setLogs(data || []);
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={<button className="primary-btn compact" onClick={() => setCreating(true)}>＋ 新增派車申請</button>} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋申請編號、申請人、目的地、車號或駕駛" />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部狀態</option>
          {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <span>共 {filtered.length} 筆</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>申請編號</th><th>用車日／時段</th><th>申請人</th><th>目的地</th><th>車輛／駕駛</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>{paged.map(row => <tr key={row.request_id}>
          <td><strong>{fmt(row.request_no)}</strong><small>申請日 {fmt(row.application_date)}</small></td>
          <td>{fmt(row.trip_date)}<small>{timeText(row.planned_departure_time)}–{timeText(row.planned_return_time)}</small></td>
          <td>{fmt(row.applicant_name)}<small>{fmt(row.applicant_department)}</small></td>
          <td>{fmt(row.destination_location)}<small>{fmt(row.trip_purpose)}</small></td>
          <td>{row.plate_no ? <>{row.plate_no}<small>{fmt(row.driver_name)}{row.driver_accepted_at ? '（已接單）' : ''}</small></> : '—'}</td>
          <td><Pill value={row.status} labels={STATUS_LABEL} tones={STATUS_TONE} /></td>
          <td><div className="admin-row-actions">
            <button onClick={() => void openDetail(row)}>詳細</button>
            {row.status === 'assigned' && row.driver_id === profile.user_id && !row.driver_accepted_at &&
              <button onClick={() => void act(row.request_id, 'accept', {}, '已接單')}>接單</button>}
            {row.status === 'assigned' && row.driver_id === profile.user_id && row.driver_accepted_at &&
              <button className="warn" onClick={() => setTripFor(row)}>行車回報</button>}
          </div></td>
        </tr>)}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">查無符合條件的派車申請</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
    </section>

    {creating && <CreateRequestModal profile={profile} onClose={() => setCreating(false)}
      onDone={async (message) => { setCreating(false); await load(); setNote(message); }} />}

    {detail && <DetailModal row={detail} logs={logs} busy={busy} profile={profile}
      vehicles={vehicles} drivers={drivers} canDispatch={canManageFleet || isAdmin}
      onClose={() => setDetail(null)} onAct={act} onTrip={() => { setTripFor(detail); setDetail(null); }} />}

    {tripFor && <TripReportModal row={tripFor} vehicles={vehicles} onClose={() => setTripFor(null)}
      onDone={async (message) => { setTripFor(null); await load(); setNote(message); }} />}
  </AppShell>;
}

function CreateRequestModal({ profile, onClose, onDone }: { profile: Profile; onClose: () => void; onDone: (message: string) => void }) {
  const [form, setForm] = useState({
    trip_date: taipeiToday(), planned_departure_time: '', planned_return_time: '',
    origin_location: '第一果菜市場', destination_location: '', trip_purpose: '',
    passenger_count: '1', applicant_phone: '', applicant_note: '',
  });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.trip_date || !form.planned_departure_time || !form.planned_return_time) return setMessage('請填寫用車日期與起訖時間');
    if (form.planned_return_time <= form.planned_departure_time) return setMessage('回程時間必須晚於出發時間');
    if (!form.destination_location.trim() || !form.trip_purpose.trim()) return setMessage('請填寫目的地與用途');
    const passengers = Number(form.passenger_count);
    if (!Number.isFinite(passengers) || passengers < 1) return setMessage('搭乘人數必須大於 0');
    setBusy(true); setMessage('');
    const { error } = await getSupabase().from('vehicle_dispatch_requests').insert({
      applicant_id: profile.user_id, applicant_name: profile.name, applicant_department: profile.department || null,
      trip_date: form.trip_date, planned_departure_time: form.planned_departure_time, planned_return_time: form.planned_return_time,
      origin_location: form.origin_location.trim(), destination_location: form.destination_location.trim(),
      trip_purpose: form.trip_purpose.trim(), passenger_count: passengers,
      applicant_phone: form.applicant_phone.trim() || null, applicant_note: form.applicant_note.trim() || null,
      status: 'pending_approval',
    });
    if (error) {
      // 23P01 是 vehicle_dispatch_no_time_overlap 排除約束；22023 多半來自 time_window guard。
      const raw = String(error.message || '');
      setMessage(/exclusion constraint|23P01|overlap/i.test(raw) ? '該時段已有其他派車申請，請改選其他時段'
        : /預計出發時間已經過去/.test(raw) ? '預計出發時間已經過去，請選擇目前時間之後的時段'
        : `失敗：${errorMessage(error)}`);
      setBusy(false); return;
    }
    onDone('派車申請已送出，待單位主管核可');
  };

  return <AdminModal title="新增派車申請" onClose={onClose}>
    <div className="admin-form-grid">
      <label>用車日期（必填）<input type="date" value={form.trip_date} min={taipeiToday()} onChange={e => set('trip_date', e.target.value)} /></label>
      <label>搭乘人數（必填）<input type="number" min={1} value={form.passenger_count} onChange={e => set('passenger_count', e.target.value)} /></label>
      <label>預計出發時間（必填）<input type="time" value={form.planned_departure_time} onChange={e => set('planned_departure_time', e.target.value)} /></label>
      <label>預計回程時間（必填）<input type="time" value={form.planned_return_time} onChange={e => set('planned_return_time', e.target.value)} /></label>
      <label>出發地<input value={form.origin_location} onChange={e => set('origin_location', e.target.value)} /></label>
      <label>目的地（必填）<input value={form.destination_location} onChange={e => set('destination_location', e.target.value)} placeholder="例：第二果菜市場" /></label>
      <label>聯絡電話<input value={form.applicant_phone} onChange={e => set('applicant_phone', e.target.value)} placeholder="分機或手機" /></label>
      <label className="wide">用途（必填）<input value={form.trip_purpose} onChange={e => set('trip_purpose', e.target.value)} placeholder="例：會勘" /></label>
      <label className="wide">備註<textarea rows={2} value={form.applicant_note} onChange={e => set('applicant_note', e.target.value)} /></label>
    </div>
    {message && <p className="inline-message danger">{message}</p>}
    <footer>
      <button className="secondary-btn" onClick={onClose}>取消</button>
      <button className="primary-btn compact" disabled={busy} onClick={() => void submit()}>{busy ? '送出中…' : '送出申請'}</button>
    </footer>
  </AdminModal>;
}

function DetailModal({ row, logs, busy, profile, vehicles, drivers, canDispatch, onClose, onAct, onTrip }: {
  row: Row; logs: Row[]; busy: boolean; profile: Profile; vehicles: Row[]; drivers: Row[]; canDispatch: boolean;
  onClose: () => void; onTrip: () => void;
  onAct: (requestId: string, action: string, extra?: { note?: string; vehicleId?: string; driverId?: string }, success?: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');
  const isDriver = row.driver_id === profile.user_id;

  const field = (label: string, value: unknown) => <div><dt>{label}</dt><dd>{fmt(value)}</dd></div>;

  return <AdminModal title={`派車申請｜${fmt(row.request_no)}`} onClose={onClose}>
    <dl className="detail-grid">
      {field('狀態', STATUS_LABEL[String(row.status)] || row.status)}
      {field('申請人', `${fmt(row.applicant_name)}（${fmt(row.applicant_department)}）`)}
      {field('聯絡電話', row.applicant_phone)}
      {field('用車日期', row.trip_date)}
      {field('預計時段', `${timeText(row.planned_departure_time)} – ${timeText(row.planned_return_time)}`)}
      {field('起訖地點', `${fmt(row.origin_location)} → ${fmt(row.destination_location)}`)}
      {field('用途', row.trip_purpose)}
      {field('搭乘人數', row.passenger_count)}
      {field('備註', row.applicant_note)}
      {row.supervisor_name ? field('核可主管', `${row.supervisor_name}｜${fmtTime(row.approved_at)}`) : null}
      {row.supervisor_note ? field('主管意見', row.supervisor_note) : null}
      {row.plate_no ? field('指派車輛', row.plate_no) : null}
      {row.driver_name ? field('指派駕駛', `${row.driver_name}${row.driver_accepted_at ? `（已接單 ${fmtTime(row.driver_accepted_at)}）` : '（尚未接單）'}`) : null}
      {row.status === 'completed' ? field('實際時段', `${fmtTime(row.actual_departure_at)} – ${fmtTime(row.actual_return_at)}`) : null}
      {row.status === 'completed' ? field('里程', `${fmt(row.odometer_start)} → ${fmt(row.odometer_end)}（${fmt(row.total_mileage)} km）`) : null}
      {row.refueled ? field('加油', `里程 ${fmt(row.refuel_odometer)}｜${fmt(row.refuel_cost)} 元`) : null}
      {row.has_abnormality ? field('異常通報', row.abnormality_note) : null}
      {row.driver_note ? field('駕駛備註', row.driver_note) : null}
      {row.cancel_reason ? field('取消原因', row.cancel_reason) : null}
    </dl>

    {logs.length > 0 && <div className="detail-timeline">
      <h3>流程歷程</h3>
      <ol>{logs.map(log => <li key={String(log.log_id)}>
        <b>{fmt(log.action)}</b><span>{fmt(log.operator_name)}</span><time>{fmtTime(log.created_at)}</time>
        {log.note ? <p>{String(log.note)}</p> : null}
      </li>)}</ol>
    </div>}

    {row.status === 'pending_approval' && <div className="admin-form-grid">
      <label className="wide">主管意見（退回時必填）<input value={reason} onChange={e => setReason(e.target.value)} /></label>
    </div>}
    {row.status === 'approved' && canDispatch && <div className="admin-form-grid">
      <label>指派車輛<select value={vehicleId} onChange={e => setVehicleId(e.target.value)}>
        <option value="">-- 請選擇 --</option>
        {vehicles.filter(v => v.status === 'active').map(v => <option key={String(v.vehicle_id)} value={String(v.vehicle_id)}>{v.plate_no}｜{v.vehicle_name}（{v.seats} 人座）</option>)}
      </select></label>
      <label>指派駕駛<select value={driverId} onChange={e => setDriverId(e.target.value)}>
        <option value="">-- 請選擇 --</option>
        {drivers.map(d => <option key={String(d.user_id)} value={String(d.user_id)}>{(d.users as Row)?.name || d.user_id}</option>)}
      </select></label>
      <label className="wide">派車備註<input value={reason} onChange={e => setReason(e.target.value)} /></label>
    </div>}
    {['pending_approval', 'approved', 'assigned'].includes(String(row.status)) && row.status !== 'pending_approval' && <div className="admin-form-grid">
      <label className="wide">取消原因（取消時必填）<input value={reason} onChange={e => setReason(e.target.value)} /></label>
    </div>}

    <footer>
      <button className="secondary-btn" onClick={onClose}>關閉</button>
      {row.status === 'pending_approval' && <>
        <button className="secondary-btn" disabled={busy} onClick={() => void onAct(row.request_id, 'return', { note: reason }, '已退回申請')}>退回</button>
        <button className="primary-btn compact" disabled={busy} onClick={() => void onAct(row.request_id, 'approve', { note: reason }, '已核可申請')}>核可</button>
      </>}
      {row.status === 'approved' && canDispatch &&
        <button className="primary-btn compact" disabled={busy} onClick={() => void onAct(row.request_id, 'dispatch', { note: reason, vehicleId, driverId }, '已完成派車')}>確認派車</button>}
      {row.status === 'assigned' && isDriver && !row.driver_accepted_at &&
        <button className="primary-btn compact" disabled={busy} onClick={() => void onAct(row.request_id, 'accept', {}, '已接單')}>接單</button>}
      {row.status === 'assigned' && isDriver && row.driver_accepted_at &&
        <button className="primary-btn compact" onClick={onTrip}>填寫行車回報</button>}
      {!['completed', 'cancelled'].includes(String(row.status)) &&
        <button className="secondary-btn danger" disabled={busy} onClick={() => window.confirm('確定取消這筆派車申請？') && void onAct(row.request_id, 'cancel', { note: reason }, '已取消申請')}>取消申請</button>}
    </footer>
  </AdminModal>;
}

function TripReportModal({ row, vehicles, onClose, onDone }: { row: Row; vehicles: Row[]; onClose: () => void; onDone: (message: string) => void }) {
  const vehicle = vehicles.find(v => v.vehicle_id === row.vehicle_id);
  const [form, setForm] = useState({
    actual_passenger_count: String(row.passenger_count ?? ''),
    actual_departure_at: isoToLocalInput(row.actual_departure_at) || `${row.trip_date}T${timeText(row.planned_departure_time)}`,
    actual_return_at: isoToLocalInput(row.actual_return_at) || `${row.trip_date}T${timeText(row.planned_return_time)}`,
    odometer_start: String(vehicle?.current_odometer ?? ''), odometer_end: '',
    last_refuel_odometer: '', last_refuel_cost: '',
    refueled: false, refuel_odometer: '', refuel_cost: '',
    has_abnormality: false, abnormality_note: '', driver_note: '',
  });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const set = (key: string, value: string | boolean) => setForm(prev => ({ ...prev, [key]: value }));

  const submit = async () => {
    const start = numberOrNull(form.odometer_start), end = numberOrNull(form.odometer_end);
    const passengers = numberOrNull(form.actual_passenger_count);
    if (passengers == null || passengers < 0) return setMessage('請填寫實際搭乘人數');
    if (!form.actual_departure_at || !form.actual_return_at) return setMessage('請填寫實際出發與回程時間');
    if (new Date(form.actual_return_at) < new Date(form.actual_departure_at)) return setMessage('回程時間不得早於出發時間');
    if (form.actual_departure_at.slice(0, 10) !== String(row.trip_date)) return setMessage('實際出發日期必須與用車日期相同');
    if (start == null || end == null) return setMessage('請填寫起始與回程里程');
    if (end < start) return setMessage('回程里程不得小於起始里程');
    const refuel = numberOrNull(form.refuel_odometer), refuelCost = numberOrNull(form.refuel_cost);
    if (form.refueled && (refuel == null || refuel < start || refuel > end)) return setMessage('加油里程必須介於起始與回程里程之間');
    if (form.refueled && (refuelCost == null || refuelCost < 0)) return setMessage('請填寫正確的本次加油費用');
    if (form.has_abnormality && !form.abnormality_note.trim()) return setMessage('勾選異常通報時，請填寫異常內容');

    setBusy(true); setMessage('');
    const { error } = await getSupabase().rpc('complete_vehicle_trip', {
      p_request_id: row.request_id, p_actual_passenger_count: passengers,
      p_actual_departure_at: localToIso(form.actual_departure_at), p_actual_return_at: localToIso(form.actual_return_at),
      p_odometer_start: start, p_odometer_end: end,
      p_last_refuel_odometer: numberOrNull(form.last_refuel_odometer), p_last_refuel_cost: numberOrNull(form.last_refuel_cost),
      p_refueled: form.refueled, p_refuel_odometer: form.refueled ? refuel : null, p_refuel_cost: form.refueled ? refuelCost : null,
      p_has_abnormality: form.has_abnormality, p_abnormality_note: form.has_abnormality ? form.abnormality_note.trim() : null,
      p_driver_note: form.driver_note.trim() || null,
    });
    if (error) { setMessage(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    onDone('行車回報已完成，里程已自動核算');
  };

  return <AdminModal title={`行車回報｜${fmt(row.request_no)}　${fmt(row.plate_no)}`} onClose={onClose}>
    <div className="admin-form-grid">
      <label>實際搭乘人數<input type="number" min={0} value={form.actual_passenger_count} onChange={e => set('actual_passenger_count', e.target.value)} /></label>
      <label>實際出發時間<input type="datetime-local" value={form.actual_departure_at} onChange={e => set('actual_departure_at', e.target.value)} /></label>
      <label>實際回程時間<input type="datetime-local" value={form.actual_return_at} onChange={e => set('actual_return_at', e.target.value)} /></label>
      <label>起始里程（km）<input type="number" step="0.1" value={form.odometer_start} onChange={e => set('odometer_start', e.target.value)} /></label>
      <label>回程里程（km）<input type="number" step="0.1" value={form.odometer_end} onChange={e => set('odometer_end', e.target.value)} /></label>
      <label>上次加油里程<input type="number" step="0.1" value={form.last_refuel_odometer} onChange={e => set('last_refuel_odometer', e.target.value)} /></label>
      <label>上次加油費用<input type="number" step="1" min={0} value={form.last_refuel_cost} onChange={e => set('last_refuel_cost', e.target.value)} /></label>
      <label className="wide checkbox"><input type="checkbox" checked={form.refueled} onChange={e => set('refueled', e.target.checked)} />本次行程有加油</label>
      {form.refueled && <>
        <label>加油當下里程<input type="number" step="0.1" value={form.refuel_odometer} onChange={e => set('refuel_odometer', e.target.value)} /></label>
        <label>本次加油費用<input type="number" step="1" min={0} value={form.refuel_cost} onChange={e => set('refuel_cost', e.target.value)} /></label>
      </>}
      <label className="wide checkbox"><input type="checkbox" checked={form.has_abnormality} onChange={e => set('has_abnormality', e.target.checked)} />有異常需通報</label>
      {form.has_abnormality && <label className="wide">異常內容（必填）<textarea rows={2} value={form.abnormality_note} onChange={e => set('abnormality_note', e.target.value)} /></label>}
      <label className="wide">駕駛備註<textarea rows={2} value={form.driver_note} onChange={e => set('driver_note', e.target.value)} /></label>
    </div>
    {message && <p className="inline-message danger">{message}</p>}
    <footer>
      <button className="secondary-btn" onClick={onClose}>取消</button>
      <button className="primary-btn compact" disabled={busy} onClick={() => void submit()}>{busy ? '送出中…' : '送出回報'}</button>
    </footer>
  </AdminModal>;
}

/* ──────────────────────────── 公務車輛 ──────────────────────────── */

function VehiclesModule({ module, profile }: Props) {
  const { canManageFleet } = useFleetRole(profile);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const { data, error } = await getSupabase().from('official_vehicles').select('*').order('plate_no');
    if (error) setNote(`失敗：${errorMessage(error, '車輛主檔載入失敗')}`);
    setRows(data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [query]);

  const filtered = useMemo(() => rows.filter(row => {
    const q = query.trim().toLowerCase();
    return !q || [row.plate_no, row.vehicle_name, row.brand, row.model, row.note].some(v => String(v || '').toLowerCase().includes(q));
  }), [rows, query]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const save = async () => {
    if (!editor) return;
    const plate = String(editor.plate_no || '').trim();
    if (!plate) { setNote('失敗：請填寫車號'); return; }
    const seats = Number(editor.seats ?? 5);
    if (!Number.isFinite(seats) || seats < 1) { setNote('失敗：座位數必須大於 0'); return; }
    const odometer = Number(editor.current_odometer ?? 0);
    if (!Number.isFinite(odometer) || odometer < 0) { setNote('失敗：目前里程不得為負數'); return; }
    setBusy(true); setNote('');
    const payload = {
      plate_no: plate, vehicle_name: String(editor.vehicle_name || '').trim() || null,
      brand: String(editor.brand || '').trim() || null, model: String(editor.model || '').trim() || null,
      seats, current_odometer: odometer, status: String(editor.status || 'active'),
      note: String(editor.note || '').trim() || null,
    };
    const client = getSupabase();
    const { error } = editor.vehicle_id
      ? await client.from('official_vehicles').update(payload).eq('vehicle_id', editor.vehicle_id)
      : await client.from('official_vehicles').insert({ ...payload, created_by: profile.user_id });
    if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    setEditor(null); await load(); setNote(editor.vehicle_id ? '車輛資料已更新' : '車輛已新增');
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={canManageFleet ? <button className="primary-btn compact" onClick={() => setEditor({ status: 'active', seats: 5, current_odometer: 0 })}>＋ 新增車輛</button> : undefined} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋車號、車名、廠牌或型號" />
        <span>可派用 {rows.filter(r => r.status === 'active').length}／共 {rows.length} 台</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>車號</th><th>車名</th><th>廠牌／型號</th><th>座位</th><th>目前里程</th><th>狀態</th>{canManageFleet && <th>操作</th>}</tr></thead>
        <tbody>{paged.map(row => <tr key={String(row.vehicle_id)}>
          <td><strong>{fmt(row.plate_no)}</strong>{row.note ? <small>{String(row.note)}</small> : null}</td>
          <td>{fmt(row.vehicle_name)}</td>
          <td>{fmt(row.brand)}{row.model ? ` / ${row.model}` : ''}</td>
          <td>{fmt(row.seats)}</td>
          <td>{fmt(row.current_odometer)} km</td>
          <td><Pill value={row.status} labels={VEHICLE_STATUS_LABEL} tones={VEHICLE_STATUS_TONE} /></td>
          {canManageFleet && <td><div className="admin-row-actions"><button onClick={() => setEditor({ ...row })}>編輯</button></div></td>}
        </tr>)}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有車輛資料</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
    </section>

    {editor && <AdminModal title={editor.vehicle_id ? `編輯車輛｜${fmt(editor.plate_no)}` : '新增車輛'} onClose={() => setEditor(null)}>
      <div className="admin-form-grid">
        <label>車號（必填）<input value={String(editor.plate_no || '')} onChange={e => setEditor({ ...editor, plate_no: e.target.value })} /></label>
        <label>車名<input value={String(editor.vehicle_name || '')} onChange={e => setEditor({ ...editor, vehicle_name: e.target.value })} placeholder="例：7人座車" /></label>
        <label>廠牌<input value={String(editor.brand || '')} onChange={e => setEditor({ ...editor, brand: e.target.value })} /></label>
        <label>型號<input value={String(editor.model || '')} onChange={e => setEditor({ ...editor, model: e.target.value })} /></label>
        <label>座位數<input type="number" min={1} value={String(editor.seats ?? 5)} onChange={e => setEditor({ ...editor, seats: e.target.value })} /></label>
        <label>目前里程（km）<input type="number" step="0.1" min={0} value={String(editor.current_odometer ?? 0)} onChange={e => setEditor({ ...editor, current_odometer: e.target.value })} /></label>
        <label>狀態<select value={String(editor.status || 'active')} onChange={e => setEditor({ ...editor, status: e.target.value })}>
          {Object.entries(VEHICLE_STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label className="wide">備註<input value={String(editor.note || '')} onChange={e => setEditor({ ...editor, note: e.target.value })} /></label>
      </div>
      <footer>
        <button className="secondary-btn" onClick={() => setEditor(null)}>取消</button>
        <button className="primary-btn compact" disabled={busy} onClick={() => void save()}>{busy ? '儲存中…' : '儲存'}</button>
      </footer>
    </AdminModal>}
  </AppShell>;
}

/* ──────────────────── 駕駛人員／派車管理員（同一份名單介面） ──────────────────── */

function RosterModule({ module, profile }: Props) {
  const table = module.key === 'drivers' ? 'vehicle_dispatch_drivers' : 'vehicle_dispatch_managers';
  const roleWord = module.key === 'drivers' ? '駕駛' : '派車管理員';
  const { isAdmin } = useFleetRole(profile);
  const [rows, setRows] = useState<Row[]>([]);
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState(''), [picking, setPicking] = useState(false), [pick, setPick] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [r, u] = await Promise.all([
      client.from(table).select('user_id,active,assigned_at,updated_at,users(name,username,department,status)').order('updated_at', { ascending: false }),
      client.from('users').select('user_id,name,username,department,status').eq('status', 'active').order('name').limit(2000),
    ]);
    if (r.error || u.error) setNote(`失敗：${errorMessage(r.error || u.error, '名單載入失敗')}`);
    setRows(r.data || []); setCandidates(u.data || []); setBusy(false);
  }, [table]);
  useEffect(() => { void load(); }, [load]);

  // vehicle_dispatch_drivers／managers 的 insert/update 政策要求 rbac_role 為 sysadmin。
  // 型別用 PromiseLike：Supabase 的查詢 builder 可 await，但不是完整的 Promise 實例。
  const run = async (fn: () => PromiseLike<{ error: unknown }>, success: string) => {
    setBusy(true); setNote('');
    const { error } = await fn();
    if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    setPicking(false); setPick(''); await load(); setNote(success);
  };
  const toggle = (row: Row) => run(
    () => getSupabase().from(table).update({ active: !row.active }).eq('user_id', row.user_id),
    row.active ? `已停用該${roleWord}` : `已啟用該${roleWord}`);
  const add = () => {
    if (!pick) { setNote('失敗：請先選擇人員'); return; }
    return run(() => getSupabase().from(table).upsert({ user_id: pick, active: true, assigned_by: profile.user_id }, { onConflict: 'user_id' }), `已新增${roleWord}`);
  };

  const listed = new Set(rows.map(row => String(row.user_id)));

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={isAdmin ? <button className="primary-btn compact" onClick={() => { setPick(''); setPicking(true); }}>＋ 新增{roleWord}</button> : undefined} />
    <section className="panel admin-panel">
      <div className="admin-toolbar"><span>啟用中 {rows.filter(r => r.active).length}／共 {rows.length} 人</span>
        {!isAdmin && <span className="inline-message">僅系統管理員可調整此名單</span>}</div>
      <div className="responsive-table"><table>
        <thead><tr><th>姓名</th><th>帳號</th><th>單位</th><th>狀態</th><th>設定時間</th>{isAdmin && <th>操作</th>}</tr></thead>
        <tbody>{rows.map(row => {
          const user = (row.users as Row) || {};
          return <tr key={String(row.user_id)}>
            <td><strong>{fmt(user.name)}</strong>{user.status === 'inactive' ? <small>帳號已停用</small> : null}</td>
            <td>{fmt(user.username)}</td>
            <td>{fmt(user.department)}</td>
            <td><span className={`status-pill ${row.active ? 'closed' : 'cancelled'}`}>{row.active ? '啟用' : '停用'}</span></td>
            <td>{fmtTime(row.updated_at || row.assigned_at)}</td>
            {isAdmin && <td><div className="admin-row-actions">
              <button className={row.active ? 'warn' : ''} onClick={() => void toggle(row)}>{row.active ? '停用' : '啟用'}</button>
            </div></td>}
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && rows.length === 0 && <p className="empty">尚未設定任何{roleWord}</p>}
    </section>

    {picking && <AdminModal title={`新增${roleWord}`} onClose={() => setPicking(false)}>
      <div className="admin-form-grid">
        <label className="wide">選擇人員<select value={pick} onChange={e => setPick(e.target.value)}>
          <option value="">-- 請選擇 --</option>
          {candidates.filter(user => !listed.has(String(user.user_id))).map(user =>
            <option key={String(user.user_id)} value={String(user.user_id)}>{user.name}（{user.username}）{user.department ? `｜${user.department}` : ''}</option>)}
        </select></label>
      </div>
      <footer>
        <button className="secondary-btn" onClick={() => setPicking(false)}>取消</button>
        <button className="primary-btn compact" disabled={busy} onClick={() => void add()}>{busy ? '儲存中…' : '確認新增'}</button>
      </footer>
    </AdminModal>}
  </AppShell>;
}

/* ──────────────────────────── 派車紀錄 ──────────────────────────── */

function LogsModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const { data, error } = await getSupabase()
      .from('vehicle_dispatch_logs')
      .select('*,vehicle_dispatch_requests(request_no,plate_no)')
      .order('created_at', { ascending: false }).limit(500);
    if (error) setNote(`失敗：${errorMessage(error, '派車紀錄載入失敗')}`);
    setRows(data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [query]);

  const filtered = useMemo(() => rows.filter(row => {
    const q = query.trim().toLowerCase();
    const request = (row.vehicle_dispatch_requests as Row) || {};
    return !q || [row.action, row.note, row.operator_name, request.request_no, request.plate_no].some(v => String(v || '').toLowerCase().includes(q));
  }), [rows, query]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋動作、備註、操作人員或申請編號" />
        <span>共 {filtered.length} 筆</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>時間</th><th>申請編號</th><th>動作</th><th>狀態變更</th><th>操作人員</th><th>備註</th></tr></thead>
        <tbody>{paged.map(row => {
          const request = (row.vehicle_dispatch_requests as Row) || {};
          return <tr key={String(row.log_id)}>
            <td>{fmtTime(row.created_at)}</td>
            <td>{fmt(request.request_no)}{request.plate_no ? <small>{String(request.plate_no)}</small> : null}</td>
            <td>{fmt(row.action)}</td>
            <td>{STATUS_LABEL[String(row.from_status)] || fmt(row.from_status)} → {STATUS_LABEL[String(row.to_status)] || fmt(row.to_status)}</td>
            <td>{fmt(row.operator_name)}</td>
            <td>{fmt(row.note)}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有派車紀錄</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
    </section>
  </AppShell>;
}
