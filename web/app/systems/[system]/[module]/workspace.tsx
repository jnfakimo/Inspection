'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
type RepairEquipmentOption = { equipment_id: string; name: string; asset_code?: string | null; location?: string | null; category?: string | null };
type RepairDetail = {
  request: Record<string, unknown>;
  order: Record<string, unknown> | null;
  attachments: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
};

const REQUEST_PAGE_SIZE = 10;
const EMPTY_FILTER_VALUE = '__empty__';

function taipeiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
}
function repairFileKind(file: File): string {
  if (file.type.startsWith('image/')) return 'photo';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.includes('pdf')) return 'pdf';
  if (file.type.includes('word') || /\.docx?$/i.test(file.name)) return 'doc';
  if (file.type.includes('sheet') || /\.xlsx?$/i.test(file.name)) return 'xls';
  return 'other';
}

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
function repairTimelineStatusLabel(value: unknown): string {
  return ({ pending: '待派工', transferred: '已轉派', assigned: '待接單', accepted: '已接單', in_progress: '維修中', waiting_parts: '等待料件', waiting_vendor: '等待廠商', pending_review: '待驗收', completed: '已完成', closed: '已結案', returned: '已退回', rejected: '已拒絕', cancelled: '已取消', overdue: '已逾期' } as Record<string, string>)[String(value)] || display(value);
}
function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function repairDate(value: unknown): string {
  if (!value) return '—';
  const raw = String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : display(value);
}
function requestFilterValue(key: string, value: unknown): string {
  if (value == null || value === '') return EMPTY_FILTER_VALUE;
  const raw = String(value);
  return key === 'created_at' ? raw.slice(0, 10) : raw;
}
function requestFilterLabel(key: string, value: string): string {
  if (value === EMPTY_FILTER_VALUE) return '未填寫';
  if (key === 'status') return repairStatusLabel(value);
  if (key === 'urgency') return ({ normal: '正常', high: '高', urgent: '緊急' } as Record<string, string>)[value] || zhValue(value);
  const label = key === 'created_at' ? value : display(value).replace(/\s+/g, ' ');
  return label.length > 32 ? label.slice(0, 32) + '…' : label;
}

