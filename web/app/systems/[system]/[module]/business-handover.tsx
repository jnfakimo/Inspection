'use client';

// SYS-04 業管組電子交接簿。
// 包含：三班交接事項、出勤摘要、異動時間紀錄、崗位時段勤務點檢表、三級主管批核（一市場主任、營業部副理、營業部經理）與每日 A4精準列印／預覽報表。
// 風格與駐警隊交接簿統一，支援當班時段光暈閃爍提示與點檢表預設收合展開。

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { AdminHeader, AdminModal, errorMessage, type Row } from '@/components/admin/shared';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { selectableActiveUsers } from '@/lib/user-visibility';
import { HANDOVER_MARKETS, type HandoverMarket } from '@/lib/handover-market';
import {
  DEFAULT_BUSINESS_DUTY_CHECKLIST,
  TIME_SLOT_DEFS,
  parseDutyChecklist,
  serializeDutyChecklist,
  type DutyItem,
} from '@/lib/business-duty-checklist';
import { BusinessDutyModal } from './business-duty-modal';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import { HandoverIcon, HandoverSheetHeader, type IconName } from './handover-sheet';
import { BusinessSignatures, BusinessConfirmModal, businessShiftName, businessTime, type BusinessShift, type BusinessConfirmation } from './business-handover-reconciliation';
import './handover-sheet.css';
import './business-handover.css';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };

// 圖示改用三本交接簿共用的 handover-sheet。
const BusinessIcon = HandoverIcon;

export type DutyCheckItem = DutyItem;

export const TIME_SLOTS = TIME_SLOT_DEFS;

export const BUSINESS_DUTY_CHECKLIST: DutyItem[] = DEFAULT_BUSINESS_DUTY_CHECKLIST;

const SHIFTS = [
  { code: '01-09', name: '早班', label: '01:00–09:00', subLabel: '涵蓋 00-08、01-09、02-10、03-11 各崗位' },
  { code: '09-17', name: '中班', label: '09:00–17:00', subLabel: '涵蓋 08-17、09-17 各崗位' },
  { code: '17-01', name: '晚班', label: '17:00–01:00', subLabel: '涵蓋 17-01 各崗位' },
] as const;

const CATEGORIES = ['事務事項', '維修', '其他'] as const;

export type ApprovalStage = 'director' | 'deputy_manager' | 'manager';

