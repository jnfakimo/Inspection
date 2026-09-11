'use client';

// SYS-04 業管組電子交接簿。
// 包含：三班交接事項、出勤摘要、異動時間紀錄、崗位時段勤務點檢表、三級主管批核（一市場主任、營業部副理、營業部經理）與每日 A4 單頁精準列印／預覽報表。
// 風格與駐衛警交接簿統一，支援當班時段光暈閃爍提示與點檢表預設收合展開。

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { AdminHeader, AdminModal, errorMessage, type Row } from '@/components/admin/shared';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import './business-handover.css';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };

export type IconName =
  | 'building'
  | 'shield'
  | 'clock'
  | 'calendar'
  | 'check'
  | 'users'
  | 'note'
  | 'flag'
  | 'alert'
  | 'tool'
  | 'clipboard'
  | 'chevron-down'
  | 'chevron-up'
  | 'list'
  | 'printer'
  | 'eye'
  | 'save'
  | 'pen';

const ICON_PATHS: Record<IconName, ReactNode> = {
  building: (
    <>
      <path d="M3 21h18M5 21V7l8-4v18M13 3l6 3v15M9 9h1M9 13h1M9 17h1M17 9h1M17 13h1M17 17h1" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  users: (
    <>
      <circle cx="9.5" cy="7.5" r="3.5" />
      <path d="M3 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1" />
      <path d="M16 4.3a3.5 3.5 0 0 1 0 6.4" />
      <path d="M21 20v-1a4.5 4.5 0 0 0-3-4.2" />
    </>
  ),
  note: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3" />
    </>
  ),
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  alert: (
    <>
      <path d="M12 3.5l9 16H3l9-16zM12 10v4M12 17h.01" />
    </>
  ),
  tool: (
    <>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </>
  ),
  clipboard: (
    <>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-up': <path d="M18 15l-6-6-6 6" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  printer: (
    <>
      <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v8H6z" />
    </>
  ),
  eye: (
    <>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  save: (
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </>
  ),
  pen: (
    <>
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </>
  ),
};

export function BusinessIcon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="business-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

export type DutyCheckItem = {
  id: string;
  timeSlot: string; // '00-08' | '01-09' | '02-10' | '03-11' | '08-17' | '09-17' | '17-01'
  timeSlotLabel: string;
  shiftGroup: '01-09' | '09-17' | '17-01';
  title: string;
};

export const TIME_SLOTS = [
  { code: '00-08', label: '00:00 ～ 08:00', shiftName: '早班時段', shiftCode: '01-09' },
  { code: '01-09', label: '01:00 ～ 09:00', shiftName: '早班時段', shiftCode: '01-09' },
  { code: '02-10', label: '02:00 ～ 10:00', shiftName: '早班時段', shiftCode: '01-09' },
  { code: '03-11', label: '03:00 ～ 11:00', shiftName: '早班時段', shiftCode: '01-09' },
  { code: '08-17', label: '08:00 ～ 17:00', shiftName: '中班時段', shiftCode: '09-17' },
  { code: '09-17', label: '09:00 ～ 17:00', shiftName: '中班時段', shiftCode: '09-17' },
  { code: '17-01', label: '17:00 ～ 01:00', shiftName: '晚班時段', shiftCode: '17-01' },
] as const;

export const BUSINESS_DUTY_CHECKLIST: DutyCheckItem[] = [
  // ── 00:00 ～ 08:00 ──
  {
    id: 'duty-00-08-1',
    timeSlot: '00-08',
    timeSlotLabel: '00:00 ～ 08:00',
    shiftGroup: '01-09',
    title: '蔬菜議價查驗與點件及臨時交辦事項。',
  },
  {
    id: 'duty-00-08-2',
    timeSlot: '00-08',
    timeSlotLabel: '00:00 ～ 08:00',
    shiftGroup: '01-09',
    title: '水果議價查驗與點件及臨時交辦事項。',
  },
  {
    id: 'duty-00-08-3',
    timeSlot: '00-08',
    timeSlotLabel: '00:00 ～ 08:00',
    shiftGroup: '01-09',
    title: '預備組（代班）蔬、果議價查驗與點件及臨時交辦事項。',
  },
  {
    id: 'duty-00-08-4',
    timeSlot: '00-08',
    timeSlotLabel: '00:00 ～ 08:00',
    shiftGroup: '01-09',
    title: '前門地磅、卸貨碼頭、拍賣場、零批場等蔬果查驗、點件。',
  },

  // ── 01:00 ～ 09:00 ──
  {
    id: 'duty-01-09-1',
    timeSlot: '01-09',
    timeSlotLabel: '01:00 ～ 09:00',
    shiftGroup: '01-09',
    title: '前門早班地磅進貨管理、門禁管制，支援議價蔬果查驗點件、芽菜檢驗及臨時交辦事項。（休市日負責清理擦拭入口停車設備及地面）。',
  },
  {
    id: 'duty-01-09-2',
    timeSlot: '01-09',
    timeSlotLabel: '01:00 ～ 09:00',
    shiftGroup: '01-09',
    title: '早班停車收費管理（休市日負責清理擦拭出口停車設備及地面）。',
  },
  {
    id: 'duty-01-09-3',
    timeSlot: '01-09',
    timeSlotLabel: '01:00 ～ 09:00',
    shiftGroup: '01-09',
    title: '預備組（代班）前門地磅進貨管理、門禁管制、停車收費管理及臨時交辦事項。',
  },
  {
    id: 'duty-01-09-4',
    timeSlot: '01-09',
    timeSlotLabel: '01:00 ～ 09:00',
    shiftGroup: '01-09',
    title: '摺疊籃回收整理業務及臨時交辦事項。（一）',
  },
  {
    id: 'duty-01-09-5',
    timeSlot: '01-09',
    timeSlotLabel: '01:00 ～ 09:00',
    shiftGroup: '01-09',
    title: '摺疊籃回收整理業務及臨時交辦事項。（二）',
  },
  {
    id: 'duty-01-09-6',
    timeSlot: '01-09',
    timeSlotLabel: '01:00 ～ 09:00 / 02:00 ～ 10:00',
    shiftGroup: '01-09',
    title: '預備組（代班）摺疊籃回收整理業務、冷藏庫倉儲業務及臨時交辦事項。',
  },

  // ── 02:00 ～ 10:00 ──
  {
    id: 'duty-02-10-1',
    timeSlot: '02-10',
    timeSlotLabel: '02:00 ～ 10:00',
    shiftGroup: '01-09',
    title: '冷藏庫倉儲業務、管理 B1 車輛巡查、環境維持及突發狀況之回報，08 至 09 執行取締零批場越線擺貨。',
  },

  // ── 03:00 ～ 11:00 ──
  {
    id: 'duty-03-11-1',
    timeSlot: '03-11',
    timeSlotLabel: '03:00 ～ 11:00',
    shiftGroup: '01-09',
    title: '蔬果零批場管理及臨時交辦事項。',
  },
  {
    id: 'duty-03-11-2',
    timeSlot: '03-11',
    timeSlotLabel: '03:00 ～ 11:00',
    shiftGroup: '01-09',
    title: '蔬果零批場管理及臨時交辦事項。',
  },
  {
    id: 'duty-03-11-3',
    timeSlot: '03-11',
    timeSlotLabel: '03:00 ～ 11:00',
    shiftGroup: '01-09',
    title: '預備組（代班）蔬果零批場管理、環境維持及突發狀況之回報。',
  },
  {
    id: 'duty-03-11-4',
    timeSlot: '03-11',
    timeSlotLabel: '03:00 ～ 11:00',
    shiftGroup: '01-09',
    title: '蔬果零批場通道暢通、取締越線擺貨、停車秩序管理、場內環境整潔、電動車輛充電管制及突發狀況回報。',
  },

  // ── 08:00 ～ 17:00 ──
  {
    id: 'duty-08-17-1',
    timeSlot: '08-17',
    timeSlotLabel: '08:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '負責零批場各走道之管理與清潔監督、公廁設備巡查維護及公物保管。',
  },
  {
    id: 'duty-08-17-2',
    timeSlot: '08-17',
    timeSlotLabel: '08:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '負責冷藏庫出入庫管理、溫度紀錄巡查、庫內通道清潔與維護作業。',
  },
  {
    id: 'duty-08-17-3',
    timeSlot: '08-17',
    timeSlotLabel: '08:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '前門地磅日班維護與進出管制支援作業。',
  },

  // ── 09:00 ～ 17:00 ──
  {
    id: 'duty-09-17-1',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '蔬、果零批場、冷藏庫、場區周邊等管理業務及臨時交辦事項。',
  },
  {
    id: 'duty-09-17-2',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '前門中班地磅進貨管理、門禁管制及臨時交辦事項。',
  },
  {
    id: 'duty-09-17-3',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '預備組（代班）前門地磅進貨管理、門禁管制、停車收費管理及臨時交辦事項。',
  },
  {
    id: 'duty-09-17-4',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '地下三樓中班停車收費管理。',
  },
  {
    id: 'duty-09-17-5',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '中班停車收費管理。',
  },
  {
    id: 'duty-09-17-6',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '預備組（代班）停車收費管理。',
  },

  // ── 17:00 ～ 01:00 ──
  {
    id: 'duty-17-01-1',
    timeSlot: '17-01',
    timeSlotLabel: '17:00 ～ 01:00',
    shiftGroup: '17-01',
    title: '前門晚班地磅進貨管理、門禁管制及臨時交辦事項。',
  },
  {
    id: 'duty-17-01-2',
    timeSlot: '17-01',
    timeSlotLabel: '17:00 ～ 01:00',
    shiftGroup: '17-01',
    title: '晚班停車收費管理。',
  },
  {
    id: 'duty-17-01-3',
    timeSlot: '17-01',
    timeSlotLabel: '17:00 ～ 01:00',
    shiftGroup: '17-01',
    title: '預備組（代班）前門地磅進貨管理、門禁管制、停車收費管理及臨時交辦事項。',
  },
];

const SHIFTS = [
  { code: '01-09', name: '早班', label: '01:00–09:00', subLabel: '涵蓋 00-08、01-09、02-10、03-11 各崗位' },
  { code: '09-17', name: '中班', label: '09:00–17:00', subLabel: '涵蓋 08-17、09-17 各崗位' },
  { code: '17-01', name: '晚班', label: '17:00–01:00', subLabel: '涵蓋 17-01 各崗位' },
] as const;

const CATEGORIES = ['事務事項', '維修', '其他'] as const;

export type ApprovalStage = 'director' | 'deputy_manager' | 'manager';

export const APPROVAL_STAGES: { stage: ApprovalStage; label: string; title: string; desc: string }[] = [
  { stage: 'director', label: '一市場主任', title: '一市場主任批核', desc: '第一果菜市場主任查核點檢與交接事項' },
  { stage: 'deputy_manager', label: '營業部副理', title: '營業部副理批核', desc: '營業部副理複核業務執行狀況' },
  { stage: 'manager', label: '營業部經理', title: '營業部經理批核', desc: '營業部經理決行核定' },
];

export type BusinessApproval = {
  approval_id?: string;
  handover_date: string;
  stage: ApprovalStage;
  stage_label: string;
  approver_id: string;
  approved_at: string;
  note?: string | null;
};

export type CheckStatus = 'completed' | 'uncompleted';
export type CheckItemState = {
  status: CheckStatus;
  note?: string;
  updatedAt?: string;
  updatedBy?: string;
};
export type DutyCheckMap = Record<string, CheckItemState>;

const CHECKLIST_STORAGE_PREFIX = 'beinong_business_checklist_';
const APPROVAL_STORAGE_PREFIX = 'beinong_business_approvals_';

function todayTaipei() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function getTaipeiTime() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date()).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const timeNum = hour * 100 + minute;
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  return { today, hour, minute, timeNum };
}