export function ModuleWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  function Workspace({ profile }: { profile: Profile }) {
    const isRequestModule = system.key === 'workorder' && module.key === 'requests';
    const reporterLabel = [profile.department, profile.name].filter(Boolean).join(' / ');
    const emptyRepairForm = () => ({ reporter: reporterLabel, phone: '', mobile: '', department: profile.department || '', equipment: '', location: '', type: '', urgency: 'normal', description: '', desiredFinish: '' });
    const [data, setData] = useState<ModuleData | null>(null);
    const [error, setError] = useState('');
    const [query, setQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
    const [page, setPage] = useState(1);
    const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
    const [repairDetail, setRepairDetail] = useState<RepairDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState('');
    const detailRequestSeq = useRef(0);
    const [syncing, setSyncing] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(emptyRepairForm);
    const [equipmentOptions, setEquipmentOptions] = useState<RepairEquipmentOption[]>([]);
    const [departmentOptions, setDepartmentOptions] = useState<string[]>([]);
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

    const closeRepairDetail = () => {
      detailRequestSeq.current += 1;
      setSelectedRow(null);
      setRepairDetail(null);
      setDetailError('');
      setDetailLoading(false);
    };

    const openRepairDetail = async (row: Record<string, unknown>) => {
      const seq = ++detailRequestSeq.current;
      setSelectedRow(row);
      setRepairDetail(null);
      setDetailError('');
      setDetailLoading(true);
      try {
        const client = getSupabase();
        const requestId = String(row.request_id || row.id || '');
        const requestNo = String(row.req_no || '');
        if (!requestId && !requestNo) throw new Error('找不到報修案件識別碼');
        let requestQuery = client.from('repair_requests').select('*,equipment(name,category,qr_code)');
        requestQuery = requestId ? requestQuery.eq('request_id', requestId) : requestQuery.eq('req_no', requestNo);
        const requestResult = await requestQuery.limit(1).maybeSingle();
        if (requestResult.error) throw new Error(requestResult.error.message);
        if (!requestResult.data) throw new Error('找不到這筆報修案件');
        const fullRequest = requestResult.data as Record<string, unknown>;
        const fullRequestId = String(fullRequest.request_id || requestId);
        const [orderResult, attachmentsResult, logsResult] = await Promise.all([
          client.from('maintenance_orders').select('*,users:assignee_id(name)').eq('request_id', fullRequestId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          client.from('repair_attachments').select('*').eq('request_id', fullRequestId).order('uploaded_at', { ascending: true }),
          client.from('case_status_log').select('*').eq('request_id', fullRequestId).order('created_at', { ascending: true }),
        ]);
        if (seq !== detailRequestSeq.current) return;
        const relationErrors = [orderResult.error, attachmentsResult.error, logsResult.error].filter(Boolean).map(item => item?.message).filter(Boolean);
        const detailAttachments = ((attachmentsResult.data || []) as Array<Record<string, unknown>>).map(item => ({ ...item }));
        if (detailAttachments.length) {
          const signedResult = await client.storage.from('repair-files').createSignedUrls(detailAttachments.map(item => String(item.file_path || '')), 3600);
          if (seq !== detailRequestSeq.current) return;
          if (signedResult.error) relationErrors.push(`附件網址：${signedResult.error.message}`);
          const signedMap = new Map((signedResult.data || []).map(item => [item.path, item.signedUrl]));
          detailAttachments.forEach(item => { item.signed_url = signedMap.get(String(item.file_path || '')) || ''; });
        }
        setRepairDetail({ request: fullRequest, order: (orderResult.data || null) as Record<string, unknown> | null, attachments: detailAttachments, logs: (logsResult.data || []) as Array<Record<string, unknown>> });
        if (relationErrors.length) setDetailError(`部分關聯資料無法載入：${relationErrors.join('；')}`);
      } catch (caught) {
        if (seq === detailRequestSeq.current) setDetailError(caught instanceof Error ? `案件詳情載入失敗：${caught.message}` : '案件詳情載入失敗');
      } finally {
        if (seq === detailRequestSeq.current) setDetailLoading(false);
      }
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
      if (!isRequestModule) return;
      let active = true;
      const client = getSupabase();
      void Promise.all([
        client.from('equipment').select('equipment_id,name,asset_code,location,category').neq('status', 'retired').order('name').limit(500),
        client.from('departments').select('name').eq('status', 'active').order('sort_order').limit(200),
      ]).then(([equipmentResult, departmentResult]) => {
        if (!active) return;
        if (!equipmentResult.error) setEquipmentOptions((equipmentResult.data || []) as RepairEquipmentOption[]);
        if (!departmentResult.error) setDepartmentOptions((departmentResult.data || []).map(row => String(row.name || '')).filter(Boolean));
      });
      return () => { active = false; };
    }, [isRequestModule]);
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
      return data.rows.filter(row => {
        const matchesColumns = Object.entries(columnFilters).every(([key, value]) => !value || requestFilterValue(key, row[key]) === value);
        return matchesColumns && (!statusFilter || String(row.status || '') === statusFilter) && (!needle || Object.values(row).some(value => display(value).toLowerCase().includes(needle)));
      });
    }, [columnFilters, data, query, statusFilter]);
    const columnFilterOptions = useMemo(() => {
      const options: Record<string, Array<{ value: string; label: string }>> = {};
      for (const column of data?.columns || []) {
        const unique = new Map<string, string>();
        for (const row of data?.rows || []) {
          const value = requestFilterValue(column.key, row[column.key]);
          if (!unique.has(value)) unique.set(value, requestFilterLabel(column.key, value));
        }
        options[column.key] = [...unique].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'));
      }
      return options;
    }, [data]);
    const totalPages = isRequestModule ? Math.max(1, Math.ceil(rows.length / REQUEST_PAGE_SIZE)) : 1;
    const visibleRows = isRequestModule ? rows.slice((page - 1) * REQUEST_PAGE_SIZE, page * REQUEST_PAGE_SIZE) : rows;
    const paginationPages = useMemo(() => {
      if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
      return [...new Set([1, page - 1, page, page + 1, totalPages])].filter(item => item >= 1 && item <= totalPages).sort((a, b) => a - b);
    }, [page, totalPages]);

    useEffect(() => { setPage(1); }, [columnFilters, query, statusFilter]);
    useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

    const createRepair = async () => {
      if (!form.mobile.trim()) { setFormMessage('請填寫手機號碼'); return; }
      if (!locationPhoto) { setFormMessage('請上傳一張故障位置照片'); return; }
      if (!form.description.trim()) { setFormMessage('請填寫故障描述'); return; }
      const permitted = /^(image\/(jpeg|png|webp|heic)|video\/mp4|application\/pdf|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document|vnd\.ms-excel|vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet))$/i;
      const invalidFile = [locationPhoto, ...attachments].find(file => file.size > 10 * 1024 * 1024 || !permitted.test(file.type));
      if (invalidFile) { setFormMessage(`附件不符合限制：${invalidFile.name}（僅接受指定照片／MP4／PDF／Word／Excel，每檔 10MB）`); return; }
      setSaving(true); setFormMessage('送出中…');
      try {
        const client = getSupabase();
        const { data: auth } = await client.auth.getUser();
        if (!auth.user) throw new Error('登入狀態已失效，請重新登入');
        const day = taipeiToday();
        const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const dayKey = day.replace(/-/g, '');
        const todayCount = data?.rows.filter(row => String(row.created_at || '').startsWith(day)).length || 0;
        const reqNo = `${dayKey}-${String(todayCount + 1).padStart(3, '0')}`;
        const faultDesc = [form.location.trim() ? `故障位置：${form.location.trim()}` : '', form.mobile.trim() ? `聯絡手機：${form.mobile.trim()}` : '', `故障描述：${form.description.trim()}`].filter(Boolean).join('\n');
        const selectedEquipment = equipmentOptions.find(item => item.equipment_id === form.equipment);
        const { error: insertError } = await client.from('repair_requests').insert({ request_id: requestId, req_no: reqNo, source: 'direct', reporter: form.reporter.trim() || profile.name, phone: form.phone.trim() || null, department: form.department.trim() || profile.department || null, equipment_id: form.equipment || null, equipment_category: selectedEquipment?.category || null, fault_location: form.location.trim() || null, fault_type: form.type.trim() || null, urgency: form.urgency, fault_desc: faultDesc, mobile: form.mobile.trim() || null, desired_finish: form.desiredFinish || null, status: 'pending', created_by: profile.user_id });
        if (insertError) throw new Error(insertError.message);
        const photoPath = `${requestId}/${Date.now()}_location.${locationPhoto.name.split('.').pop() || 'jpg'}`;
        const upload = await client.storage.from('repair-files').upload(photoPath, locationPhoto, { upsert: true, contentType: locationPhoto.type || 'image/jpeg' });
        if (upload.error) throw new Error(`故障位置照片上傳失敗：${upload.error.message}`);
        const photoRecord = await client.from('repair_attachments').insert({ request_id: requestId, kind: 'location_photo', file_path: photoPath, file_name: locationPhoto.name, uploaded_by: profile.user_id });
        if (photoRecord.error) { await client.storage.from('repair-files').remove([photoPath]); throw new Error(`照片紀錄失敗：${photoRecord.error.message}`); }
        for (const file of attachments) {
          const path = `${requestId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const uploadFile = await client.storage.from('repair-files').upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
          if (uploadFile.error) throw new Error(`附件上傳失敗：${file.name}`);
          const fileRecord = await client.from('repair_attachments').insert({ request_id: requestId, kind: repairFileKind(file), file_path: path, file_name: file.name, uploaded_by: profile.user_id });
          if (fileRecord.error) { await client.storage.from('repair-files').remove([path]); throw new Error(`附件紀錄失敗：${file.name}`); }
        }
        setForm(emptyRepairForm());
        setLocationPhoto(null); setAttachments([]);
        setShowCreate(false); setFormMessage(''); await load();
      } catch (caught) { setFormMessage(caught instanceof Error ? `送出失敗：${caught.message}` : '送出失敗，請稍後再試'); }
      finally { setSaving(false); }
    };

    const detailRequest = repairDetail?.request || selectedRow;
    const detailEquipment = recordValue(detailRequest?.equipment);
    const detailOrder = repairDetail?.order;
    const detailAssignee = recordValue(detailOrder?.users);

    return <AppShell profile={profile} title={module.title}>
      <div className="page-actions">
        <div><p>{module.description}</p>{error && <span className="inline-message danger">{error}</span>}</div>
        {!isRequestModule && <div className="action-cluster">
          {module.legacy && <a className="secondary-btn" href={`${LEGACY_BASE}/${module.legacy}`}>專業圖臺／進階作業</a>}
          <button className="primary-btn compact" onClick={load} disabled={syncing}>{syncing ? '同步中…' : '重新同步'}</button>
        </div>}
      </div>
      <div className="realtime-state"><i /> 已啟用資料庫即時更新；存取仍受帳號角色與資料列權限保護。</div>
      {data?.summary && <section className="mini-metrics">{data.summary.map(item => <article key={item.label}><span>{zhValue(item.label)}</span><strong>{item.value}</strong></article>)}</section>}
      <section className={`panel table-panel ${system.key === 'workorder' && module.key === 'requests' ? 'request-v1-table' : ''}`}>
        <div className="panel-head"><h2>{data?.title || module.title}</h2><div className="table-tools"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋 報修單號／故障類型／單位…" /><span>{rows.length} 筆</span>{isRequestModule && <button className="repair-add-button" onClick={() => { setForm(emptyRepairForm()); setLocationPhoto(null); setAttachments([]); setFormMessage(''); setShowCreate(true); }}>＋ 新增報修</button>}</div></div>
        {system.key === 'workorder' && module.key === 'requests' && <div className="request-status-chips"><button className={!statusFilter ? 'active' : ''} onClick={() => setStatusFilter('')}>全部 <b>{data?.rows.length || 0}</b></button><button className={statusFilter === 'pending' ? 'active' : ''} onClick={() => setStatusFilter('pending')}>待處理 <b>{data?.rows.filter(row => row.status === 'pending').length || 0}</b></button><button className={statusFilter === 'assigned' ? 'active' : ''} onClick={() => setStatusFilter('assigned')}>已派工 <b>{data?.rows.filter(row => row.status === 'assigned').length || 0}</b></button><button className={statusFilter === 'in_progress' ? 'active' : ''} onClick={() => setStatusFilter('in_progress')}>維修中 <b>{data?.rows.filter(row => row.status === 'in_progress').length || 0}</b></button><button className={statusFilter === 'closed' ? 'active' : ''} onClick={() => setStatusFilter('closed')}>已結案 <b>{data?.rows.filter(row => row.status === 'closed').length || 0}</b></button></div>}
        {!data && !error ? <div className="loading-panel">正在透過安全服務載入資料…</div> : <>
          <div className="responsive-table"><table><thead><tr>{data?.columns.map(column => <th key={column.key}>{zhValue(column.label)}</th>)}{system.key === 'workorder' && module.key === 'dispatch' && <th>操作</th>}{isRequestModule && <th>檢視</th>}</tr>{isRequestModule && <tr className="request-column-filters">{data?.columns.map(column => { const value = column.key === 'status' ? statusFilter : columnFilters[column.key] || ''; return <th key={column.key}><select value={value} onChange={event => column.key === 'status' ? setStatusFilter(event.target.value) : setColumnFilters(current => ({ ...current, [column.key]: event.target.value }))} aria-label={'篩選' + zhValue(column.label)}><option value="">全部</option>{(columnFilterOptions[column.key] || []).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></th>; })}<th><button type="button" className="request-filter-clear" onClick={() => { setColumnFilters({}); setStatusFilter(''); }} disabled={!statusFilter && !Object.values(columnFilters).some(Boolean)}>清除</button></th></tr>}</thead><tbody>{visibleRows.map((row, index) => { const action = nextRepairAction(String(row.status || 'pending')); return <tr key={String(row.id || row.request_id || row.record_id || row.user_id || index)} onClick={() => { if (isRequestModule) void openRepairDetail(row); }}>{data?.columns.map(column => <td key={column.key}>{column.key === 'status' ? <span className={`status-pill ${repairStatusClass(row[column.key])}`}>{repairStatusLabel(row[column.key])}</span> : display(row[column.key])}</td>)}{system.key === 'workorder' && module.key === 'dispatch' && <td><button className="secondary-btn" onClick={event => { event.stopPropagation(); if (action) void updateRepairStatus(row, action[0]); }}>{action ? action[1] : '—'}</button></td>}{isRequestModule && <td className="request-view-link">檢視 ›</td>}</tr>; })}</tbody></table>{data && rows.length === 0 && <p className="empty">查無資料</p>}</div>
          {isRequestModule && rows.length > 0 && <nav className="request-pagination" aria-label="報修案件分頁">
            <span>每頁 {REQUEST_PAGE_SIZE} 筆，第 {page}／{totalPages} 頁，共 {rows.length} 筆</span>
            <div>
              <button type="button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={page === 1} aria-label="上一頁">‹</button>
              {paginationPages.map((pageNumber, index) => <span key={pageNumber} className="request-page-item">{index > 0 && pageNumber - paginationPages[index - 1] > 1 && <i>…</i>}<button type="button" className={page === pageNumber ? 'active' : ''} onClick={() => setPage(pageNumber)} aria-current={page === pageNumber ? 'page' : undefined}>{pageNumber}</button></span>)}
              <button type="button" onClick={() => setPage(current => Math.min(totalPages, current + 1))} disabled={page === totalPages} aria-label="下一頁">›</button>
            </div>
          </nav>}
        </>}
      </section>
      {selectedRow && detailRequest && <div className="request-detail-backdrop" role="dialog" aria-modal="true" aria-labelledby="repair-detail-title"><section className="request-detail-modal">
        <header><h2 id="repair-detail-title"><b>{display(detailRequest.req_no)}</b><span className={`status-pill ${repairStatusClass(detailRequest.status)}`}>{repairStatusLabel(detailRequest.status)}</span></h2><button type="button" onClick={closeRepairDetail} aria-label="關閉案件詳情">×</button></header>
        {detailLoading && <div className="request-detail-loading">案件資料、附件與流程載入中…</div>}
        {detailError && <div className="request-detail-error" role="alert">{detailError}</div>}
        {!detailLoading && repairDetail && <div className="request-detail-body">
          <div className="request-detail-grid">
            <div><span>設備：</span><strong>{display(detailEquipment.name)}</strong></div><div><span>分類：</span><strong>{display(detailRequest.equipment_category || detailEquipment.category)}</strong></div>
            <div><span>故障位置：</span><strong>{display(detailRequest.fault_location)}</strong></div><div><span>QR：</span><strong>{display(detailEquipment.qr_code)}</strong></div>
            <div><span>報修人：</span><strong>{display(detailRequest.reporter)}</strong></div><div><span>單位：</span><strong>{display(detailRequest.department)}</strong></div>
            <div><span>電話：</span><strong>{display(detailRequest.phone)}</strong></div><div><span>手機：</span><strong>{display(detailRequest.mobile)}</strong></div>
            <div><span>故障類型：</span><strong>{display(detailRequest.fault_type)}</strong></div><div><span>希望完成：</span><strong>{repairDate(detailRequest.desired_finish)}</strong></div>
            <div className="full"><span>故障描述：</span><p>{display(detailRequest.fault_desc)}</p></div>
            {detailOrder && <div className="full"><span>派工：</span><strong>{display(detailOrder.wo_no)} · 技師 {display(detailAssignee.name)}{detailOrder.vendor ? ` · 委外 ${display(detailOrder.vendor)}` : ''}</strong></div>}
            {detailOrder && Boolean(detailOrder.fault_cause) && <div className="full"><span>維修結果：</span><p>{[detailOrder.fault_cause, detailOrder.handle_method, detailOrder.parts_used ? `更換：${display(detailOrder.parts_used)}` : '', detailOrder.labor_hours ? `工時：${display(detailOrder.labor_hours)}h` : ''].filter(Boolean).map(display).join('｜')}</p></div>}
          </div>
          {repairDetail.attachments.length > 0 && <section className="request-detail-section"><h3>附件</h3><div className="request-detail-attachments">{repairDetail.attachments.map((attachment, index) => { const url = String(attachment.signed_url || ''); const name = String(attachment.file_name || attachment.kind || `附件 ${index + 1}`); const isImage = ['photo', 'location_photo'].includes(String(attachment.kind || '')) || /\.(jpe?g|png|webp|heic)$/i.test(name); return url ? <a key={String(attachment.attach_id || index)} href={url} target="_blank" rel="noopener noreferrer" className={isImage ? 'is-image' : ''}>{isImage ? <img src={url} alt={name} /> : <>📎 {name}</>}</a> : <span key={String(attachment.attach_id || index)}>附件暫時無法開啟：{name}</span>; })}</div></section>}
          <section className="request-detail-section"><h3>處理歷程</h3>{repairDetail.logs.length ? <ol className="request-detail-timeline">{repairDetail.logs.map((log, index) => <li key={String(log.log_id || index)}><strong>{repairTimelineStatusLabel(log.to_status)}</strong>{Boolean(log.note) && <p>{display(log.note)}</p>}<small>{[log.operator_name ? display(log.operator_name) : '', display(log.created_at)].filter(Boolean).join(' · ')}</small></li>)}</ol> : <p className="request-detail-empty">尚無歷程</p>}</section>
        </div>}
      </section></div>}
      {showCreate && <div className="repair-create-backdrop" role="dialog" aria-modal="true" aria-labelledby="repair-create-title">
        <section className="repair-create-modal">
          <header className="repair-create-header"><h2 id="repair-create-title">＋ 新增報修</h2><button type="button" onClick={() => setShowCreate(false)} aria-label="關閉新增報修視窗">✕</button></header>
          <div className="repair-create-body">
            <div className="repair-filed-date">填表日期：<b>{taipeiToday()}</b></div>
            <div className="repair-form-row">
              <label className="repair-form-field">報修人<select value={form.reporter} onChange={e => setForm({ ...form, reporter: e.target.value })}><option value={reporterLabel}>{reporterLabel}</option></select></label>
              <label className="repair-form-field">聯絡電話<input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>
            </div>
            <div className="repair-form-row">
              <label className="repair-form-field">手機（必填）<input required value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} placeholder="請填手機號碼" /></label>
              <label className="repair-form-field">所屬單位<input list="repair-department-list" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} /><datalist id="repair-department-list">{departmentOptions.map(department => <option key={department} value={department} />)}</datalist></label>
            </div>
            <label className="repair-form-field">關聯設備（選填）<select value={form.equipment} onChange={e => { const equipmentId = e.target.value; const selected = equipmentOptions.find(item => item.equipment_id === equipmentId); setForm(current => ({ ...current, equipment: equipmentId, location: current.location.trim() || selected?.location || '' })); }}><option value="">-- 未指定設備 --</option>{equipmentOptions.map(item => <option key={item.equipment_id} value={item.equipment_id}>{item.asset_code ? `${item.asset_code}｜` : ''}{item.name}</option>)}</select></label>
            <label className="repair-form-field">故障位置<input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="請描述故障位置，例如：第一市場 2F 配電盤旁" /></label>
            <label className="repair-form-field">故障位置照片（必填，請上傳一張照片）<input required type="file" accept="image/*" onChange={e => setLocationPhoto(e.target.files?.[0] || null)} /></label>
            <label className="repair-form-field">故障類型<input list="repair-fault-type-list" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} placeholder="電氣／機械／漏水…" /><datalist id="repair-fault-type-list"><option value="電氣" /><option value="機械" /><option value="漏水" /><option value="異音" /><option value="停機" /><option value="其他" /></datalist></label>
            <label className="repair-form-field">故障描述<textarea required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="請描述故障狀況…" /></label>
            <label className="repair-form-field">希望完成日期<input type="date" value={form.desiredFinish} onChange={e => setForm({ ...form, desiredFinish: e.target.value })} /></label>
            <label className="repair-form-field">其他附件（照片／影片／PDF／Word／Excel，可多選）<input type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx" onChange={e => setAttachments(Array.from(e.target.files || []))} /></label>
            <div className={`repair-form-message ${formMessage ? 'show' : ''}`} role="status">{formMessage}</div>
            <button type="button" className="repair-submit-button" disabled={saving} onClick={createRepair}>{saving ? '送出中…' : '送出報修'}</button>
          </div>
        </section>
      </div>}
    </AppShell>;
  }
  return <AuthGate>{profile => <Workspace profile={profile} />}</AuthGate>;
}
