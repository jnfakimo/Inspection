'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { invokeAdminApi } from '@/lib/admin-api';
import { AdminHeader, type AdminProps, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row, StatusPill } from './shared';

const SEVERITY: Record<string, string> = { critical: '嚴重', warning: '警告', high: '高', medium: '中', low: '低', info: '資訊' };
export function AlertsAdminV2({ profile, module }: AdminProps) {
  const [alerts, setAlerts] = useState<Row[]>([]), [busy, setBusy] = useState(true), [note, setNote] = useState(''), [status, setStatus] = useState('open'), [severity, setSeverity] = useState(''), [query, setQuery] = useState(''), [page, setPage] = useState(1);
  const load = useCallback(async () => { setBusy(true); setNote(''); const { data, error } = await getSupabase().from('security_alerts').select('*').order('last_seen_at', { ascending: false }).limit(1000); if (error) setNote(`失敗：${errorMessage(error, '資安告警載入失敗')}`); setAlerts(data || []); setBusy(false); }, []);
  useEffect(() => { void load(); }, [load]);
  const availableSeverities = Array.from(new Set(alerts.map(row => String(row.severity || '')).filter(Boolean)));
  const rows = useMemo(() => alerts.filter(row => { const q = query.trim().toLowerCase(); return (!status || row.status === status) && (!severity || row.severity === severity) && (!q || [row.title, row.message, row.actor_identifier, row.resource].some(value => String(value || '').toLowerCase().includes(q))); }), [alerts, query, status, severity]);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  useEffect(() => { setPage(1); }, [query, status, severity]);
  // 這頁預設就套用「未處理」篩選，篩到 0 筆時畫面會全空，很容易被當成資料沒進來或
  // 功能壞掉（實際發生過）。把目前生效的條件明講出來，並給一個一鍵清除。
  const activeFilters = [
    status ? `狀態為「${status === 'open' ? '未處理' : '已處理'}」` : '',
    severity ? `等級為「${SEVERITY[severity] || severity}」` : '',
    query.trim() ? `關鍵字為「${query.trim()}」` : '',
  ].filter(Boolean).join('、');
  const clearFilters = () => { setStatus(''); setSeverity(''); setQuery(''); };
  const acknowledge = async (row: Row) => { if (!window.confirm(`確定將「${row.title || row.alert_id}」標記為已處理？`)) return; setBusy(true); setNote(''); try { await invokeAdminApi('admin_ack_alert', { alert_id: row.alert_id }); await load(); setNote('告警已標記為已處理'); } catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); } };
  return <AppShell profile={profile} title={module.title}><AdminHeader module={module} busy={busy} note={note} onReload={load}/><section className="panel admin-panel"><div className="admin-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋標題、訊息、操作人員或資源"/><select value={severity} onChange={event => setSeverity(event.target.value)}><option value="">全部等級</option>{availableSeverities.map(value => <option key={value} value={value}>{SEVERITY[value] || value}</option>)}</select><select value={status} onChange={event => setStatus(event.target.value)}><option value="">全部狀態</option><option value="open">未處理</option><option value="acknowledged">已處理</option></select><span>未處理 {alerts.filter(row => row.status === 'open').length} 筆</span></div><div className="admin-alert-list">{pageRows.map(row => <article className={`admin-alert severity-${row.severity || 'info'}`} key={row.alert_id}><header><div><span className="severity">{SEVERITY[row.severity] || fmt(row.severity)}</span><h3>{row.title || '未命名告警'}</h3></div><StatusPill value={row.status}/></header><p>{row.message || '—'}</p><dl><div><dt>操作人員</dt><dd>{fmt(row.actor_identifier)}</dd></div><div><dt>資源</dt><dd>{fmt(row.resource)}</dd></div><div><dt>累計次數</dt><dd>{fmt(row.event_count || 1)}</dd></div><div><dt>最後發生</dt><dd>{fmtTime(row.last_seen_at || row.detected_at)}</dd></div></dl>{row.status === 'open' && <button className="primary-btn compact" disabled={busy} onClick={() => void acknowledge(row)}>標記已處理</button>}{row.status === 'acknowledged' && <small>處理時間：{fmtTime(row.acknowledged_at)}</small>}</article>)}{!busy && rows.length === 0 && (alerts.length === 0 ? <p className="empty">目前沒有任何資安告警紀錄</p> : <div className="empty admin-empty-filtered"><p>目前的篩選條件沒有符合的告警。</p><p>系統共有 <b>{alerts.length}</b> 筆告警紀錄{activeFilters ? `，但目前只顯示${activeFilters}的項目` : ''}。</p><button type="button" className="secondary-btn" onClick={clearFilters}>清除篩選條件，顯示全部</button></div>)}</div>{rows.length > 0 && <Pager page={page} total={rows.length} onPage={setPage} />}</section></AppShell>;
}