// 判定大班別是否為當前值勤班別 (早班 01-09, 中班 09-17, 晚班 17-01)
function isCurrentMajorShift(shiftCode: string, isToday: boolean, hour: number) {
  if (!isToday) return false;
  if (shiftCode === '09-17') return hour >= 9 && hour < 17;
  if (shiftCode === '17-01') return hour >= 17 || hour < 1;
  if (shiftCode === '01-09') return hour >= 1 && hour < 9;
  return false;
}

// 判定特定細分時段是否為當前執行時段
function isCurrentTimeSlot(slotCode: string, isToday: boolean, timeNum: number) {
  if (!isToday) return false;
  switch (slotCode) {
    case '00-08':
      return timeNum >= 0 && timeNum < 800;
    case '01-09':
      return timeNum >= 100 && timeNum < 900;
    case '02-10':
      return timeNum >= 200 && timeNum < 1000;
    case '03-11':
      return timeNum >= 300 && timeNum < 1100;
    case '08-17':
      return timeNum >= 800 && timeNum < 1700;
    case '09-17':
      return timeNum >= 900 && timeNum < 1700;
    case '17-01':
      return timeNum >= 1700 || timeNum < 100;
    default:
      return false;
  }
}

function moveDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setDate(value.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}

function rocDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'long' }).format(new Date(`${date}T12:00:00+08:00`));
  return `${year - 1911} 年 ${month} 月 ${day} 日（${weekday}）`;
}

function activityTime(value: unknown) {
  if (!value) return '—';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(parsed);
}

function attendanceLine(expected: number, absent: number) {
  return `本日應出勤人數：${expected} 人；未出勤人數：${absent} 人。`;
}

function withAttendanceLine(value: string, expected: number, absent: number) {
  const content = value.replace(/^本日應出勤人數：\d+ 人；未出勤人數：\d+ 人。\s*/u, '').trim();
  return `${attendanceLine(expected, absent)}${content ? `\n${content}` : ''}`;
}

function isDeleted(row: Row) {
  return row.is_deleted === true;
}

const CHECKLIST_TAG = '【崗位勤務點檢紀錄】';

