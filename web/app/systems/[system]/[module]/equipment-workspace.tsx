'use client';

// SYS-05 設備建置 V2 工作區。
//
// 八個模組（設備主檔／保養排程／維修履歷／維護合約／設備文件／年度成本／中央監控／材料主檔）
// 結構高度相似，因此以「欄位規格驅動」的方式共用同一套列表與表單引擎，各模組只描述
// 自己的資料表、清單欄位與表單欄位，避免寫八份幾乎一樣的程式碼。
//
// 寫入直接走資料表，與 V1 一致。這些表的 RLS 已同時要求
// has_system_access('sys_equipment') 與 has_app_permission('create'/'update')，
// 伺服器端把關存在，另包一層 Edge Function 只會多一次轉發而不會提高安全性
// （見 ARCHITECTURE_V2.md「第 3 條的實際落差」的判斷準則）。

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import '@/app/admin-workspace.css';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { getSupabase } from '@/lib/supabase';
import { AdminHeader, AdminModal, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from '@/components/admin/shared';
import { ComboboxSelect } from '@/components/ComboboxSelect';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Opt = [string, string];
type Field = {
  key: string; label: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'checkbox';
  options?: Opt[]; required?: boolean; wide?: boolean; step?: string; placeholder?: string;
};
type Column = { key: string; label: string; render?: (row: Row, ctx: Ctx) => ReactNode };
type Spec = {
  table: string; pk: string;
  orderBy: string; ascending?: boolean;
  select?: string;
  columns: Column[];
  fields: Field[];
  search: (row: Row, ctx: Ctx) => string[];
  /** 需要「設備」下拉選單（子表皆以 equipment_id 為主軸） */
  equipmentScoped?: boolean;
  /** insert／update 時要蓋章的欄位 */
  createdBy?: string; updatedBy?: string;
  /** 唯讀模組不提供新增與編輯 */
  readOnly?: boolean;
  emptyText: string;
};
type Ctx = { equipmentById: Map<string, Row>; categoryById: Map<string, Row> };

const opts = (map: Record<string, string>): Opt[] => Object.entries(map);

const EQUIPMENT_STATUS = { active: '使用中', repair: '維修中', inactive: '停用', retired: '報廢' };
const PLAN_TYPE = { preventive: '預防保養', predictive: '預測保養', statutory: '法定檢查', condition_based: '狀態導向', other: '其他' };
const PLAN_STATUS = { active: '執行中', paused: '暫停', inactive: '停用' };
const INTERVAL_UNIT = { day: '日', week: '週', month: '月', year: '年', hour: '小時', count: '次' };
const RECORD_TYPE = { maintenance: '保養', repair: '維修', inspection_followup: '巡檢追蹤', overhaul: '大修', replacement: '汰換', other: '其他' };
const CONTRACT_STATUS = { draft: '草稿', active: '有效', expired: '已到期', terminated: '已終止', inactive: '停用' };
const DOC_TYPE = {
  operation_manual: '操作手冊', maintenance_manual: '維修手冊', parts_manual: '零件手冊', circuit_diagram: '電路圖',
  plc_program: 'PLC 程式', parameter_backup: '參數備份', photo: '設備照片', certificate: '證明文件', contract: '合約', other: '其他',
};
const COST_SOURCE = { import: '匯入', manual: '人工登錄', calculated: '系統計算' };
const SEVERITY = { info: '一般', warning: '警告', critical: '嚴重' };
const EVENT_STATE = { open: '未處理', acknowledged: '已確認', resolved: '已解除', suppressed: '已抑制' };
const MATERIAL_STATUS = { active: '啟用', inactive: '停用' };
const CRITICALITY = { high: '高', medium: '中', low: '低' };

const TONE: Record<string, string> = {
  active: 'closed', 使用中: 'closed', repair: 'in-progress', inactive: 'cancelled', retired: 'cancelled',
  paused: 'review', draft: 'pending', expired: 'cancelled', terminated: 'cancelled',
  open: 'cancelled', acknowledged: 'review', resolved: 'closed', suppressed: 'pending',
  info: 'pending', warning: 'in-progress', critical: 'cancelled',
};

function Pill({ value, labels }: { value: unknown; labels: Record<string, string> }) {
  const key = String(value || '');
  return <span className={`status-pill ${TONE[key] || 'pending'}`}>{labels[key] || fmt(value)}</span>;
}
function money(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n.toLocaleString('zh-TW') : n === 0 ? '0' : '—';
}
function equipmentLabel(row: Row, ctx: Ctx) {
  const eq = ctx.equipmentById.get(String(row.equipment_id));
  return eq ? `${eq.asset_code || eq.qr_code || ''} ${eq.name || ''}`.trim() || String(eq.equipment_id) : '—';
}

/* ──────────────────────────── 各模組規格 ──────────────────────────── */

const EQUIPMENT_FIELDS: Field[] = [
  { key: 'asset_code', label: '設備編號', required: true },
  { key: 'name', label: '設備名稱', required: true },
  { key: 'category', label: '設備類別' },
  { key: 'floor', label: '安裝樓層', placeholder: '例：B1／1F／RF' },
  { key: 'location', label: '位置說明' },
  { key: 'department', label: '使用部門' },
  { key: 'brand', label: '廠牌' },
  { key: 'model', label: '型號' },
  { key: 'serial_no', label: '序號' },
  { key: 'manufactured_year', label: '製造年份', type: 'number' },
  { key: 'installed_on', label: '安裝日期', type: 'date' },
  { key: 'accepted_on', label: '驗收日期', type: 'date' },
  { key: 'service_life_y', label: '設備壽命（年）', type: 'number' },
  { key: 'voltage', label: '電壓' },
  { key: 'power_kw', label: '功率（kW）', type: 'number', step: '0.01' },
  { key: 'criticality', label: '關鍵程度', type: 'select', options: opts(CRITICALITY) },
  { key: 'status', label: '設備狀態', type: 'select', options: opts(EQUIPMENT_STATUS), required: true },
  { key: 'original_manufacturer', label: '原廠名稱' },
  { key: 'original_contact', label: '原廠聯絡人' },
  { key: 'original_phone', label: '原廠電話' },
  { key: 'distributor', label: '代理商' },
  { key: 'distributor_contact', label: '代理商聯絡人' },
  { key: 'distributor_phone', label: '代理商電話' },
  { key: 'warranty_from', label: '保固開始', type: 'date' },
  { key: 'warranty_until', label: '保固到期', type: 'date' },
  { key: 'has_maintenance_contract', label: '有保養合約', type: 'checkbox' },
  { key: 'maintenance_vendor', label: '保養廠商' },
  { key: 'maintenance_cycle', label: '保養週期' },
  { key: 'last_maintenance_on', label: '上次保養', type: 'date' },
  { key: 'next_maintenance_on', label: '下次保養', type: 'date' },
  { key: 'responsible_name', label: '設備負責人' },
  { key: 'emergency_phone', label: '24 小時維修電話' },
  { key: 'remarks', label: '備註', type: 'textarea', wide: true },
];

const SPECS: Record<string, Spec> = {
  assets: {
    table: 'equipment', pk: 'equipment_id', orderBy: 'name', ascending: true,
    createdBy: 'created_by', updatedBy: 'updated_by',
    emptyText: '目前沒有設備資料',
    columns: [
      { key: 'asset_code', label: '設備編號', render: r => <><strong>{fmt(r.asset_code || r.qr_code)}</strong><small>{fmt(r.category)}</small></> },
      { key: 'name', label: '設備名稱', render: r => <>{fmt(r.name)}<small>{[r.brand, r.model].filter(Boolean).join(' / ') || '—'}</small></> },
      { key: 'floor', label: '位置', render: r => <>{fmt(r.floor)}<small>{fmt(r.location)}</small></> },
      { key: 'department', label: '使用部門' },
      { key: 'next_maintenance_on', label: '下次保養' },
      { key: 'criticality', label: '關鍵度', render: r => r.criticality ? <Pill value={r.criticality} labels={CRITICALITY} /> : '—' },
      { key: 'status', label: '狀態', render: r => <Pill value={r.status} labels={EQUIPMENT_STATUS} /> },
    ],
    fields: EQUIPMENT_FIELDS,
    search: r => [r.asset_code, r.qr_code, r.name, r.category, r.brand, r.model, r.floor, r.location, r.department, r.responsible_name],
  },
  plans: {
    table: 'equipment_maintenance_plans', pk: 'plan_id', orderBy: 'next_due_on', ascending: true,
    equipmentScoped: true, createdBy: 'created_by', updatedBy: 'updated_by',
    emptyText: '目前沒有保養排程',
    columns: [
      { key: 'equipment_id', label: '設備', render: (r, c) => equipmentLabel(r, c) },
      { key: 'item_name', label: '保養項目', render: r => <>{fmt(r.item_name)}<small>{PLAN_TYPE[String(r.maintenance_type) as keyof typeof PLAN_TYPE] || '—'}</small></> },
      { key: 'cycle_text', label: '週期', render: r => fmt(r.cycle_text || (r.interval_value ? `${r.interval_value} ${INTERVAL_UNIT[String(r.interval_unit) as keyof typeof INTERVAL_UNIT] || ''}` : null)) },
      { key: 'responsible_name', label: '負責人' },
      { key: 'last_performed_on', label: '上次保養' },
      { key: 'next_due_on', label: '下次到期' },
      { key: 'status', label: '狀態', render: r => <Pill value={r.status} labels={PLAN_STATUS} /> },
    ],
    fields: [
      { key: 'item_name', label: '保養項目', required: true },
      { key: 'maintenance_type', label: '保養類型', type: 'select', options: opts(PLAN_TYPE), required: true },
      { key: 'cycle_text', label: '週期說明', placeholder: '例：每季' },
      { key: 'interval_value', label: '間隔值', type: 'number', step: '0.01' },
      { key: 'interval_unit', label: '間隔單位', type: 'select', options: opts(INTERVAL_UNIT) },
      { key: 'responsible_name', label: '負責人' },
      { key: 'last_performed_on', label: '上次保養', type: 'date' },
      { key: 'next_due_on', label: '下次到期', type: 'date' },
      { key: 'last_result', label: '上次結果' },
      { key: 'status', label: '狀態', type: 'select', options: opts(PLAN_STATUS), required: true },
      { key: 'note', label: '備註', type: 'textarea', wide: true },
    ],
    search: (r, c) => [equipmentLabel(r, c), r.item_name, r.cycle_text, r.responsible_name, r.note],
  },
  records: {
    table: 'equipment_maintenance_records', pk: 'record_id', orderBy: 'performed_on', ascending: false,
    equipmentScoped: true, createdBy: 'created_by',
    emptyText: '目前沒有維修履歷',
    columns: [
      { key: 'performed_on', label: '日期' },
      { key: 'equipment_id', label: '設備', render: (r, c) => equipmentLabel(r, c) },
      { key: 'record_type', label: '類型', render: r => <Pill value={r.record_type} labels={RECORD_TYPE} /> },
      { key: 'fault_description', label: '內容', render: r => <>{fmt(r.fault_description || r.action_taken)}<small>{fmt(r.technician)}</small></> },
      { key: 'downtime_hours', label: '停機(hr)' },
      { key: 'maintenance_cost', label: '維修費', render: r => money(r.maintenance_cost) },
      { key: 'result', label: '結果' },
    ],
    fields: [
      { key: 'record_type', label: '履歷類型', type: 'select', options: opts(RECORD_TYPE), required: true },
      { key: 'performed_on', label: '執行日期', type: 'date', required: true },
      { key: 'technician', label: '維修人員' },
      { key: 'result', label: '結果' },
      { key: 'fault_description', label: '故障內容', type: 'textarea', wide: true },
      { key: 'fault_cause', label: '故障原因', type: 'textarea', wide: true },
      { key: 'action_taken', label: '處理方式', type: 'textarea', wide: true },
      { key: 'replacement_parts', label: '更換零件' },
      { key: 'downtime_hours', label: '停機時間（hr）', type: 'number', step: '0.01' },
      { key: 'maintenance_cost', label: '維修費用', type: 'number', step: '0.01' },
      { key: 'parts_cost', label: '零件費', type: 'number', step: '0.01' },
      { key: 'downtime_loss', label: '停機損失', type: 'number', step: '0.01' },
      { key: 'next_due_on', label: '下次保養', type: 'date' },
      { key: 'note', label: '備註', type: 'textarea', wide: true },
    ],
    search: (r, c) => [equipmentLabel(r, c), r.fault_description, r.action_taken, r.technician, r.result, r.note],
  },
  contracts: {
    table: 'equipment_contracts', pk: 'contract_id', orderBy: 'ends_on', ascending: true,
    equipmentScoped: true, createdBy: 'created_by', updatedBy: 'updated_by',
    emptyText: '目前沒有維護合約',
    columns: [
      { key: 'equipment_id', label: '設備', render: (r, c) => equipmentLabel(r, c) },
      { key: 'vendor', label: '廠商', render: r => <>{fmt(r.vendor)}<small>{[r.contact_name, r.contact_phone].filter(Boolean).join('｜') || '—'}</small></> },
      { key: 'contract_no', label: '合約編號' },
      { key: 'starts_on', label: '開始' },
      { key: 'ends_on', label: '到期' },
      { key: 'contract_amount', label: '金額', render: r => money(r.contract_amount) },
      { key: 'status', label: '狀態', render: r => <Pill value={r.status} labels={CONTRACT_STATUS} /> },
    ],
    fields: [
      { key: 'vendor', label: '廠商', required: true },
      { key: 'contract_no', label: '合約編號' },
      { key: 'contact_name', label: '聯絡人' },
      { key: 'contact_phone', label: '聯絡電話' },
      { key: 'starts_on', label: '合約開始', type: 'date' },
      { key: 'ends_on', label: '合約到期', type: 'date' },
      { key: 'sla_hours', label: 'SLA 回應（小時）', type: 'number', step: '0.5' },
      { key: 'contract_amount', label: '合約金額', type: 'number', step: '0.01' },
      { key: 'status', label: '狀態', type: 'select', options: opts(CONTRACT_STATUS), required: true },
      { key: 'service_scope', label: '服務內容', type: 'textarea', wide: true },
      { key: 'note', label: '備註', type: 'textarea', wide: true },
    ],
    search: (r, c) => [equipmentLabel(r, c), r.vendor, r.contract_no, r.contact_name, r.service_scope, r.note],
  },
  documents: {
    table: 'equipment_documents', pk: 'document_id', orderBy: 'created_at', ascending: false,
    equipmentScoped: true, createdBy: 'uploaded_by',
    emptyText: '目前沒有設備文件',
    columns: [
      { key: 'equipment_id', label: '設備', render: (r, c) => equipmentLabel(r, c) },
      { key: 'document_type', label: '類型', render: r => <Pill value={r.document_type} labels={DOC_TYPE} /> },
      { key: 'title', label: '文件名稱', render: r => <>{fmt(r.title)}<small>{r.version ? `版本 ${r.version}` : '—'}</small></> },
      {
        key: 'file_url', label: '檔案位置',
        render: r => r.file_url ? <a href={String(r.file_url)} target="_blank" rel="noreferrer noopener">開啟 ↗</a> : '—',
      },
      { key: 'expires_on', label: '到期日' },
      { key: 'is_current', label: '目前版本', render: r => <span className={`status-pill ${r.is_current ? 'closed' : 'pending'}`}>{r.is_current ? '是' : '否'}</span> },
    ],
    fields: [
      { key: 'document_type', label: '文件類型', type: 'select', options: opts(DOC_TYPE), required: true },
      { key: 'title', label: '文件名稱', required: true },
      { key: 'version', label: '版本' },
      { key: 'effective_on', label: '有效日期', type: 'date' },
      { key: 'expires_on', label: '到期日期', type: 'date' },
      { key: 'is_current', label: '設為目前版本', type: 'checkbox' },
      { key: 'file_url', label: '檔案網址', required: true, wide: true, placeholder: 'https://…' },
      { key: 'note', label: '備註', type: 'textarea', wide: true },
    ],
    search: (r, c) => [equipmentLabel(r, c), r.title, r.version, r.file_url, r.note],
  },
  costs: {
    table: 'equipment_annual_costs', pk: 'annual_cost_id', orderBy: 'fiscal_year', ascending: false,
    equipmentScoped: true, createdBy: 'created_by', updatedBy: 'updated_by',
    emptyText: '目前沒有年度成本資料',
    columns: [
      { key: 'fiscal_year', label: '年度' },
      { key: 'equipment_id', label: '設備', render: (r, c) => equipmentLabel(r, c) },
      { key: 'repair_cost', label: '維修費', render: r => money(r.repair_cost) },
      { key: 'maintenance_cost', label: '保養費', render: r => money(r.maintenance_cost) },
      { key: 'parts_cost', label: '零件費', render: r => money(r.parts_cost) },
      { key: 'downtime_loss', label: '停機損失', render: r => money(r.downtime_loss) },
      {
        key: 'total', label: '合計',
        render: r => <strong>{money(Number(r.repair_cost || 0) + Number(r.maintenance_cost || 0) + Number(r.parts_cost || 0) + Number(r.downtime_loss || 0))}</strong>,
      },
      { key: 'source', label: '來源', render: r => <Pill value={r.source} labels={COST_SOURCE} /> },
    ],
    fields: [
      { key: 'fiscal_year', label: '年度', type: 'number', required: true },
      { key: 'source', label: '資料來源', type: 'select', options: opts(COST_SOURCE), required: true },
      { key: 'repair_cost', label: '維修費', type: 'number', step: '0.01' },
      { key: 'maintenance_cost', label: '保養費', type: 'number', step: '0.01' },
      { key: 'parts_cost', label: '零件費', type: 'number', step: '0.01' },
      { key: 'downtime_loss', label: '停機損失', type: 'number', step: '0.01' },
      { key: 'note', label: '備註', type: 'textarea', wide: true },
    ],
    search: (r, c) => [equipmentLabel(r, c), r.fiscal_year, r.note],
  },
  monitoring: {
    // 監控事件由外部系統寫入，V2 不提供人工新增；僅供查閱與確認。
    table: 'equipment_monitor_events', pk: 'event_id', orderBy: 'occurred_at', ascending: false,
    equipmentScoped: true, readOnly: true,
    emptyText: '目前沒有中央監控事件',
    columns: [
      { key: 'occurred_at', label: '發生時間', render: r => fmtTime(r.occurred_at) },
      { key: 'equipment_id', label: '設備', render: (r, c) => equipmentLabel(r, c) },
      { key: 'title', label: '事件', render: r => <>{fmt(r.title)}<small>{[r.external_system, r.event_code].filter(Boolean).join('｜') || '—'}</small></> },
      { key: 'severity', label: '等級', render: r => <Pill value={r.severity} labels={SEVERITY} /> },
      { key: 'message', label: '內容' },
      { key: 'event_state', label: '狀態', render: r => <Pill value={r.event_state} labels={EVENT_STATE} /> },
    ],
    fields: [],
    search: (r, c) => [equipmentLabel(r, c), r.title, r.message, r.event_code, r.external_system],
  },
  materials: {
    table: 'materials', pk: 'material_id', orderBy: 'material_name', ascending: true,
    emptyText: '目前沒有材料資料',
    columns: [
      { key: 'material_code', label: '材料編號', render: r => <><strong>{fmt(r.material_code)}</strong><small>{fmt(r.sub_category)}</small></> },
      { key: 'material_name', label: '材料名稱', render: r => <>{fmt(r.material_name)}<small>{fmt(r.material_alias)}</small></> },
      { key: 'category_id', label: '分類', render: (r, c) => fmt(c.categoryById.get(String(r.category_id))?.name) },
      { key: 'floor', label: '樓層' },
      { key: 'unit', label: '單位' },
      { key: 'brand', label: '廠牌', render: r => <>{fmt(r.brand)}<small>{fmt(r.model)}</small></> },
      { key: 'status', label: '狀態', render: r => <Pill value={r.status} labels={MATERIAL_STATUS} /> },
    ],
    fields: [
      { key: 'material_code', label: '材料編號' },
      { key: 'material_name', label: '材料名稱', required: true },
      { key: 'material_alias', label: '材料別名' },
      { key: 'sub_category', label: '子分類' },
      { key: 'material_type', label: '材料類型', placeholder: '設備／備品／耗材' },
      { key: 'floor', label: '樓層' },
      { key: 'brand', label: '廠牌' },
      { key: 'manufacturer', label: '製造商' },
      { key: 'model', label: '型號' },
      { key: 'specification', label: '規格' },
      { key: 'unit', label: '單位' },
      { key: 'size', label: '尺寸' },
      { key: 'voltage', label: '電壓' },
      { key: 'power', label: '功率' },
      { key: 'supplier', label: '供應商' },
      { key: 'purchase_price', label: '採購單價', type: 'number', step: '0.01' },
      { key: 'status', label: '狀態', type: 'select', options: opts(MATERIAL_STATUS), required: true },
    ],
    search: (r, c) => [r.material_code, r.material_name, r.material_alias, r.brand, r.model, r.specification, r.supplier, c.categoryById.get(String(r.category_id))?.name],
  },
};

/* ──────────────────────────── 共用引擎 ──────────────────────────── */

export function EquipmentWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  const spec = SPECS[module.key];
  return <AuthGate>{profile => spec
    ? <EntityWorkspace spec={spec} module={module} profile={profile} />
    : <AppShell profile={profile} title={module.title}><section className="panel"><p className="empty">找不到此設備模組。</p></section></AppShell>}
  </AuthGate>;
}

