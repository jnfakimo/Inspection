'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { getSupabase } from '@/lib/supabase';
import { invokeAdminApi } from '@/lib/admin-api';
import { AdminHeader, type AdminProps, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row, StatusPill } from './shared';

const POLL_INTERVAL_MS = 45_000;
const SEVERITY: Record<string, string> = { critical: '嚴重', warning: '警告', high: '高', medium: '中', low: '低', info: '資訊' };
const STATUS_FILTERS: Record<string, string> = { open: '未處理', acknowledged: '已處理' };
const ALERT_TYPES: Record<string, string> = {
  bulk_read: '大量資料讀取', repeated_denied: '重複拒絕存取', suspicious_file: '可疑檔案存取',
  rate_limit: '流量限制觸發', login_bruteforce: '疑似暴力登入', error_threshold: '系統錯誤爆量',
  rate_limit_exceeded: '流量限制觸發', brute_force: '疑似暴力登入', client_error_threshold: '系統錯誤爆量',
};
const ALERT_TYPE_FILTERS = ['bulk_read', 'repeated_denied', 'suspicious_file', 'rate_limit', 'login_bruteforce', 'error_threshold'] as const;
const ALERT_TYPE_GROUPS: Record<string, string[]> = {
  rate_limit: ['rate_limit', 'rate_limit_exceeded'],
  login_bruteforce: ['login_bruteforce', 'brute_force'],
  error_threshold: ['error_threshold', 'client_error_threshold'],
};
const LINE_STATUS: Record<string, string> = {
  sent: '已送達', failed: '傳送失敗', disabled: '推播停用', not_configured: '尚未設定', pending: '等待傳送',
};
const ENFORCEMENT: Record<string, string> = {
  audit_and_notify_only: '保留證據並通知', force_logout_current_session: '中止目前工作階段',
  rate_limited: '已限制流量', blocked: '已阻擋', none: '僅記錄',
};
const RESOURCE_LABELS: Record<string, string> = {
  client_error_logs: '前端錯誤紀錄',
  'app-api': '應用程式介面',
  'admin-api': '後台管理介面',
  'username-login': '登入服務',
  'audit-event': '稽核服務',
  'error-threshold-check': '錯誤門檻檢查服務',
  'patrol-checkin': '巡檢打卡介面',
  'ipcam-proxy': '監視影像介面',
  'line-notify': 'LINE 推播服務',
  'synthetic:github_pages': 'GitHub Pages 無腳本探針',
  'synthetic:supabase_rest': 'Supabase REST 無腳本探針',
  'synthetic:supabase_storage': 'Supabase Storage 無腳本探針',
  'synthetic:traffic:edge_logs': 'API Gateway／REST 無腳本流量探針',
  'synthetic:traffic:storage_logs': 'Storage 無腳本流量探針',
  data_access: '資料讀取',
  file_access: '檔案存取',
  security_alerts: '資安告警',
  system_settings: '系統設定',
  auth: '登入驗證',
  users: '帳號資料',
  roles: '系統角色',
  role_permissions: '角色權限',
  departments: '組織部門',
  locations: '場域位置',
  equipment: '設備',
  inspection_records: '巡檢記錄',
  checkin_logs: '巡檢打卡',
  repair_requests: '報修單',
  maintenance_orders: '維修單',
  handover_records: '電子交接簿',
  vehicle_dispatch_requests: '公務車派車',
  meeting_bookings: '會議室預約',
  floor_spaces: '專案空間',
  plan_markers: '圖面標記',
  notifications: '系統通知',
  dashboard_layouts: '戰情版面',
};