export const APPROVAL_STAGES: { stage: ApprovalStage; label: string; title: string; desc: string }[] = [
  { stage: 'director', label: '市場主任', title: '市場主任批核', desc: '所屬市場主任查核點檢與交接事項' },
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
  const [market, setMarket] = useState<HandoverMarket | null>(null);
  const [allowedMarkets, setAllowedMarkets] = useState<HandoverMarket[]>([]);
  const [date, setDate] = useState(() => getTaipeiTime().hour < 1 ? moveDate(todayTaipei(), -1) : todayTaipei());
  const [entries, setEntries] = useState<Row[]>([]);
  const [shiftReports, setShiftReports] = useState<BusinessShift[]>([]);
  const [confirmation, setConfirmation] = useState<BusinessConfirmation | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmMessage, setConfirmMessage] = useState('');
  const loadGeneration = useRef(0);
  const [users, setUsers] = useState<Row[]>([]);
  const [receivers, setReceivers] = useState<Row[]>([]);
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

  // 點檢狀態與項目管理
  const [dutyItems, setDutyItems] = useState<DutyItem[]>(DEFAULT_BUSINESS_DUTY_CHECKLIST);
  const [manageDutyOpen, setManageDutyOpen] = useState(false);
  const [checks, setChecks] = useState<DutyCheckMap>({});
  const [selectedSlotFilter, setSelectedSlotFilter] = useState<string>('all');
  const [savingChecks, setSavingChecks] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // 點檢表收折控制：剛進入時預設為「收起來」
  const [checklistOpen, setChecklistOpen] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    void invokeAppApi<{ markets: HandoverMarket[]; assigned_market: HandoverMarket | null }>('handover_market_context', { team: 'business' })
      .then(result => {
        if (cancelled) return;
        setAllowedMarkets(result.markets);
        setMarket(result.assigned_market || result.markets[0] || null);
        if (!result.markets.length) setNote('目前未設定業管組市場歸屬，請由管理員核對組織架構。');
      })
      .catch(error => { if (!cancelled) { setNote(`市場權限載入失敗：${errorMessage(error)}`); setBusy(false); } });
    return () => { cancelled = true; };
  }, []);

  // 載入資料庫、點檢表與批核紀錄
  const load = useCallback(async () => {
    if (!market) { setBusy(false); return; }
    const generation = ++loadGeneration.current;
    setBusy(true);
    setNote('');
    try {
      const client = getSupabase();
      const [entryResult, userResult, approvalResult, reports, eligibleReceivers] = await Promise.all([
        client.from('business_handover_entries').select('*').eq('market_code', market).eq('handover_date', date).order('shift_code').order('created_at'),
        client.from('users').select('user_id,name,username,email,role,rbac_role,department,dept_id,status').eq('status', 'active').order('name').limit(1000),
        client.from('business_handover_approvals').select('*').eq('market_code', market).eq('handover_date', date).order('created_at'),
        invokeAppApi<BusinessShift[]>('business_handover_day', { market_code: market, handover_date: date }),
        invokeAppApi<Row[]>('business_handover_receivers', { market_code: market }),
      ]);
      if (generation !== loadGeneration.current) return;
      if (entryResult.error || userResult.error || approvalResult.error) throw entryResult.error || userResult.error || approvalResult.error;
      const rawEntries = entryResult.data || [];
      setEntries(rawEntries);
      setShiftReports(reports);
      setReceivers(selectableActiveUsers(eligibleReceivers));
      setUsers(selectableActiveUsers(userResult.data || []));
      setApprovals((approvalResult.data as BusinessApproval[]) || []);

      // 嘗試從資料庫中的點檢紀錄條目或 LocalStorage 載入點檢表狀態與自訂項目
      let loadedChecks: DutyCheckMap = {};
      let loadedItems: DutyItem[] | null = null;
      let templateItems: DutyItem[] = DEFAULT_BUSINESS_DUTY_CHECKLIST;

      if (typeof window !== 'undefined') {
        try {
          const storedTemplate = localStorage.getItem(`beinong_business_duty_template_${market}`);
          if (storedTemplate) {
            const parsed = JSON.parse(storedTemplate);
            if (Array.isArray(parsed) && parsed.length > 0) templateItems = parsed;
          }
        } catch {
          // ignore
        }
      }

      const checklistEntry = rawEntries.find(r => !isDeleted(r) && String(r.description || '').includes(CHECKLIST_TAG));
      if (checklistEntry) {
        try {
          const jsonPart = String(checklistEntry.description).split(CHECKLIST_TAG)[1]?.trim();
          if (jsonPart) {
            const parsed = parseDutyChecklist(jsonPart, templateItems);
            loadedItems = parsed.items.filter(i => !i.deletedAt);
            loadedChecks = parsed.checks;
          }
        } catch {
          // 解析失敗時從 LocalStorage 備援
        }
      }

      if (!loadedItems) {
        loadedItems = templateItems;
      }

      if (Object.keys(loadedChecks).length === 0 && typeof window !== 'undefined') {
        try {
          const local = localStorage.getItem(`${CHECKLIST_STORAGE_PREFIX}${market}_${date}`);
          if (local) {
            const parsed = parseDutyChecklist(JSON.parse(local), loadedItems);
            loadedChecks = parsed.checks;
          }
        } catch {
          // ignore
        }
      }

      setDutyItems(loadedItems);

      // 初始化所有項目狀態
      const mergedChecks: DutyCheckMap = {};
      for (const item of loadedItems) {
        mergedChecks[item.id] = loadedChecks[item.id] || { status: 'uncompleted' };
      }
      setChecks(mergedChecks);
    } catch (err) {
      if (generation !== loadGeneration.current) return;
      setShiftReports([]);
      setEntries([]);
      setApprovals([]);
      setNote(`失敗：${errorMessage(err, '業管組交接資料載入失敗')}`);
    } finally {
      if (generation === loadGeneration.current) setBusy(false);
    }
  }, [date, market]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDutyItemsChange = useCallback((newItems: DutyItem[]) => {
    const active = newItems.filter(i => !i.deletedAt);
    setDutyItems(active);
    if (typeof window !== 'undefined' && market) {
      localStorage.setItem(`beinong_business_duty_template_${market}`, JSON.stringify(active));
    }
    setChecks(prev => {
      const next = { ...prev };
      for (const item of active) {
        if (!next[item.id]) next[item.id] = { status: 'uncompleted' };
      }
      if (typeof window !== 'undefined' && market) {
        localStorage.setItem(`${CHECKLIST_STORAGE_PREFIX}${market}_${date}`, JSON.stringify(next));
      }
      return next;
    });
  }, [date, market]);

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

  const activeDutyItems = useMemo(() => dutyItems.filter(i => !i.deletedAt), [dutyItems]);

  // 統計點檢完成數
  const checkStats = useMemo(() => {
    let completed = 0;
    const total = activeDutyItems.length;
    for (const item of activeDutyItems) {
      if (checks[item.id]?.status === 'completed') {
        completed += 1;
      }
    }
    const percent = total > 0 ? Math.round((completed / total) * 100) : 100;
    return { completed, total, percent };
  }, [activeDutyItems, checks]);

  // 單一時段完成統計
  const getSlotStats = useCallback(
    (slotCode: string) => {
      const items = activeDutyItems.filter(i => i.timeSlot === slotCode);
      let comp = 0;
      for (const item of items) {
        if (checks[item.id]?.status === 'completed') comp += 1;
      }
      return { completed: comp, total: items.length };
    },
    [activeDutyItems, checks]
  );

  // 當前活耀大班別代碼
  const currentActiveShift = useMemo(() => {
    if (nowTime.hour < 1) return date === moveDate(nowTime.today, -1) ? SHIFTS[2] : null;
    if (!isToday) return null;
    return SHIFTS.find(s => isCurrentMajorShift(s.code, isToday, nowTime.hour)) || null;
  }, [date, isToday, nowTime.hour, nowTime.today]);

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
          if (market) localStorage.setItem(`${CHECKLIST_STORAGE_PREFIX}${market}_${date}`, JSON.stringify(nextState));
        }
        return nextState;
      });
    },
    [date, market, profile.name]
  );

  // 批量設為「點檢完成」或「未點檢」
  const handleBatchSetSlot = useCallback(
    (slotCode: string, targetStatus: CheckStatus) => {
      setChecks(prev => {
        const nextState = { ...prev };
        const items = activeDutyItems.filter(i => i.timeSlot === slotCode);
        for (const item of items) {
          nextState[item.id] = {
            ...(nextState[item.id] || {}),
            status: targetStatus,
            updatedAt: new Date().toISOString(),
            updatedBy: profile.name,
          };
        }
        if (typeof window !== 'undefined') {
          if (market) localStorage.setItem(`${CHECKLIST_STORAGE_PREFIX}${market}_${date}`, JSON.stringify(nextState));
        }
        return nextState;
      });
    },
    [activeDutyItems, date, market, profile.name]
  );

  // 儲存點檢表至資料庫 (以專屬點檢紀錄條目保存)
  const saveChecklistToDb = async () => {
    setSavingChecks(true);
    setNote('');
    try {
      const existing = entries.find(r => !isDeleted(r) && String(r.description || '').includes(CHECKLIST_TAG));
      const summaryText = `${CHECKLIST_TAG}\n${serializeDutyChecklist({ items: activeDutyItems, checks }, DEFAULT_BUSINESS_DUTY_CHECKLIST)}`;

      if (existing) {
        await invokeAppApi('handover_save', {
          kind: 'business_entry_update',
          market_code: market,
          entry_id: existing.entry_id,
          category: '事務事項',
          description: summaryText,
          expected_attendance: Number(existing.expected_attendance || 0),
          absent_attendance: Number(existing.absent_attendance || 0),
        });
      } else {
        await invokeAppApi('handover_save', {
          kind: 'business_entry',
          market_code: market,
          handover_date: date,
          shift_code: '01-09',
          category: '事務事項',
          description: summaryText,
          expected_attendance: 0,
          absent_attendance: 0,
        });
      }
      setNote('點檢紀錄已同步保存');
      await load();
    } catch (err) {
      setNote(`失敗：點檢未儲存，${errorMessage(err)}`);
    } finally {
      setSavingChecks(false);
    }
  };

  // 主管批核動作
  const handleApproveStage = async (stage: ApprovalStage | null, customNote?: string) => {
    if (!stage) return;
    const stageItem = approvalStages.find(s => s.stage === stage);
    if (!stageItem) return;
    const noteContent = customNote !== undefined ? customNote : approvalStageNote[stage] || '';
    setBusy(true);
    setNote('');

    try {
      await invokeAppApi('handover_save', {
        kind: 'business_approve',
        market_code: market,
        handover_date: date,
        stage,
        note: noteContent.trim() || null,
      });

      setApprovingStage(null);
      setModalApprovalNote('');
      await load();
    } catch (err) {
      setNote(`失敗：批核未儲存，${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const openConfirmation = (value: BusinessConfirmation) => {
    setConfirmMessage('');
    setConfirmation(value);
  };
  const saveConfirmation = async (receiverId: string) => {
    if (!confirmation || confirmBusy) return;
    setConfirmBusy(true);
    setConfirmMessage('');
    try {
      const { operation, shift, entry } = confirmation;
      await invokeAppApi('business_handover_action', {
        operation, market_code: market, handover_date: date, shift_code: shift.shift_code,
        entry_id: entry?.entry_id, receiver_id: receiverId || undefined,
        revision: operation === 'receive' ? shift.incoming?.revision : shift.revision,
      });
      setConfirmation(null);
      await load();
    } catch (err) {
      setConfirmMessage(errorMessage(err));
    } finally { setConfirmBusy(false); }
  };

  const print = () => {
    window.print();
  };

  const approvedCount = approvals.length;
  const marketDirectorLabel = market === 'market_2' ? '二市場主任' : '一市場主任';
  const approvalStages = APPROVAL_STAGES.map(stage => stage.stage === 'director'
    ? { ...stage, label: marketDirectorLabel, title: `${marketDirectorLabel}批核`, desc: `${HANDOVER_MARKETS[market || 'market_1'].name}主任查核點檢與交接事項` }
    : stage);

  return (
    <AppShell profile={profile} title={module.title} heading={{ system, module, title: module.title, metaTitle: system.title }}>
      <div className="hs-page">
        <AdminHeader
          module={module}
          busy={busy || savingChecks}
          note={note}
          onReload={load}
          action={
            <div className="hs-header-actions">
              <button
                type="button"
                className="secondary-btn compact"
                onClick={() => setPreviewOpen(true)}
                title="在畫面上預覽 A4報表"
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
        <section className="panel hs-toolbar">
          {allowedMarkets.length > 0 && <div className="hs-market-switch" role="group" aria-label="市場別">{allowedMarkets.map(code =>
            <button key={code} type="button" className={`secondary-btn compact${market === code ? ' is-active' : ''}`}
              aria-pressed={market === code} disabled={busy} onClick={() => setMarket(code)}>{HANDOVER_MARKETS[code].short}</button>)}</div>}
          <div className="hs-date-nav">
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

          <div className="hs-toolbar-right">
            {currentActiveShift && (
              <span className="hs-current-now">
                <span className="hs-pulse-dot" />
                目前當班：{currentActiveShift.name}（{currentActiveShift.label}）
              </span>
            )}
            <span className="hs-toolbar-summary">
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
                <span>逐級審核：{marketDirectorLabel} ➔ 營業部副理 ➔ 營業部經理（可輸入批核意見與簽核）</span>
              </div>
            </div>
            <div className="business-approval-progress">
              <span className={`business-approval-badge ${approvedCount === 3 ? 'is-all-approved' : 'is-partial'}`}>
                {approvedCount === 3 ? '✓ 三級批核完成' : `批核進度：${approvedCount} / 3 階段`}
              </span>
            </div>
          </div>

          <div className="business-approval-stages-grid">
            {approvalStages.map((stageItem, stageIdx) => {
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
        <section className="hs-sheet" aria-label="業管組電子交接簿">
          {/* 表頭與今日指標：三本交接簿共用同一支元件 */}
          <HandoverSheetHeader
            org={`臺北農產運銷股份有限公司　${HANDOVER_MARKETS[market || 'market_1'].name}`}
            title="業管組交接紀錄表"
            date={date}
            stats={stats}
          />

          {/* 崗位勤務時段點檢表（手風琴可收合） */}
          <div className="business-duty-accordion">
            <div className="business-duty-accordion-head">
              <button
                type="button"
                className="business-duty-accordion-toggle"
                onClick={() => setDutyChecklistOpen(prev => !prev)}
                aria-expanded={dutyChecklistOpen}
              >
                <div className="business-duty-accordion-title">
                  <BusinessIcon name="clipboard-check" size={18} />
                  <span>崗位勤務時段點檢表</span>
                  <span className="business-duty-accordion-sub">
                    （涵蓋 7 大時段、{activeDutyItems.length} 項崗位職責 · 目前點檢進度：{checkStats.completed} / {checkStats.total}（{checkStats.percent}%））
                  </span>
                </div>
                <div className="business-duty-accordion-state">
                  <span className="business-duty-accordion-badge">
                    {checkStats.percent === 100 ? '✓ 全數點檢完成' : `進行中 ${checkStats.percent}%`}
                  </span>
                  <span className="business-duty-accordion-arrow">
                    {dutyChecklistOpen ? '▲ 收合點檢表' : '▼ 展開點檢表'}
                  </span>
                </div>
              </button>
              <div className="business-checklist-toggle-btn-wrap">
                <button
                  type="button"
                  className="secondary-btn compact"
                  onClick={() => setManageDutyOpen(true)}
                  title="管理點檢項目清單（新增、修改、刪除、排序、恢復預設）"
                >
                  <BusinessIcon name="settings" size={14} />
                  ⚙ 管理點檢項目
                </button>
              </div>
            </div>

            {dutyChecklistOpen && (
              <div className="business-duty-accordion-body">
                {/* 時段篩選按鈕列 */}
                <div className="business-slot-filter-bar">
                  <button
                    type="button"
                    className={`business-slot-filter-btn ${selectedSlot === 'ALL' ? 'active' : ''}`}
                    onClick={() => setSelectedSlot('ALL')}
                  >
                    全部時段 ({activeDutyItems.length})
                  </button>
                  {TIME_SLOTS.map(slot => {
                    const slotItems = activeDutyItems.filter(i => i.timeSlot === slot.code);
                    const slotDone = slotItems.filter(i => isItemCompleted(i.id)).length;
                    return (
                      <button
                        type="button"
                        key={slot.code}
                        className={`business-slot-filter-btn ${selectedSlot === slot.code ? 'active' : ''}`}
                        onClick={() => setSelectedSlot(slot.code)}
                      >
                        {slot.label} ({slotDone}/{slotItems.length})
                      </button>
                    );
                  })}
                </div>

                {/* 點檢項目清單（依時段分組卡片） */}
                <div className="business-slot-cards-container">
                  {visibleSlots.map(slot => {
                    const slotItems = activeDutyItems.filter(i => i.timeSlot === slot.code);
                    if (slotItems.length === 0) return null;
                    const slotDone = slotItems.filter(i => isItemCompleted(i.id)).length;

                    return (
                      <div className="business-slot-card" key={slot.code}>
                        <div className="business-slot-card-head">
                          <div className="business-slot-card-title">
                            <span className="business-slot-badge">{slot.label}</span>
                            <span className="business-slot-desc">{slot.shiftGroup}</span>
                          </div>
                          <div className="business-slot-card-stats">
                            時段完成度：<b>{slotDone} / {slotItems.length}</b>
                          </div>
                        </div>

                        <div className="business-slot-table-wrapper">
                          <table className="business-slot-table">
                            <thead>
                              <tr>
                                <th style={{ width: '45px' }}>項次</th>
                                <th style={{ width: '130px' }}>勤務時段</th>
                                <th>工作要點與職責內容</th>
                                <th style={{ width: '190px' }}>點檢狀態</th>
                              </tr>
                            </thead>
                            <tbody>
                              {slotItems.map((item, itemIdx) => {
                                const isDone = isItemCompleted(item.id);
                                const itemState = checklist[item.id] || {};
                                return (
                                  <tr
                                    key={item.id}
                                    className={`business-slot-row ${isDone ? 'is-completed' : 'is-pending'}`}
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
          <div className="hs-shifts">
            {SHIFTS.map((shift, shiftIndex) => {
              const report = shiftReports.find(item => item.shift_code === shift.code);
              const shiftCustomRows = report?.items || [];
              const activeCustomRows = shiftCustomRows.filter(row => !isDeleted(row));
              const isShiftActive = shift.code === '17-01' && nowTime.hour < 1
                ? date === moveDate(nowTime.today, -1) : isCurrentMajorShift(shift.code, isToday, nowTime.hour);

              return (
                <section
                  className={`hs-shift hs-shift-${shiftIndex + 1}${isShiftActive ? ' is-current' : ''}`}
                  key={shift.code}
                >
                  {/* 班別主標題列 */}
                  <div className="hs-shift-head">
                    <div className="hs-shift-title">
                      <strong className="hs-shift-no">{shiftIndex + 1}</strong>
                      <div>
                        <div className="hs-shift-name">
                          <b>{shift.name}</b>
                          {isShiftActive ? (
                            <span className="hs-state is-active">
                              <span className="hs-pulse-dot" />
                              當班中
                            </span>
                          ) : (
                            <span className="hs-state is-normal">班別時段</span>
                          )}
                        </div>
                        <div className="hs-shift-times">
                          <span className="hs-chip">
                            <BusinessIcon name="clock" size={14} />
                            時段 {shift.label}
                          </span>
                          <span className="hs-chip">
                            <BusinessIcon name="list" size={14} />
                            {shift.subLabel}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="hs-shift-actions">
                      <span className="hs-pill is-count">
                        共 {activeCustomRows.length} 筆交接
                      </span>
                      <button
                        type="button"
                        className="primary-btn compact"
                        disabled={busy || !report || Boolean(report.outgoing)}
                        onClick={() => {
                          setEditingEntry(null);
                          setEditingShift(shift.code);
                        }}
                      >
                        ＋ 新增交接
                      </button>
                    </div>
                  </div>

                  {report && <BusinessSignatures shift={report} profileId={profile.user_id}
                    disabled={busy || confirmBusy || new Date(`${date}T${shift.code.slice(0, 2)}:00:00+08:00`).getTime() > Date.now()} onConfirm={openConfirmation} />}
                  {/* 班別內容清單 */}
                  <div className="hs-shift-body is-single">
                    {shiftCustomRows.length ? (
                      <div className="business-entry-list">
                        {shiftCustomRows.map((row, itemIndex) => (
                          <article
                            className={`business-entry${isDeleted(row) ? ' is-deleted' : ''}`}
                            key={String(row.entry_id)}
                          >
                            <div className="business-entry-main">
                              <div className="business-entry-category">
                                <span className={`business-category-tag ${row.category === '維修' ? 'is-repair' : row.category === '事務事項' ? 'is-affair' : 'is-other'}`}>
                                  {String(row.category || '其他')}
                                </span>
                                <small>第 {itemIndex + 1} 件 · 是否完成：{row.is_completed ? '是' : '否（持續續辦）'}</small>
                                {row.carried && <small>續帶自 {String(row.handover_date)} {businessShiftName(String(row.shift_code))}</small>}
                              </div>
                              <p>{row.carried ? String(row.description || '—').replace(/^本日應出勤人數：\d+ 人；未出勤人數：\d+ 人。\s*/u, '') : String(row.description || '—')}</p>
                              {row.is_completed && <small>完成：{businessTime(row.completed_at)} · {String(row.completed_name || '—')}</small>}
                            </div>

                            {!row.carried && <div className="business-attendance">
                              <span>
                                應出勤 <b>{Number(row.expected_attendance || 0)}</b> 人
                              </span>
                              <span>
                                未出勤 <b>{Number(row.absent_attendance || 0)}</b> 人
                              </span>
                            </div>}
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
                              <b>{isDeleted(row) ? '已刪除，保留紀錄' : report?.outgoing || row.content_locked || row.is_completed ? '交接內容已鎖定' : '可編輯事項'}</b>
                              {!isDeleted(row) && <div className="business-stage-actions">
                                {!report?.outgoing && !row.content_locked && !row.is_completed && <button type="button" className="secondary-btn compact" disabled={busy}
                                  onClick={() => { setEditingEntry(row); setEditingShift(shift.code); }}>修改事項</button>}
                                {!row.is_completed && !report?.outgoing && report && <button type="button" className="primary-btn compact" disabled={busy || confirmBusy || !isShiftActive}
                                  onClick={() => openConfirmation({ operation: 'complete', shift: report, entry: row })}>標記已完成</button>}
                              </div>}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="hs-empty-shift">
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

        {/* 列印專用報表區 (A4精確排版) */}
        <section className="hs-print-sheet" aria-label="業管組每日列印報表">
          <BusinessReportContent
            market={market || 'market_1'}
            date={date}
            checkStats={checkStats}
            checks={checks}
            dutyItems={activeDutyItems}
            entries={entries}
            shiftReports={shiftReports}
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
              <strong>本日報表預覽（A4版面）</strong>
              <span>{rocDate(date)} · A4 直式排版，資料較多時自動跨頁，已整合雙欄點檢與三階批核簽章</span>
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
                market={market || 'market_1'}
                date={date}
                checkStats={checkStats}
                checks={checks}
                dutyItems={activeDutyItems}
                entries={entries}
                shiftReports={shiftReports}
                approvals={approvals}
                userName={userName}
              />
            </div>
          </div>
        </div>
      )}

      {confirmation && <BusinessConfirmModal confirmation={confirmation} users={receivers} profileId={profile.user_id}
        busy={confirmBusy} message={confirmMessage} onClose={() => setConfirmation(null)} onSave={receiver => void saveConfirmation(receiver)} />}
      {/* 編輯交接彈窗 */}
      {editingShift && (
        <BusinessEntryModal
          market={market || 'market_1'}
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
          title={`修改批核意見｜${approvalStages.find(s => s.stage === approvingStage)?.label}`}
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

      {/* 點檢項目管理彈窗 */}
      {manageDutyOpen && (
        <BusinessDutyModal
          items={dutyItems}
          onItemsChange={handleDutyItemsChange}
          onClose={() => setManageDutyOpen(false)}
          authorName={profile.name}
        />
      )}
    </AppShell>
  );
}

// 供列印與螢幕預覽共用的 A4報表內容元件 (精確控制在一頁內)
function BusinessReportContent({
  market,
  date,
  checkStats,
  checks,
  dutyItems,
  entries,
  shiftReports,
  approvals,
  userName,
}: {
  market: HandoverMarket;
  date: string;
  checkStats: { completed: number; total: number; percent: number };
  checks: DutyCheckMap;
  dutyItems: DutyCheckItem[];
  entries: Row[];
  shiftReports: BusinessShift[];
  approvals: BusinessApproval[];
  userName: (id: unknown) => string;
}) {
  // 將點檢項目拆分成左右兩欄，使高度減半，完美容納於單張 A4
  const mid = Math.ceil(dutyItems.length / 2);
  const leftItems = dutyItems.slice(0, mid);
  const rightItems = dutyItems.slice(mid);

  return (
    <div className="business-print-content">
      <header className="business-print-header">
        <h2>臺北農產運銷股份有限公司{HANDOVER_MARKETS[market].name} 業管組崗位勤務點檢與交接紀錄表</h2>
        <div className="business-print-meta-line">
          <span><b>交接日期：</b>{rocDate(date)}</span>
          <span><b>點檢完成率：</b>{checkStats.percent}%（{checkStats.completed}/{checkStats.total}）</span>
          <span><b>三班交接：</b>共 {entries.filter(r => !isDeleted(r) && !String(r.description || '').includes(CHECKLIST_TAG)).length} 筆紀錄</span>
        </div>
      </header>

      {/* 1. 崗位勤務時段點檢紀錄 (雙欄緊緻排版) */}
      <div className="business-print-section-title">一、崗位勤務時段點檢紀錄（全日 7 時段 · {dutyItems.length} 項崗位職責）</div>
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
            const report = shiftReports.find(item => item.shift_code === shift.code);
            const shiftRows = report?.items || [];
            const activeRows = shiftRows.filter(r => !isDeleted(r));
            const expectedSum = activeRows.filter(r => !r.carried).reduce((s, r) => s + Number(r.expected_attendance || 0), 0);
            const absentSum = activeRows.filter(r => !r.carried).reduce((s, r) => s + Number(r.absent_attendance || 0), 0);

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
                          <span className="print-cat-tag">【{r.category || '交接'}・{r.is_completed ? '已完成' : '未完成／續辦'}】</span>
                          {r.carried && <small>來源 {String(r.handover_date)} {businessShiftName(String(r.shift_code))}　</small>}
                          {r.is_completed && <small>完成 {businessTime(r.completed_at)} · {String(r.completed_name)}　</small>}
                          <span>{String(r.description || '').replace(/^本日應出勤人數：\d+ 人；未出勤人數：\d+ 人。\s*/u, '') || '正常交接'}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="print-muted-text">本班無交接事項。</span>
                  )}
                  <div className="business-print-reconciliation">
                    <p>接班：{report?.incoming?.received_name || '尚未確認'} · {businessTime(report?.incoming?.received_at)}</p>
                    <p>交班：{report?.outgoing?.handed_name || '尚未確認'} · {businessTime(report?.outgoing?.handed_at)}</p>
                    <p>交予：{report?.outgoing?.receiver_name || '尚未指定'} · 下一班接班：{businessTime(report?.outgoing?.received_at)}</p>
                  </div>
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
        三、主管批核紀錄（{market === 'market_2' ? '二市場主任' : '一市場主任'} · 營業部副理 · 營業部經理）
      </div>
      <div className="business-print-approvals-grid">
        {APPROVAL_STAGES.map(baseStage => {
          const stageItem = baseStage.stage === 'director' ? { ...baseStage, label: market === 'market_2' ? '二市場主任' : '一市場主任' } : baseStage;
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
  market,
  date,
  shiftCode,
  entry,
  userName,
  onClose,
  onDone,
}: {
  market: HandoverMarket;
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
        market_code: market,
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
      await invokeAppApi('handover_save', { kind: 'business_entry_delete', market_code: market, entry_id: entry.entry_id });
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
