'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { AdminHeader, AdminModal, errorMessage, type Row } from '@/components/admin/shared';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { selectableActiveUsers } from '@/lib/user-visibility';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import './business-handover.css';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };

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
    title: '送貨工管理及臨時交辦事項。',
  },
  {
    id: 'duty-03-11-3',
    timeSlot: '03-11',
    timeSlotLabel: '03:00 ～ 11:00',
    shiftGroup: '01-09',
    title: '停車月票辦理及帳務管理。',
  },
  {
    id: 'duty-03-11-4',
    timeSlot: '03-11',
    timeSlotLabel: '03:00 ～ 11:00',
    shiftGroup: '01-09',
    title: '停車設備維護、停車場管理及臨時交辦事項。',
  },

  // ── 08:00 ～ 17:00 ──
  {
    id: 'duty-08-17-1',
    timeSlot: '08-17',
    timeSlotLabel: '08:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '主任室總務（辦理二市場業務）。',
  },

  // ── 09:00 ～ 17:00 ──
  {
    id: 'duty-09-17-1',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '全場清潔、公廁、垃圾載運等管理及臨時交辦事項。',
  },
  {
    id: 'duty-09-17-2',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '預備組（代班）全場清潔、公廁、垃圾載運等管理及臨時交辦事項。',
  },
  {
    id: 'duty-09-17-3',
    timeSlot: '09-17',
    timeSlotLabel: '09:00 ～ 17:00',
    shiftGroup: '09-17',
    title: '前門中班地磅進貨管理、門禁管制及臨時交辦事項。',
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
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');
  const [editingShift, setEditingShift] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<Row | null>(null);

  // 點檢狀態管理
  const [checks, setChecks] = useState<DutyCheckMap>({});
  const [selectedSlotFilter, setSelectedSlotFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'checklist' | 'custom' | 'all'>('all');
  const [savingChecks, setSavingChecks] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // 載入資料庫與點檢表
  const load = useCallback(async () => {
    setBusy(true);
    setNote('');
    const client = getSupabase();
    const [entryResult, userResult] = await Promise.all([
      client.from('business_handover_entries').select('*').eq('handover_date', date).order('shift_code').order('created_at'),
      client.from('users').select('user_id,name,username,email,status').eq('status', 'active').order('name').limit(1000),
    ]);
    if (entryResult.error || userResult.error) {
      setNote(`失敗：${errorMessage(entryResult.error || userResult.error, '業管組交接資料載入失敗')}`);
    }
    const rawEntries = entryResult.data || [];
    setEntries(rawEntries);
    setUsers(selectableActiveUsers(userResult.data || []));

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

  // 單一大班別完成統計
  const getShiftGroupStats = useCallback(
    (shiftCode: string) => {
      const items = BUSINESS_DUTY_CHECKLIST.filter(i => i.shiftGroup === shiftCode);
      let comp = 0;
      for (const item of items) {
        if (checks[item.id]?.status === 'completed') comp += 1;
      }
      return { completed: comp, total: items.length };
    },
    [checks]
  );

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
        // 保存至本機快照
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
      // 找出既有的點檢條目
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

  const print = () => {
    window.print();
  };

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
                title="在畫面上預覽 A4 直式報表"
              >
                預覽本日報表
              </button>
              <button
                type="button"
                className="secondary-btn compact"
                onClick={() => void saveChecklistToDb()}
                disabled={savingChecks}
                title="將當前點檢狀態儲存同步至雲端資料庫"
              >
                {savingChecks ? '儲存中…' : '儲存點檢表'}
              </button>
              <button type="button" className="primary-btn compact business-print-button" onClick={print}>
                列印本日報表
              </button>
            </div>
          }
        />

        {/* 頂部日期與進度工具列 */}
        <section className="panel business-toolbar">
          <button className="secondary-btn compact" aria-label="前一天" onClick={() => setDate(current => moveDate(current, -1))}>
            ‹
          </button>
          <label>
            交接日期
            <LocalizedDateInput aria-label="交接日期（年/月/日）" value={date} onChange={event => setDate(event.target.value)} />
          </label>
          <button className="secondary-btn compact" aria-label="後一天" onClick={() => setDate(current => moveDate(current, 1))}>
            ›
          </button>
          <button className="secondary-btn compact" onClick={() => setDate(todayTaipei())}>
            回到今天
          </button>

          <div className="business-stats-badge">
            <span>點檢進度：</span>
            <b>
              {checkStats.completed} / {checkStats.total}
            </b>
            <span className="business-percent">({checkStats.percent}%)</span>
            <div className="business-progress-bar">
              <div className="business-progress-fill" style={{ width: `${checkStats.percent}%` }} />
            </div>
          </div>

          <span className="business-date-summary">{rocDate(date)} · 本日共 {customEntries.length} 筆自訂交接</span>
        </section>

        {/* 點檢與交接切換標籤 */}
        <div className="business-tab-bar">
          <button
            className={`business-tab-btn ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            📋 完整總覽 (點檢表 + 交接事項)
          </button>
          <button
            className={`business-tab-btn ${activeTab === 'checklist' ? 'active' : ''}`}
            onClick={() => setActiveTab('checklist')}
          >
            ✓ 崗位時段點檢表 ({checkStats.completed}/{checkStats.total})
          </button>
          <button
            className={`business-tab-btn ${activeTab === 'custom' ? 'active' : ''}`}
            onClick={() => setActiveTab('custom')}
          >
            📝 交接事項與出勤 ({customEntries.length} 筆)
          </button>
        </div>

        {/* 時段過濾快捷列 */}
        {(activeTab === 'all' || activeTab === 'checklist') && (
          <div className="business-slot-filter-bar">
            <span className="business-filter-label">時段篩選：</span>
            <button
              className={`business-slot-chip ${selectedSlotFilter === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedSlotFilter('all')}
            >
              全部時段 ({BUSINESS_DUTY_CHECKLIST.length})
            </button>
            {TIME_SLOTS.map(slot => {
              const stats = getSlotStats(slot.code);
              const isAllDone = stats.completed === stats.total && stats.total > 0;
              return (
                <button
                  key={slot.code}
                  className={`business-slot-chip ${selectedSlotFilter === slot.code ? 'active' : ''} ${isAllDone ? 'is-done' : ''}`}
                  onClick={() => setSelectedSlotFilter(slot.code)}
                >
                  {slot.label} ({stats.completed}/{stats.total})
                </button>
              );
            })}
          </div>
        )}

        {/* 主要工作區 */}
        <section className="business-sheet" aria-label="業管組電子交接簿">
          <header>
            <div>
              <small>臺北農產運銷股份有限公司　第一果菜市場</small>
              <h2>業管組崗位勤務點檢與交接紀錄表</h2>
            </div>
            <div className="business-header-meta">
              <b>{rocDate(date)}</b>
              <span className="business-completion-pill">
                總點檢率 {checkStats.percent}% ({checkStats.completed}/{checkStats.total})
              </span>
            </div>
          </header>

          {/* 依大班別與時段區隔 */}
          {SHIFTS.map((shift, shiftIndex) => {
            const shiftDutyItems = BUSINESS_DUTY_CHECKLIST.filter(i => i.shiftGroup === shift.code);
            const shiftSlots = TIME_SLOTS.filter(s => s.shiftCode === shift.code);
            const shiftCustomRows = entries.filter(
              row => row.shift_code === shift.code && !String(row.description || '').includes(CHECKLIST_TAG)
            );
            const activeCustomRows = shiftCustomRows.filter(row => !isDeleted(row));
            const shiftStats = getShiftGroupStats(shift.code);

            // 判斷是否被時段篩選過濾
            const matchingSlots = selectedSlotFilter === 'all'
              ? shiftSlots
              : shiftSlots.filter(s => s.code === selectedSlotFilter);

            if (selectedSlotFilter !== 'all' && matchingSlots.length === 0 && activeTab === 'checklist') {
              return null;
            }

            return (
              <section className={`business-shift business-shift-${shiftIndex + 1}`} key={shift.code}>
                {/* 班別主標題 */}
                <div className="business-shift-head">
                  <div>
                    <strong>{['一', '二', '三'][shiftIndex]}</strong>
                    <span>
                      <b>
                        {shift.name} ({shift.label})
                      </b>
                      <small>
                        {shift.subLabel} · 點檢完成 {shiftStats.completed}/{shiftStats.total} 項 · 自訂交接 {activeCustomRows.length} 件
                      </small>
                    </span>
                  </div>
                  <div className="business-shift-actions">
                    <button
                      className="primary-btn compact"
                      onClick={() => {
                        setEditingEntry(null);
                        setEditingShift(shift.code);
                      }}
                    >
                      ＋ 新增交接事項
                    </button>
                  </div>
                </div>

                {/* 1. 崗位勤務時段點檢表區塊 */}
                {(activeTab === 'all' || activeTab === 'checklist') && matchingSlots.length > 0 && (
                  <div className="business-duty-container">
                    <div className="business-section-title">
                      <h4>📌 崗位勤務時段點檢表</h4>
                      <span className="business-badge-sub">
                        依時間區段分配，請逐項檢查並標記「點檢完成」或「未點檢」
                      </span>
                    </div>

                    {matchingSlots.map(slot => {
                      const itemsInSlot = shiftDutyItems.filter(i => i.timeSlot === slot.code);
                      if (itemsInSlot.length === 0) return null;
                      const slotStats = getSlotStats(slot.code);

                      return (
                        <div className="business-slot-card" key={slot.code}>
                          <div className="business-slot-head">
                            <div className="business-slot-title">
                              <span className="business-slot-badge">⏰ 時段 {slot.label}</span>
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
                                  <th style={{ width: '60px' }}>項次</th>
                                  <th style={{ width: '130px' }}>時間區段</th>
                                  <th>點檢項目與崗位職責</th>
                                  <th style={{ width: '230px', textAlign: 'center' }}>點檢結果</th>
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
                )}

                {/* 2. 交接事項紀錄清單區塊 */}
                {(activeTab === 'all' || activeTab === 'custom') && (
                  <div className="business-custom-section">
                    <div className="business-section-title">
                      <h4>📝 班別交接事項與出勤紀錄</h4>
                      <span className="business-badge-sub">
                        記錄本日事務事項、維修狀況、各組出勤與臨時交辦
                      </span>
                    </div>

                    <div className="business-entry-list">
                      {shiftCustomRows.length ? (
                        shiftCustomRows.map((row, itemIndex) => (
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
                              <small>
                                <b>第 {itemIndex + 1} 件</b>
                                {String(row.category || '其他')}
                              </small>
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
                        ))
                      ) : (
                        <p className="business-empty">本班尚無自訂交接紀錄，請按「新增交接事項」建立。</p>
                      )}
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </section>

        {/* 列印專用報表區 (A4 格式化排版) */}
        <section className="business-print-sheet" aria-label="業管組每日列印報表">
          <BusinessReportContent
            date={date}
            checkStats={checkStats}
            checks={checks}
            entries={entries}
          />
        </section>
      </div>

      {/* 螢幕上預覽本日報表彈窗 */}
      {previewOpen && (
        <div
          className="business-report-preview"
          role="dialog"
          aria-modal="true"
          aria-label="業管組交接本日報表預覽"
        >
          <div className="business-report-preview-bar">
            <div>
              <strong>本日報表預覽</strong>
              <span>{rocDate(date)} · A4 直式，與紙本列印內容完全一致</span>
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
    </AppShell>
  );
}

// 供列印與螢幕預覽共用的 A4 報表內容元件
function BusinessReportContent({
  date,
  checkStats,
  checks,
  entries,
}: {
  date: string;
  checkStats: { completed: number; total: number; percent: number };
  checks: DutyCheckMap;
  entries: Row[];
}) {
  return (
    <div className="business-print-content">
      <header>
        <h2>
          臺北農產運銷股份有限公司第一果菜市場
          <br />
          業管組崗位勤務點檢與交接紀錄表
        </h2>
        <p>
          {rocDate(date)}　·　點檢總體完成率：{checkStats.percent}%（{checkStats.completed}/{checkStats.total}）
        </p>
      </header>

      {/* 1. 列印點檢項目表 */}
      <h3 className="business-print-h3">一、崗位勤務時段點檢紀錄</h3>
      <table className="business-print-duty-table">
        <thead>
          <tr>
            <th style={{ width: '13%' }}>班別時段</th>
            <th style={{ width: '15%' }}>時間區段</th>
            <th>點檢項目與崗位職責</th>
            <th style={{ width: '15%', textAlign: 'center' }}>點檢結果</th>
          </tr>
        </thead>
        <tbody>
          {BUSINESS_DUTY_CHECKLIST.map(item => {
            const itemState = checks[item.id] || { status: 'uncompleted' };
            const isDone = itemState.status === 'completed';
            const shiftInfo = SHIFTS.find(s => s.code === item.shiftGroup);

            return (
              <tr key={item.id}>
                <td>
                  {shiftInfo?.name}
                  <br />
                  <small>{shiftInfo?.label}</small>
                </td>
                <td>{item.timeSlotLabel}</td>
                <td>{item.title}</td>
                <td
                  style={{
                    textAlign: 'center',
                    fontWeight: 'bold',
                    color: isDone ? '#059669' : '#b45309',
                  }}
                >
                  {isDone ? '✓ 點檢完成' : '✕ 未點檢'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* 2. 列印交接事項表 */}
      <h3 className="business-print-h3" style={{ marginTop: '6mm' }}>
        二、班別交接與出勤紀錄
      </h3>
      <table>
        <thead>
          <tr>
            <th style={{ width: '18%' }}>班別</th>
            <th style={{ width: '18%' }}>交接分類</th>
            <th>交接說明</th>
            <th style={{ width: '13%' }}>應出勤</th>
            <th style={{ width: '13%' }}>未出勤</th>
          </tr>
        </thead>
        <tbody>
          {SHIFTS.flatMap(shift => {
            const rows = entries.filter(
              row => row.shift_code === shift.code && !String(row.description || '').includes(CHECKLIST_TAG)
            );
            return (rows.length ? rows : [null]).map((row, index) => (
              <tr
                className={row && isDeleted(row) ? 'is-deleted' : ''}
                key={row ? String(row.entry_id) : `${shift.code}-empty`}
              >
                {index === 0 && (
                  <th rowSpan={Math.max(rows.length, 1)}>
                    {shift.name}
                    <br />
                    {shift.label}
                  </th>
                )}
                <td>{row ? String(row.category || '—') : '—'}</td>
                <td>{row ? String(row.description || '—') : '尚無交接紀錄'}</td>
                <td>{row ? `${Number(row.expected_attendance || 0)} 人` : '—'}</td>
                <td>{row ? `${Number(row.absent_attendance || 0)} 人` : '—'}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>
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

