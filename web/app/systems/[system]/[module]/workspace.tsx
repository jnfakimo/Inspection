'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { LEGACY_BASE } from '@/lib/config';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { zhValue } from '@/lib/zh-tw';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type ModuleData = {
  title: string;
  table: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
  summary?: Array<{ label: string; value: number | string }>;
};

function display(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.map(display).join('、');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return String(obj.name || obj.title || obj.label || obj.username || Object.values(obj).map(display).filter(Boolean).join('、'));
  }
  const raw = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toLocaleString('zh-TW', { hour12: false });
  }
  return zhValue(raw);
}

export function ModuleWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  function Workspace({ profile }: { profile: Profile }) {
    const [data, setData] = useState<ModuleData | null>(null);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [syncing, setSyncing] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ location: '', type: '', urgency: 'normal', mobile: '', description: '' });
    const [formMessage, setFormMessage] = useState('');

    const updateRepairStatus = async (row: Record<string, unknown>, status: string) => {
      const requestId = String(row.request_id || row.id || '');
      if (!requestId) return;
      setError('');
      try {
        const { error: updateError } = await getSupabase().from('repair_requests').update({ status, updated_at: new Date().toISOString() }).eq('request_id', requestId);
        if (updateError) throw updateError;
        await load();
      } catch (caught) { setError(caught instanceof Error ? `狀態更新失敗：${caught.message}` : '狀態更新失敗'); }
    };

    const load = useCallback(async () => {
      setSyncing(true);
      setError('');
      try {
        setData(await invokeAppApi<ModuleData>('module_data', { system: system.key, module: module.key }));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '資料讀取失敗');
      } finally {
        setSyncing(false);
      }
    }, []);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
      if (!data?.table) return;
      const channel = getSupabase().channel(`v2-${system.key}-${module.key}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: data.table }, () => { load(); })
        .subscribe();
      return () => { getSupabase().removeChannel(channel); };
    }, [data?.table, load]);

    const rows = useMemo(() => {
      if (!data || !query.trim()) return data?.rows || [];
      const needle = query.toLowerCase();
      return data.rows.filter(row => Object.values(row).some(value => display(value).toLowerCase().includes(needle)));
    }, [data, query]);

    const createRepair = async () => {
      if (!form.description.trim()) { setFormMessage('請填寫故障描述'); return; }
      setSaving(true); setFormMessage('送出中…');
      try {
        const client = getSupabase();
        const { data: auth } = await client.auth.getUser();
        const user = auth.user;
        if (!user) throw new Error('登入狀態已失效，請重新登入');
        const now = new Date();
        const day = now.toISOString().slice(0, 10);
        const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const reqNo = `${day}-${String(Date.now()).slice(-3)}`;
        const faultDesc = [form.location.trim() ? `故障位置：${form.location.trim()}` : '', form.mobile.trim() ? `聯絡手機：${form.mobile.trim()}` : '', `故障描述：${form.description.trim()}`].filter(Boolean).join('\n');
        const { error: insertError } = await client.from('repair_requests').insert({ request_id: requestId, req_no: reqNo, source: 'v2', reporter: profile.name, department: profile.department || null, fault_location: form.location.trim() || null, fault_type: form.type.trim() || null, urgency: form.urgency, fault_desc: faultDesc, mobile: form.mobile.trim() || null, status: 'pending', created_by: user.id });
        if (insertError) throw new Error(insertError.message);
        setForm({ location: '', type: '', urgency: 'normal', mobile: '', description: '' });
        setShowCreate(false); setFormMessage(''); await load();
      } catch (caught) { setFormMessage(caught instanceof Error ? `送出失敗：${caught.message}` : '送出失敗，請稍後再試'); }
      finally { setSaving(false); }
    };

    return <AppShell profile={profile} title={module.title}>
      <div className="page-actions">
        <div><p>{module.description}</p>{error && <span className="inline-message danger">{error}</span>}</div>
        <div className="action-cluster">
          {system.key === 'workorder' && module.key === 'requests' && <button className="primary-btn compact" onClick={() => { setFormMessage(''); setShowCreate(true); }}>＋ 新增報修</button>}
          {module.legacy && <a className="secondary-btn" href={`${LEGACY_BASE}/${module.legacy}`}>專業圖臺／進階作業</a>}
          <button className="primary-btn compact" onClick={load} disabled={syncing}>{syncing ? '同步中…' : '重新同步'}</button>
        </div>
      </div>
      <div className="realtime-state"><i /> 已啟用資料庫即時更新；存取仍受帳號角色與資料列權限保護。</div>
      {data?.summary && <section className="mini-metrics">{data.summary.map(item => <article key={item.label}><span>{zhValue(item.label)}</span><strong>{item.value}</strong></article>)}</section>}
      <section className="panel table-panel">
        <div className="panel-head"><h2>{data?.title || module.title}</h2><div className="table-tools"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋目前資料" /><span>{rows.length} 筆</span></div></div>
        {!data && !error ? <div className="loading-panel">正在透過安全服務載入資料…</div> : <div className="responsive-table"><table><thead><tr>{data?.columns.map(column => <th key={column.key}>{zhValue(column.label)}</th>)}{system.key === 'workorder' && module.key === 'dispatch' && <th>操作</th>}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id || row.request_id || row.record_id || row.user_id || index)}>{data?.columns.map(column => <td key={column.key}>{display(row[column.key])}</td>)}{system.key === 'workorder' && module.key === 'dispatch' && <td><select aria-label="更新案件狀態" value={String(row.status || 'pending')} onChange={event => updateRepairStatus(row, event.target.value)}><option value="pending">待處理</option><option value="assigned">已指派</option><option value="in_progress">處理中</option><option value="pending_review">待驗收</option><option value="closed">已結案</option></select></td>}</tr>)}</tbody></table>{data && rows.length === 0 && <p className="empty">查無資料</p>}</div>}
      </section>
      {showCreate && <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(2,11,24,.45)', display: 'grid', placeItems: 'center', padding: 16 }}>
        <section className="panel" style={{ width: 'min(680px, 100%)', maxHeight: '90vh', overflow: 'auto', background: '#fff' }}>
          <div className="panel-head"><h2>＋ 新增報修</h2><button className="secondary-btn" onClick={() => setShowCreate(false)}>關閉</button></div>
          <div style={{ display: 'grid', gap: 12, padding: 18 }}>
            <label>故障位置<input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="例如：第一市場 2F 配電盤旁" /></label>
            <label>故障類型<input value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} placeholder="電氣／機械／漏水…" /></label>
            <label>急迫度<select value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value })}><option value="normal">正常</option><option value="urgent">緊急</option></select></label>
            <label>聯絡手機<input value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} placeholder="請填手機號碼" /></label>
            <label>故障描述<textarea rows={5} required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="請描述故障狀況…" /></label>
            {formMessage && <span className="inline-message danger">{formMessage}</span>}
            <button className="primary-btn" disabled={saving} onClick={createRepair}>{saving ? '送出中…' : '送出報修'}</button>
          </div>
        </section>
      </div>}
    </AppShell>;
  }
  return <AuthGate>{profile => <Workspace profile={profile} />}</AuthGate>;
}
