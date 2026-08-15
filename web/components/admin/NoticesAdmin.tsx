'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { invokeAdminApi } from '@/lib/admin-api';
import { AdminHeader, type AdminProps, errorMessage, fmt, fmtTime, type Row } from './shared';

export function NoticesAdmin({ profile, module }: AdminProps) {
  const [notices, setNotices] = useState<Row[]>([]), [busy, setBusy] = useState(true), [note, setNote] = useState(''), [tab, setTab] = useState<'all' | 'unread' | 'read'>('all'), [query, setQuery] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const { data, error } = await getSupabase().from('notifications').select('*').order('created_at', { ascending: false }).limit(1000);
    if (error) setNote(`失敗：${errorMessage(error, '通知載入失敗')}`); setNotices(data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const rows = useMemo(() => notices.filter(row => {
    const q = query.trim().toLowerCase(); const read = Boolean(row.is_read);
    return (tab === 'all' || (tab === 'read' ? read : !read)) && (!q || [row.title, row.body, row.event].some(value => String(value || '').toLowerCase().includes(q)));
  }), [notices, query, tab]);
  const mark = async (notifId?: string) => {
    setBusy(true); setNote('');
    try { await invokeAdminApi('admin_mark_notice', notifId ? { notif_id: notifId } : { all: true }); setNote(notifId ? '通知已標記為已讀' : '全部通知已標記為已讀'); await load(); }
    catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };
  const unread = notices.filter(row => !row.is_read).length;
  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} action={<button className="primary-btn compact" disabled={busy || unread === 0} onClick={() => window.confirm(`確定將 ${unread} 筆未讀通知全部標記為已讀？`) && void mark()}>全部標記已讀</button>}/>
    <section className="panel admin-panel"><div className="admin-tabs"><button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>全部 {notices.length}</button><button className={tab === 'unread' ? 'active' : ''} onClick={() => setTab('unread')}>未讀 {unread}</button><button className={tab === 'read' ? 'active' : ''} onClick={() => setTab('read')}>已讀 {notices.length - unread}</button></div><div className="admin-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋通知標題、內容或事件"/></div>
      <div className="admin-notice-list">{rows.map(row => <article className={row.is_read ? 'read' : 'unread'} key={row.notif_id}><div><span className="notice-event">{fmt(row.event)}</span><h3>{row.title || '系統通知'}</h3><p>{row.body || '—'}</p><time>{fmtTime(row.created_at)}</time></div>{!row.is_read && <button className="secondary-btn" disabled={busy} onClick={() => void mark(row.notif_id)}>標記已讀</button>}</article>)}{!busy && rows.length === 0 && <p className="empty">目前沒有符合條件的通知</p>}</div>
    </section>
  </AppShell>;
}
