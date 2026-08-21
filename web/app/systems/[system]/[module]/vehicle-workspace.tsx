'use client';

// SYS-07 公務車派車 V2 工作區（100% 保持 V1 樣板視覺與操作模式）。
//
// 五個模組（派車申請／公務車輛／駕駛人員／派車管理員／派車紀錄）由本檔承接，
// 前端採用 React / Next.js，後端以 Supabase PostgreSQL Security Definer RPC 函式為基礎：
//   vehicle_request_action  —— 核可／退回／派車／接單／取消（security definer，內含 RLS 等價檢查）
//   complete_vehicle_trip   —— 司機行車回報（單一交易內更新申請單、車輛里程與流程歷程）

import { useCallback, useEffect, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import '@/app/admin-workspace.css';
import { AppShell } from '@/components/AppShell';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { AuthGate } from '@/components/AuthGate';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { AdminHeader, AdminModal, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from '@/components/admin/shared';
import { TimeSelect } from '@/components/TimeSelect';
import { LocalizedDateTimeInput } from '@/components/LocalizedDateTimeInput';
import { escHtml } from '@/lib/html-escape';
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

function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((acc, part) => (acc[part.type] = part.value, acc), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function timeText(value: unknown) { return value ? String(value).slice(0, 5) : '—'; }
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
  return { isAdmin, isManager, canManageFleet: isAdmin || isManager };
}

/* ──────────────────────────── 派車申請 (100% V1 視覺對齊) ──────────────────────────── */

function RequestsModule({ module, profile }: Props) {
  const { isAdmin, canManageFleet } = useFleetRole(profile);
  const [rows, setRows] = useState<Row[]>([]);
  const [vehicles, setVehicles] = useState<Row[]>([]);
  const [drivers, setDrivers] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  
  const [tab, setTab] = useState<'mine' | 'driverToday' | 'todo' | 'all'>('mine');
  const [query, setQuery] = useState(''), [statusFilter, setStatusFilter] = useState(''), [dateFilter, setDateFilter] = useState(''), [page, setPage] = useState(1);
  
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Row | null>(null);
  const [logs, setLogs] = useState<Row[]>([]);
  const [tripFor, setTripFor] = useState<Row | null>(null);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showVehicleMasterModal, setShowVehicleMasterModal] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [r, v, d] = await Promise.all([
      client.from('vehicle_dispatch_requests').select('*').order('application_date', { ascending: false }).order('created_at', { ascending: false }).limit(1000),
      client.from('official_vehicles').select('vehicle_id,plate_no,vehicle_name,brand,model,seats,current_odometer,status,note').order('plate_no'),
      client.from('vehicle_dispatch_drivers').select('user_id,active,users!vehicle_dispatch_drivers_user_id_fkey(name,username,department)').eq('active', true),
    ]);
    if (r.error || v.error || d.error) setNote(`失敗：${errorMessage(r.error || v.error || d.error, '派車資料載入失敗')}`);
    setRows(r.data || []); setVehicles(v.data || []); setDrivers(d.data || []); setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [query, statusFilter, dateFilter, tab]);

  const today = taipeiToday();
  const isDriver = useMemo(() => drivers.some(d => d.user_id === profile.user_id), [drivers, profile.user_id]);

  // KPI 統計數字
  const kApprovalCount = useMemo(() => rows.filter(r => r.status === 'pending_approval').length, [rows]);
  const kDispatchCount = useMemo(() => rows.filter(r => r.status === 'approved').length, [rows]);
  const kTodayCount = useMemo(() => rows.filter(r => String(r.trip_date) === today && r.status === 'assigned').length, [rows, today]);
  const kDriverCount = useMemo(() => rows.filter(r => r.status === 'assigned').length, [rows]);

  // 頁籤資料列篩選
  const mineRows = useMemo(() => rows.filter(r => r.applicant_id === profile.user_id), [rows, profile.user_id]);
  const driverTodayRows = useMemo(() => rows.filter(r => r.driver_id === profile.user_id && String(r.trip_date) === today && ['assigned', 'completed'].includes(String(r.status))), [rows, profile.user_id, today]);
  const todoRows = useMemo(() => rows.filter(r => {
    if (r.status === 'pending_approval' && (canManageFleet || isAdmin || r.applicant_department === profile.department)) return true;
    if (r.status === 'approved' && (canManageFleet || isAdmin)) return true;
    if (r.status === 'assigned' && r.driver_id === profile.user_id) return true;
    return false;
  }), [rows, canManageFleet, isAdmin, profile.department, profile.user_id]);

  const tabRows = useMemo(() => {
    if (tab === 'mine') return mineRows;
    if (tab === 'driverToday') return driverTodayRows;
    if (tab === 'todo') return todoRows;
    return rows;
  }, [tab, mineRows, driverTodayRows, todoRows, rows]);

  const filtered = useMemo(() => tabRows.filter(row => {
    const q = query.trim().toLowerCase();
    const matchStatus = !statusFilter || row.status === statusFilter;
    const matchDate = !dateFilter || String(row.trip_date) === dateFilter;
    const matchQuery = !q || [row.request_no, row.applicant_name, row.applicant_department, row.origin_location, row.destination_location, row.trip_purpose, row.plate_no, row.driver_name]
      .some(v => String(v || '').toLowerCase().includes(q));
    return matchStatus && matchDate && matchQuery;
  }), [tabRows, query, statusFilter, dateFilter]);

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

    {/* V1 四步驟流程 Banner */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginBottom: '14px' }}>
      <div style={{ padding: '12px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px', borderLeft: '3px solid var(--cyan)' }}>
        <b style={{ color: 'var(--cyan)', fontSize: '0.85rem' }}>1. 申請人填單</b>
        <div style={{ color: 'var(--dim)', fontSize: '0.72rem', marginTop: '3px' }}>線上填寫用車日期、地點、人數與事由</div>
      </div>
      <div style={{ padding: '12px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px', borderLeft: '3px solid var(--amber)' }}>
        <b style={{ color: 'var(--amber)', fontSize: '0.85rem' }}>2. 單位主管核可</b>
        <div style={{ color: 'var(--dim)', fontSize: '0.72rem', marginTop: '3px' }}>單位主管審核或退回派車申請</div>
      </div>
      <div style={{ padding: '12px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px', borderLeft: '3px solid var(--violet)' }}>
        <b style={{ color: 'var(--violet)', fontSize: '0.85rem' }}>3. 派車管理員</b>
        <div style={{ color: 'var(--dim)', fontSize: '0.72rem', marginTop: '3px' }}>派車管理員指派公務車號與駕駛人員</div>
      </div>
      <div style={{ padding: '12px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px', borderLeft: '3px solid var(--green)' }}>
        <b style={{ color: 'var(--green)', fontSize: '0.85rem' }}>4. 司機接單與回報</b>
        <div style={{ color: 'var(--dim)', fontSize: '0.72rem', marginTop: '3px' }}>司機於用車當日接單、實際里程與加油紀錄回報</div>
      </div>
    </div>

    {/* V1 四大 KPI 統計卡 */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(130px, 1fr))', gap: '10px', marginBottom: '14px' }}>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px 14px', borderLeft: '3px solid var(--amber)' }}>
        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--amber)', lineHeight: 1 }}>{kApprovalCount}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--dim)', marginTop: '6px' }}>待主管核可</div>
      </div>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px 14px', borderLeft: '3px solid var(--blue)' }}>
        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--blue)', lineHeight: 1 }}>{kDispatchCount}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--dim)', marginTop: '6px' }}>待車管派車</div>
      </div>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px 14px', borderLeft: '3px solid var(--violet)' }}>
        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--violet)', lineHeight: 1 }}>{kTodayCount}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--dim)', marginTop: '6px' }}>今日已派行程</div>
      </div>
      <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '8px', padding: '12px 14px', borderLeft: '3px solid var(--green)' }}>
        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--green)', lineHeight: 1 }}>{kDriverCount}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--dim)', marginTop: '6px' }}>待司機回報</div>
      </div>
    </div>

    {/* V1 四大頁籤（帶計數） */}
    <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--line)', marginBottom: '12px' }}>
      <button className={`secondary-btn ${tab === 'mine' ? 'primary-btn' : ''}`} style={{ borderRadius: '4px 4px 0 0' }} onClick={() => setTab('mine')}>
        我的申請 <span style={{ marginLeft: '4px', padding: '1px 6px', borderRadius: '10px', background: 'rgba(0,212,255,0.15)', fontSize: '0.68rem' }}>{mineRows.length}</span>
      </button>
      {isDriver && <button className={`secondary-btn ${tab === 'driverToday' ? 'primary-btn' : ''}`} style={{ borderRadius: '4px 4px 0 0' }} onClick={() => setTab('driverToday')}>
        今日派車 <span style={{ marginLeft: '4px', padding: '1px 6px', borderRadius: '10px', background: 'rgba(0,255,157,0.15)', fontSize: '0.68rem' }}>{driverTodayRows.length}</span>
      </button>}
      <button className={`secondary-btn ${tab === 'todo' ? 'primary-btn' : ''}`} style={{ borderRadius: '4px 4px 0 0' }} onClick={() => setTab('todo')}>
        待我處理 <span style={{ marginLeft: '4px', padding: '1px 6px', borderRadius: '10px', background: 'rgba(255,179,0,0.15)', fontSize: '0.68rem' }}>{todoRows.length}</span>
      </button>
      <button className={`secondary-btn ${tab === 'all' ? 'primary-btn' : ''}`} style={{ borderRadius: '4px 4px 0 0' }} onClick={() => setTab('all')}>
        派車總覽 <span style={{ marginLeft: '4px', padding: '1px 6px', borderRadius: '10px', background: 'rgba(255,255,255,0.1)', fontSize: '0.68rem' }}>{rows.length}</span>
      </button>
    </div>

    {/* 工具列 */}
    <section className="panel admin-panel">
      <div className="admin-toolbar" style={{ flexWrap: 'wrap', gap: '8px' }}>
        <input style={{ minWidth: '220px', flex: 1 }} value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋申請編號、申請人、地點、車號或駕駛…" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">全部狀態</option>
          {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <LocalizedDateInput aria-label="用車日期（年/月/日）" value={dateFilter} onChange={e => setDateFilter(e.target.value)} title="用車日期" />
        <button className="secondary-btn" onClick={() => { setQuery(''); setStatusFilter(''); setDateFilter(''); }}>清除篩選</button>
        {canManageFleet && <button className="secondary-btn" onClick={() => setShowReportModal(true)}>派車報表</button>}
        {canManageFleet && <button className="secondary-btn" onClick={() => setShowVehicleMasterModal(true)}>公務車主檔</button>}
        <button className="primary-btn compact" onClick={() => setCreating(true)}>＋ 新增派車申請</button>
      </div>

      <div className="responsive-table"><table>
        <thead><tr><th>申請編號</th><th>狀態</th><th>用車日期／時間</th><th>起訖地點</th><th>申請人／單位</th><th>人數</th><th>車號／司機</th><th>里程</th><th>操作</th></tr></thead>
        <tbody>{paged.map(row => <tr key={row.request_id}>
          <td><strong>{fmt(row.request_no)}</strong><small>申請日 {fmt(row.application_date)}</small></td>
          <td><Pill value={row.status} labels={STATUS_LABEL} tones={STATUS_TONE} /></td>
          <td>{fmt(row.trip_date)}<small>{timeText(row.planned_departure_time)}–{timeText(row.planned_return_time)}</small></td>
          <td>{fmt(row.origin_location)} → {fmt(row.destination_location)}</td>
          <td>{fmt(row.applicant_name)}<small>{fmt(row.applicant_department)}</small></td>
          <td>{fmt(row.passenger_count)} 人</td>
          <td>{row.plate_no ? <>{row.plate_no}<small>{fmt(row.driver_name)}{row.driver_accepted_at ? '（已接單）' : ''}</small></> : '待派'}</td>
          <td>{row.total_mileage != null ? `${Number(row.total_mileage).toFixed(1)} km` : '—'}</td>
          <td><div className="admin-row-actions">
            <button onClick={() => void openDetail(row)}>詳細</button>
            {row.status === 'assigned' && row.driver_id === profile.user_id && !row.driver_accepted_at &&
              <button onClick={() => void act(row.request_id, 'accept', {}, '已接單')}>接單</button>}
            {row.status === 'assigned' && row.driver_id === profile.user_id && row.driver_accepted_at &&
              <button className="warn" onClick={() => setTripFor(row)}>行車回報</button>}
          </div></td>
        </tr>)}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有符合條件的派車申請</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
    </section>

    {creating && <CreateRequestModal profile={profile} onClose={() => setCreating(false)}
      onDone={async (message) => { setCreating(false); await load(); setNote(message); }} />}

    {detail && <DetailModal row={detail} logs={logs} busy={busy} profile={profile}
      vehicles={vehicles} drivers={drivers} canDispatch={canManageFleet || isAdmin}
      onClose={() => setDetail(null)} onAct={act} onTrip={() => { setTripFor(detail); setDetail(null); }} />}

    {tripFor && <TripReportModal row={tripFor} vehicles={vehicles} onClose={() => setTripFor(null)}
      onDone={async (message) => { setTripFor(null); await load(); setNote(message); }} />}

    {showReportModal && <VehicleReportModal rows={rows} profile={profile} onClose={() => setShowReportModal(false)} />}
    {showVehicleMasterModal && <VehicleMasterModal profile={profile} onClose={() => { setShowVehicleMasterModal(false); void load(); }} />}
  </AppShell>;
}

