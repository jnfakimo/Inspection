// 駐衛警電子交接簿共用的型別、常數與純函式。
// 資料容器（guard-handover.tsx）與畫面元件（guard-handover-view.tsx）共用；刻意不引用
// Supabase、AppShell 等執行環境相依，畫面元件才能單獨渲染出來檢查版面。

export type Item = { name: string; qty: number; condition: string; note: string };
export type Incident = { id: string; time: string; location: string; category: string; description: string; action: string; reported_to: string };
export type Attachment = {
  attachment_id: string; shift_name: string; incident_id: string; file_name: string; content_type: string;
  file_size: number; original_size: number | null; compressed: boolean; uploaded_by: string; uploaded_at: string;
};
export type PatrolSummary = {
  expected: number; checked: number; unchecked: number; rate: number;
  unchecked_floors: { floor: string; count: number }[]; checkers: string[];
  window_start: string; window_end: string; computed_at: string;
};
export type GuardShift = {
  name: string; sort_order: number; shift_start: string; shift_end: string; patrol_start: string; patrol_end: string;
  scheduled_user_ids: string[]; state: 'upcoming' | 'active' | 'ended'; patrol: PatrolSummary;
};
export type GuardLog = {
  log_id: string; duty_date: string; shift_name: string; shift_start: string; shift_end: string; patrol_start: string; patrol_end: string;
  scheduled_user_ids: string[]; actual_user_ids: string[]; substitute_note: string; duty_summary: string; important_notes: string;
  incidents: Incident[]; items: Item[]; patrol_snapshot: PatrolSummary | null; status: 'draft' | 'submitted' | 'received';
  handover_by: string | null; handover_at: string | null; takeover_by: string | null; takeover_at: string | null;
  created_by: string; created_at: string; updated_by: string; updated_at: string;
};
export type Approval = { approval_id: string; approver_id: string; approved_at: string; note: string; shift_count: number; received_count: number };
export type GuardContext = {
  duty_date: string; shifts: GuardShift[]; logs: GuardLog[]; approval: Approval | null; attachments: Attachment[];
  staff: { user_id: string; name: string }[]; people: Record<string, string>; previous_items: Item[];
  can_edit: boolean; can_approve: boolean; approval_open: boolean;
};

// 附件限制必須與 app-api 的 GUARD_ATTACHMENT_* 及 migration 的 bucket 設定一致。
export const GUARD_ATTACHMENT_BUCKET = 'guard-handover-files';
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_INCIDENT = 10;

export const INCIDENT_CATEGORIES = ['門禁管制', '可疑人車', '竊盜', '火警／煙霧', '設備故障', '漏水／停電', '交通事故', '民眾糾紛', '急救傷病', '其他'] as const;
export const ITEM_CONDITIONS = ['正常', '短少', '損壞', '遺失'] as const;
// 第一次使用、前面也沒有任何交接時的起始清單；之後一律沿用上一班的點交結果。
export const DEFAULT_ITEMS: Item[] = [
  { name: '無線電對講機', qty: 1, condition: '正常', note: '' },
  { name: '手電筒', qty: 1, condition: '正常', note: '' },
  { name: '警棍', qty: 1, condition: '正常', note: '' },
  { name: '鑰匙（串）', qty: 1, condition: '正常', note: '' },
  { name: '門禁磁卡', qty: 1, condition: '正常', note: '' },
];
export const STATUS_LABELS: Record<string, string> = { draft: '交接中', submitted: '已交班・待接班', received: '已接班' };
export const SHIFT_STATE_LABELS: Record<string, string> = { upcoming: '尚未開始', active: '值勤中', ended: '已結束' };

export function todayTaipei() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function moveDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setDate(value.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
export function rocDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'long' }).format(new Date(`${date}T12:00:00+08:00`));
  return `${year - 1911} 年 ${month} 月 ${day} 日（${weekday}）`;
}
export function activityTime(value: unknown) {
  if (!value) return '—';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(parsed);
}
export function hhmm(value: unknown) { return String(value || '').slice(0, 5) || '—'; }
export function incidentTime(value: string) { return value ? value.replace('T', ' ') : '—'; }
export function itemLine(item: Item) { return `${item.name}×${item.qty}（${item.condition}${item.note ? `，${item.note}` : ''}）`; }

export function fileSizeLabel(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'none';
/** 只有圖片、影片、音訊與 PDF 能在瀏覽器內預覽；SVG 可夾帶指令碼，一律改為下載。 */
export function previewKind(contentType: string, fileName: string): PreviewKind {
  const type = String(contentType || '').toLowerCase();
  const ext = String(fileName || '').toLowerCase().split('.').pop() || '';
  if (type === 'image/svg+xml' || ext === 'svg') return 'none';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  return 'none';
}

/** 異常事件的穩定識別碼：附件以它掛在事件上，事件內容修改或重新排序都不會掉附件。 */
export function newIncidentId() {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
  // 非安全環境（http）沒有 randomUUID，退回以亂數組出 v4 格式。
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16);
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}