function localizeResource(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  return raw.split(/\s*[、,，]\s*/).filter(Boolean).map(item => {
    if (RESOURCE_LABELS[item]) return RESOURCE_LABELS[item];
    if (/^username-login(?:\b|[:/])/i.test(item)) return '登入服務';
    if (/^app-api(?:\b|[:/])/i.test(item)) return '應用程式介面';
    if (/^admin-api(?:\b|[:/])/i.test(item)) return '後台管理介面';
    if (/^audit-event(?:\b|[:/])/i.test(item)) return '稽核服務';
    if (/^error-threshold-check(?:\b|[:/])/i.test(item)) return '錯誤門檻檢查服務';
    if (/^patrol-checkin(?:\b|[:/])/i.test(item)) return '巡檢打卡介面';
    if (/^ipcam-proxy(?:\b|[:/])/i.test(item)) return '監視影像介面';
    if (/^line-notify(?:\b|[:/])/i.test(item)) return 'LINE 推播服務';
    if (/^synthetic:github_pages(?:\b|[:/])/i.test(item)) return 'GitHub Pages 無腳本探針';
    if (/^synthetic:supabase_rest(?:\b|[:/])/i.test(item)) return 'Supabase REST 無腳本探針';
    if (/^synthetic:supabase_storage(?:\b|[:/])/i.test(item)) return 'Supabase Storage 無腳本探針';
    if (/^synthetic:traffic:edge_logs(?:\b|[:/])/i.test(item)) return 'API Gateway／REST 無腳本流量探針';
    if (/^synthetic:traffic:storage_logs(?:\b|[:/])/i.test(item)) return 'Storage 無腳本流量探針';
    return item;
  }).join('、');
}

