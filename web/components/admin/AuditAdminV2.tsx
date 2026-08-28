'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { AdminHeader, AdminModal, type AdminProps, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from './shared';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { auditSafeValue } from '@/lib/security-audit-sanitize';

const RESOURCE_LABELS: Record<string, string> = {
  system_usage: '系統／功能使用', users: '帳號', roles: '系統角色', role_permissions: '角色權限',
  departments: '組織部門', locations: '場域位置', equipment: '設備',
  inspection_records: '巡檢記錄', checkin_logs: '巡檢打卡', patrol_shifts: '巡檢班別',
  repair_requests: '報修單', maintenance_orders: '維修單', cost_records: '費用',
  handover_records: '電子交接簿', handover_cases: '交接案件',
  vehicle_dispatch_requests: '公務車派車', meeting_bookings: '會議室預約',
  meeting_booking_change_requests: '預約變更申請', floor_spaces: '專案空間',
  plan_markers: '圖面標記', data_access: '資料讀取', file_access: '檔案存取',
  auth: '登入／登出', security_alerts: '資安告警', notifications: '系統通知',
  dashboard_layouts: '戰情版面',
  client_error_logs: '前端錯誤紀錄',
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

function clientOf(row: Row) {
  const changes = row.changes && typeof row.changes === 'object' ? row.changes : {};
  return changes.client && typeof changes.client === 'object' ? changes.client : {};
}

function ipOf(row: Row) {
  return row.ip_address || clientOf(row).ip_address || '—';
}

function deviceOf(row: Row) {
  return row.user_agent || clientOf(row).user_agent || '—';
}

function contentOf(row: Row) {
  const changes = row.changes && typeof row.changes === 'object' ? row.changes : {};
  const detail = changes.details && typeof changes.details === 'object' ? changes.details : {};
  const page = changes.page && typeof changes.page === 'object' ? changes.page : {};
  const eventType = String(changes.event_type || '');
  const rawResource = String(detail.resource || '');
  const resource = RESOURCE_LABELS[rawResource] || rawResource;
  if ((eventType === 'data_read' || eventType === 'file_read') && resource) {
    return `${ACTION_LABELS[eventType]}：${resource}`;
  }
  return changes.feature || detail.feature || detail.reason || detail.result || resource || page.url || changes.title || changes.message || '—';
}

function safeDetailCode(row: Row) {
  return auditSafeValue({
    audit_id: row.audit_id,
    table_name: row.table_name,
    record_id: row.record_id,
    action: row.action,
    operator_id: row.operator_id,
    ip_address: row.ip_address,
    user_agent: row.user_agent,
    source: row.source,
    operated_at: row.operated_at,
    changes: row.changes,
  });
}

function renderAuditFlow(row: Row) {
  const c = row.changes || {};
  const action = ACTION_LABELS[actionKey(row)] || row.action || '操作';
  const resource = RESOURCE_LABELS[String(row.table_name || '')] || row.table_name || '系統資源';
  
  let summary = `使用者執行了「${action}」操作，目標為「${resource}」。`;
  
  if (row.action === 'login' || row.action === 'logout') {
    summary = `使用者${action}了系統。`;
  } else if (c.event_type === 'page_view' && c.page?.url) {
    summary = `使用者進入了頁面：${c.page.url}`;
  } else if (c.event_type === 'function_use' && (c.feature || c.details?.feature)) {
    summary = `使用者執行了功能：${c.feature || c.details.feature}`;
  }
  
  const clientInfo = c.client || {};
  const ip = row.ip_address || clientInfo.ip_address;
  const ua = row.user_agent || clientInfo.user_agent;

  return (
    <div className="audit-flow-box" style={{ padding: '15px', background: 'var(--panel2)', borderRadius: '8px', marginBottom: '15px' }}>
      <h4 style={{ margin: '0 0 10px 0', color: 'var(--cyan, #00d4ff)' }}>操作摘要</h4>
      <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '1.6' }}>
        <li><strong>行為：</strong>{summary}</li>
        {ip && <li><strong>來源 IP：</strong>{ip}</li>}
        {ua && <li><strong>裝置資訊：</strong>{ua}</li>}
      </ul>
    </div>
  );
}

