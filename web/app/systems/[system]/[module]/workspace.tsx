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
function repairStatusLabel(value: unknown): string {
  return ({ pending: '待處理', assigned: '已派工', in_progress: '維修中', pending_review: '待驗收', closed: '已結案', cancelled: '已取消' } as Record<string, string>)[String(value)] || display(value);
}
function repairStatusClass(value: unknown): string {
  return ({ pending: 'pending', assigned: 'assigned', in_progress: 'in-progress', pending_review: 'review', closed: 'closed', cancelled: 'cancelled' } as Record<string, string>)[String(value)] || 'unknown';
}

export function ModuleWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  function Workspace({ profile }: { profile: Profile }) {
    const [data, setData] = useState<ModuleData | null>(null);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({ reporter: profile.name, phone: '', mobile: '', department: profile.department || '', equipment: '', location: '', type: '', urgency: 'normal', description: '', desiredFinish: '' });
    const [locationPhoto, setLocationPhoto] = useState<File | null>(null);
    const [attachments, setAttachments] = useState<File[]>([]);
    const [formMessage, setFormMessage] = useState('');

    const updateRepairStatus = async (row: Record<string, unknown>, status: string) => {
      const requestId = String(row.request_id || row.id || '');
      const requestNo = String(row.req_no || '');
      if (!requestId && !requestNo) return;
      setError('');
      try {
        const query = getSupabase().from('repair_requests').update({ status, updated_at: new Date().toISOString() });
        const { error: updateError } = requestId ? await query.eq('request_id', requestId) : await query.eq('req_no', requestNo);
        if (updateError) throw updateError;
        await load();
      } catch (caught) { setError(caught instanceof Error ? `狀態更新失敗：${caught.message}` : '狀態更新失敗'); }
    };

    const nextRepairAction = (status: string) => ({ pending: ['assigned', '派工'], assigned: ['in_progress', '開始處理'], in_progress: ['pending_review', '送驗收'], pending_review: ['closed', '結案'] } as Record<string, [string, string]>)[status];

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
      if (!data) return [];
      const needle = query.toLowerCase();
      return data.rows.filter(row => (!statusFilter || String(row.status || '') === statusFilter) && (!needle || Object.values(row).some(value => display(value).toLowerCase().includes(needle))));
    }, [data, query, statusFilter]);

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
        const dayKey = day.replace(/-/g, '');
        const todayCount = data?.rows.filter(row => String(row.created_at || '').startsWith(day)).length || 0;
        const reqNo = `${dayKey}-${String(todayCount + 1).padStart(3, '0')}`;
        const faultDesc = [form.location.trim() ? `故障位置：${form.location.trim()}` : '', form.mobile.trim() ? `聯絡手機：${form.mobile.trim()}` : '', `故障描述：${form.description.trim()}`].filter(Boolean).join('\n');
        if (!form.mobile.trim()) { setFormMessage('請填寫手機號碼'); setSaving(false); return; }
        if (!locationPhoto) { setFormMessage('請上傳一張故障位置照片'); setSaving(false); return; }
        const { error: insertError } = await client.from('repair_requests').insert({ request_id: requestId, req_no: reqNo, source: 'v2', reporter: form.reporter.trim() || profile.name, phone: form.phone.trim() || null, department: form.department.trim() || profile.department || null, equipment_id: form.equipment || null, fault_location: form.location.trim() || null, fault_type: form.type.trim() || null, urgency: form.urgency, fault_desc: faultDesc, mobile: form.mobile.trim() || null, desired_finish: form.desiredFinish || null, status: 'pending', created_by: user.id });
        if (insertError) throw new Error(insertError.message);
        const photoPath = `${requestId}/${Date.now()}_location.${locationPhoto.name.split('.').pop() || 'jpg'}`;
        const upload = await client.storage.from('repair-files').upload(photoPath, locationPhoto, { upsert: true, contentType: locationPhoto.type || 'image/jpeg' });
        if (upload.error) throw new Error(`故障位置照片上傳失敗：${upload.error.message}`);
        const photoRecord = await client.from('repair_attachments').insert({ request_id: requestId, kind: 'location_photo', file_path: photoPath, file_name: locationPhoto.name, uploaded_by: user.id });
        if (photoRecord.error) throw new Error(`照片紀錄失敗：${photoRecord.error.message}`);
        for (const file of attachments) {
          const path = `${requestId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const uploadFile = await client.storage.from('repair-files').upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
          if (uploadFile.error) throw new Error(`附件上傳失敗：${file.name}`);
          const fileRecord = await client.from('repair_attachments').insert({ request_id: requestId, kind: 'attachment', file_path: path, file_name: file.name, uploaded_by: user.id });
          if (fileRecord.error) throw new Error(`附件紀錄失敗：${file.name}`);
        }
        setForm({ reporter: profile.name, phone: '', mobile: '', department: profile.department || '', equipment: '', location: '', type: '', urgency: 'normal', description: '', desiredFinish: '' });
        setLocationPhoto(null); setAttachments([]);
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
      <section className={`panel table-panel ${system.key === 'workorder' && module.key === 'requests' ? 'request-v1-table' : ''}`}>
        <div className="panel-head"><h2>{data?.title || module.title}</h2><div className="table-tools"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋 報修單號／故障類型／單位…" /><span>{rows.length} 筆</span></div></div>
        {system.key === 'workorder' && module.key === 'requests' && <div className="request-status-chips"><button className={!statusFilter ? 'active' : ''} onClick={() => setStatusFilter('')}>全部 <b>{data?.rows.length || 0}</b></button><button className={statusFilter === 'pending' ? 'active' : ''} onClick={() => setStatusFilter('pending')}>待處理 <b>{data?.rows.filter(row => row.status === 'pending').length || 0}</b></button><button className={statusFilter === 'assigned' ? 'active' : ''} onClick={() => setStatusFilter('assigned')}>已派工 <b>{data?.rows.filter(row => row.status === 'assigned').length || 0}</b></button><button className={statusFilter === 'in_progress' ? 'active' : ''} onClick={() => setStatusFilter('in_progress')}>維修中 <b>{data?.rows.filter(row => row.status === 'in_progress').length || 0}</b></button><button className={statusFilter === 'closed' ? 'active' : ''} onClick={() => setStatusFilter('closed')}>已結案 <b>{data?.rows.filter(row => row.status === 'closed').length || 0}</b></button></div>}
        {!data && !error ? <div className="loading-panel">正在透過安全服務載入資料…</div> : <div className="responsive-table"><table><thead><tr>{data?.columns.map(column => <th key={column.key}>{zhValue(column.label)}</th>)}{system.key === 'workorder' && module.key === 'dispatch' && <th>操作</th>}{system.key === 'workorder' && module.key === 'requests' && <th>檢視</th>}</tr></thead><tbody>{rows.map((row, index) => { const action = nextRepairAction(String(row.status || 'pending')); return <tr key={String(row.id || row.request_id || row.record_id || row.user_id || index)} onClick={() => system.key === 'workorder' && module.key === 'requests' && setSelectedRow(row)}>{data?.columns.map(column => <td key={column.key}>{column.key === 'status' ? <span className={`status-pill ${repairStatusClass(row[column.key])}`}>{repairStatusLabel(row[column.key])}</span> : display(row[column.key])}</td>)}{system.key === 'workorder' && module.key === 'dispatch' && <td><button className="secondary-btn" onClick={event => { event.stopPropagation(); if (action) void updateRepairStatus(row, action[0]); }}>{action ? action[1] : '—'}</button></td>}{system.key === 'workorder' && module.key === 'requests' && <td className="request-view-link">檢視 ›</td>}</tr>; })}</tbody></table>{data && rows.length === 0 && <p className="empty">查無資料</p>}</div>}
      </section>
      {selectedRow && <div className="request-detail-backdrop" role="dialog" aria-modal="true"><section className="request-detail-modal"><header><h2>案件詳情</h2><button onClick={() => setSelectedRow(null)} aria-label="關閉">×</button></header><div className="request-detail-grid"><div><span>報修單號</span><strong>{display(selectedRow.req_no)}</strong></div><div><span>報修人</span><strong>{display(selectedRow.reporter)}</strong></div><div><span>所屬單位</span><strong>{display(selectedRow.department)}</strong></div><div><span>聯絡手機</span><strong>{display(selectedRow.mobile)}</strong></div><div><span>故障類型</span><strong>{display(selectedRow.fault_type)}</strong></div><div><span>急迫度</span><strong>{display(selectedRow.urgency)}</strong></div><div className="full"><span>故障位置</span><strong>{display(selectedRow.fault_location)}</strong></div><div className="full"><span>故障說明</span><p>{display(selectedRow.fault_desc)}</p></div><div><span>報修狀態</span><strong><span className={`status-pill ${repairStatusClass(selectedRow.status)}`}>{repairStatusLabel(selectedRow.status)}</span></strong></div><div><span>建立時間</span><strong>{display(selectedRow.created_at)}</strong></div></div></section></div>}
      {showCreate && <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(2,11,24,.45)', display: 'grid', placeItems: 'center', padding: 16 }}>
        <section className="panel" style={{ width: 'min(680px, 100%)', maxHeight: '90vh', overflow: 'auto', background: '#fff' }}>
          <div className="panel-head"><h2>＋ 新增報修</h2><button className="secondary-btn" onClick={() => setShowCreate(false)}>關閉</button></div>
          <div style={{ display: 'grid', gap: 12, padding: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}><label>報修人<input value={form.reporter} onChange={e => setForm({ ...form, reporter: e.target.value })} /></label><label>聯絡電話<input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="例如：5818" /></label><label>手機（必填）<input value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} placeholder="請填手機號碼" /></label><label>所屬單位<input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} /></label></div>
            <label>關聯設備（選填）<select value={form.equipment} onChange={e => setForm({ ...form, equipment: e.target.value })}><option value="">-- 未指定設備 --</option></select></label>
            <label>故障位置<input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="請描述故障位置，例如：第一市場 2F 配電盤旁" /></label>
            <label>故障位置照片（必填，請上傳一張照片）<input type="file" accept="image/*" onChange={e => setLocationPhoto(e.target.files?.[0] || null)} /></label>
            <label>故障類型<input value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} placeholder="電氣／機械／漏水…" /></label>
            <label>急迫度<select value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value })}><option value="normal">正常</option><option value="urgent">緊急</option><option value="high">高</option></select></label>
            <label>故障描述<textarea rows={5} required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="請描述故障狀況…" /></label>
            <label>希望完成日期<input type="date" value={form.desiredFinish} onChange={e => setForm({ ...form, desiredFinish: e.target.value })} /></label>
            <label>其他附件（照片／影片／PDF／Word／Excel，可多選）<input type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={e => setAttachments(Array.from(e.target.files || []))} /></label>
            {formMessage && <span className="inline-message danger">{formMessage}</span>}
            <button className="primary-btn" disabled={saving} onClick={createRepair}>{saving ? '送出中…' : '送出報修'}</button>
          </div>
        </section>
      </div>}
    </AppShell>;
  }
  return <AuthGate>{profile => <Workspace profile={profile} />}</AuthGate>;
}