function objectOf(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function alertTypeLabel(value: unknown) {
  const key = String(value || '');
  return ALERT_TYPES[key] || key || '其他資安事件';
}

function thresholdText(row: Row) {
  const details = objectOf(row.details);
  const threshold = Number(details.automated_event_threshold ?? details.maximum_requests ?? details.threshold ?? details.threshold_count);
  const resourceThreshold = Number(details.unique_resource_threshold);
  const requestCount = Number(details.request_count ?? details.error_count);
  const parts = [Number.isFinite(threshold) && threshold > 0 ? `${threshold} 次事件` : ''];
  if (Number.isFinite(resourceThreshold) && resourceThreshold > 0) parts.push(`${resourceThreshold} 個資源`);
  if (Number.isFinite(requestCount) && requestCount > 0) parts.push(`實際 ${requestCount} 次`);
  return parts.filter(Boolean).join('／') || '依系統規則';
}

function deviceText(row: Row) {
  const details = objectOf(row.details);
  const observed = Array.isArray(details.observed_user_agents) ? details.observed_user_agents : [];
  return String(observed[0] || details.user_agent || '—');
}

function lineDelivery(row: Row) {
  const notification = objectOf(objectOf(row.details).line_notification);
  const status = String(notification.status || '');
  if (!status) return { label: '尚無投遞紀錄', time: '', httpStatus: '', hasTechnicalResponse: false };
  return {
    label: LINE_STATUS[status] || status,
    time: fmtTime(notification.sent_at || notification.attempted_at),
    httpStatus: notification.http_status ? String(notification.http_status) : '',
    hasTechnicalResponse: Boolean(notification.response),
  };
}

export function AlertsAdminV2({ profile, module }: AdminProps) {
  const [alerts, setAlerts] = useState<Row[]>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');
  const [alertType, setAlertType] = useState('');
  const [query, setQuery] = useState('');
  const [ip, setIp] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [openCount, setOpenCount] = useState(0);
  const [updatedAt, setUpdatedAt] = useState('');
  const latestOpenSignal = useRef<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy(true);
    if (!silent) setNote('');
    try {
      if (from && to && from > to) {
        setAlerts([]); setTotal(0);
        setNote('失敗：日期區間錯誤，起始日期不可晚於結束日期');
        return;
      }
      const offset = (page - 1) * PAGE_SIZE;
      let request = getSupabase().from('security_alerts')
        .select('*', { count: 'exact' })
        .order('last_seen_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (status) request = request.eq('status', status);
      if (severity) request = request.eq('severity', severity);
      if (alertType) request = request.in('alert_type', ALERT_TYPE_GROUPS[alertType] || [alertType]);
      if (ip.trim()) request = request.ilike('ip_address', `%${ip.trim().replace(/[%_,()*]/g, '')}%`);
      if (from) request = request.gte('last_seen_at', `${from}T00:00:00+08:00`);
      if (to) request = request.lte('last_seen_at', `${to}T23:59:59.999+08:00`);
      const term = query.trim().replace(/[%_,()*]/g, ' ').replace(/\s+/g, ' ').trim();
      if (term) {
        const rawResource = Object.entries(RESOURCE_LABELS).find(([, label]) => label === term)?.[0] || term;
        request = request.or(`title.ilike.%${term}%,message.ilike.%${term}%,actor_identifier.ilike.%${term}%,resource.ilike.%${rawResource}%`);
      }

      const [result, openProbe] = await Promise.all([
        request,
        getSupabase().from('security_alerts')
          .select('alert_id,last_seen_at,event_count', { count: 'exact' })
          .eq('status', 'open')
          .order('last_seen_at', { ascending: false })
          .limit(1),
      ]);
      if (result.error) throw result.error;
      if (openProbe.error) throw openProbe.error;

      const nextTotal = result.count || 0;
      const pages = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));
      setTotal(nextTotal);
      if (page > pages) {
        setAlerts([]);
        setPage(pages);
        return;
      }
      const rows = result.data || [];
      setAlerts(rows);
      const ids = Array.from(new Set(rows.flatMap(row => [row.operator_id, row.acknowledged_by]).filter(Boolean).map(String)));
      if (ids.length) {
        const userResult = await getSupabase().from('users').select('user_id,name,username').in('user_id', ids);
        if (!userResult.error) {
          setUsers(Object.fromEntries((userResult.data || []).map(user => [String(user.user_id), `${user.name || '未命名'}${user.username ? `（${user.username}）` : ''}`])));
        }
      } else {
        setUsers({});
      }

      const newest = openProbe.data?.[0];
      const newestSignal = newest?.alert_id ? `${newest.alert_id}:${newest.last_seen_at || ''}:${newest.event_count || 0}` : null;
      const nextOpenCount = openProbe.count || 0;
      if (silent && latestOpenSignal.current && newestSignal && newestSignal !== latestOpenSignal.current) {
        setNote(`偵測到新的未處理資安告警，目前共 ${nextOpenCount} 筆，清單已自動更新。`);
      }
      latestOpenSignal.current = newestSignal;
      setOpenCount(nextOpenCount);
      setUpdatedAt(new Date().toISOString());
    } catch (error) {
      if (!silent) setAlerts([]);
      setNote(`失敗：${errorMessage(error, '資安告警載入失敗')}`);
    } finally {
      if (!silent) setBusy(false);
    }
  }, [alertType, from, ip, page, query, severity, status, to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) void load(true); }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const changeFilter = (setter: (value: string) => void, value: string) => { setter(value); setPage(1); };
  const clear = () => { setQuery(''); setIp(''); setStatus('open'); setSeverity(''); setAlertType(''); setFrom(''); setTo(''); setPage(1); };
  // 這頁預設就帶著「未處理」篩選，篩到 0 筆時整頁全空，很容易被當成資料沒進來或功能
  // 壞掉（實際發生過）。把目前生效的條件講出來，並給一顆真的清光的按鈕——clear() 會把
  // 狀態設回 open，從空畫面按下去可能還是 0 筆。
  const clearAll = () => { setQuery(''); setIp(''); setStatus(''); setSeverity(''); setAlertType(''); setFrom(''); setTo(''); setPage(1); };
  const activeFilters = [
    status ? `狀態為「${STATUS_FILTERS[status] || status}」` : '',
    severity ? `等級為「${SEVERITY[severity] || severity}」` : '',
    alertType ? `類型為「${ALERT_TYPES[alertType] || alertType}」` : '',
    query.trim() ? `關鍵字為「${query.trim()}」` : '',
    ip.trim() ? `來源 IP 為「${ip.trim()}」` : '',
    from ? `起日 ${from}` : '',
    to ? `迄日 ${to}` : '',
  ].filter(Boolean).join('、');
  const acknowledge = async (row: Row) => {
    if (!window.confirm(`確定將「${row.title || row.alert_id}」標記為已處理？`)) return;
    setBusy(true); setNote('');
    try {
      await invokeAdminApi('admin_ack_alert', { alert_id: row.alert_id });
      await load();
      setNote('告警已標記為已處理，處理人與時間已永久留存。');
    } catch (error) {
      setNote(`失敗：${errorMessage(error)}`);
      setBusy(false);
    }
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={() => void load()} />
    <section className="panel admin-panel">
      <div className="security-alert-summary" role="status">
        <strong>未處理告警 {openCount} 筆</strong>
        <span>每 45 秒自動更新{updatedAt ? `；上次更新 ${fmtTime(updatedAt)}` : ''}</span>
      </div>
      <div className="admin-toolbar security-alert-filters">
        <input value={query} onChange={event => changeFilter(setQuery, event.target.value)} placeholder="搜尋標題、訊息、人員或資源" />
        <input value={ip} onChange={event => changeFilter(setIp, event.target.value)} placeholder="來源 IP" aria-label="來源 IP" />
        <select value={alertType} onChange={event => changeFilter(setAlertType, event.target.value)} aria-label="告警類型"><option value="">全部類型</option>{ALERT_TYPE_FILTERS.map(value => <option key={value} value={value}>{ALERT_TYPES[value]}</option>)}</select>
        <select value={severity} onChange={event => changeFilter(setSeverity, event.target.value)} aria-label="告警等級"><option value="">全部等級</option><option value="critical">嚴重</option><option value="warning">警告</option></select>
        <select value={status} onChange={event => changeFilter(setStatus, event.target.value)} aria-label="處理狀態"><option value="">全部狀態</option><option value="open">未處理</option><option value="acknowledged">已處理</option></select>
        <label className="security-alert-date">起日<LocalizedDateInput aria-label="告警起始日期（年/月/日）" value={from} onChange={event => changeFilter(setFrom, event.target.value)} /></label>
        <label className="security-alert-date">迄日<LocalizedDateInput aria-label="告警結束日期（年/月/日）" value={to} onChange={event => changeFilter(setTo, event.target.value)} /></label>
        <button className="secondary-btn" type="button" onClick={clear}>清除</button>
      </div>
      <div className="admin-alert-list">{alerts.map(row => {
        const details = objectOf(row.details);
        const delivery = lineDelivery(row);
        const enforcement = String(details.enforcement || details.action_taken || '');
        const actor = users[String(row.operator_id || '')] || row.actor_identifier || row.operator_id;
        const handler = users[String(row.acknowledged_by || '')] || row.acknowledged_by;
        return <article className={`admin-alert severity-${row.severity || 'info'}`} key={row.alert_id}>
          <header><div><span className="severity">{SEVERITY[String(row.severity)] || fmt(row.severity)}</span><span className="alert-type">{alertTypeLabel(row.alert_type)}</span><h3>{row.title || '未命名告警'}</h3></div><StatusPill value={row.status} /></header>
          <p>{row.message || '—'}</p>
          <dl>
            <div><dt>操作人員</dt><dd>{fmt(actor)}</dd></div><div><dt>來源 IP</dt><dd>{fmt(row.ip_address)}</dd></div>
            <div><dt>偵測視窗</dt><dd>{Number(row.window_minutes) > 0 ? `${row.window_minutes} 分鐘` : '即時'}</dd></div><div><dt>觸發門檻</dt><dd>{thresholdText(row)}</dd></div>
            <div><dt>累計次數</dt><dd>{fmt(row.event_count || 1)}</dd></div><div><dt>資源</dt><dd>{localizeResource(row.resource)}</dd></div>
            <div><dt>首次偵測</dt><dd>{fmtTime(row.detected_at)}</dd></div><div><dt>最後發生</dt><dd>{fmtTime(row.last_seen_at || row.detected_at)}</dd></div>
            <div><dt>裝置</dt><dd className="alert-device" title={deviceText(row)}>{deviceText(row)}</dd></div><div><dt>系統處置</dt><dd>{ENFORCEMENT[enforcement] || enforcement || '已建立永久告警'}</dd></div>
            <div><dt>LINE 投遞</dt><dd>{delivery.label}{delivery.httpStatus ? `／HTTP ${delivery.httpStatus}` : ''}{delivery.time !== '—' && delivery.time ? `（${delivery.time}）` : ''}{delivery.hasTechnicalResponse ? <small>技術回應已記錄</small> : null}</dd></div>
            <div><dt>處理人員</dt><dd>{row.status === 'acknowledged' ? fmt(handler) : '尚未處理'}</dd></div>
          </dl>
          {row.status === 'open' && <button className="primary-btn compact" disabled={busy} onClick={() => void acknowledge(row)}>標記已處理</button>}
          {row.status === 'acknowledged' && <small className="alert-acknowledged">處理時間：{fmtTime(row.acknowledged_at)}</small>}
        </article>;
      })}{!busy && alerts.length === 0 && (activeFilters
        ? <div className="admin-empty-filtered"><p>目前生效的篩選條件：<b>{activeFilters}</b></p><p>這個範圍內沒有資安告警。放寬條件後可能就有資料。</p><button className="secondary-btn" type="button" onClick={clearAll}>清除全部條件</button></div>
        : <p className="empty">目前沒有資安告警</p>)}</div>
      {total > 0 && <Pager page={page} total={total} onPage={setPage} />}
    </section>
  </AppShell>;
}