export function AuditAdminV2({ profile, module }: AdminProps) {
  const [logs, setLogs] = useState<Row[]>([]), [busy, setBusy] = useState(true), [note, setNote] = useState(''), [total, setTotal] = useState(0);
  const [openAlertCount, setOpenAlertCount] = useState(0);
  const [actors, setActors] = useState<Array<{ id: string; label: string }>>([]);
  const [query, setQuery] = useState(''), [actor, setActor] = useState(''), [actorId, setActorId] = useState(''), [resource, setResource] = useState(''), [resourceText, setResourceText] = useState(''), [action, setAction] = useState(''), [actionText, setActionText] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [page, setPage] = useState(1), [detail, setDetail] = useState<Row | null>(null);

  useEffect(() => {
    void getSupabase().from('users').select('user_id,name,username').order('name').limit(1000).then(({ data, error }) => {
      if (error) return;
      setActors((data || []).map(row => ({
        id: String(row.user_id),
        label: `${row.name || '未命名'}${row.username ? `（${row.username}）` : ''}`,
      })));
    });
  }, []);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    try {
      if (from && to && from > to) {
        setLogs([]); setTotal(0);
        setNote('失敗：日期區間錯誤，起始日期不可晚於結束日期');
        return;
      }
      const offset = (page - 1) * PAGE_SIZE;
      let request = getSupabase().from('audit_logs')
        .select('*,users(name,username)', { count: 'exact' })
        .order('operated_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (resource) request = request.eq('table_name', resource);
      if (action) request = EVENT_ACTIONS.has(action) ? request.contains('changes', { event_type: action }) : request.eq('action', action);
      if (actor && !actorId) {
        setLogs([]); setTotal(0);
        setNote('請從操作人員清單選擇有效帳號');
        return;
      }
      if (actorId) request = request.eq('operator_id', actorId);
      if (from) request = request.gte('operated_at', `${from}T00:00:00+08:00`);
      if (to) request = request.lte('operated_at', `${to}T23:59:59.999+08:00`);
      const term = query.trim().replace(/[%_,()*]/g, ' ').replace(/\s+/g, ' ').trim();
      if (term) request = request.or(`table_name.ilike.%${term}%,action.ilike.%${term}%,record_id.ilike.%${term}%,source.ilike.%${term}%,ip_address.ilike.%${term}%`);
      const [logResult, alertResult] = await Promise.all([
        request,
        getSupabase().from('security_alerts').select('alert_id', { count: 'exact', head: true }).eq('status', 'open'),
      ]);
      const { data, error, count } = logResult;
      if (!alertResult.error) setOpenAlertCount(alertResult.count || 0);
      if (error) {
        setLogs([]); setTotal(0);
        setNote(`失敗：${errorMessage(error, '稽核紀錄載入失敗')}`);
        return;
      }
      const nextTotal = count || 0;
      const pages = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));
      if (page > pages) {
        // 頁碼越界時清空舊資料，避免短暫顯示上一篩選條件的紀錄。
        setLogs([]); setTotal(0); setPage(pages);
        return;
      }
      setLogs(data || []); setTotal(nextTotal);
    } catch (error) { setLogs([]); setTotal(0); setNote(`失敗：${errorMessage(error, '稽核紀錄載入失敗')}`); }
    finally { setBusy(false); }
  }, [action, actor, actorId, from, page, query, resource, to]);

  useEffect(() => { void load(); }, [load]);
  const changeFilter = (setter: (value: string) => void, value: string) => { setter(value); setPage(1); };
  const changeActor = (value: string) => { setActor(value); setActorId(actors.find(item => item.label === value)?.id || ''); setPage(1); };
  const changeResource = (value: string) => { setResourceText(value); setResource(RESOURCES.find(([, label]) => label === value)?.[0] || ''); setPage(1); };
  const changeAction = (value: string) => { setActionText(value); setAction(ACTIONS.find(([, label]) => label === value)?.[0] || ''); setPage(1); };
  const clear = () => { setQuery(''); setActor(''); setActorId(''); setResource(''); setResourceText(''); setAction(''); setActionText(''); setFrom(''); setTo(''); setPage(1); };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={() => { void load(); }} action={<Link className="security-alert-entry" href="/systems/admin/alerts/">資安告警 <strong>{openAlertCount}</strong></Link>}/>
    <section className="panel admin-panel"><div className="admin-toolbar audit-filters"><input value={query} onChange={event => changeFilter(setQuery, event.target.value)} placeholder="搜尋資源、動作、紀錄編號、來源或 IP"/><input list="audit-actor-options" value={actor} onChange={event => changeActor(event.target.value)} placeholder="操作人員（可輸入篩選）" aria-label="操作人員" aria-invalid={Boolean(actor && !actorId)}/><datalist id="audit-actor-options">{actors.map(item => <option key={item.id} value={item.label}/>)}</datalist><input list="audit-resource-options" value={resourceText} onChange={event => changeResource(event.target.value)} placeholder="全部資源（可輸入篩選）" aria-label="資源"/><datalist id="audit-resource-options">{RESOURCES.map(([value, label]) => <option key={value} value={label}/>)}</datalist><input list="audit-action-options" value={actionText} onChange={event => changeAction(event.target.value)} placeholder="全部操作（可輸入篩選）" aria-label="操作"/><datalist id="audit-action-options">{ACTIONS.map(([value, label]) => <option key={value} value={label}/>)}</datalist><label>起日<LocalizedDateInput aria-label="起始日期（年/月/日）" value={from} onChange={event => changeFilter(setFrom, event.target.value)}/></label><label>迄日<LocalizedDateInput aria-label="結束日期（年/月/日）" value={to} onChange={event => changeFilter(setTo, event.target.value)}/></label><button className="secondary-btn" onClick={clear}>清除</button></div>
      <div className="responsive-table"><table className="audit-log-table"><thead><tr><th>時間</th><th>操作人員</th><th>來源 IP</th><th>資源／操作</th><th>具體內容</th><th>裝置</th><th>紀錄編號</th><th>詳細內容</th></tr></thead><tbody>{logs.map(row => <tr key={row.audit_id}><td>{fmtTime(row.operated_at)}</td><td>{actorOf(row)}</td><td>{fmt(ipOf(row))}</td><td>{RESOURCE_LABELS[String(row.table_name || '')] || '其他資料'}<small>{ACTION_LABELS[actionKey(row)] || '其他操作'}</small></td><td className="audit-content" title={String(contentOf(row))}>{fmt(contentOf(row))}</td><td className="audit-device" title={String(deviceOf(row))}>{fmt(deviceOf(row))}</td><td>{fmt(row.record_id)}</td><td><button className="link-btn" onClick={() => setDetail(row)}>檢視</button></td></tr>)}</tbody></table></div>{!busy && logs.length === 0 && <p className="empty">查無符合條件的稽核紀錄</p>}<Pager page={page} total={total} onPage={setPage}/>
    </section>
    {detail && <AdminModal title="操作稽核詳細內容" onClose={() => setDetail(null)}>
      <dl className="audit-details">
        <div><dt>時間</dt><dd>{fmtTime(detail.operated_at)}</dd></div>
        <div><dt>操作人員</dt><dd>{actorOf(detail)}</dd></div>
        <div><dt>資源／操作</dt><dd>{RESOURCE_LABELS[String(detail.table_name || '')] || '其他資料'}／{ACTION_LABELS[actionKey(detail)] || '其他操作'}</dd></div>
        <div><dt>紀錄編號</dt><dd>{fmt(detail.record_id)}</dd></div>
        <div><dt>來源 IP</dt><dd>{fmt(ipOf(detail))}</dd></div>
        <div><dt>裝置資訊</dt><dd>{fmt(deviceOf(detail))}</dd></div>
        <div><dt>具體內容</dt><dd>{fmt(contentOf(detail))}</dd></div>
        <div><dt>來源系統</dt><dd>{fmt(detail.source)}</dd></div>
      </dl>
      {renderAuditFlow(detail)}
      <details style={{ marginTop: '1rem', cursor: 'pointer', background: 'var(--panel2)', padding: '0.5rem', borderRadius: '4px' }}>
        <summary style={{ fontWeight: 'bold', userSelect: 'none' }}>查看完整紀錄代碼 (JSON)</summary>
        <pre style={{ marginTop: '0.5rem', maxHeight: '400px', overflow: 'auto' }}>{JSON.stringify(safeDetailCode(detail), null, 2)}</pre>
      </details>
      <footer><button className="primary-btn compact" onClick={() => setDetail(null)}>關閉</button></footer>
    </AdminModal>}
  </AppShell>;
}
