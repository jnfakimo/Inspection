'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { AdminHeader, AdminModal, type AdminProps, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from './shared';

const RESOURCE_LABELS: Record<string, string> = {
  system_usage: '系統／功能使用', users: '帳號', role_permissions: '角色權限',
  departments: '組織部門', locations: '場域位置', equipment: '設備',
  inspection_records: '巡檢記錄', checkin_logs: '巡檢打卡', patrol_shifts: '巡檢班別',
  repair_requests: '報修單', maintenance_orders: '維修單', cost_records: '費用',
  handover_records: '電子交接簿', handover_cases: '交接案件',
  vehicle_dispatch_requests: '公務車派車', meeting_bookings: '會議室預約',
  meeting_booking_change_requests: '預約變更申請', floor_spaces: '專案空間',
  plan_markers: '圖面標記', data_access: '資料讀取', file_access: '檔案存取',
  auth: '登入／登出', security_alerts: '資安告警', notifications: '系統通知',
  dashboard_layouts: '戰情版面',
};
const ACTION_LABELS: Record<string, string> = {
  page_view: '進入系統', function_use: '使用功能', data_read: '讀取資料',
  file_read: '讀取檔案', access_denied: '拒絕存取', insert: '新增',
  update: '修改', status_change: '狀態變更', login: '登入', logout: '登出',
};
const EVENT_ACTIONS = new Set(['page_view', 'function_use', 'data_read', 'file_read', 'access_denied']);
const RESOURCES = Object.entries(RESOURCE_LABELS);
const ACTIONS = Object.entries(ACTION_LABELS);

function actorOf(row: Row) {
  const relation = Array.isArray(row.users) ? row.users[0] : row.users;
  if (relation) return `${relation.name || '未命名'}${relation.username ? `（${relation.username}）` : ''}`;
  return row.operator_id || '系統';
}
function actionKey(row: Row) {
  const eventType = String(row.changes?.event_type || '');
  return ACTION_LABELS[eventType] ? eventType : String(row.action || '');
}

export function AuditAdminV2({ profile, module }: AdminProps) {
  const [logs, setLogs] = useState<Row[]>([]), [busy, setBusy] = useState(true), [note, setNote] = useState(''), [total, setTotal] = useState(0);
  const [query, setQuery] = useState(''), [resource, setResource] = useState(''), [action, setAction] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [page, setPage] = useState(1), [detail, setDetail] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    if (from && to && from > to) {
      setLogs([]); setTotal(0); setBusy(false);
      setNote('失敗：日期區間錯誤，起始日期不可晚於結束日期');
      return;
    }
    const offset = (page - 1) * PAGE_SIZE;
    let request = getSupabase().from('audit_logs')
      .select('*,users(name,username,email,department,role,rbac_role)', { count: 'exact' })
      .order('operated_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (resource) request = request.eq('table_name', resource);
    if (action) request = EVENT_ACTIONS.has(action) ? request.contains('changes', { event_type: action }) : request.eq('action', action);
    if (from) request = request.gte('operated_at', `${from}T00:00:00+08:00`);
    if (to) request = request.lte('operated_at', `${to}T23:59:59.999+08:00`);
    const term = query.trim().replace(/[%_,()*]/g, ' ').replace(/\s+/g, ' ').trim();
    if (term) request = request.or(`table_name.ilike.%${term}%,action.ilike.%${term}%,record_id.ilike.%${term}%,source.ilike.%${term}%`);
    const { data, error, count } = await request;
    if (error) {
      setLogs([]); setTotal(0); setBusy(false);
      setNote(`失敗：${errorMessage(error, '稽核紀錄載入失敗')}`);
      return;
    }
    const nextTotal = count || 0;
    const pages = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));
    if (page > pages) {
      setPage(pages); setBusy(false);
      return;
    }
    setLogs(data || []); setTotal(nextTotal); setBusy(false);
  }, [action, from, page, query, resource, to]);

  useEffect(() => { void load(); }, [load]);
  const changeFilter = (setter: (value: string) => void, value: string) => { setter(value); setPage(1); };
  const clear = () => { setQuery(''); setResource(''); setAction(''); setFrom(''); setTo(''); setPage(1); };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={() => { void load(); }}/>
    <section className="panel admin-panel"><div className="admin-toolbar audit-filters"><input value={query} onChange={event => changeFilter(setQuery, event.target.value)} placeholder="搜尋資源、動作、紀錄編號或來源"/><select value={resource} onChange={event => changeFilter(setResource, event.target.value)}><option value="">全部資源</option>{RESOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><select value={action} onChange={event => changeFilter(setAction, event.target.value)}><option value="">全部操作</option>{ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><label>起日<input type="date" value={from} onChange={event => changeFilter(setFrom, event.target.value)}/></label><label>迄日<input type="date" value={to} onChange={event => changeFilter(setTo, event.target.value)}/></label><button className="secondary-btn" onClick={clear}>清除</button></div>
      <div className="responsive-table"><table><thead><tr><th>時間</th><th>操作人員</th><th>資源</th><th>操作</th><th>紀錄編號</th><th>來源</th><th>詳細內容</th></tr></thead><tbody>{logs.map(row => <tr key={row.audit_id}><td>{fmtTime(row.operated_at)}</td><td>{actorOf(row)}</td><td>{RESOURCE_LABELS[String(row.table_name || '')] || '其他資料'}</td><td>{ACTION_LABELS[actionKey(row)] || '其他操作'}</td><td>{fmt(row.record_id)}</td><td>{fmt(row.source || row.ip_address)}</td><td><button className="link-btn" onClick={() => setDetail(row)}>檢視</button></td></tr>)}</tbody></table></div>{!busy && logs.length === 0 && <p className="empty">查無符合條件的稽核紀錄</p>}<Pager page={page} total={total} onPage={setPage}/>
    </section>
    {detail && <AdminModal title="操作稽核詳細內容" onClose={() => setDetail(null)}><dl className="audit-details"><div><dt>時間</dt><dd>{fmtTime(detail.operated_at)}</dd></div><div><dt>操作人員</dt><dd>{actorOf(detail)}</dd></div><div><dt>資源／操作</dt><dd>{RESOURCE_LABELS[String(detail.table_name || '')] || '其他資料'}／{ACTION_LABELS[actionKey(detail)] || '其他操作'}</dd></div><div><dt>紀錄編號</dt><dd>{fmt(detail.record_id)}</dd></div></dl><pre>{JSON.stringify(detail, null, 2)}</pre><footer><button className="primary-btn compact" onClick={() => setDetail(null)}>關閉</button></footer></AdminModal>}
  </AppShell>;
}
