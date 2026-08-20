'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { LEGACY_BASE } from '@/lib/config';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { zhValue } from '@/lib/zh-tw';
import { PAGE_SIZE, Pager } from '@/components/admin/shared';
import { ComboboxSelect } from '@/components/ComboboxSelect';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { locationOptions, type LocationLike } from '@/lib/locations';
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
type DispatchTechnician = { user_id: string; name: string; department?: string | null };
type DispatchForm = { technician: string; vendor: string; expectedArrival: string; expectedFinish: string; workContent: string; needShutdown: boolean; needApproval: boolean };
type CompletionForm = { faultCause: string; handleMethod: string; partsUsed: string; materials: string; laborHours: string; partsCost: string; laborCost: string; note: string };
type RepairDetail = {
  request: Record<string, unknown>;
  order: Record<string, unknown> | null;
  attachments: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
  costs?: Array<Record<string, unknown>>;
};

// 綁在維修工單上的費用類型。完工回報只會產生這兩種，其餘（購置、委外）不會帶 order_id。
const ORDER_COST_LABELS: Record<string, string> = { parts: '零件', labor: '工資', outsource: '委外', other: '其他' };
const twd = (value: unknown) => Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 0 });

const EMPTY_FILTER_VALUE = '__empty__';
const REQUEST_COLUMNS = [
  { key: 'req_no', label: '報修單號' },
  { key: 'fault_type', label: '故障類型' },
  { key: 'department', label: '單位' },
  { key: 'status', label: '狀態' },
  { key: 'created_at', label: '報修時間' },
];
const DISPATCH_COLUMNS = [
  { key: 'req_no', label: '報修單號' },
  { key: 'fault_type', label: '故障類型' },
  { key: 'department', label: '單位' },
  { key: 'urgency', label: '急迫性' },
  { key: 'status', label: '狀態' },
  { key: 'assignee_name', label: '指派人員' },
];
const ORDER_COLUMNS = [
  { key: 'req_no', label: '報修單號' },
  { key: 'fault_type', label: '故障類型' },
  { key: 'department', label: '單位' },
  { key: 'assignee_name', label: '維修人員' },
  { key: 'status', label: '流程狀態' },
  { key: 'desired_finish', label: '希望完成' },
];
const REPAIR_PHOTO_ALLOWED_TYPES = /^image\/(jpeg|png|webp|heic)$/i;
const REPAIR_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
type WorkorderUploadSession = {
  request_snapshot: {
    request_id: string;
    req_no: string;
    source: string;
    reporter: string;
    phone: string | null;
    department: string | null;
    equipment_id: string | null;
    equipment_category: string | null;
    fault_location: string | null;
    fault_type: string | null;
    urgency: string;
    fault_desc: string;
    mobile: string | null;
    status: string;
    created_by: string;
  };
  uploads: {
    location: { path: string; token: string };
    equipment: { path: string; token: string };
  };
};

function taipeiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
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
  return ({ pending: '待主管派工', transferred: '待主管派工', assigned: '待工程師接單', in_progress: '維修中', waiting_parts: '等待料件', waiting_vendor: '等待廠商', pending_review: '待報修人驗收', completed: '待主管驗收', closed: '已結案', returned: '待重新派工', rejected: '待重新派工', cancelled: '已取消' } as Record<string, string>)[String(value)] || display(value);
}
function repairStatusClass(value: unknown): string {
  return ({ pending: 'pending', transferred: 'pending', assigned: 'assigned', accepted: 'assigned', in_progress: 'in-progress', waiting_parts: 'in-progress', waiting_vendor: 'in-progress', pending_review: 'review', completed: 'review', closed: 'closed', returned: 'pending', rejected: 'cancelled', cancelled: 'cancelled' } as Record<string, string>)[String(value)] || 'unknown';
}
function repairTimelineStatusLabel(value: unknown): string {
  return ({ pending: '報修人建立報修', transferred: '轉交主管派工', assigned: '主管完成派工', accepted: '工程師接單', in_progress: '工程師開始維修', waiting_parts: '等待料件', waiting_vendor: '等待廠商', pending_review: '工程師完工，待報修人驗收', reporter_accepted: '報修人驗收通過', completed: '報修人驗收通過，待主管驗收', supervisor_accepted: '主管驗收通過', closed: '主管驗收結案', returned: '退回重新派工', rejected: '工程師拒絕接單', cancelled: '案件已取消', overdue: '案件已逾期' } as Record<string, string>)[String(value)] || display(value);
}
function repairWorkflowStatusLabel(row: Record<string, unknown>, order?: Record<string, unknown> | null): string {
  const status = String(row.status || 'pending');
  const orderStatus = String(order?.status || row.order_status || '');
  if (status === 'assigned' && orderStatus === 'accepted') return '工程師已接單';
  return repairStatusLabel(status);
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
  return key === 'created_at' || key === 'desired_finish' ? raw.slice(0, 10) : raw;
}
function requestFilterLabel(key: string, value: string): string {
  if (value === EMPTY_FILTER_VALUE) return '未填寫';
  if (key === 'status') return repairStatusLabel(value);
  if (key === 'urgency') return ({ normal: '正常', high: '高', urgent: '緊急' } as Record<string, string>)[value] || zhValue(value);
  const label = key === 'created_at' ? value : display(value).replace(/\s+/g, ' ');
  return label.length > 32 ? label.slice(0, 32) + '…' : label;
}
function requestTimeLabel(value: unknown): string {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return display(value);
  const parts = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}/${part('month')}/${part('day')}`;
}
type RequestFilterCellProps = { column: { key: string; label: string }; statusFilter: string; columnFilters: Record<string, string>; columnFilterOptions: Record<string, Array<{ value: string; label: string }>>; setStatusFilter: (value: string) => void; setColumnFilters: (updater: any) => void };
function RequestFilterCell({ column, statusFilter, columnFilters, columnFilterOptions, setStatusFilter, setColumnFilters }: RequestFilterCellProps) {
  if (column.key === 'req_no' || column.key === 'assignee_id') return <th aria-label={column.key === 'req_no' ? '報修單號不提供篩選' : '不提供篩選'} />;
  const options = (columnFilterOptions[column.key] || []).filter(option => option.value !== EMPTY_FILTER_VALUE);
  const update = (value: string) => setColumnFilters((current: Record<string, string>) => ({ ...current, [column.key]: value }));

  if (column.key === 'created_at' || column.key === 'desired_finish') {
    // 原本是自己在 text／date 之間切換 type 的土炮寫法，一旦切成 date 且值為空，
    // 瀏覽器就會蓋上自己的格式提示，在繁中環境顯示成「yyyy/月/dd」這種中英混雜。
    // 一律改用 LocalizedDateInput：空值顯示「年/月/日」，聚焦才開原生日曆。
    return <th><LocalizedDateInput className='request-filter-date' value={columnFilters[column.key] || ''}
      onChange={(event: ChangeEvent<HTMLInputElement>) => update(event.target.value)}
      aria-label={column.key === 'created_at' ? '依報修時間篩選' : '依希望完成日期篩選'} /></th>;
  }

  const isStatus = column.key === 'status';
  const currentValue = isStatus ? statusFilter : (columnFilters[column.key] || '');
  let displayValue = currentValue;
  if (currentValue) {
    const matchedOption = options.find(o => o.value === currentValue);
    if (matchedOption) displayValue = matchedOption.label;
  }
  
  const onChange = (value: string) => {
    const rawMatch = options.find(o => o.label === value);
    const setVal = rawMatch ? rawMatch.value : value;
    isStatus ? setStatusFilter(setVal) : update(setVal);
  };

  const listId = 'request-' + column.key + '-filter-list'; 
  const placeholderText = column.key === 'fault_type' ? '全部故障類型' : column.key === 'department' ? '全部單位' : column.key === 'urgency' ? '全部急迫性' : column.key === 'status' ? '全部狀態' : column.key === 'assignee_name' ? '全部人員' : '全部';
  
  return <th><div className='request-filter-combobox'><input list={listId} value={displayValue} onChange={event => onChange(event.target.value)} placeholder={placeholderText} aria-label={'篩選' + zhValue(column.label)} /><span aria-hidden='true'>▾</span></div><datalist id={listId}>{options.map(option => <option key={option.value} value={option.label} />)}</datalist></th>;
}

export function ModuleWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  function Workspace({ profile }: { profile: Profile }) {
    const isRequestModule = system.key === 'workorder' && module.key === 'requests';
    const isDispatchModule = system.key === 'workorder' && module.key === 'dispatch';
    const isOrdersModule = system.key === 'workorder' && module.key === 'orders';
    const isRepairTableModule = isRequestModule || isDispatchModule || isOrdersModule;
    const normalizedRole = ({ admin: 'sysadmin', supervisor: 'unit_supervisor', maintenance: 'technician', inspector: 'reporter' } as Record<string, string>)[String(profile.rbac_role || profile.role || '')] || String(profile.rbac_role || profile.role || 'reporter');
    const canDispatch = ['sysadmin', 'unit_supervisor', 'mgmt_supervisor', 'dispatcher', 'duty'].includes(normalizedRole);
    const canSupervisorAccept = ['sysadmin', 'unit_supervisor', 'mgmt_supervisor'].includes(normalizedRole);
    const reporterLabel = [profile.department, profile.name].filter(Boolean).join(' / ');
    const [profileContact, setProfileContact] = useState({ phone: '', department: profile.department || '' });
    const emptyRepairForm = () => ({ reporter: reporterLabel, phone: profileContact.phone, mobile: '', department: profileContact.department, equipment: '', location: '', locationId: '', type: '', urgency: 'normal', description: '' });
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
    // 綁定場域位置後這筆報修才會進入位置分析的彙總；fault_location 只是現場自由描述。
    const [locationChoices, setLocationChoices] = useState<LocationLike[]>([]);
    const [locationPhoto, setLocationPhoto] = useState<File | null>(null);
    const [equipmentPhoto, setEquipmentPhoto] = useState<File | null>(null);
    const [formMessage, setFormMessage] = useState('');
    const [dispatchTechnicians, setDispatchTechnicians] = useState<DispatchTechnician[]>([]);
    const [dispatchForm, setDispatchForm] = useState<DispatchForm>({ technician: '', vendor: '', expectedArrival: '', expectedFinish: '', workContent: '', needShutdown: false, needApproval: false });
    const [showDispatchForm, setShowDispatchForm] = useState(false);
    const [completionForm, setCompletionForm] = useState<CompletionForm>({ faultCause: '', handleMethod: '', partsUsed: '', materials: '', laborHours: '', partsCost: '', laborCost: '', note: '' });
    const [showCompletionForm, setShowCompletionForm] = useState(false);
    const [dispatchSaving, setDispatchSaving] = useState(false);
    const [dispatchMessage, setDispatchMessage] = useState('');
    const nextRepairAction = (row: Record<string, unknown>): string => {
      const status = String(row.status || 'pending');
      const orderStatus = String(row.order_status || '');
      if (!row.order_id && !['closed', 'cancelled'].includes(status)) return status === 'pending' ? '派工' : '補建派工';
      if (['pending', 'transferred', 'returned', 'rejected'].includes(status)) return '派工';
      if (status === 'assigned' && orderStatus === 'accepted') return '開始維修';
      if (status === 'assigned') return '接單';
      if (status === 'in_progress') return '完工';
      if (status === 'pending_review') return '報修人驗收';
      if (status === 'completed') return '主管驗收';
      return '檢視';
    };
    const startDispatch = () => {
      if (!canDispatch) { setDispatchMessage('僅限主管或派工管理人員派工'); return; }
      const current = repairDetail?.request || selectedRow || {};
      setDispatchForm({ technician: String(current.assignee_id || ''), vendor: '', expectedArrival: '', expectedFinish: '', workContent: '', needShutdown: false, needApproval: false });
      setDispatchMessage('');
      setShowDispatchForm(true);
    };

    const runRepairWorkflow = async (row: Record<string, unknown>, action: string, nextStatus: string, payload: Record<string, unknown> = {}) => {
      const requestId = String(row.request_id || row.id || '');
      if (!requestId) { setDispatchMessage('案件缺少報修單編號'); return; }
      setDispatchSaving(true);
      setDispatchMessage('');
      try {
        await invokeAppApi('workorder_workflow', { request_id: requestId, workflow_action: action, payload });
        await load();
        void openRepairDetail({ ...row, request_id: requestId, status: nextStatus });
      } catch (caught) {
        setDispatchMessage(caught instanceof Error ? `流程更新失敗：${caught.message}` : '流程更新失敗');
      } finally {
        setDispatchSaving(false);
      }
    };
    const dispatchRepair = async () => {
      const current = repairDetail?.request || selectedRow || {};
      const requestId = String(current.request_id || current.id || '');
      const technician = dispatchForm.technician.trim();
      const vendor = dispatchForm.vendor.trim();
      if (!canDispatch) { setDispatchMessage('僅限主管或派工管理人員派工'); return; }
      if (!requestId) { setDispatchMessage('案件缺少報修單編號'); return; }
      if (!technician && !vendor) { setDispatchMessage('請選擇維修人員或填寫委外廠商'); return; }
      const toIso = (value: string) => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); };
      setDispatchSaving(true);
      setDispatchMessage('');
      try {
        await invokeAppApi('workorder_workflow', {
          request_id: requestId,
          workflow_action: 'dispatch',
          payload: {
            technician: technician || null,
            vendor: vendor || null,
            expected_arrival: toIso(dispatchForm.expectedArrival),
            expected_finish: toIso(dispatchForm.expectedFinish),
            work_content: dispatchForm.workContent.trim() || null,
            need_shutdown: dispatchForm.needShutdown,
            need_approval: dispatchForm.needApproval,
          },
        });
        setShowDispatchForm(false);
        setDispatchForm({ technician: '', vendor: '', expectedArrival: '', expectedFinish: '', workContent: '', needShutdown: false, needApproval: false });
        await load();
        void openRepairDetail({ ...current, request_id: requestId, status: 'assigned' });
      } catch (caught) {
        setDispatchMessage(caught instanceof Error ? `派工失敗：${caught.message}` : '派工失敗');
      } finally {
        setDispatchSaving(false);
      }
    };
    const openCompletionForm = () => {
      const order = repairDetail?.order;
      setCompletionForm({
        faultCause: String(order?.fault_cause || ''),
        handleMethod: String(order?.handle_method || order?.result_desc || ''),
        partsUsed: String(order?.parts_used || ''),
        materials: String(order?.materials || ''),
        laborHours: order?.labor_hours == null ? '' : String(order.labor_hours),
        partsCost: '', laborCost: '',
        note: String(order?.note || ''),
      });
      setDispatchMessage('');
      setShowCompletionForm(true);
    };

    const completeRepair = async () => {
      const current = repairDetail?.request;
      const requestId = String(current?.request_id || '');
      if (!requestId || !repairDetail?.order?.order_id) { setDispatchMessage('找不到報修案件或維修工單'); return; }
      if (!completionForm.faultCause.trim()) { setDispatchMessage('請填寫故障原因'); return; }
      if (!completionForm.handleMethod.trim()) { setDispatchMessage('請填寫處理方式'); return; }
      const laborHours = completionForm.laborHours.trim() ? Number(completionForm.laborHours) : null;
      // 費用填了才送；金額直接介接費用系統，會產生綁設備的費用紀錄。
      const money = (raw: string) => (raw.trim() ? Number(raw) : null);
      const partsCost = money(completionForm.partsCost), laborCost = money(completionForm.laborCost);
      for (const [label, value] of [['零件費用', partsCost], ['工資費用', laborCost]] as const) {
        if (value !== null && (!Number.isFinite(value) || value < 0)) { setDispatchMessage(`${label}必須是零以上的數字`); return; }
      }
      if (laborHours != null && (!Number.isFinite(laborHours) || laborHours < 0)) { setDispatchMessage('工時必須是零以上的數字'); return; }
      setDispatchSaving(true);
      setDispatchMessage('');
      try {
        await invokeAppApi('workorder_workflow', {
          request_id: requestId,
          workflow_action: 'engineer_complete',
          payload: {
            fault_cause: completionForm.faultCause.trim(),
            handle_method: completionForm.handleMethod.trim(),
            parts_used: completionForm.partsUsed.trim() || null,
            materials: completionForm.materials.trim() || null,
            labor_hours: laborHours,
            parts_cost: partsCost,
            labor_cost: laborCost,
            note: completionForm.note.trim() || null,
          },
        });
        setShowCompletionForm(false);
        await load();
        void openRepairDetail({ ...current, status: 'pending_review' });
      } catch (caught) {
        setDispatchMessage(caught instanceof Error ? `完工回報失敗：${caught.message}` : '完工回報失敗');
      } finally {
        setDispatchSaving(false);
      }
    };
    const acceptByReporter = async () => {
      const current = repairDetail?.request;
      const requestId = String(current?.request_id || '');
      if (!current || !requestId || String(current.status) !== 'pending_review') return;
      const isOwner = String(current.created_by || '') === profile.user_id;
      if (!isOwner && normalizedRole !== 'sysadmin') { setDispatchMessage('僅限原報修人進行本階段驗收'); return; }
      await runRepairWorkflow(current, 'reporter_accept', 'completed');
    };
    const acceptBySupervisor = async () => {
      const current = repairDetail?.request;
      if (!current || String(current.status) !== 'completed') return;
      if (!canSupervisorAccept) { setDispatchMessage('僅限主管進行最終驗收'); return; }
      await runRepairWorkflow(current, 'supervisor_accept', 'closed');
    };
    const closeRepairDetail = () => {
      detailRequestSeq.current += 1;
      setSelectedRow(null);
      setRepairDetail(null);
      setDetailError('');
      setDetailLoading(false);
      setShowDispatchForm(false);
      setShowCompletionForm(false);
      setDispatchMessage('');
    };

    const openRepairDetail = async (row: Record<string, unknown>) => {
      const seq = ++detailRequestSeq.current;
      setSelectedRow(row);
      setRepairDetail(null);
      setDetailError('');
      setDetailLoading(true);
      setShowDispatchForm(false);
      setShowCompletionForm(false);
      setDispatchMessage('');
      try {
        const requestId = String(row.request_id || row.id || '');
        const requestNo = String(row.req_no || '');
        if (!requestId && !requestNo) throw new Error('找不到報修案件識別碼');
        const detail = await invokeAppApi<RepairDetail & { warnings?: string[] }>('workorder_detail', {
          request_id: requestId || undefined,
          req_no: requestNo || undefined,
        });
        if (seq !== detailRequestSeq.current) return;
        setRepairDetail(detail);
        if (detail.warnings?.length) setDetailError(`部分關聯資料無法載入：${detail.warnings.join('；')}`);
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
        if (isRepairTableModule) {
          const workorderData = await invokeAppApi<Omit<ModuleData, 'columns'>>('workorder_list', { module: module.key });
          const repairRows = workorderData.rows || [];
          setData({ ...workorderData, columns: isDispatchModule ? DISPATCH_COLUMNS : isOrdersModule ? ORDER_COLUMNS : REQUEST_COLUMNS, rows: repairRows });
        } else {
          const moduleData = await invokeAppApi<ModuleData>('module_data', { system: system.key, module: module.key });
          setData(moduleData);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '資料讀取失敗');
      } finally {
        setSyncing(false);
      }
    }, [isDispatchModule, isOrdersModule, isRepairTableModule, module.key, system.key]);

    useEffect(() => { load(); }, [load]);
    useEffect(() => {
      if (!isRepairTableModule) return;
      let active = true;
      void invokeAppApi<{
        technicians: DispatchTechnician[];
        equipment: RepairEquipmentOption[];
        departments: string[];
        locations: LocationLike[];
        contact: { phone: string; department: string };
      }>('workorder_options').then(result => {
        if (!active) return;
        setDispatchTechnicians(result.technicians || []);
        if (isRequestModule) {
          setEquipmentOptions(result.equipment || []);
          setDepartmentOptions(result.departments || []);
          setLocationChoices(result.locations || []);
          const contact = result.contact || { phone: '', department: profile.department || '' };
          setProfileContact(contact);
          setForm(current => ({ ...current, phone: current.phone || contact.phone, department: current.department || contact.department }));
        }
      }).catch(caught => { if (active) setError(caught instanceof Error ? caught.message : '維修選項載入失敗'); });
      return () => { active = false; };
    }, [isRepairTableModule, isRequestModule, profile.department]);
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
        const rowStatus = String(row.status || '');
        const matchesColumns = Object.entries(columnFilters).every(([key, value]) => {
          if (!value) return true;
          const raw = requestFilterValue(key, row[key]);
          if (key === 'created_at' || key === 'desired_finish') return raw === value;
          const lbl = requestFilterLabel(key, raw);
          return raw.toLocaleLowerCase().includes(value.toLocaleLowerCase()) || lbl.toLocaleLowerCase().includes(value.toLocaleLowerCase());
        });
        const mappedStatusFilter = statusFilter === '待主管派工' ? 'pending' : statusFilter === '待接單' ? 'assigned' : statusFilter === '維修中' ? 'in_progress' : statusFilter === '待報修人驗收' ? 'pending_review' : statusFilter === '待主管驗收' ? 'completed' : statusFilter === '已結案' ? 'closed' : statusFilter === '退回' ? 'returned' : statusFilter;
        const statusMatches = !mappedStatusFilter || (mappedStatusFilter === 'pending' ? ['pending', 'transferred'].includes(rowStatus) : mappedStatusFilter === 'returned' ? ['returned', 'rejected'].includes(rowStatus) : rowStatus === mappedStatusFilter || repairWorkflowStatusLabel(row) === mappedStatusFilter || repairStatusLabel(rowStatus) === mappedStatusFilter);
        const hideClosedByDefault = isRepairTableModule && !mappedStatusFilter && rowStatus === 'closed';
        return !hideClosedByDefault && matchesColumns && statusMatches && (!needle || Object.values(row).some(val => display(val).toLowerCase().includes(needle)));
      });
    }, [columnFilters, data, isRepairTableModule, query, statusFilter]);
    const columnFilterOptions = useMemo(() => {
      const options: Record<string, Array<{ value: string; label: string }>> = {};
      for (const column of data?.columns || []) {
        const unique = new Map<string, string>();
        for (const row of data?.rows || []) {
          const rawValue = requestFilterValue(column.key, row[column.key]);
          const value = column.key === 'status' && rawValue === 'transferred' ? 'pending' : column.key === 'status' && rawValue === 'rejected' ? 'returned' : rawValue;
          if (!unique.has(value)) unique.set(value, requestFilterLabel(column.key, value));
        }
        options[column.key] = [...unique].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'));
      }
      return options;
    }, [data]);
    const totalPages = isRepairTableModule ? Math.max(1, Math.ceil(rows.length / PAGE_SIZE)) : 1;
    const visibleRows = isRepairTableModule ? rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : rows;

    useEffect(() => { setPage(1); }, [columnFilters, query, statusFilter]);
    useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

    const createRepair = async () => {
      if (!form.mobile.trim()) { setFormMessage('請填寫手機號碼'); return; }
      if (!locationPhoto) { setFormMessage('請上傳一張故障位置照片'); return; }
      if (!equipmentPhoto) { setFormMessage('請上傳一張維修設備照片'); return; }
      if (!form.description.trim()) { setFormMessage('請填寫故障描述'); return; }
      const invalidFile = [locationPhoto, equipmentPhoto].find(file => file.size > REPAIR_PHOTO_MAX_BYTES || !REPAIR_PHOTO_ALLOWED_TYPES.test(file.type || ''));
      if (invalidFile) { setFormMessage(`照片不符合限制：${invalidFile.name}（僅接受 JPEG／PNG／WebP／HEIC，單檔 10MB）`); return; }
      setSaving(true); setFormMessage('送出中…');
      try {
        const client = getSupabase();
        const faultDesc = [form.location.trim() ? `故障位置：${form.location.trim()}` : '', form.mobile.trim() ? `聯絡手機：${form.mobile.trim()}` : '', `故障描述：${form.description.trim()}`].filter(Boolean).join('\n');
        const selectedEquipment = equipmentOptions.find(item => item.equipment_id === form.equipment);
        const uploadSession = await invokeAppApi<WorkorderUploadSession>('workorder_prepare_upload', {
          request: {
            reporter: form.reporter.trim() || profile.name,
            phone: form.phone.trim() || null,
            department: form.department.trim() || profile.department || null,
            equipment_id: form.equipment || null,
            equipment_category: selectedEquipment?.category || null,
            fault_location: form.location.trim() || null,
            location_id: form.locationId || null,
            fault_type: form.type.trim() || null,
            urgency: form.urgency,
            fault_desc: faultDesc,
            mobile: form.mobile.trim() || null,
          },
          location_photo: {
            name: locationPhoto.name,
            type: locationPhoto.type || 'image/jpeg',
            size: locationPhoto.size,
          },
          equipment_photo: {
            name: equipmentPhoto.name,
            type: equipmentPhoto.type || 'image/jpeg',
            size: equipmentPhoto.size,
          },
        });
        const uploadTargets = [uploadSession.uploads.location.path, uploadSession.uploads.equipment.path];
        try {
          const [locationUpload, equipmentUpload] = await Promise.all([
            client.storage.from('repair-files').uploadToSignedUrl(
              uploadSession.uploads.location.path,
              uploadSession.uploads.location.token,
              locationPhoto,
              { upsert: true, contentType: locationPhoto.type || 'image/jpeg' },
            ),
            client.storage.from('repair-files').uploadToSignedUrl(
              uploadSession.uploads.equipment.path,
              uploadSession.uploads.equipment.token,
              equipmentPhoto,
              { upsert: true, contentType: equipmentPhoto.type || 'image/jpeg' },
            ),
          ]);
          if (locationUpload.error) throw new Error(`故障位置照片上傳失敗：${locationUpload.error.message}`);
          if (equipmentUpload.error) throw new Error(`維修設備照片上傳失敗：${equipmentUpload.error.message}`);
        } catch (uploadError) {
          await client.storage.from('repair-files').remove(uploadTargets).catch(() => null);
          throw uploadError;
        }
        const { request_id: requestId, req_no: reqNo } = uploadSession.request_snapshot;
        await invokeAppApi('workorder_create_request', {
          request: {
            request_id: requestId,
            req_no: reqNo,
            reporter: form.reporter.trim() || profile.name,
            phone: form.phone.trim() || null,
            department: form.department.trim() || profile.department || null,
            equipment_id: form.equipment || null,
            equipment_category: selectedEquipment?.category || null,
            fault_location: form.location.trim() || null,
            location_id: form.locationId || null,
            fault_type: form.type.trim() || null,
            urgency: form.urgency,
            fault_desc: faultDesc,
            mobile: form.mobile.trim() || null,
          },
          location_file_path: uploadSession.uploads.location.path,
          equipment_file_path: uploadSession.uploads.equipment.path,
          location_file_name: locationPhoto.name,
          equipment_file_name: equipmentPhoto.name,
        });
        setForm(emptyRepairForm());
        setLocationPhoto(null); setEquipmentPhoto(null);
        setShowCreate(false); setFormMessage(''); await load();
      } catch (caught) { setFormMessage(caught instanceof Error ? `送出失敗：${caught.message}` : '送出失敗，請稍後再試'); }
      finally { setSaving(false); }
    };

    const detailRequest = repairDetail?.request || selectedRow;
    const detailEquipment = recordValue(detailRequest?.equipment);
    const detailOrder = repairDetail?.order;
    const detailAssignee = recordValue(detailOrder?.users);
    const detailStatus = String(detailRequest?.status || 'pending');
    const detailOrderStatus = String(detailOrder?.status || '');
    // 完工回報寫入的費用，接在「工程師完工」那則歷程底下。金額為 0 或留白時不會有
    // 紀錄，這裡自然就不顯示——沒填費用和填了 0 元在畫面上是同一件事。
    const orderCostSummary = (() => {
      const items = (repairDetail?.costs || []).filter(row => Number(row.amount || 0) > 0);
      if (!items.length) return '';
      const parts = items.map(row => `${ORDER_COST_LABELS[String(row.cost_type)] || display(row.cost_type)} ${twd(row.amount)} 元`);
      const total = items.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      return items.length > 1
        ? `維修費用：${parts.join('｜')}（合計 ${twd(total)} 元）`
        : `維修費用：${parts[0]}`;
    })();
    const canEngineerAct = normalizedRole === 'sysadmin' || (normalizedRole === 'technician' && String(detailOrder?.assignee_id || '') === profile.user_id);
    const canReporterAccept = normalizedRole === 'sysadmin' || String(detailRequest?.created_by || '') === profile.user_id;
    const workflowSteps = ['報修', '主管派工', '工程師接單', '完工', '報修人驗收', '主管驗收'];
    const workflowIndex = detailStatus === 'closed' ? 5 : detailStatus === 'completed' ? 5 : detailStatus === 'pending_review' ? 4 : detailStatus === 'in_progress' ? 3 : detailStatus === 'assigned' && detailOrderStatus === 'accepted' ? 3 : detailStatus === 'assigned' ? 2 : 1;

    return <AppShell profile={profile} title={module.title}>
      <div className="page-actions">
        <div><p>{module.description}</p>{error && <span className="inline-message danger">{error}</span>}</div>
        {!isRepairTableModule && <div className="action-cluster">
          {module.legacy && <a className="secondary-btn" href={`${LEGACY_BASE}/${module.legacy}`}>專業圖臺／進階作業</a>}
          <button className="primary-btn compact" onClick={load} disabled={syncing}>{syncing ? '同步中…' : '重新同步'}</button>
        </div>}
      </div>
      <div className="realtime-state"><i /> 已啟用資料庫即時更新；存取仍受帳號角色與資料列權限保護。</div>
      {data?.summary && (
        <section className="mini-metrics">
          {/* 圖卡內容一律由後端的 repairRequestSummary 決定，前端不再自行插卡——
              先前這裡額外插了一張「急迫性案件」，維修系統入口沒有，兩頁因此對不起來。 */}
          {data.summary.map(item => (
            <article key={item.label} data-label={item.label}>
              <span>{zhValue(item.label)}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </section>
      )}
      <section className={`panel table-panel ${isRequestModule ? 'request-v1-table' : isDispatchModule ? 'dispatch-v1-table' : ''}`}>
        <div className="panel-head"><h2>{data?.title || module.title}</h2><div className="table-tools"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋 報修單號／故障類型／單位…" /><span>{rows.length} 筆</span>{isRequestModule && <button className="repair-add-button" onClick={() => { setForm(emptyRepairForm()); setLocationPhoto(null); setEquipmentPhoto(null); setFormMessage(''); setShowCreate(true); }}>＋ 新增報修</button>}</div></div>
        {isRequestModule && <div className="request-status-chips">
          <button data-status="all" className={!statusFilter ? 'active' : ''} onClick={() => setStatusFilter('')}>全部 <b>{data?.rows.filter(row => row.status !== 'closed').length || 0}</b></button>
          <button data-status="pending" className={statusFilter === 'pending' ? 'active' : ''} onClick={() => setStatusFilter('pending')}>待主管派工 <b>{data?.rows.filter(row => ['pending', 'transferred'].includes(String(row.status))).length || 0}</b></button>
          <button data-status="assigned" className={statusFilter === 'assigned' ? 'active' : ''} onClick={() => setStatusFilter('assigned')}>待接單 <b>{data?.rows.filter(row => row.status === 'assigned').length || 0}</b></button>
          <button data-status="in_progress" className={statusFilter === 'in_progress' ? 'active' : ''} onClick={() => setStatusFilter('in_progress')}>維修中 <b>{data?.rows.filter(row => row.status === 'in_progress').length || 0}</b></button>
          <button data-status="pending_review" className={statusFilter === 'pending_review' ? 'active' : ''} onClick={() => setStatusFilter('pending_review')}>待報修人驗收 <b>{data?.rows.filter(row => row.status === 'pending_review').length || 0}</b></button>
          <button data-status="completed" className={statusFilter === 'completed' ? 'active' : ''} onClick={() => setStatusFilter('completed')}>待主管驗收 <b>{data?.rows.filter(row => row.status === 'completed').length || 0}</b></button>
          <button data-status="closed" className={statusFilter === 'closed' ? 'active' : ''} onClick={() => setStatusFilter('closed')}>已結案 <b>{data?.rows.filter(row => row.status === 'closed').length || 0}</b></button>
        </div>}        {!data && !error ? <div className="loading-panel">正在透過安全服務載入資料…</div> : <>
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  {data?.columns.map(column => <th key={column.key}>{zhValue(column.label)}</th>)}
                  {isDispatchModule && <th>派工</th>}
                  {isOrdersModule && <th>處理</th>}
                  {isRequestModule && <th>檢視</th>}
                </tr>
                {isRepairTableModule && <tr className="request-column-filters">
                  {data?.columns.map(column => <RequestFilterCell key={column.key} column={column} statusFilter={statusFilter} columnFilters={columnFilters} columnFilterOptions={columnFilterOptions} setStatusFilter={setStatusFilter} setColumnFilters={setColumnFilters} />)}
                  <th><button type="button" className="request-filter-clear" onClick={() => { setColumnFilters({}); setStatusFilter(''); }} disabled={!statusFilter && !Object.values(columnFilters).some(Boolean)}>清除</button></th>
                </tr>}
              </thead>
              <tbody>{visibleRows.map((row, index) => {
                const action = nextRepairAction(row);
                return <tr key={String(row.id || row.request_id || row.record_id || row.user_id || index)} onClick={() => { if (isRepairTableModule) void openRepairDetail(row); }}>
                  {data?.columns.map(column => <td key={column.key}>{column.key === 'status'
                    ? <span className={`status-pill ${repairStatusClass(row[column.key])}`}>{repairWorkflowStatusLabel(row)}</span>
                    : column.key === 'created_at' ? requestTimeLabel(row[column.key])
                    : column.key === 'desired_finish' ? repairDate(row[column.key])
                    : column.key === 'urgency' ? requestFilterLabel('urgency', String(row[column.key] || ''))
                    : display(row[column.key])}</td>)}
                  {(isDispatchModule || isOrdersModule) && <td><button className="secondary-btn" onClick={event => { event.stopPropagation(); void openRepairDetail(row); }}>{action}</button></td>}
                  {isRequestModule && <td className="request-view-link">檢視 ›</td>}
                </tr>;
              })}</tbody>
            </table>
            {data && rows.length === 0 && <p className="empty">查無資料</p>}
          </div>
          {isRepairTableModule && rows.length > 0 && <Pager page={page} total={rows.length} onPage={setPage} />}
        </>}
      </section>
      {selectedRow && detailRequest && <div className="request-detail-backdrop" role="dialog" aria-modal="true" aria-labelledby="repair-detail-title"><section className="request-detail-modal">
        <header><h2 id="repair-detail-title"><b>{display(detailRequest.req_no)}</b><span className={`status-pill ${repairStatusClass(detailRequest.status)}`}>{repairWorkflowStatusLabel(detailRequest, detailOrder)}</span></h2><button type="button" onClick={closeRepairDetail} aria-label="關閉案件詳情">×</button></header>
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
          {repairDetail.attachments.length > 0 && <section className="request-detail-section"><h3>附件</h3><div className="request-detail-attachments">{repairDetail.attachments.map((attachment, index) => { const url = String(attachment.signed_url || ''); const name = String(attachment.file_name || attachment.kind || `附件 ${index + 1}`); const isImage = ['photo', 'location_photo', 'equipment_photo'].includes(String(attachment.kind || '')) || /\.(jpe?g|png|webp|heic)$/i.test(name); return url ? <a key={String(attachment.attach_id || index)} href={url} target="_blank" rel="noopener noreferrer" className={isImage ? 'is-image' : ''}>{isImage ? <img src={url} alt={name} /> : <>📎 {name}</>}</a> : <span key={String(attachment.attach_id || index)}>附件暫時無法開啟：{name}</span>; })}</div></section>}
          <section className="request-detail-section"><h3>處理歷程</h3>{repairDetail.logs.length ? <ol className="request-detail-timeline">{repairDetail.logs.map((log, index) => <li key={String(log.log_id || index)}><strong>{repairTimelineStatusLabel(log.to_status)}</strong>{Boolean(log.note) && <p>{display(log.note)}</p>}{String(log.to_status) === 'pending_review' && orderCostSummary && <p className="repair-cost-note">{orderCostSummary}</p>}<small>{[log.operator_name ? display(log.operator_name) : '', display(log.created_at)].filter(Boolean).join(' · ')}</small></li>)}</ol> : <p className="request-detail-empty">尚無歷程</p>}</section>
          {isRepairTableModule && !detailLoading && <section className="request-detail-section request-dispatch-actions">
            <h3>維修流程</h3>
            <ol className="repair-workflow-steps">
              {workflowSteps.map((step, index) => <li key={step} className={index < workflowIndex || detailStatus === 'closed' ? 'done' : index === workflowIndex ? 'current' : ''}><span>{index + 1}</span><b>{step}</b></li>)}
            </ol>
            <h3>流程操作</h3>
            {showDispatchForm ? <form className="dispatch-detail-form" onSubmit={event => { event.preventDefault(); void dispatchRepair(); }}>
              <div className="dispatch-detail-form-grid">
                <label><span>維修人員</span><select value={dispatchForm.technician} onChange={event => setDispatchForm(current => ({ ...current, technician: event.target.value }))}><option value="">-- 請選擇 --</option>{dispatchTechnicians.map(item => <option key={item.user_id} value={item.user_id}>{item.name}{item.department ? `（${item.department}）` : ''}</option>)}</select></label>
                <label><span>委外廠商</span><input value={dispatchForm.vendor} onChange={event => setDispatchForm(current => ({ ...current, vendor: event.target.value }))} /></label>
                <label><span>預計到場</span><input type="datetime-local" step="1800" aria-label="預計到場（年/月/日 上午/下午 時 分）" value={dispatchForm.expectedArrival} onChange={event => setDispatchForm(current => ({ ...current, expectedArrival: event.target.value }))} /></label>
                <label><span>預計完成</span><input type="datetime-local" step="1800" aria-label="預計完成（年/月/日 上午/下午 時 分）" value={dispatchForm.expectedFinish} onChange={event => setDispatchForm(current => ({ ...current, expectedFinish: event.target.value }))} /></label>
                <label className="wide"><span>工作內容</span><textarea value={dispatchForm.workContent} onChange={event => setDispatchForm(current => ({ ...current, workContent: event.target.value }))} /></label>
                <label className="dispatch-check"><input type="checkbox" checked={dispatchForm.needShutdown} onChange={event => setDispatchForm(current => ({ ...current, needShutdown: event.target.checked }))} />需要停機</label>
                <label className="dispatch-check"><input type="checkbox" checked={dispatchForm.needApproval} onChange={event => setDispatchForm(current => ({ ...current, needApproval: event.target.checked }))} />需要主管核准</label>
              </div>
              <div className="dispatch-detail-form-actions"><button type="button" className="secondary-btn" onClick={() => setShowDispatchForm(false)}>取消</button><button type="submit" className="dispatch-assign-button" disabled={dispatchSaving}>{dispatchSaving ? '送出中…' : '確認派工'}</button></div>
            </form> : showCompletionForm ? <form className="dispatch-detail-form" onSubmit={event => { event.preventDefault(); void completeRepair(); }}>
              <div className="dispatch-detail-form-grid">
                <label><span>故障原因（必填）</span><textarea value={completionForm.faultCause} onChange={event => setCompletionForm(current => ({ ...current, faultCause: event.target.value }))} /></label>
                <label><span>處理方式（必填）</span><textarea value={completionForm.handleMethod} onChange={event => setCompletionForm(current => ({ ...current, handleMethod: event.target.value }))} /></label>
                <label><span>更換零件</span><input value={completionForm.partsUsed} onChange={event => setCompletionForm(current => ({ ...current, partsUsed: event.target.value }))} /></label>
                <label><span>使用材料</span><input value={completionForm.materials} onChange={event => setCompletionForm(current => ({ ...current, materials: event.target.value }))} /></label>
                <label><span>工時（小時）</span><input type="number" min="0" step="0.5" value={completionForm.laborHours} onChange={event => setCompletionForm(current => ({ ...current, laborHours: event.target.value }))} /></label>
                <label><span>零件費用（元）</span><input type="number" min="0" step="1" value={completionForm.partsCost} onChange={event => setCompletionForm(current => ({ ...current, partsCost: event.target.value }))} /></label>
                <label><span>工資費用（元）</span><input type="number" min="0" step="1" value={completionForm.laborCost} onChange={event => setCompletionForm(current => ({ ...current, laborCost: event.target.value }))} /></label>
                <label><span>完工備註</span><input value={completionForm.note} onChange={event => setCompletionForm(current => ({ ...current, note: event.target.value }))} /></label>
              </div>
              <div className="dispatch-detail-form-actions"><button type="button" className="secondary-btn" onClick={() => setShowCompletionForm(false)}>取消</button><button type="submit" className="dispatch-assign-button" disabled={dispatchSaving}>{dispatchSaving ? '送出中…' : '送出完工'}</button></div>
            </form> : <div className="dispatch-detail-actions">
              {(!detailOrder || ['pending', 'transferred', 'returned', 'rejected'].includes(detailStatus)) && canDispatch && !['closed', 'cancelled'].includes(detailStatus) && <button type="button" className="dispatch-assign-button" onClick={startDispatch}>{detailOrder ? '主管派工' : detailStatus === 'pending' ? '主管派工' : '建立／補建派工'}</button>}
              {detailStatus === 'assigned' && detailOrderStatus === 'assigned' && canEngineerAct && <button type="button" className="dispatch-step-button" onClick={() => void runRepairWorkflow(detailRequest, 'engineer_accept', 'assigned')}>工程師接單</button>}
              {detailStatus === 'assigned' && detailOrderStatus === 'accepted' && canEngineerAct && <button type="button" className="dispatch-step-button" onClick={() => void runRepairWorkflow(detailRequest, 'engineer_start', 'in_progress')}>開始維修</button>}
              {/* 完工的前置條件是「報修單與工單都在維修中」（apply_repair_workflow 的
                  engineer_complete 分支）。這裡原本只看報修單狀態，於是工單停在
                  accepted／waiting_vendor 時按鈕照樣出現，按下去必定失敗並回一句
                  「案件尚未進入維修中」——按鈕給按卻永遠不可能成功。 */}
              {detailStatus === 'in_progress' && detailOrderStatus === 'in_progress' && canEngineerAct && <button type="button" className="dispatch-step-button" onClick={openCompletionForm}>完工回報</button>}
              {detailStatus === 'in_progress' && detailOrderStatus !== 'in_progress' && Boolean(detailOrder) && canEngineerAct && <p className="workflow-waiting">
                工單目前是「{repairTimelineStatusLabel(detailOrderStatus)}」，尚未進入維修中，還不能回報完工。
              </p>}
              {detailStatus === 'pending_review' && canReporterAccept && <button type="button" className="dispatch-step-button" disabled={dispatchSaving} onClick={() => void acceptByReporter()}>報修人驗收通過</button>}
              {detailStatus === 'completed' && canSupervisorAccept && <button type="button" className="dispatch-step-button" disabled={dispatchSaving} onClick={() => void acceptBySupervisor()}>主管驗收並結案</button>}
              {!detailOrder && !canDispatch && !['closed', 'cancelled'].includes(detailStatus) && <p className="workflow-waiting">尚未建立維修工單，等待主管派工。</p>}
              {Boolean(detailOrder) && ['pending', 'transferred', 'returned', 'rejected'].includes(detailStatus) && !canDispatch && <p className="workflow-waiting">等待主管派工。</p>}
              {detailStatus === 'assigned' && !canEngineerAct && <p className="workflow-waiting">等待已指派工程師接單或開始維修。</p>}
              {detailStatus === 'in_progress' && !canEngineerAct && <p className="workflow-waiting">等待已指派工程師完成維修回報。</p>}
              {detailStatus === 'pending_review' && !canReporterAccept && <p className="workflow-waiting">等待原報修人驗收。</p>}
              {detailStatus === 'completed' && !canSupervisorAccept && <p className="workflow-waiting">報修人已驗收，等待主管最終驗收。</p>}
              {detailStatus === 'closed' && <p className="workflow-finished">主管驗收完成，案件已結案。</p>}
              {canDispatch && !['pending_review', 'completed', 'closed', 'cancelled'].includes(detailStatus) && <button type="button" className="dispatch-cancel-button" onClick={() => void runRepairWorkflow(detailRequest, 'cancel', 'cancelled')}>取消案件</button>}
            </div>}
            {dispatchMessage && <p className="dispatch-detail-message" role="alert">{dispatchMessage}</p>}
          </section>}
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
            <label className="repair-form-field">關聯設備（選填）<select value={form.equipment} onChange={e => { const equipmentId = e.target.value; const selected = equipmentOptions.find(item => item.equipment_id === equipmentId); setForm(current => ({ ...current, equipment: equipmentId, location: current.location.trim() || selected?.location || '' })); }}><option value="">-- 未指定設備 --</option>{equipmentOptions.map(item => <option key={item.equipment_id} value={item.equipment_id}>{item.asset_code ? `${item.asset_code}｜` : ''}{item.name}</option>)}</select></label><label className="repair-form-field">場域位置（選填，供位置統計）<ComboboxSelect value={form.locationId} onChange={value => setForm(current => ({ ...current, locationId: value }))} options={locationOptions(locationChoices)} placeholder="輸入可篩選，留白代表不綁定" ariaLabel="場域位置" /></label>
            <label className="repair-form-field">故障位置<input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="請描述故障位置，例如：第一市場 2F 配電盤旁" /></label>
            <label className="repair-form-field">故障位置照片（必填，請上傳一張照片）<input required type="file" accept="image/*" onChange={e => setLocationPhoto(e.target.files?.[0] || null)} /></label>
            <label className="repair-form-field">故障類型<select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value="">-- 請選擇故障類型 --</option><option value="電氣">電氣</option><option value="機械">機械</option><option value="漏水">漏水</option><option value="異音">異音</option><option value="停機">停機</option><option value="其他">其他</option></select></label>
            <label className="repair-form-field">故障描述<textarea required value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="請描述故障狀況…" /></label>
            <label className="repair-form-field">維修設備照片（必填，請上傳一張照片）<input required type="file" accept="image/*" onChange={e => setEquipmentPhoto(e.target.files?.[0] || null)} /></label>
            <div className={`repair-form-message ${formMessage ? 'show' : ''}`} role="status">{formMessage}</div>
            <button type="button" className="repair-submit-button" disabled={saving} onClick={createRepair}>{saving ? '送出中…' : '送出報修'}</button>
          </div>
        </section>
      </div>}
    </AppShell>;
  }
  return <AuthGate>{profile => <Workspace profile={profile} />}</AuthGate>;
}
