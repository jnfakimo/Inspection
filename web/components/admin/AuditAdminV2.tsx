'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { AdminHeader, AdminModal, type AdminProps, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from './shared';

export function AuditAdminV2({ profile, module }: AdminProps) {
  const [logs, setLogs] = useState<Row[]>([]), [users, setUsers] = useState<Row[]>([]), [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [resource, setResource] = useState(''), [action, setAction] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [page, setPage] = useState(1), [detail, setDetail] = useState<Row | null>(null);
  const load = useCallback(async () => {
    setBusy(true); setNote(''); const client = getSupabase();
    const [logResult, userResult] = await Promise.all([client.from('audit_logs').select('*').order('operated_at', { ascending: false }).limit(2000), client.from('users').select('user_id,name,username,email,department').limit(2000)]);
    if (logResult.error || userResult.error) setNote(`失敗：${errorMessage(logResult.error || userResult.error, '稽核紀錄載入失敗')}`);
    setLogs(logResult.data || []); setUsers(userResult.data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const actor = useCallback((row: Row) => { const user = users.find(item => item.user_id === row.operator_id); return user ? `${user.name}${user.username ? `（${user.username}）` : ''}` : row.operator_id || '系統'; }, [users]);
  const filtered = useMemo(() => logs.filter(row => {
    const when = new Date(String(row.operated_at || 0)); const q = query.trim().toLowerCase(); const text = [actor(row), row.table_name, row.action, row.record_id, JSON.stringify(row.changes || {})].join(' ').toLowerCase();
    return (!resource || row.table_name === resource) && (!action || row.action === action) && (!from || when >= new Date(`${from}T00:00:00`)) && (!to || when <= new Date(`${to}T23:59:59`)) && (!q || text.includes(q));
  }), [logs, actor, query, resource, action, from, to]);
  useEffect(() => setPage(1), [query, resource, action, from, to]);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), resources = Array.from(new Set(logs.map(row => String(row.table_name || '')).filter(Boolean))).sort(), actions = Array.from(new Set(logs.map(row => String(row.action || '')).filter(Boolean))).sort();
  const clear = () => { setQuery(''); setResource(''); setAction(''); setFrom(''); setTo(''); };
  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}/>
    <section className="panel admin-panel"><div className="admin-toolbar audit-filters"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋操作人員、資源、紀錄編號或內容"/><select value={resource} onChange={event => setResource(event.target.value)}><option value="">全部資源</option>{resources.map(value => <option key={value}>{value}</option>)}</select><select value={action} onChange={event => setAction(event.target.value)}><option value="">全部操作</option>{actions.map(value => <option key={value}>{value}</option>)}</select><label>起日<input type="date" value={from} onChange={event => setFrom(event.target.value)}/></label><label>迄日<input type="date" value={to} onChange={event => setTo(event.target.value)}/></label><button className="secondary-btn" onClick={clear}>清除</button></div>
      <div className="responsive-table"><table><thead><tr><th>時間</th><th>操作人員</th><th>資源</th><th>操作</th><th>紀錄編號</th><th>來源</th><th>詳細內容</th></tr></thead><tbody>{rows.map(row => <tr key={row.audit_id}><td>{fmtTime(row.operated_at)}</td><td>{actor(row)}</td><td>{fmt(row.table_name)}</td><td>{fmt(row.action)}</td><td>{fmt(row.record_id)}</td><td>{fmt(row.source || row.ip_address)}</td><td><button className="link-btn" onClick={() => setDetail(row)}>檢視</button></td></tr>)}</tbody></table></div>{!busy && rows.length === 0 && <p className="empty">查無符合條件的稽核紀錄</p>}<Pager page={page} total={filtered.length} onPage={setPage}/>
    </section>
    {detail && <AdminModal title="操作稽核詳細內容" onClose={() => setDetail(null)}><dl className="audit-details"><div><dt>時間</dt><dd>{fmtTime(detail.operated_at)}</dd></div><div><dt>操作人員</dt><dd>{actor(detail)}</dd></div><div><dt>資源／操作</dt><dd>{fmt(detail.table_name)}／{fmt(detail.action)}</dd></div><div><dt>紀錄編號</dt><dd>{fmt(detail.record_id)}</dd></div></dl><pre>{JSON.stringify(detail, null, 2)}</pre><footer><button className="primary-btn compact" onClick={() => setDetail(null)}>關閉</button></footer></AdminModal>}
  </AppShell>;
}