function EntityWorkspace({ spec, module, profile }: { spec: Spec; module: ModuleDefinition; profile: Profile }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [equipment, setEquipment] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [equipmentFilter, setEquipmentFilter] = useState(''), [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const jobs: Array<PromiseLike<any>> = [
      client.from(spec.table).select(spec.select || '*').order(spec.orderBy, { ascending: spec.ascending ?? false, nullsFirst: false }).limit(2000),
    ];
    jobs.push(spec.equipmentScoped || spec.table === 'equipment'
      ? client.from('equipment').select('equipment_id,asset_code,qr_code,name,floor,status').order('name').limit(5000)
      : Promise.resolve({ data: [], error: null }));
    jobs.push(spec.table === 'materials'
      ? client.from('material_categories').select('category_id,name,code,status').order('sort_order')
      : Promise.resolve({ data: [], error: null }));
    const [main, eq, cat] = await Promise.all(jobs);
    if (main.error || eq.error || cat.error) setNote(`失敗：${errorMessage(main.error || eq.error || cat.error, '資料載入失敗')}`);
    setRows(main.data || []); setEquipment(eq.data || []); setCategories(cat.data || []); setBusy(false);
  }, [spec]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [query, equipmentFilter]);

  const ctx: Ctx = useMemo(() => ({
    equipmentById: new Map(equipment.map(row => [String(row.equipment_id), row])),
    categoryById: new Map(categories.map(row => [String(row.category_id), row])),
  }), [equipment, categories]);

  const filtered = useMemo(() => rows.filter(row => {
    if (equipmentFilter && String(row.equipment_id) !== equipmentFilter) return false;
    const q = query.trim().toLowerCase();
    return !q || spec.search(row, ctx).some(value => String(value ?? '').toLowerCase().includes(q));
  }), [rows, query, equipmentFilter, spec, ctx]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const blank = () => {
    const draft: Row = {};
    for (const field of spec.fields) {
      if (field.type === 'checkbox') draft[field.key] = field.key === 'is_current';
      else if (field.type === 'select' && field.required) draft[field.key] = field.options?.[0]?.[0] ?? '';
      else draft[field.key] = '';
    }
    if (spec.equipmentScoped) draft.equipment_id = equipmentFilter || '';
    return draft;
  };

  const save = async () => {
    if (!editor) return;
    if (spec.equipmentScoped && !editor.equipment_id) { setNote('失敗：請選擇設備'); return; }
    for (const field of spec.fields) {
      if (field.required && field.type !== 'checkbox' && !String(editor[field.key] ?? '').trim()) {
        setNote(`失敗：請填寫${field.label}`); return;
      }
    }
    const payload: Row = {};
    if (spec.equipmentScoped) payload.equipment_id = editor.equipment_id;
    for (const field of spec.fields) {
      const raw = editor[field.key];
      if (field.type === 'checkbox') { payload[field.key] = Boolean(raw); continue; }
      const text = String(raw ?? '').trim();
      if (field.type === 'number') {
        if (!text) { payload[field.key] = null; continue; }
        const parsed = Number(text);
        if (!Number.isFinite(parsed)) { setNote(`失敗：${field.label}必須是數字`); return; }
        payload[field.key] = parsed;
        continue;
      }
      payload[field.key] = text || null;
    }
    if (spec.table === 'materials' && editor.category_id) payload.category_id = editor.category_id;

    setBusy(true); setNote('');
    const client = getSupabase();
    const id = editor[spec.pk];
    if (id) {
      if (spec.updatedBy) payload[spec.updatedBy] = profile.user_id;
      const { error } = await client.from(spec.table).update(payload).eq(spec.pk, id);
      if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    } else {
      if (spec.createdBy) payload[spec.createdBy] = profile.user_id;
      const { error } = await client.from(spec.table).insert(payload);
      if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    }
    setEditor(null); await load(); setNote(id ? '資料已更新' : '資料已新增');
  };

  // 監控事件的唯一寫入動作：確認事件。
  const acknowledge = async (row: Row) => {
    setBusy(true); setNote('');
    const { error } = await getSupabase().from('equipment_monitor_events')
      .update({ event_state: 'acknowledged', acknowledged_at: new Date().toISOString(), acknowledged_by: profile.user_id })
      .eq('event_id', row.event_id).eq('event_state', 'open');
    if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    await load(); setNote('事件已確認');
  };

  const canEdit = !spec.readOnly;
  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={canEdit ? <button className="primary-btn compact" onClick={() => setEditor(blank())}>＋ 新增</button> : undefined} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={`搜尋${module.title}`} />
        {spec.equipmentScoped && <ComboboxSelect 
          value={equipmentFilter} 
          onChange={setEquipmentFilter} 
          placeholder="全部設備" 
          options={[
            { value: '', label: '全部設備' },
            ...equipment.map(row => ({ value: String(row.equipment_id), label: `${row.asset_code || row.qr_code || ''} ${row.name || ''}`.trim() }))
          ]} 
        />}
        <span>共 {filtered.length} 筆</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr>{spec.columns.map(col => <th key={col.key}>{col.label}</th>)}{(canEdit || spec.table === 'equipment_monitor_events') && <th>操作</th>}</tr></thead>
        <tbody>{paged.map(row => <tr key={String(row[spec.pk])}>
          {spec.columns.map(col => <td key={col.key}>{col.render ? col.render(row, ctx) : fmt(row[col.key])}</td>)}
          {(canEdit || spec.table === 'equipment_monitor_events') && <td><div className="admin-row-actions">
            {canEdit && <button onClick={() => setEditor({ ...row })}>編輯</button>}
            {spec.table === 'equipment_monitor_events' && row.event_state === 'open' && <button onClick={() => void acknowledge(row)}>確認</button>}
          </div></td>}
        </tr>)}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">{spec.emptyText}</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
    </section>

    {editor && <AdminModal title={`${editor[spec.pk] ? '編輯' : '新增'}${module.title}`} onClose={() => setEditor(null)}>
      <div className="admin-form-grid">
        {spec.equipmentScoped && <label className="wide">設備（必填）
          <ComboboxSelect 
            value={String(editor.equipment_id || '')} 
            onChange={val => setEditor({ ...editor, equipment_id: val })} 
            placeholder="-- 請選擇 --" 
            options={[
              { value: '', label: '-- 請選擇 --' },
              ...equipment.map(row => ({ value: String(row.equipment_id), label: `${row.asset_code || row.qr_code || ''} ${row.name || ''}`.trim() }))
            ]} 
          /></label>}
        {spec.table === 'materials' && <label className="wide">材料分類
          <ComboboxSelect 
            value={String(editor.category_id || '')} 
            onChange={val => setEditor({ ...editor, category_id: val || null })} 
            placeholder="-- 未分類 --" 
            options={[
              { value: '', label: '-- 未分類 --' },
              ...categories.filter(row => row.status !== 'inactive').map(row => ({ value: String(row.category_id), label: row.name }))
            ]} 
          /></label>}
        {spec.fields.map(field => <FieldInput key={field.key} field={field} value={editor[field.key]}
          onChange={value => setEditor({ ...editor, [field.key]: value })} />)}
      </div>
      <footer>
        <button className="secondary-btn" onClick={() => setEditor(null)}>取消</button>
        <button className="primary-btn compact" disabled={busy} onClick={() => void save()}>{busy ? '儲存中…' : '儲存'}</button>
      </footer>
    </AdminModal>}
  </AppShell>;
}

function FieldInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (value: unknown) => void }) {
  const label = `${field.label}${field.required ? '（必填）' : ''}`;
  if (field.type === 'checkbox') {
    return <label className="wide checkbox"><input type="checkbox" checked={Boolean(value)} onChange={e => onChange(e.target.checked)} />{field.label}</label>;
  }
  const common = { value: value == null ? '' : String(value), onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  return <label className={field.wide ? 'wide' : undefined}>{label}
    {field.type === 'select'
      ? <ComboboxSelect 
          value={value == null ? '' : String(value)} 
          onChange={onChange} 
          placeholder="-- 未指定 --" 
          options={!field.required ? [{ value: '', label: '-- 未指定 --' }, ...(field.options || []).map(([v, l]) => ({ value: String(v), label: String(l) }))] : (field.options || []).map(([v, l]) => ({ value: String(v), label: String(l) }))} 
        />
      : field.type === 'textarea'
        ? <textarea rows={2} placeholder={field.placeholder} {...common} />
        : <input type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
            step={field.step} placeholder={field.placeholder} {...common} />}
  </label>;
}