/* ─────────────── 派車報表彈窗（含 A4 列印與 ExcelJS 雙頁面匯出） ─────────────── */

function VehicleReportModal({ rows, profile, onClose }: { rows: Row[]; profile: Profile; onClose: () => void }) {
  const today = taipeiToday();
  const [reportFrom, setReportFrom] = useState(`${today.slice(0, 7)}-01`);
  const [reportTo, setReportTo] = useState(today);
  const [reportStatus, setReportStatus] = useState('');
  const [reportQuery, setReportQuery] = useState('');

  const filtered = useMemo(() => {
    return rows.filter(r => {
      const matchFrom = !reportFrom || String(r.trip_date) >= reportFrom;
      const matchTo = !reportTo || String(r.trip_date) <= reportTo;
      const matchStatus = !reportStatus || r.status === reportStatus;
      const q = reportQuery.trim().toLowerCase();
      const matchQuery = !q || [r.request_no, r.applicant_name, r.applicant_department, r.origin_location, r.destination_location, r.trip_purpose, r.plate_no, r.driver_name]
        .some(v => String(v || '').toLowerCase().includes(q));
      return matchFrom && matchTo && matchStatus && matchQuery;
    }).sort((a, b) => String(a.trip_date).localeCompare(String(b.trip_date)) || String(a.planned_departure_time).localeCompare(String(b.planned_departure_time)));
  }, [rows, reportFrom, reportTo, reportStatus, reportQuery]);

  const metrics = useMemo(() => {
    const count = filtered.length;
    const passengers = filtered.reduce((n, r) => n + Number(r.actual_passenger_count ?? r.passenger_count ?? 0), 0);
    const mileage = filtered.reduce((n, r) => n + Number(r.total_mileage || 0), 0);
    const fuel = filtered.reduce((n, r) => n + Number(r.refuel_cost || 0), 0);
    const abnormal = filtered.filter(r => r.has_abnormality).length;
    return { count, passengers, mileage, fuel, abnormal };
  }, [filtered]);

  const exportExcel = async () => {
    if (!filtered.length) return alert('目前條件沒有可匯出的派車資料');
    const wb = new ExcelJS.Workbook();
    wb.creator = profile.name;
    wb.created = new Date();

    const detail = wb.addWorksheet('派車明細');
    detail.getCell('A1').value = '臺北農產運銷股份有限公司';
    detail.getCell('A2').value = '派車報表';
    detail.getCell('A3').value = `報表期間：${reportFrom || '不限'} 至 ${reportTo || '不限'}`;
    detail.getCell('A4').value = `產出時間：${new Date().toLocaleString('zh-TW')}　產出人：${profile.name}`;

    const headers = ['用車日期', '預計出發', '預計回程', '申請單號', '狀態', '申請單位', '申請人', '起點', '迄點', '用車事由', '乘車人數', '車號', '司機', '行駛里程(km)', '加油費用(元)', '異常通報'];
    detail.getRow(6).values = headers;

    filtered.forEach((r, i) => {
      detail.getRow(7 + i).values = [
        String(r.trip_date || ''), timeText(r.planned_departure_time), timeText(r.planned_return_time),
        String(r.request_no || ''), STATUS_LABEL[String(r.status)] || String(r.status),
        String(r.applicant_department || ''), String(r.applicant_name || ''),
        String(r.origin_location || ''), String(r.destination_location || ''),
        String(r.trip_purpose || ''), Number(r.actual_passenger_count ?? r.passenger_count ?? 0),
        String(r.plate_no || '待派'), String(r.driver_name || '—'),
        r.total_mileage != null ? Number(r.total_mileage) : '—',
        r.refueled ? Number(r.refuel_cost || 0) : 0,
        r.has_abnormality ? `有 (${r.abnormality_note || ''})` : '無',
      ];
    });

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `派車報表_${reportFrom || 'all'}_${reportTo || 'all'}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const printReport = () => {
    if (!filtered.length) return alert('目前條件沒有可列印的資料');
    const popup = window.open('', 'vehicleDispatchReport', 'width=1280,height=850');
    if (!popup) return alert('瀏覽器已阻擋列印視窗');
    // 這份 HTML 不經過 React，每個來自資料庫的值都必須跳脫；
    // 數值欄位先轉成數字再格式化，本身不會挾帶標記。
    const body = filtered.map(r => `<tr>
      <td>${escHtml(r.trip_date)}<br>${escHtml(timeText(r.planned_departure_time))}–${escHtml(timeText(r.planned_return_time))}</td>
      <td>${escHtml(r.request_no)}<br>${escHtml(STATUS_LABEL[String(r.status)] || r.status)}</td>
      <td>${escHtml(r.applicant_department || '—')}<br>${escHtml(r.applicant_name)}</td>
      <td>${escHtml(r.origin_location)} → ${escHtml(r.destination_location)}</td>
      <td>${escHtml(r.trip_purpose)}</td>
      <td>${escHtml(r.plate_no || '待派')}<br>${escHtml(r.driver_name || '—')}</td>
      <td>${r.total_mileage == null ? '—' : Number(r.total_mileage).toFixed(1) + ' km'}</td>
      <td>${r.refueled ? Number(r.refuel_cost || 0).toLocaleString('zh-TW') + ' 元' : '否'}</td>
      <td>${r.has_abnormality ? '有｜' + escHtml(r.abnormality_note || '') : '無'}</td>
    </tr>`).join('');

    popup.document.write(`<!doctype html><html lang="zh-TW"><head><meta charset="utf-8"><title>公務車派車報表</title><style>
      body{font-family:'Noto Sans TC',sans-serif;padding:18px;color:#111}
      h1{font-size:20px;margin:0 0 6px}
      .meta{font-size:12px;color:#555;margin-bottom:12px}
      .summary{display:flex;gap:18px;padding:8px 12px;background:#eef7ff;margin-bottom:12px;font-size:13px;border-radius:4px}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #888;padding:6px;vertical-align:top}
      th{background:#0959a8;color:#fff}
      @page{size:A4 landscape;margin:10mm}
    </style></head><body>
      <h1>臺北農產公司／第一果菜市場　公務車派車報表</h1>
      <div class="meta">報表期間：${escHtml(reportFrom)} 至 ${escHtml(reportTo)}｜產出人：${escHtml(profile.name)}｜產出時間：${escHtml(new Date().toLocaleString('zh-TW'))}</div>
      <div class="summary"><b>申請 ${metrics.count} 筆</b><b>乘車 ${metrics.passengers} 人次</b><b>里程 ${metrics.mileage.toFixed(1)} km</b><b>加油 ${metrics.fuel.toLocaleString('zh-TW')} 元</b><b>異常 ${metrics.abnormal} 件</b></div>
      <table><thead><tr><th>日期／時段</th><th>單號／狀態</th><th>單位／申請人</th><th>起訖地點</th><th>用途</th><th>車號／司機</th><th>里程</th><th>加油</th><th>異常</th></tr></thead><tbody>${body}</tbody></table>
    </body></html>`);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  return <AdminModal title="公務車派車報表" onClose={onClose}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px', marginBottom: '12px' }}>
      <label style={{ fontSize: '0.7rem' }}>開始日期<LocalizedDateInput aria-label="報表開始日期（年/月/日）" value={reportFrom} onChange={e => setReportFrom(e.target.value)} /></label>
      <label style={{ fontSize: '0.7rem' }}>結束日期<LocalizedDateInput aria-label="報表結束日期（年/月/日）" value={reportTo} onChange={e => setReportTo(e.target.value)} /></label>
      <label style={{ fontSize: '0.7rem' }}>狀態<select value={reportStatus} onChange={e => setReportStatus(e.target.value)}>
        <option value="">全部狀態</option>
        {Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label style={{ fontSize: '0.7rem' }}>關鍵字<input value={reportQuery} onChange={e => setReportQuery(e.target.value)} placeholder="搜尋地點、車號、人員…" /></label>
    </div>

    {/* 報表 KPI 統計 */}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', marginBottom: '12px' }}>
      <div style={{ padding: '8px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '8px' }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--dim)' }}>申請單數</div>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--cyan)' }}>{metrics.count} 筆</div>
      </div>
      <div style={{ padding: '8px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '8px' }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--dim)' }}>乘車人次</div>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--cyan)' }}>{metrics.passengers} 人</div>
      </div>
      <div style={{ padding: '8px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '8px' }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--dim)' }}>完成里程</div>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--cyan)' }}>{metrics.mileage.toFixed(1)} km</div>
      </div>
      <div style={{ padding: '8px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '8px' }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--dim)' }}>加油費用</div>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--cyan)' }}>{metrics.fuel.toLocaleString('zh-TW')} 元</div>
      </div>
      <div style={{ padding: '8px', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: '8px' }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--dim)' }}>異常通報</div>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: metrics.abnormal > 0 ? 'var(--red)' : 'var(--cyan)' }}>{metrics.abnormal} 件</div>
      </div>
    </div>

    <div className="responsive-table" style={{ maxHeight: '45vh', overflow: 'auto' }}><table>
      <thead><tr><th>日期／時段</th><th>單號／狀態</th><th>單位／申請人</th><th>起訖地點</th><th>用途</th><th>車號／司機</th><th>里程</th><th>加油</th><th>異常</th></tr></thead>
      <tbody>{filtered.map(r => <tr key={r.request_id}>
        <td>{String(r.trip_date)}<small>{timeText(r.planned_departure_time)}–{timeText(r.planned_return_time)}</small></td>
        <td><strong>{fmt(r.request_no)}</strong><small>{STATUS_LABEL[String(r.status)] || r.status}</small></td>
        <td>{fmt(r.applicant_department)}<small>{fmt(r.applicant_name)}</small></td>
        <td>{fmt(r.origin_location)} → {fmt(r.destination_location)}</td>
        <td>{fmt(r.trip_purpose)}</td>
        <td>{fmt(r.plate_no || '待派')}<small>{fmt(r.driver_name || '—')}</small></td>
        <td>{r.total_mileage != null ? `${Number(r.total_mileage).toFixed(1)} km` : '—'}</td>
        <td>{r.refueled ? `${Number(r.refuel_cost || 0).toLocaleString('zh-TW')} 元` : '否'}</td>
        <td>{r.has_abnormality ? <span style={{ color: 'var(--red)' }}>有｜{fmt(r.abnormality_note)}</span> : '無'}</td>
      </tr>)}</tbody>
    </table></div>
    {filtered.length === 0 && <p className="empty">無符合條件的派車資料</p>}

    <footer>
      <button className="secondary-btn" onClick={onClose}>關閉</button>
      <button className="secondary-btn" onClick={printReport}>A4 列印</button>
      <button className="primary-btn compact" onClick={() => void exportExcel()}>匯出 Excel (.xlsx)</button>
    </footer>
  </AdminModal>;
}

/* ──────────────────── 公務車主檔快速管理彈窗 ──────────────────── */

function VehicleMasterModal({ profile: _profile, onClose }: { profile: Profile; onClose: () => void }) {
  const [vehicles, setVehicles] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    const { data } = await getSupabase().from('official_vehicles').select('*').order('plate_no');
    setVehicles(data || []); setBusy(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    if (!String(editing.plate_no || '').trim()) return alert('請填寫車號');
    setBusy(true);
    const payload = {
      plate_no: String(editing.plate_no).trim(),
      vehicle_name: String(editing.vehicle_name || '').trim() || null,
      brand: String(editing.brand || '').trim() || null,
      model: String(editing.model || '').trim() || null,
      seats: Number(editing.seats || 5),
      current_odometer: Number(editing.current_odometer || 0),
      status: String(editing.status || 'active'),
      note: String(editing.note || '').trim() || null,
    };
    try {
      await invokeAppApi('save_official_vehicle', editing.vehicle_id ? { vehicle_id: String(editing.vehicle_id), ...payload } : payload);
      setEditing(null); await load();
    } catch (error) { alert(`失敗：${error instanceof Error ? error.message : String(error)}`); }
    setBusy(false);
  };

  return <AdminModal title="公務車主檔管理" onClose={onClose}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
      <span>共 {vehicles.length} 台車輛</span>
      <button className="primary-btn compact" onClick={() => setEditing({ status: 'active', seats: 5, current_odometer: 0 })}>＋ 新增車輛</button>
    </div>
    <div className="responsive-table" style={{ maxHeight: '45vh', overflow: 'auto' }}><table>
      <thead><tr><th>車號</th><th>車名</th><th>廠牌／型號</th><th>座位</th><th>目前里程</th><th>狀態</th><th>操作</th></tr></thead>
      <tbody>{vehicles.map(v => <tr key={String(v.vehicle_id)}>
        <td><strong>{fmt(v.plate_no)}</strong></td>
        <td>{fmt(v.vehicle_name)}</td>
        <td>{fmt(v.brand)} {v.model ? `/ ${v.model}` : ''}</td>
        <td>{fmt(v.seats)} 人座</td>
        <td>{fmt(v.current_odometer)} km</td>
        <td><Pill value={v.status} labels={VEHICLE_STATUS_LABEL} tones={VEHICLE_STATUS_TONE} /></td>
        <td><button className="secondary-btn compact" onClick={() => setEditing({ ...v })}>編輯</button></td>
      </tr>)}</tbody>
    </table></div>

    {editing && <AdminModal title={editing.vehicle_id ? '編輯車輛' : '新增車輛'} onClose={() => setEditing(null)}>
      <div className="admin-form-grid">
        <label>車號（必填）<input value={String(editing.plate_no || '')} onChange={e => setEditing({ ...editing, plate_no: e.target.value })} /></label>
        <label>車名<input value={String(editing.vehicle_name || '')} onChange={e => setEditing({ ...editing, vehicle_name: e.target.value })} placeholder="例：公務 7 人座" /></label>
        <label>廠牌<input value={String(editing.brand || '')} onChange={e => setEditing({ ...editing, brand: e.target.value })} /></label>
        <label>型號<input value={String(editing.model || '')} onChange={e => setEditing({ ...editing, model: e.target.value })} /></label>
        <label>座位數<input type="number" min={1} value={String(editing.seats ?? 5)} onChange={e => setEditing({ ...editing, seats: e.target.value })} /></label>
        <label>目前里程 (km)<input type="number" step="0.1" value={String(editing.current_odometer ?? 0)} onChange={e => setEditing({ ...editing, current_odometer: e.target.value })} /></label>
        <label>狀態<select value={String(editing.status || 'active')} onChange={e => setEditing({ ...editing, status: e.target.value })}>
          {Object.entries(VEHICLE_STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label className="wide">備註<input value={String(editing.note || '')} onChange={e => setEditing({ ...editing, note: e.target.value })} /></label>
      </div>
      <footer>
        <button className="secondary-btn" onClick={() => setEditing(null)}>取消</button>
        <button className="primary-btn compact" disabled={busy} onClick={() => void save()}>{busy ? '儲存中…' : '儲存'}</button>
      </footer>
    </AdminModal>}

    <footer>
      <button className="secondary-btn" onClick={onClose}>關閉</button>
    </footer>
  </AdminModal>;
}

/* ──────────────────────────── 表單與彈窗邏輯 ──────────────────────────── */

function CreateRequestModal({ profile: _profile, onClose, onDone }: { profile: Profile; onClose: () => void; onDone: (message: string) => void }) {
  const [form, setForm] = useState({
    trip_date: taipeiToday(), planned_departure_time: '09:00', planned_return_time: '12:00',
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
    try {
      await invokeAppApi('vehicle_create_request', {
        trip_date: form.trip_date, planned_departure_time: form.planned_departure_time, planned_return_time: form.planned_return_time,
        origin_location: form.origin_location.trim(), destination_location: form.destination_location.trim(),
        trip_purpose: form.trip_purpose.trim(), passenger_count: passengers,
        applicant_phone: form.applicant_phone.trim() || null, applicant_note: form.applicant_note.trim() || null,
      });
      onDone('派車申請已送出，待單位主管核可');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setBusy(false); return;
    }
  };

  return <AdminModal title="新增派車申請" onClose={onClose}>
    <div className="admin-form-grid">
      <label>用車日期（必填）<LocalizedDateInput aria-label="用車日期（年/月/日）" value={form.trip_date} min={taipeiToday()} onChange={e => set('trip_date', e.target.value)} /></label>
      <label>搭乘人數（必填）<input type="number" min={1} value={form.passenger_count} onChange={e => set('passenger_count', e.target.value)} /></label>
      <label>預計出發時間（必填）<TimeSelect value={form.planned_departure_time} onChange={e => set('planned_departure_time', e.target.value)} /></label>
      <label>預計回程時間（必填）<TimeSelect value={form.planned_return_time} onChange={e => set('planned_return_time', e.target.value)} /></label>
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
      <label>實際出發時間<LocalizedDateTimeInput ariaLabel="實際出發時間" value={form.actual_departure_at} onChange={value => set('actual_departure_at', value)} /></label>
      <label>實際回程時間<LocalizedDateTimeInput ariaLabel="實際回程時間" value={form.actual_return_at} onChange={value => set('actual_return_at', value)} /></label>
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
    try { await invokeAppApi('save_official_vehicle', { vehicle_id: editor.vehicle_id, ...payload }); }
    catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
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
  const [page, setPage] = useState(1);
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState(''), [picking, setPicking] = useState(false), [pick, setPick] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [r, u] = await Promise.all([
      client.from(table).select(`user_id,active,assigned_at,updated_at,users!${table}_user_id_fkey(name,username,department,status)`).order('updated_at', { ascending: false }),
      client.from('users').select('user_id,name,username,department,status').eq('status', 'active').order('name').limit(2000),
    ]);
    if (r.error || u.error) setNote(`失敗：${errorMessage(r.error || u.error, '名單載入失敗')}`);
    setRows(r.data || []); setCandidates(u.data || []); setBusy(false);
  }, [table]);
  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<void>, success: string) => {
    setBusy(true); setNote('');
    try { await fn(); setPicking(false); setPick(''); await load(); setNote(success); }
    catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };
  const toggle = (row: Row) => run(
    () => invokeAppApi('vehicle_roster_update', { table, user_id: row.user_id, active: !row.active }),
    row.active ? `已停用該${roleWord}` : `已啟用該${roleWord}`);
  const add = () => {
    if (!pick) { setNote('失敗：請先選擇人員'); return; }
    return run(() => invokeAppApi('vehicle_roster_update', { table, user_id: pick, active: true }), `已新增${roleWord}`);
  };

  const listed = new Set(rows.map(row => String(row.user_id)));
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { if (page > pageCount) setPage(pageCount); }, [page, pageCount]);

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={isAdmin ? <button className="primary-btn compact" onClick={() => { setPick(''); setPicking(true); }}>＋ 新增{roleWord}</button> : undefined} />
    <section className="panel admin-panel">
      <div className="admin-toolbar"><span>啟用中 {rows.filter(r => r.active).length}／共 {rows.length} 人</span>
        {!isAdmin && <span className="inline-message">僅系統管理員可調整此名單</span>}</div>
      <div className="responsive-table"><table>
        <thead><tr><th>姓名</th><th>帳號</th><th>單位</th><th>狀態</th><th>設定時間</th>{isAdmin && <th>操作</th>}</tr></thead>
        <tbody>{pageRows.map(row => {
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
      {rows.length > 0 && <Pager page={page} total={rows.length} onPage={setPage} />}
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