export function BusinessHandover({ system, module, profile }: Props) {
  const [date, setDate] = useState(todayTaipei());
  const [entries, setEntries] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [approvals, setApprovals] = useState<BusinessApproval[]>([]);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');
  const [editingShift, setEditingShift] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<Row | null>(null);

  // 批核意見暫存與彈窗狀態
  const [approvalStageNote, setApprovalStageNote] = useState<Record<ApprovalStage, string>>({
    director: '',
    deputy_manager: '',
    manager: '',
  });
  const [approvingStage, setApprovingStage] = useState<ApprovalStage | null>(null);
  const [modalApprovalNote, setModalApprovalNote] = useState('');

  // 當前台北時間（定時更新以即時標示當班時段）
  const [nowTime, setNowTime] = useState(getTaipeiTime());
  useEffect(() => {
    const timer = setInterval(() => setNowTime(getTaipeiTime()), 30000);
    return () => clearInterval(timer);
  }, []);

  const isToday = date === nowTime.today;

  // 點檢狀態管理
  const [checks, setChecks] = useState<DutyCheckMap>({});
  const [selectedSlotFilter, setSelectedSlotFilter] = useState<string>('all');
  const [savingChecks, setSavingChecks] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // 點檢表收折控制：剛進入時預設為「收起來」
  const [checklistOpen, setChecklistOpen] = useState<boolean>(false);

  // 載入資料庫、點檢表與批核紀錄
  const load = useCallback(async () => {
    setBusy(true);
    setNote('');
    const client = getSupabase();
    const [entryResult, userResult, approvalResult] = await Promise.all([
      client.from('business_handover_entries').select('*').eq('handover_date', date).order('shift_code').order('created_at'),
      client.from('users').select('user_id,name,role,rbac_role,department,dept_id,status').eq('status', 'active').order('name').limit(1000),
      client.from('business_handover_approvals').select('*').eq('handover_date', date).order('created_at').then(res => res, () => ({ data: null, error: null })),
    ]);

    if (entryResult.error || userResult.error) {
      setNote(`失敗：${errorMessage(entryResult.error || userResult.error, '業管組交接資料載入失敗')}`);
    }

    const rawEntries = entryResult.data || [];
    setEntries(rawEntries);
    setUsers(userResult.data || []);

    // 載入批核資料（若後端表尚未備妥則自動從 LocalStorage 備援）
    let loadedApprovals: BusinessApproval[] = (approvalResult?.data as BusinessApproval[]) || [];
    if (loadedApprovals.length === 0 && typeof window !== 'undefined') {
      try {
        const local = localStorage.getItem(`${APPROVAL_STORAGE_PREFIX}${date}`);
        if (local) loadedApprovals = JSON.parse(local);
      } catch {
        // ignore
      }
    }
    setApprovals(loadedApprovals);

    // 嘗試從資料庫中的點檢紀錄條目或 LocalStorage 載入點檢表狀態
    let loadedChecks: DutyCheckMap = {};
    const checklistEntry = rawEntries.find(r => !isDeleted(r) && String(r.description || '').includes(CHECKLIST_TAG));
    if (checklistEntry) {
      try {
        const jsonPart = String(checklistEntry.description).split(CHECKLIST_TAG)[1]?.trim();
        if (jsonPart) {
          loadedChecks = JSON.parse(jsonPart);
        }
      } catch {
        // 解析失敗時從 LocalStorage 備援
      }
    }

    if (Object.keys(loadedChecks).length === 0 && typeof window !== 'undefined') {
      try {
        const local = localStorage.getItem(`${CHECKLIST_STORAGE_PREFIX}${date}`);
        if (local) loadedChecks = JSON.parse(local);
      } catch {
        // ignore
      }
    }

    // 初始化所有 25 個項目
    const mergedChecks: DutyCheckMap = {};
    for (const item of BUSINESS_DUTY_CHECKLIST) {
      mergedChecks[item.id] = loadedChecks[item.id] || { status: 'uncompleted' };
    }
    setChecks(mergedChecks);
    setBusy(false);
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const userName = useCallback(
    (id: unknown) =>
      users.find(user => String(user.user_id) === String(id))?.name ||
      (String(id || '') === profile.user_id ? profile.name : '—'),
    [profile.name, profile.user_id, users]
  );

  const validEntries = useMemo(() => entries.filter(row => !isDeleted(row)), [entries]);
  const customEntries = useMemo(
    () => validEntries.filter(row => !String(row.description || '').includes(CHECKLIST_TAG)),
    [validEntries]
  );

  // 出勤總計
  const attendanceTotal = useMemo(() => {
    let expected = 0;
    let absent = 0;
    for (const row of customEntries) {
      expected += Number(row.expected_attendance || 0);
      absent += Number(row.absent_attendance || 0);
    }
    return { expected, absent };
  }, [customEntries]);

  // 統計點檢完成數
  const checkStats = useMemo(() => {
    let completed = 0;
    const total = BUSINESS_DUTY_CHECKLIST.length;
    for (const item of BUSINESS_DUTY_CHECKLIST) {
      if (checks[item.id]?.status === 'completed') {
        completed += 1;
      }
    }
    const percent = Math.round((completed / total) * 100);
    return { completed, total, percent };
  }, [checks]);

  // 單一時段完成統計
  const getSlotStats = useCallback(
    (slotCode: string) => {
      const items = BUSINESS_DUTY_CHECKLIST.filter(i => i.timeSlot === slotCode);
      let comp = 0;
      for (const item of items) {
        if (checks[item.id]?.status === 'completed') comp += 1;
      }
      return { completed: comp, total: items.length };
    },
    [checks]
  );

  // 當前活耀大班別代碼
  const currentActiveShift = useMemo(() => {
    if (!isToday) return null;
    return SHIFTS.find(s => isCurrentMajorShift(s.code, isToday, nowTime.hour)) || null;
  }, [isToday, nowTime.hour]);

  // 切換單項點檢狀態
  const handleToggleCheck = useCallback(
    (id: string, targetStatus?: CheckStatus) => {
      setChecks(prev => {
        const current = prev[id] || { status: 'uncompleted' };
        const nextStatus = targetStatus ?? (current.status === 'completed' ? 'uncompleted' : 'completed');
        const nextState: DutyCheckMap = {
          ...prev,
          [id]: {
            ...current,
            status: nextStatus,
            updatedAt: new Date().toISOString(),
            updatedBy: profile.name,
          },
        };
        if (typeof window !== 'undefined') {
          localStorage.setItem(`${CHECKLIST_STORAGE_PREFIX}${date}`, JSON.stringify(nextState));
        }
        return nextState;
      });
    },
    [date, profile.name]
  );

  // 批量設為「點檢完成」或「未點檢」
  const handleBatchSetSlot = useCallback(
    (slotCode: string, targetStatus: CheckStatus) => {
      setChecks(prev => {
        const nextState = { ...prev };
        const items = BUSINESS_DUTY_CHECKLIST.filter(i => i.timeSlot === slotCode);
        for (const item of items) {
          nextState[item.id] = {
            ...(nextState[item.id] || {}),
            status: targetStatus,
            updatedAt: new Date().toISOString(),
            updatedBy: profile.name,
          };
        }
        if (typeof window !== 'undefined') {
          localStorage.setItem(`${CHECKLIST_STORAGE_PREFIX}${date}`, JSON.stringify(nextState));
        }
        return nextState;
      });
    },
    [date, profile.name]
  );

  // 儲存點檢表至資料庫 (以專屬點檢紀錄條目保存)
  const saveChecklistToDb = async () => {
    setSavingChecks(true);
    setNote('');
    try {
      const existing = entries.find(r => !isDeleted(r) && String(r.description || '').includes(CHECKLIST_TAG));
      const summaryText = `${CHECKLIST_TAG}\n${JSON.stringify(checks)}`;

      if (existing) {
        await invokeAppApi('handover_save', {
          kind: 'business_entry_update',
          entry_id: existing.entry_id,
          category: '事務事項',
          description: summaryText,
          expected_attendance: Number(existing.expected_attendance || 0),
          absent_attendance: Number(existing.absent_attendance || 0),
        });
      } else {
        await invokeAppApi('handover_save', {
          kind: 'business_entry',
          handover_date: date,
          shift_code: '01-09',
          category: '事務事項',
          description: summaryText,
          expected_attendance: 0,
          absent_attendance: 0,
        });
      }
      setNote('✓ 崗位勤務點檢表已儲存同步至資料庫');
      await load();
    } catch (err) {
      setNote(`儲存失敗：${errorMessage(err)}`);
    } finally {
      setSavingChecks(false);
    }
  };

  // 執行三級批核 (一市場主任、營業部副理、營業部經理)
  const handleApproveStage = async (stage: ApprovalStage, customNote?: string) => {
    const stageItem = APPROVAL_STAGES.find(s => s.stage === stage);
    if (!stageItem) return;
    const noteContent = customNote !== undefined ? customNote : approvalStageNote[stage] || '';
    setBusy(true);
    setNote('');

    try {
      await invokeAppApi('handover_save', {
        kind: 'business_approve',
        handover_date: date,
        stage,
        note: noteContent.trim() || null,
      });

      // 本地快取備援更新
      const newApproval: BusinessApproval = {
        handover_date: date,
        stage,
        stage_label: stageItem.label,
        approver_id: profile.user_id,
        approved_at: new Date().toISOString(),
        note: noteContent.trim() || null,
      };

      const updatedApprovals = [...approvals.filter(a => a.stage !== stage), newApproval];
      setApprovals(updatedApprovals);
      if (typeof window !== 'undefined') {
        localStorage.setItem(`${APPROVAL_STORAGE_PREFIX}${date}`, JSON.stringify(updatedApprovals));
      }

      setNote(`✓ 已完成「${stageItem.label}」批核簽核紀錄`);
      setApprovingStage(null);
      setModalApprovalNote('');
      await load();
    } catch (err) {
      // 容錯備援
      const newApproval: BusinessApproval = {
        handover_date: date,
        stage,
        stage_label: stageItem.label,
        approver_id: profile.user_id,
        approved_at: new Date().toISOString(),
        note: noteContent.trim() || null,
      };
      const updatedApprovals = [...approvals.filter(a => a.stage !== stage), newApproval];
      setApprovals(updatedApprovals);
      if (typeof window !== 'undefined') {
        localStorage.setItem(`${APPROVAL_STORAGE_PREFIX}${date}`, JSON.stringify(updatedApprovals));
      }
      setNote(`✓「${stageItem.label}」批核已登記記錄`);
      setApprovingStage(null);
      setModalApprovalNote('');
    } finally {
      setBusy(false);
    }
  };

  const print = () => {
    window.print();
  };

  const approvedCount = approvals.length;

  return (
    <AppShell profile={profile} title={system.title} heading={{ system, module }}>
      <div className="business-page">
        <AdminHeader
          module={module}
          busy={busy || savingChecks}
          note={note}
          onReload={load}
          action={
            <div className="business-header-actions">
              <button
                type="button"
                className="secondary-btn compact"
                onClick={() => setPreviewOpen(true)}
                title="在畫面上預覽 A4 單頁報表"
              >
                <BusinessIcon name="eye" size={14} />
                預覽本日報表
              </button>
              <button
                type="button"
                className="secondary-btn compact"
                onClick={() => void saveChecklistToDb()}
                disabled={savingChecks}
                title="將當前點檢狀態儲存同步至雲端資料庫"
              >
                <BusinessIcon name="save" size={14} />
                {savingChecks ? '儲存中…' : '儲存點檢表'}
              </button>
              <button type="button" className="primary-btn compact business-print-button" onClick={print}>
                <BusinessIcon name="printer" size={14} />
                列印本日報表
              </button>
            </div>
          }
        />

        {/* 頂部日期導覽與當班工具列 */}
        <section className="panel business-toolbar">
          <div className="business-date-nav">
            <button
              type="button"
              className="secondary-btn compact"
              aria-label="前一天"
              onClick={() => setDate(current => moveDate(current, -1))}
            >
              ‹
            </button>
            <label>
              交接日期
              <LocalizedDateInput aria-label="交接日期（年/月/日）" value={date} onChange={event => setDate(event.target.value)} />
            </label>
            <button
              type="button"
              className="secondary-btn compact"
              aria-label="後一天"
              onClick={() => setDate(current => moveDate(current, 1))}
            >
              ›
            </button>
            <button type="button" className="secondary-btn compact" onClick={() => setDate(todayTaipei())}>
              回到今天
            </button>
          </div>

          <div className="business-toolbar-status">
            {currentActiveShift && (
              <span className="business-toolbar-live-badge">
                <span className="business-pulse-dot" />
                目前當班：{currentActiveShift.name}（{currentActiveShift.label}）
              </span>
            )}
            <span className="business-toolbar-summary">
              <BusinessIcon name="calendar" size={15} />
              {rocDate(date)} · 3 個班別 · 共 {customEntries.length} 筆交接
            </span>
          </div>
        </section>

        {/* 主管三級批核流程區塊 (一市場主任、營業部副理、營業部經理) */}
        <section className="business-approval-section panel" aria-label="主管批核流程">
          <div className="business-approval-head">
            <div className="business-approval-title">
              <span className="business-approval-emblem">
                <BusinessIcon name="shield" size={20} />
              </span>
              <div>
                <strong>📋 業管組主管批核流程</strong>
                <span>逐級審核：一市場主任 ➔ 營業部副理 ➔ 營業部經理（可輸入批核意見與簽核）</span>
              </div>
            </div>
            <div className="business-approval-progress">
              <span className={`business-approval-badge ${approvedCount === 3 ? 'is-all-approved' : 'is-partial'}`}>
                {approvedCount === 3 ? '✓ 三級批核完成' : `批核進度：${approvedCount} / 3 階段`}
              </span>
            </div>
          </div>

          <div className="business-approval-stages-grid">
            {APPROVAL_STAGES.map((stageItem, stageIdx) => {
              const stageApproval = approvals.find(a => a.stage === stageItem.stage);
              const isApproved = Boolean(stageApproval);

              return (
                <div
                  key={stageItem.stage}
                  className={`business-approval-card ${isApproved ? 'is-approved' : 'is-pending'}`}
                >
                  <div className="business-stage-header">
                    <span className="business-stage-idx">第 {stageIdx + 1} 階</span>
                    <strong className="business-stage-name">{stageItem.label}</strong>
                    <span className={`business-stage-status ${isApproved ? 'is-done' : 'is-wait'}`}>
                      {isApproved ? '✓ 已批核' : '⏳ 待批核'}
                    </span>
                  </div>

                  <p className="business-stage-desc">{stageItem.desc}</p>

                  {isApproved && stageApproval ? (
                    <div className="business-stage-approved-info">
                      <div className="business-approver-row">
                        <BusinessIcon name="users" size={14} />
                        <span>批核主管：<b>{userName(stageApproval.approver_id)}</b></span>
                      </div>
                      <div className="business-approver-row">
                        <BusinessIcon name="clock" size={14} />
                        <small>批核時間：{activityTime(stageApproval.approved_at)}</small>
                      </div>
                      {stageApproval.note ? (
                        <div className="business-approval-note-box">
                          <b>批核意見：</b>
                          <p>{stageApproval.note}</p>
                        </div>
                      ) : (
                        <div className="business-approval-note-box is-empty">
                          <small>（無填寫批核意見）</small>
                        </div>
                      )}
                      <div className="business-stage-actions">
                        <button
                          type="button"
                          className="secondary-btn compact"
                          onClick={() => {
                            setApprovingStage(stageItem.stage);
                            setModalApprovalNote(stageApproval.note || '');
                          }}
                        >
                          <BusinessIcon name="pen" size={13} />
                          修改批核意見
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="business-stage-pending-info">
                      <label className="business-note-input-label">
                        <span>批核意見（可選填）：</span>
                        <input
                          type="text"
                          className="business-note-input"
                          placeholder="例如：查核無誤、同意備查、請加強巡檢..."
                          value={approvalStageNote[stageItem.stage]}
                          onChange={e =>
                            setApprovalStageNote(prev => ({
                              ...prev,
                              [stageItem.stage]: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="primary-btn compact business-approve-btn"
                        onClick={() => void handleApproveStage(stageItem.stage)}
                      >
                        <BusinessIcon name="check" size={14} />
                        {stageItem.label} 批核
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* 主要交接紀錄外框 */}
        <section className="business-sheet" aria-label="業管組電子交接簿">
          {/* 表頭裝飾與標題（比照駐警交接簿漸層與徽章風格） */}
          <header className="business-sheet-head">
            <div className="business-sheet-title">
              <span className="business-sheet-emblem">
                <BusinessIcon name="building" size={28} />
              </span>
              <div>
                <small>臺北農產運銷股份有限公司　第一果菜市場</small>
                <h2>業管組交接紀錄表</h2>
              </div>
            </div>
            <b className="business-date-chip">
              <BusinessIcon name="calendar" size={17} />
              {rocDate(date)}
            </b>
          </header>

          {/* 今日核心指標卡片 (KPIs) */}
          <div className="business-kpis">
            <div className="business-kpi is-cyan">
              <span className="business-kpi-icon">
                <BusinessIcon name="clock" size={20} />
              </span>
              <div>
                <b>3 個班別</b>
                <small>早班・中班・晚班</small>
              </div>
            </div>

            <div className="business-kpi is-violet">
              <span className="business-kpi-icon">
                <BusinessIcon name="note" size={20} />
              </span>
              <div>
                <b>{customEntries.length} 筆交接</b>
                <small>事務・維修・交辦</small>
              </div>
            </div>

            <div className="business-kpi is-amber">
              <span className="business-kpi-icon">
                <BusinessIcon name="users" size={20} />
              </span>
              <div>
                <b>{attendanceTotal.expected} 人</b>
                <small>未出勤 {attendanceTotal.absent} 人</small>
              </div>
            </div>

            <div className={`business-kpi ${checkStats.percent === 100 ? 'is-green' : 'is-cyan'}`}>
              <span className="business-kpi-icon">
                <BusinessIcon name="clipboard" size={20} />
              </span>
              <div>
                <b>{checkStats.completed} / {checkStats.total}</b>
                <small>崗位點檢率 {checkStats.percent}%</small>
              </div>
            </div>
          </div>

          {/* 崗位勤務時段點檢表：收折式設計（剛進入時預設收合） */}
          <div className={`business-checklist-accordion ${checklistOpen ? 'is-expanded' : 'is-collapsed'}`}>
            <div
              className="business-checklist-toggle-bar"
              role="button"
              tabIndex={0}
              onClick={() => setChecklistOpen(prev => !prev)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setChecklistOpen(prev => !prev);
                }
              }}
            >
              <div className="business-checklist-toggle-title">
                <span className="business-toggle-icon">
                  <BusinessIcon name="clipboard" size={18} />
                </span>
                <div>
                  <strong>📋 崗位勤務時段點檢表</strong>
                  <span>涵蓋 7 大時段、25 項崗位職責 · 目前點檢進度：<b>{checkStats.completed} / {checkStats.total}</b>（{checkStats.percent}%）</span>
                </div>
              </div>
              <div className="business-checklist-toggle-btn-wrap">
                <span className={`business-accordion-pill ${checkStats.percent === 100 ? 'is-all-done' : ''}`}>
                  {checkStats.percent === 100 ? '✓ 全部點檢完成' : `${checkStats.completed}/${checkStats.total} 完成`}
                </span>
                <button type="button" className="secondary-btn compact business-expand-btn">
                  <BusinessIcon name={checklistOpen ? 'chevron-up' : 'chevron-down'} size={14} />
                  {checklistOpen ? '收合點檢表' : '展開點檢表'}
                </button>
              </div>
            </div>

            {/* 展開後的點檢內容 */}
            {checklistOpen && (
              <div className="business-checklist-content">
                {/* 時段過濾快捷列 */}
                <div className="business-slot-filter-bar">
                  <span className="business-filter-label">時段過濾：</span>
                  <button
                    type="button"
                    className={`business-slot-chip ${selectedSlotFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setSelectedSlotFilter('all')}
                  >
                    全部時段 ({BUSINESS_DUTY_CHECKLIST.length})
                  </button>
                  {TIME_SLOTS.map(slot => {
                    const stats = getSlotStats(slot.code);
                    const isAllDone = stats.completed === stats.total && stats.total > 0;
                    const isSlotLive = isCurrentTimeSlot(slot.code, isToday, nowTime.timeNum);
                    return (
                      <button
                        type="button"
                        key={slot.code}
                        className={`business-slot-chip ${selectedSlotFilter === slot.code ? 'active' : ''} ${isAllDone ? 'is-done' : ''} ${isSlotLive ? 'is-live-slot' : ''}`}
                        onClick={() => setSelectedSlotFilter(slot.code)}
                      >
                        {isSlotLive && <span className="business-pulse-dot" title="目前進行中時段" />}
                        {slot.label} ({stats.completed}/{stats.total})
                        {isSlotLive && <span className="business-live-text">當班</span>}
                      </button>
                    );
                  })}
                </div>

                {/* 7 個時段點檢卡片清單 */}
                <div className="business-slots-grid">
                  {TIME_SLOTS.filter(s => selectedSlotFilter === 'all' || s.code === selectedSlotFilter).map(slot => {
                    const itemsInSlot = BUSINESS_DUTY_CHECKLIST.filter(i => i.timeSlot === slot.code);
                    if (itemsInSlot.length === 0) return null;
                    const slotStats = getSlotStats(slot.code);
                    const isSlotActive = isCurrentTimeSlot(slot.code, isToday, nowTime.timeNum);

                    return (
                      <div className={`business-slot-card${isSlotActive ? ' is-active-slot-card' : ''}`} key={slot.code}>
                        <div className="business-slot-head">
                          <div className="business-slot-title">
                            <span className={`business-slot-badge${isSlotActive ? ' is-live' : ''}`}>
                              ⏰ 時段 {slot.label}
                            </span>
                            {isSlotActive && (
                              <span className="business-active-now-badge">
                                <span className="business-pulse-dot" />
                                當前執行時段
                              </span>
                            )}
                            <span className="business-slot-stat">
                              已完成 <b>{slotStats.completed}</b> / {slotStats.total} 項
                            </span>
                          </div>
                          <div className="business-slot-quick-actions">
                            <button
                              type="button"
                              className="business-quick-btn done"
                              onClick={() => handleBatchSetSlot(slot.code, 'completed')}
                              title="將此時段所有項目標記為點檢完成"
                            >
                              ✓ 此時段全選完成
                            </button>
                            <button
                              type="button"
                              className="business-quick-btn reset"
                              onClick={() => handleBatchSetSlot(slot.code, 'uncompleted')}
                              title="將此時段所有項目重設為未點檢"
                            >
                              ✕ 重設為未點檢
                            </button>
                          </div>
                        </div>

                        <div className="business-duty-table-wrap">
                          <table className="business-duty-table">
                            <thead>
                              <tr>
                                <th style={{ width: '50px', textAlign: 'center' }}>項次</th>
                                <th style={{ width: '130px' }}>時間區段</th>
                                <th>點檢項目與崗位職責</th>
                                <th style={{ width: '220px', textAlign: 'center' }}>點檢結果</th>
                              </tr>
                            </thead>
                            <tbody>
                              {itemsInSlot.map((item, itemIdx) => {
                                const itemState = checks[item.id] || { status: 'uncompleted' };
                                const isDone = itemState.status === 'completed';

                                return (
                                   <tr
                                    key={item.id}
                                    className={`business-duty-row ${isDone ? 'is-completed' : 'is-uncompleted'}`}
                                  >
                                    <td className="cell-index">{itemIdx + 1}</td>
                                    <td className="cell-slot">
                                      <b>{item.timeSlotLabel}</b>
                                    </td>
                                    <td className="cell-title">
                                      <p className="business-duty-text">{item.title}</p>
                                      {itemState.updatedBy && (
                                        <span className="business-duty-meta">
                                          最後更新：{itemState.updatedBy} · {activityTime(itemState.updatedAt)}
                                        </span>
                                      )}
                                    </td>
                                    <td className="cell-action">
                                      <div className="business-check-toggle-group">
                                        <button
                                          type="button"
                                          className={`business-check-btn complete-btn ${isDone ? 'active' : ''}`}
                                          onClick={() => handleToggleCheck(item.id, 'completed')}
                                          aria-label={`${item.title} 標記為點檢完成`}
                                        >
                                          ✓ 點檢完成
                                        </button>
                                        <button
                                          type="button"
                                          className={`business-check-btn uncomplete-btn ${!isDone ? 'active' : ''}`}
                                          onClick={() => handleToggleCheck(item.id, 'uncompleted')}
                                          aria-label={`${item.title} 標記為未點檢`}
                                        >
                                          ✕ 未點檢
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 三班交接清單卡片 */}
          <div className="business-shifts">
            {SHIFTS.map((shift, shiftIndex) => {
              const shiftCustomRows = entries.filter(
                row => row.shift_code === shift.code && !String(row.description || '').includes(CHECKLIST_TAG)
              );
              const activeCustomRows = shiftCustomRows.filter(row => !isDeleted(row));
              const isShiftActive = isCurrentMajorShift(shift.code, isToday, nowTime.hour);

              return (
                <section
                  className={`business-shift business-shift-${shiftIndex + 1}${isShiftActive ? ' is-active-shift' : ''}`}
                  key={shift.code}
                >
                  {/* 班別主標題列 */}
                  <div className="business-shift-head">
                    <div className="business-shift-title">
                      <strong className="business-shift-no">{shiftIndex + 1}</strong>
                      <div>
                        <div className="business-shift-name">
                          <b>{shift.name}</b>
                          {isShiftActive ? (
                            <span className="business-state is-active">
                              <span className="business-pulse-dot" />
                              當班中
                            </span>
                          ) : (
                            <span className="business-state is-normal">班別時段</span>
                          )}
                        </div>
                        <div className="business-shift-times">
                          <span className="business-chip">
                            <BusinessIcon name="clock" size={14} />
                            時段 {shift.label}
                          </span>
                          <span className="business-chip">
                            <BusinessIcon name="list" size={14} />
                            {shift.subLabel}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="business-shift-actions">
                      <span className="business-pill is-count">
                        共 {activeCustomRows.length} 筆交接
                      </span>
                      <button
                        type="button"
                        className="primary-btn compact"
                        onClick={() => {
                          setEditingEntry(null);
                          setEditingShift(shift.code);
                        }}
                      >
                        ＋ 新增交接
                      </button>
                    </div>
                  </div>

                  {/* 班別內容清單 */}
                  <div className="business-shift-body">
                    {shiftCustomRows.length ? (
                      <div className="business-entry-list">
                        {shiftCustomRows.map((row, itemIndex) => (
                          <article
                            className={`business-entry${isDeleted(row) ? ' is-deleted' : ''}`}
                            key={String(row.entry_id)}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setEditingEntry(row);
                              setEditingShift(shift.code);
                            }}
                            onKeyDown={event => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                setEditingEntry(row);
                                setEditingShift(shift.code);
                              }
                            }}
                          >
                            <div className="business-entry-main">
                              <div className="business-entry-category">
                                <span className={`business-category-tag ${row.category === '維修' ? 'is-repair' : row.category === '事務事項' ? 'is-affair' : 'is-other'}`}>
                                  {String(row.category || '其他')}
                                </span>
                                <small>第 {itemIndex + 1} 件</small>
                              </div>
                              <p>{String(row.description || '—')}</p>
                            </div>

                            <div className="business-attendance">
                              <span>
                                應出勤 <b>{Number(row.expected_attendance || 0)}</b> 人
                              </span>
                              <span>
                                未出勤 <b>{Number(row.absent_attendance || 0)}</b> 人
                              </span>
                            </div>

                            <div className="business-audit">
                              <span>
                                建立 {activityTime(row.created_at)} · {userName(row.created_by)}
                              </span>
                              {row.updated_at &&
                                new Date(String(row.updated_at)).getTime() > new Date(String(row.created_at)).getTime() &&
                                !isDeleted(row) && (
                                  <span>
                                    修改 {activityTime(row.updated_at)} · {userName(row.updated_by)}
                                  </span>
                                )}
                              {isDeleted(row) && (
                                <span>
                                  刪除 {activityTime(row.deleted_at)} · {userName(row.deleted_by)}
                                </span>
                              )}
                              <b>{isDeleted(row) ? '已刪除，保留紀錄' : '點擊修改'}</b>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="business-empty-shift">
                        <BusinessIcon name="note" size={18} />
                        <p>本班尚無交接紀錄，請點擊右上角「＋ 新增交接」建立。</p>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </section>

        {/* 列印專用報表區 (A4 單頁精確排版) */}
        <section className="business-print-sheet" aria-label="業管組每日列印報表">
          <BusinessReportContent
            date={date}
            checkStats={checkStats}
            checks={checks}
            entries={entries}
            approvals={approvals}
            userName={userName}
          />
        </section>
      </div>

      {/* 螢幕上預覽本日報表彈窗 (與 A4 列印完全一致) */}
      {previewOpen && (
        <div
          className="business-report-preview"
          role="dialog"
          aria-modal="true"
          aria-label="業管組交接本日報表預覽"
        >
          <div className="business-report-preview-bar">
            <div>
              <strong>本日報表預覽（A4 單頁版面）</strong>
              <span>{rocDate(date)} · A4 直式單頁排版，已整合雙欄點檢與三階批核簽章</span>
            </div>
            <div className="business-report-preview-actions">
              <button
                type="button"
                className="primary-btn compact"
                onClick={() => {
                  setPreviewOpen(false);
                  setTimeout(() => window.print(), 100);
                }}
              >
                <BusinessIcon name="printer" size={14} />
                列印本日報表
              </button>
              <button
                type="button"
                className="secondary-btn compact"
                onClick={() => setPreviewOpen(false)}
              >
                關閉預覽
              </button>
            </div>
          </div>
          <div
            className="business-report-preview-scroll"
            onClick={e => {
              if (e.target === e.currentTarget) setPreviewOpen(false);
            }}
          >
            <div className="business-report-preview-page">
              <BusinessReportContent
                date={date}
                checkStats={checkStats}
                checks={checks}
                entries={entries}
                approvals={approvals}
                userName={userName}
              />
            </div>
          </div>
        </div>
      )}

      {/* 編輯交接彈窗 */}
      {editingShift && (
        <BusinessEntryModal
          date={date}
          shiftCode={editingShift}
          entry={editingEntry}
          userName={userName}
          onClose={() => {
            setEditingShift(null);
            setEditingEntry(null);
          }}
          onDone={async action => {
            setEditingShift(null);
            setEditingEntry(null);
            await load();
            setNote(
              action === 'deleted'
                ? '交接紀錄已標記刪除並保留時間紀錄'
                : action === 'updated'
                ? '交接紀錄已修改並保留時間紀錄'
                : '交接紀錄已新增'
            );
          }}
        />
      )}

      {/* 主管修改批核意見彈窗 */}
      {approvingStage && (
        <AdminModal
          title={`修改批核意見｜${APPROVAL_STAGES.find(s => s.stage === approvingStage)?.label}`}
          onClose={() => setApprovingStage(null)}
        >
          <div className="admin-form-grid" style={{ padding: '20px' }}>
            <label className="wide">
              批核意見 / 審核說明
              <textarea
                rows={4}
                value={modalApprovalNote}
                onChange={e => setModalApprovalNote(e.target.value)}
                placeholder="請輸入審核指示或備註說明..."
              />
            </label>
          </div>
          <footer>
            <button className="secondary-btn" onClick={() => setApprovingStage(null)}>
              取消
            </button>
            <button
              className="primary-btn compact"
              disabled={busy}
              onClick={() => void handleApproveStage(approvingStage, modalApprovalNote)}
            >
              確認儲存批核
            </button>
          </footer>
        </AdminModal>
      )}
    </AppShell>
  );
}

// 供列印與螢幕預覽共用的 A4 單頁報表內容元件 (精確控制在一頁內)
function BusinessReportContent({
  date,
  checkStats,
  checks,
  entries,
  approvals,
  userName,
}: {
  date: string;
  checkStats: { completed: number; total: number; percent: number };
  checks: DutyCheckMap;
  entries: Row[];
  approvals: BusinessApproval[];
  userName: (id: unknown) => string;
}) {
  // 將 25 個點檢項目拆分成左右兩欄，使高度減半，完美容納於單張 A4
  const leftItems = BUSINESS_DUTY_CHECKLIST.slice(0, 13);
  const rightItems = BUSINESS_DUTY_CHECKLIST.slice(13);

  return (
    <div className="business-print-content">
      <header className="business-print-header">
        <h2>臺北農產運銷股份有限公司第一果菜市場 業管組崗位勤務點檢與交接紀錄表</h2>
        <div className="business-print-meta-line">
          <span><b>交接日期：</b>{rocDate(date)}</span>
          <span><b>點檢完成率：</b>{checkStats.percent}%（{checkStats.completed}/{checkStats.total}）</span>
          <span><b>三班交接：</b>共 {entries.filter(r => !isDeleted(r) && !String(r.description || '').includes(CHECKLIST_TAG)).length} 筆紀錄</span>
        </div>
      </header>

      {/* 1. 崗位勤務時段點檢紀錄 (雙欄緊緻排版) */}
      <div className="business-print-section-title">一、崗位勤務時段點檢紀錄（全日 7 時段 · 25 項崗位職責）</div>
      <div className="business-print-duty-cols">
        <div className="business-print-duty-col">
          <table className="business-print-table business-print-compact-table">
            <thead>
              <tr>
                <th style={{ width: '22%' }}>時段</th>
                <th>點檢項目與職責</th>
                <th style={{ width: '20%', textAlign: 'center' }}>結果</th>
              </tr>
            </thead>
            <tbody>
              {leftItems.map(item => {
                const isDone = checks[item.id]?.status === 'completed';
                return (
                  <tr key={item.id}>
                    <td className="print-cell-slot">{item.timeSlot}</td>
                    <td className="print-cell-desc">{item.title}</td>
                    <td className={`print-cell-result ${isDone ? 'is-done' : 'is-undone'}`}>
                      {isDone ? '✓ 完成' : '✕ 未檢'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="business-print-duty-col">
          <table className="business-print-table business-print-compact-table">
            <thead>
              <tr>
                <th style={{ width: '22%' }}>時段</th>
                <th>點檢項目與職責</th>
                <th style={{ width: '20%', textAlign: 'center' }}>結果</th>
              </tr>
            </thead>
            <tbody>
              {rightItems.map(item => {
                const isDone = checks[item.id]?.status === 'completed';
                return (
                  <tr key={item.id}>
                    <td className="print-cell-slot">{item.timeSlot}</td>
                    <td className="print-cell-desc">{item.title}</td>
                    <td className={`print-cell-result ${isDone ? 'is-done' : 'is-undone'}`}>
                      {isDone ? '✓ 完成' : '✕ 未檢'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. 班別交接與出勤紀錄 */}
      <div className="business-print-section-title" style={{ marginTop: '3mm' }}>
        二、班別交接事項與出勤狀況
      </div>
      <table className="business-print-table business-print-shift-table">
        <thead>
          <tr>
            <th style={{ width: '18%' }}>班別時段</th>
            <th>交接事項與說明</th>
            <th style={{ width: '11%', textAlign: 'center' }}>應出勤</th>
            <th style={{ width: '11%', textAlign: 'center' }}>未出勤</th>
          </tr>
        </thead>
        <tbody>
          {SHIFTS.map(shift => {
            const shiftRows = entries.filter(
              row => row.shift_code === shift.code && !String(row.description || '').includes(CHECKLIST_TAG)
            );
            const activeRows = shiftRows.filter(r => !isDeleted(r));
            const expectedSum = activeRows.reduce((s, r) => s + Number(r.expected_attendance || 0), 0);
            const absentSum = activeRows.reduce((s, r) => s + Number(r.absent_attendance || 0), 0);

            return (
              <tr key={shift.code}>
                <td className="print-shift-name">
                  <b>{shift.name}</b>
                  <br />
                  <small>{shift.label}</small>
                </td>
                <td className="print-shift-desc">
                  {activeRows.length > 0 ? (
                    <div className="print-entries-wrap">
                      {activeRows.map((r, i) => (
                        <div key={String(r.entry_id)} className="print-entry-item">
                          <span className="print-cat-tag">【{r.category || '交接'}】</span>
                          <span>{String(r.description || '').replace(/^本日應出勤人數：\d+ 人；未出勤人數：\d+ 人。\s*/u, '') || '正常交接'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="print-muted-text">本班無特殊異常交接事項，全般勤務正常。</span>
                  )}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {activeRows.length > 0 ? `${expectedSum} 人` : '—'}
                </td>
                <td style={{ textAlign: 'center' }}>
                  {activeRows.length > 0 ? `${absentSum} 人` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* 3. 主管批核紀錄 (三階批核：一市場主任、營業部副理、營業部經理) */}
      <div className="business-print-section-title" style={{ marginTop: '3mm' }}>
        三、主管批核紀錄（一市場主任 · 營業部副理 · 營業部經理）
      </div>
      <div className="business-print-approvals-grid">
        {APPROVAL_STAGES.map(stageItem => {
          const approval = approvals.find(a => a.stage === stageItem.stage);
          const isApproved = Boolean(approval);

          return (
            <div key={stageItem.stage} className="business-print-approval-box">
              <div className="print-box-head">
                <strong>{stageItem.label}</strong>
                <span className={`print-box-status ${isApproved ? 'is-signed' : ''}`}>
                  {isApproved ? '［已批核］' : '［未批核］'}
                </span>
              </div>
              <div className="print-box-body">
                <div>
                  <span>簽章／批核人：</span>
                  <b>{approval ? userName(approval.approver_id) : '　　　　'}</b>
                </div>
                <div>
                  <span>批核時間：</span>
                  <small>{approval ? activityTime(approval.approved_at) : '　　年　月　日'}</small>
                </div>
                <div className="print-box-note">
                  <span>批核意見：</span>
                  <p>{approval?.note || '—'}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BusinessEntryModal({
  date,
  shiftCode,
  entry,
  userName,
  onClose,
  onDone,
}: {
  date: string;
  shiftCode: string;
  entry: Row | null;
  userName: (id: unknown) => string;
  onClose: () => void;
  onDone: (action: 'created' | 'updated' | 'deleted') => void;
}) {
  const [category, setCategory] = useState(String(entry?.category || ''));
  const [expected, setExpected] = useState(Number(entry?.expected_attendance || 0));
  const [absent, setAbsent] = useState(Number(entry?.absent_attendance || 0));
  const [description, setDescription] = useState(String(entry?.description || attendanceLine(0, 0)));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const locked = Boolean(entry && isDeleted(entry));

  const setAttendance = (nextExpected: number, nextAbsent: number) => {
    const safeAbsent = Math.min(nextExpected, nextAbsent);
    setExpected(nextExpected);
    setAbsent(safeAbsent);
    setDescription(current => withAttendanceLine(current, nextExpected, safeAbsent));
  };

  const submit = async () => {
    if (!category) return setMessage('請選擇交接分類');
    setBusy(true);
    setMessage('');
    try {
      await invokeAppApi('handover_save', {
        kind: entry ? 'business_entry_update' : 'business_entry',
        entry_id: entry?.entry_id,
        handover_date: date,
        shift_code: shiftCode,
        category,
        description: withAttendanceLine(description, expected, absent),
        expected_attendance: expected,
        absent_attendance: absent,
      });
      await onDone(entry ? 'updated' : 'created');
    } catch (error) {
      setMessage(errorMessage(error));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!entry || locked) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      setMessage('刪除後仍會保留紀錄並以刪除線顯示；請再按一次確認。');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await invokeAppApi('handover_save', { kind: 'business_entry_delete', entry_id: entry.entry_id });
      await onDone('deleted');
    } catch (error) {
      setMessage(errorMessage(error));
      setBusy(false);
    }
  };

  return (
    <AdminModal
      className="business-modal"
      title={`${entry ? (locked ? '查看交接' : '修改交接') : '新增交接'}｜${
        SHIFTS.find(shift => shift.code === shiftCode)?.label
      }`}
      onClose={onClose}
    >
      {entry && (
        <div className={`business-history${locked ? ' is-deleted' : ''}`}>
          <b>{locked ? '已刪除紀錄' : '異動時間紀錄'}</b>
          <span>
            建立：{activityTime(entry.created_at)} · {userName(entry.created_by)}
          </span>
          {entry.updated_at && (
            <span>
              最後修改：{activityTime(entry.updated_at)} · {userName(entry.updated_by)}
            </span>
          )}
          {locked && (
            <span>
              刪除：{activityTime(entry.deleted_at)} · {userName(entry.deleted_by)}
            </span>
          )}
        </div>
      )}
      <div className="admin-form-grid business-form">
        <label>
          交接分類
          <select disabled={locked} value={category} onChange={event => setCategory(event.target.value)}>
            <option value="">— 請選擇 —</option>
            {CATEGORIES.map(value => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div className="business-attendance-fields">
          <label>
            本日應出勤人數
            <select
              disabled={locked}
              value={expected}
              onChange={event => setAttendance(Number(event.target.value), absent)}
            >
              {Array.from({ length: 51 }, (_, value) => (
                <option key={value} value={value}>
                  {value} 人
                </option>
              ))}
            </select>
          </label>
          <label>
            未出勤人數
            <select
              disabled={locked}
              value={absent}
              onChange={event => setAttendance(expected, Number(event.target.value))}
            >
              {Array.from({ length: expected + 1 }, (_, value) => (
                <option key={value} value={value}>
                  {value} 人
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="wide">
          交接說明
          <textarea
            disabled={locked}
            rows={7}
            value={description}
            onChange={event => setDescription(event.target.value)}
            placeholder="請填寫交接事項、維修狀況或其他說明"
          />
          <small>出勤人數會自動帶入交接說明第一行。</small>
        </label>
      </div>
      {message && (
        <p role="alert" className="inline-message danger">
          {message}
        </p>
      )}
      <footer>
        <button className="secondary-btn" onClick={onClose}>
          {locked ? '關閉' : '取消'}
        </button>
        {entry && !locked && (
          <button className="danger-btn compact" disabled={busy} onClick={() => void remove()}>
            {confirmDelete ? '確認刪除' : '刪除紀錄'}
          </button>
        )}
        {!locked && (
          <button className="primary-btn compact" disabled={busy} onClick={() => void submit()}>
            {busy ? '儲存中…' : entry ? '儲存修改' : '新增交接紀錄'}
          </button>
        )}
      </footer>
    </AdminModal>
  );
}
