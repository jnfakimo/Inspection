'use client';

import type { ReactNode } from 'react';
import type { ModuleDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

export type Row = Record<string, any>;
export type AdminProps = { profile: Profile; module: ModuleDefinition };
export type AdminAction = { action: string; [key: string]: unknown };
export const PAGE_SIZE = 10;
export const ROLE_LABELS: Record<string, string> = {
  reporter: '一般報修人員', duty: '值班人員', dispatcher: '派工管理員', technician: '維修技術人員',
  unit_supervisor: '單位主管', mgmt_supervisor: '管理部主管（已停用）', sysadmin: '系統管理員',
};
export const PERMISSIONS = [
  ['create', '新增'], ['update', '修改'], ['delete', '刪除'], ['read', '查詢'], ['dispatch', '派工'],
  ['close', '結案'], ['sign', '簽核'], ['export', '匯出'], ['admin', '後台管理'],
] as const;
export const SYSTEM_PERMISSIONS = [
  ['sys_admin', '後台管理'], ['sys_workorder', '維修／派工／完工'], ['sys_guardpatrol', '駐衛警巡檢'],
  ['sys_handover', '電子交接簿'], ['sys_equipment', '設備建置'], ['sys_structuremap', '設備圖臺'],
  ['sys_equipment_manage', '設備與圖臺管理'], ['sys_vehicle', '公務車派車'], ['sys_meetingroom', '會議室預約'],
] as const;

export function errorMessage(error: unknown, fallback = '操作失敗，請稍後再試') {
  const raw = error instanceof Error ? error.message : String(error || '');
  if (/row-level security|permission denied|沒有.*權限|無操作權限/i.test(raw)) return '目前帳號沒有執行此操作的權限';
  if (/duplicate|unique/i.test(raw)) return '資料已存在，請勿重複建立';
  if (/failed to fetch|network\s*error|network request failed|load failed|fetch failed/i.test(raw)) return '網路連線失敗，請確認連線後再試';
  if (/jwt.*expired|token.*expired|invalid.*jwt|invalid.*token|auth session missing|refresh.*token/i.test(raw)) return '登入已過期，請重新登入';
  if (/not authenticated|unauthorized|尚未登入|未登入|登入狀態無效/i.test(raw)) return '無法確認登入狀態，請重新登入';
  if (/timeout|timed out|gateway timeout/i.test(raw)) return '系統回應逾時，請稍後再試';
  if (/rate limit|too many requests|security purposes.*seconds/i.test(raw)) return '操作過於頻繁，請稍後再試';
  if (/foreign key|violates.*reference/i.test(raw)) return '關聯資料不完整，無法完成操作';
  if (/not-null|null value|required|cannot be blank/i.test(raw)) return '請完整填寫必填欄位';
  if (/check constraint|invalid input|invalid format|malformed/i.test(raw)) return '輸入資料格式不正確';
  return raw || fallback;
}
export function fmt(value: unknown) {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return String((value as Row).name || (value as Row).title || '—');
  return String(value);
}
export function fmtTime(value: unknown) {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return fmt(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}
export function userRole(row: Row) {
  return String(row.rbac_role || ({ admin: 'sysadmin', supervisor: 'unit_supervisor', maintenance: 'technician', inspector: 'reporter' } as Row)[row.role] || 'reporter');
}
export function StatusPill({ value }: { value: unknown }) {
  const key = String(value || '');
  const label = ({ active: '啟用', inactive: '停用', open: '未處理', acknowledged: '已處理', published: '已發布', draft: '草稿', archived: '歷史', failed: '失敗' } as Row)[key] || fmt(value);
  const tone = ['active', 'published', 'acknowledged'].includes(key) ? 'closed' : ['open', 'failed'].includes(key) ? 'cancelled' : key === 'draft' ? 'assigned' : 'pending';
  return <span className={`status-pill ${tone}`}>{label}</span>;
}
export function AdminModal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="admin-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
    <section className="admin-modal"><header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="關閉">×</button></header>{children}</section>
  </div>;
}
export function AdminHeader({ module, busy, note, onReload, action }: { module: ModuleDefinition; busy: boolean; note: string; onReload: () => void; action?: ReactNode }) {
  return <div className="page-actions admin-page-actions"><div><p>{module.description}</p>{note && <span className={`inline-message ${note.startsWith('失敗') ? 'danger' : ''}`}>{note}</span>}</div><div>{action}<button className="secondary-btn" disabled={busy} onClick={onReload}>{busy ? '載入中…' : '重新載入'}</button></div></div>;
}
export function Pager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const shown = Array.from({ length: pages }, (_, i) => i + 1).filter(value => value === 1 || value === pages || Math.abs(value - page) <= 2);
  return <nav className="admin-pager"><span>每頁 {PAGE_SIZE} 筆，第 {page}／{pages} 頁，共 {total} 筆</span><div><button disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>{shown.map((value, index) => <span key={value}>{index > 0 && value - shown[index - 1] > 1 && <i>…</i>}<button className={value === page ? 'active' : ''} onClick={() => onPage(value)}>{value}</button></span>)}<button disabled={page >= pages} onClick={() => onPage(page + 1)}>›</button></div></nav>;
}
