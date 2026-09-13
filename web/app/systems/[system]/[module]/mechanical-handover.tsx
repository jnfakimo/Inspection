'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { repairCostCents, repairCostTotal, formatRepairCost } from '@/lib/mechanical-cost';
import { canApproveMechanicalDay, carryTargetShift, currentMechanicalShift, mechanicalApprovalOpensOn, outstandingMechanicalEntries } from '@/lib/mechanical-handover-flow';
import { AppShell } from '@/components/AppShell';
import { HandoverIcon, HandoverSheetHeader, type HandoverKpi } from './handover-sheet';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { BlankSelectOption } from '@/components/BlankSelectOption';
import { AdminHeader, AdminModal, errorMessage, type Row } from '@/components/admin/shared';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { selectableActiveUsers } from '@/lib/user-visibility';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import './handover-sheet.css';
import './mechanical-handover.css';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };
type Shift = { code: string; label: string };

const SHIFTS: Shift[] = [
  { code: '01-09', label: '01:00–09:00' },
  { code: '09-17', label: '09:00–17:00' },
  { code: '17-01', label: '17:00–01:00' },
];
const WORK_ITEMS: Record<string, string[]> = {
  '冷凍冷藏設備': ['B1F 冷藏主機巡檢、運轉壓力溫度紀錄', '4F 冷藏庫主機巡檢壓力紀錄', '4F 西側冷藏庫、東側冷凍庫巡查及溫度紀錄', '冷凍空調設備異常處理'],
  '供配電設備': ['B2F 東西側配電室巡查', 'B3F 東西側發電機及消防室巡查', '2F 東西側發電機室巡查', '發電機啟動測試', '配電盤及電氣設備檢查'],
  '給排水設備': ['污廢水井、抽水泵及逆止閥檢查', '排水管路及積水巡查', '飲水及排水設備疏通'],
  '電梯設備': ['電梯運轉巡查', '電梯故障緊急處理'],
  '消防設備': ['消防設備巡查', '消防警報及泵浦測試'],
  '環境與例行工作': ['工具清點', '機電辦公室清潔', '設備機房清潔'],
  '修繕與臨時工作': ['門窗及五金修繕', '照明設備修繕', '現場臨時交辦事項'],
  '其他': ['其他維修養護工作'],
};
const RESULT_OPTIONS = ['正常', '已完成', '處理中', '待料', '待廠商', '交下班續辦', '無法處理'];
const RESULT_TONES: Record<string, string> = {
  '正常': 'ok', '已完成': 'done', '處理中': 'working', '待料': 'waiting', '待廠商': 'waiting', '交下班續辦': 'handoff', '無法處理': 'danger',
};

function todayTaipei() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function weekday(date: string) {
  if (!date) return '';
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'long' }).format(new Date(`${date}T12:00:00+08:00`));
}
function rocDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return year ? `${year - 1911} 年 ${month} 月 ${day} 日（${weekday(date)}）` : '';
}
function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setDate(value.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
}
function dateRange(from: string, to: string) {
  const result: string[] = [];
  let cursor = from;
  for (let i = 0; i < 62 && cursor <= to; i += 1) { result.push(cursor); cursor = shiftDate(cursor, 1); }
  return result;
}
function isDeleted(row: Row) {
  return row.is_deleted === true;
}
function activeEntries(rows: Row[]) {
  return rows.filter(row => !isDeleted(row));
}
function activityTime(value: unknown) {
  if (!value) return '—';
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(parsed);
}
function hasLaterUpdate(row: Row) {
  if (!row.updated_at || !row.created_at || isDeleted(row)) return false;
  return new Date(String(row.updated_at)).getTime() > new Date(String(row.created_at)).getTime();
}

export function MechanicalHandover({ system, module, profile }: Props) {
  const [date, setDate] = useState(todayTaipei());
  const [entries, setEntries] = useState<Row[]>([]);
  const [signatures, setSignatures] = useState<Row[]>([]);
  const [approvals, setApprovals] = useState<Row[]>([]);
  const [approvalNote, setApprovalNote] = useState('');
  const [carryHistory, setCarryHistory] = useState<Row[]>([]);
  const [scheduleRows, setScheduleRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [directoryUsers, setDirectoryUsers] = useState<Row[]>([]);
  const [workCategories, setWorkCategories] = useState<Row[]>([]);
  const [workItems, setWorkItems] = useState<Row[]>([]);
  const [historyItems, setHistoryItems] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');
  const [editingShift, setEditingShift] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<Row | null>(null);
  const [carrySource, setCarrySource] = useState<Row | null>(null);
  const [presetItem, setPresetItem] = useState('');
  const [printOpen, setPrintOpen] = useState(false);
  const [printFrom, setPrintFrom] = useState(date);
  const [printTo, setPrintTo] = useState(date);
  const [printData, setPrintData] = useState<{ dates: string[]; entries: Row[]; signatures: Row[]; approvals: Row[] } | null>(null);
  const [printError, setPrintError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [printRequested, setPrintRequested] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { setPrintData(null); }, [date]);
  useEffect(() => { setApprovalNote(''); }, [date]);
  useEffect(() => {
    const beforePrint = () => {
      document.body.classList.add('mechanical-printing');
      fitMechanicalPrint();
    };
    const afterPrint = () => document.body.classList.remove('mechanical-printing');
    window.addEventListener('beforeprint', beforePrint);
    window.addEventListener('afterprint', afterPrint);
    return () => {
      window.removeEventListener('beforeprint', beforePrint);
      window.removeEventListener('afterprint', afterPrint);
      afterPrint();
    };
  }, []);
  useEffect(() => {
    if (!printRequested || !printData) return;
    let cancelled = false;
    void document.fonts.ready.then(() => requestAnimationFrame(() => {
      if (cancelled) return;
      document.body.classList.add('mechanical-printing');
      fitMechanicalPrint();
      window.print();
      document.body.classList.remove('mechanical-printing');
      setPrintRequested(false);
    }));
    return () => { cancelled = true; };
  }, [printRequested, printData]);
  useEffect(() => {
    if (!previewOpen) return;
    let frame = 0;
    const refresh = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(fitMechanicalReportPreview);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setPreviewOpen(false); };
    refresh();
    void document.fonts.ready.then(refresh);
    window.addEventListener('resize', refresh);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [approvals, date, entries, previewOpen, signatures]);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const historyFrom = shiftDate(date, -90);
    const [work, signs, approvalRows, people, departments, history, carryRows, scheduled, marketScopes, categoryRows, itemRows] = await Promise.all([
      client.from('mechanical_handover_entries').select('*').eq('work_date', date).order('shift_code').order('sort_order').order('created_at'),
      client.from('mechanical_handover_signatures').select('*').eq('work_date', date),
      client.from('mechanical_handover_daily_approvals').select('*').eq('work_date', date),
      client.from('users').select('user_id,name,username,email,department,dept_id,role,rbac_role,status').order('name').limit(1000),
      client.from('departments').select('dept_id,name,parent_id,status,level').eq('name', '機電課').eq('level', 2).eq('status', 'active').limit(20),
      client.from('mechanical_handover_entries').select('work_item').eq('created_by', profile.user_id).eq('is_deleted', false).limit(1000),
      client.from('mechanical_handover_entries').select('*').gte('work_date', historyFrom).lte('work_date', date).order('work_date').order('created_at').limit(5000),
      client.from('mechanical_schedule_assignments').select('user_id,duty_code,market_code,duty_date').eq('duty_date', date).eq('market_code', 'market_2').eq('is_active', true).in('duty_code', SHIFTS.map(shift => shift.code)),
      client.from('mechanical_staff_market_scopes').select('user_id').eq('market_code', 'market_2').eq('is_active', true).limit(1000),
      client.from('mechanical_work_categories').select('*').order('sort_order').order('name'),
      client.from('mechanical_work_items').select('*').order('sort_order').order('name'),
    ]);
    const mechanicalDeptIds = new Set((departments.data || []).map(department => String(department.dept_id)));
    const secondMarketUserIds = new Set((marketScopes.data || []).map(row => String(row.user_id)));
    const scopedPeople = selectableActiveUsers(people.data || []).filter(person => mechanicalDeptIds.has(String(person.dept_id)) && secondMarketUserIds.has(String(person.user_id)));
    const selectableIds = new Set(scopedPeople.map(person => String(person.user_id)));
    const scopedScheduleRows = (scheduled.data || []).filter(row => selectableIds.has(String(row.user_id)));
    const failures = [work.error, signs.error, approvalRows.error, people.error, departments.error, history.error, carryRows.error, scheduled.error, marketScopes.error, categoryRows.error, itemRows.error].filter(Boolean);
    const failure = failures[0];
    if (failure) {
      const localOrigin = typeof window !== 'undefined' && /^(?:localhost|127\.0\.0\.1|\d{1,3}(?:\.\d{1,3}){3})$/.test(window.location.hostname);
      setNote(localOrigin && failures.length >= 3
        ? '失敗：地端資料服務連線設定異常，請通知系統管理員'
        : `失敗：${errorMessage(failure, '機電交接資料載入失敗')}`);
    }
    const itemCounts = new Map<string, number>();
    (history.data || []).forEach(row => { const item = String(row.work_item || ''); if (item) itemCounts.set(item, (itemCounts.get(item) || 0) + 1); });
    setEntries(work.data || []); setSignatures(signs.data || []); setApprovals(approvalRows.data || []); setUsers(scopedPeople); setDirectoryUsers(people.data || []); setCarryHistory(carryRows.data || []); setScheduleRows(scopedScheduleRows);
    setWorkCategories(categoryRows.data || []); setWorkItems(itemRows.data || []);
    setHistoryItems([...itemCounts.entries()].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1]).map(([item]) => item)); setBusy(false);
  }, [date, profile.user_id]);
  useEffect(() => { void load(); }, [load]);

  const userName = useCallback((id: unknown) => directoryUsers.find(user => String(user.user_id) === String(id))?.name || '—', [directoryUsers]);
  const mechanicalUsers = useMemo(() => [...users].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW')), [users]);
  const scheduledIdsFor = useCallback((shiftCode: string) => scheduleRows.filter(row => row.duty_code === shiftCode).map(row => String(row.user_id)), [scheduleRows]);
  const configuredItemNames = useMemo(() => new Set(workItems.filter(row => row.is_active !== false).map(row => String(row.name || ''))), [workItems]);
  const frequentItems = useMemo(() => historyItems.filter(item => configuredItemNames.size ? configuredItemNames.has(item) : Object.values(WORK_ITEMS).some(items => items.includes(item))), [configuredItemNames, historyItems]);
  const byShift = (code: string) => entries.filter(entry => entry.shift_code === code);
  const signFor = (code: string) => signatures.find(sign => sign.shift_code === code);
  const approval = approvals[0];
  const activeShift = currentMechanicalShift(now);
  const role = String(profile.rbac_role || ({ admin: 'sysadmin', supervisor: 'unit_supervisor' } as Record<string, string>)[profile.role] || profile.role || '');
  const canManageOptions = role === 'sysadmin' || (role === 'unit_supervisor' && users.some(user => String(user.user_id) === profile.user_id));
  const hasApprovalRole = role === 'sysadmin' || (role === 'unit_supervisor' && users.some(user => String(user.user_id) === profile.user_id));
  const approvalOpen = canApproveMechanicalDay(date, now);
  const approvalOpenDate = mechanicalApprovalOpensOn(date);
  const canApprove = hasApprovalRole && approvalOpen;
  const currentEntries = activeEntries(entries);
  const deletedEntryCount = entries.length - currentEntries.length;
  const openEntry = (row: Row) => {
    setCarrySource(null); setPresetItem(''); setEditingEntry(row); setEditingShift(String(row.shift_code || ''));
  };
  const carryByShift = useMemo(() => {
    const grouped = new Map<string, Row[]>();
    outstandingMechanicalEntries(carryHistory).forEach(row => {
      const target = carryTargetShift(row, date, now);
      if (target) grouped.set(target, [...(grouped.get(target) || []), row]);
    });
    return grouped;
  }, [carryHistory, date, now]);

  const saveSignature = async (shiftCode: string, userId: string) => {
    setBusy(true); setNote('');
    try {
      await invokeAppApi('handover_save', { kind: 'mechanical_sign', work_date: date, shift_code: shiftCode, signer_id: userId || null });
      await load(); setNote(userId ? '值班人員已簽名' : '已清除值班簽名');
    } catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };
  const approveDaily = async () => {
    if (!canApproveMechanicalDay(date, new Date())) { setNote('本日交接簿須於隔日起由課長簽核'); return; }
    setBusy(true); setNote('');
    try {
      await invokeAppApi('handover_save', { kind: 'mechanical_approve', work_date: date, note: approvalNote.trim() });
      await load(); setNote('本日交接簿已完成課長簽核');
    } catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };
  const preparePrint = async () => {
    if (!printFrom || !printTo || printFrom > printTo || dateRange(printFrom, printTo).length > 31) return;
    setPrintBusy(true); setPrintError('');
    try {
      const client = getSupabase();
      // Paginate so a multi-day report and its cost total cannot silently lose rows.
      const works: Row[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from('mechanical_handover_entries').select('*')
          .gte('work_date', printFrom).lte('work_date', printTo)
          .order('work_date').order('shift_code').order('sort_order').order('created_at').order('entry_id')
          .range(offset, offset + 499);
        if (error) throw error;
        works.push(...(data || []));
        if (!data || data.length < 500) break;
      }
      const { data: signs, error } = await client.from('mechanical_handover_signatures').select('*')
        .gte('work_date', printFrom).lte('work_date', printTo);
      if (error) throw error;
      const { data: approvalData, error: approvalError } = await client.from('mechanical_handover_daily_approvals').select('*')
        .gte('work_date', printFrom).lte('work_date', printTo);
      if (approvalError) throw approvalError;
      setPrintData({ dates: dateRange(printFrom, printTo), entries: works, signatures: signs || [], approvals: approvalData || [] });
      setPrintOpen(false); setPrintRequested(true);
    } catch (error) {
      setPrintError(errorMessage(error, '報表資料讀取失敗，請重試'));
    } finally { setPrintBusy(false); }
  };

  // 今日指標：與另外兩本交接簿相同的四張卡片，數字才看得出輕重。
  const kpis: HandoverKpi[] = [
    { label: '本日有效工作', value: `${currentEntries.length} 件`, icon: 'clipboard', tone: 'cyan' },
    { label: '維修費用合計', value: formatRepairCost(repairCostTotal(currentEntries)), icon: 'note', tone: 'violet' },
    { label: '保留刪除紀錄', value: `${deletedEntryCount} 件`, icon: 'alert', tone: deletedEntryCount ? 'amber' : 'green' },
    { label: '課長簽核', value: approval ? '已簽核' : approvalOpen ? '待簽核' : '隔日開放', icon: approval ? 'check' : 'pen', tone: approval ? 'green' : 'amber' },
  ];

  return <AppShell profile={profile} title={module.title} heading={{ system, module, title: module.title, metaTitle: system.title }}>
    <div className="hs-page">
      <AdminHeader module={module} busy={busy} note={note} onReload={load}
        action={<>{canManageOptions && <button className="secondary-btn compact" disabled={busy} onClick={() => setOptionsOpen(true)}>管理工作選項</button>}<button className="secondary-btn compact" disabled={busy} onClick={() => { setPrintData(null); setPrintRequested(false); setPreviewOpen(true); }}>預覽本日報表</button><button className="primary-btn compact mechanical-print-button" onClick={() => { setPrintFrom(date); setPrintTo(date); setPrintError(''); setPrintOpen(true); }}>列印每日報表</button></>} />
      <section className="panel hs-toolbar">
        <div className="hs-date-nav"><button className="secondary-btn compact" aria-label="前一天" onClick={() => setDate(current => shiftDate(current, -1))}>‹</button><label>報表日期<LocalizedDateInput aria-label="報表日期（年/月/日）" value={date} onChange={event => { if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) setDate(event.target.value); }} /></label><button className="secondary-btn compact" aria-label="後一天" onClick={() => setDate(current => shiftDate(current, 1))}>›</button></div>
        <span>{rocDate(date)}</span>
        <button className="secondary-btn compact" onClick={() => setDate(todayTaipei())}>回到今天</button>
        <div className="mechanical-legend" aria-label="班別色彩說明"><b>班別</b><span className="legend-chip shift-0109">早班 01–09</span><span className="legend-chip shift-0917">中班 09–17</span><span className="legend-chip shift-1701">晚班 17–01</span><span className="legend-chip shift-current">目前當班</span></div>
      </section>
      {frequentItems.length > 0 && <section className="panel mechanical-frequent"><div><b>我的常用工作項目</b><small>依個人紀錄累計 3 次以上</small></div><div className="mechanical-frequent-list">{frequentItems.slice(0, 6).map(item => <button key={item} className="secondary-btn compact" onClick={() => { setEditingEntry(null); setCarrySource(null); setPresetItem(item); setEditingShift('01-09'); }}>{item}</button>)}</div></section>}

      <section className="hs-sheet" aria-label="機電設備交接紀錄">
        <HandoverSheetHeader org="臺北農產運銷股份有限公司　第二批發市場" title="機電設備交接紀錄表"
          dateLabel={rocDate(date)} emblem="tool" kpis={kpis} />
        {currentEntries.some(row => row.repair_cost == null) && <p className="mechanical-cost-note">
          含 {currentEntries.filter(row => row.repair_cost == null).length} 件費用未填，合計僅計入已填金額。</p>}
        <div className="hs-shifts">{SHIFTS.map((shift, index) => {
          const rows = byShift(shift.code);
          const activeRows = activeEntries(rows);
          const deletedRows = rows.length - activeRows.length;
          const carryRows = carryByShift.get(shift.code) || [];
          const isCurrent = date === activeShift.workDate && shift.code === activeShift.shiftCode;
          const scheduledIds = scheduledIdsFor(shift.code);
          const scheduledNames = scheduledIds.map(userName).filter(name => name !== '—');
          const signatureUsers = [...mechanicalUsers].sort((a, b) => Number(scheduledIds.includes(String(b.user_id))) - Number(scheduledIds.includes(String(a.user_id))) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW'));
          return <section className={`hs-shift hs-shift-${index + 1}${isCurrent ? ' is-current' : ''}`} key={shift.code}>
            <div className="hs-shift-head">
              <div className="hs-shift-title">
                <span className="hs-shift-no">{index + 1}</span>
                <div>
                  <div className="hs-shift-name"><b>{['早班', '中班', '晚班'][index]}</b>
                    {isCurrent && <span className="hs-current-badge"><i className="hs-pulse-dot" aria-hidden="true" />當班中</span>}</div>
                  <div className="hs-shift-times">
                    <span className="hs-chip"><HandoverIcon name="clock" size={14} />{shift.label}</span>
                    <span className="hs-chip"><HandoverIcon name="clipboard" size={14} />{activeRows.length} 件{deletedRows ? `（刪除 ${deletedRows}）` : ''}</span>
                    <span className="hs-chip"><HandoverIcon name="note" size={14} />費用 {formatRepairCost(repairCostTotal(activeRows))}</span>
                  </div>
                </div>
              </div>
              <div className="hs-shift-actions">
                <button className="primary-btn compact" disabled={busy || Boolean(approval)} onClick={() => { setEditingEntry(null); setCarrySource(null); setPresetItem(''); setEditingShift(shift.code); }}>＋ 新增工作</button>
              </div>
            </div>
            <div className="hs-shift-body is-single">
            <div className={`mechanical-scheduled-roster${scheduledNames.length ? '' : ' is-empty'}`}><span>二市排班表</span><b>{scheduledNames.length ? scheduledNames.join('、') : '本班尚未排定人員'}</b><a href="/Inspection/v2/systems/handover/mechanical-schedule/">開啟排班表</a></div>
            {carryRows.length > 0 && <div className="mechanical-carry-list" aria-label={`${shift.label}上班續辦工作`}>
              <div className="mechanical-carry-heading"><b>上班未完成 · 待續辦 {carryRows.length} 件</b><small>原紀錄保留；接續處理後會建立本班的新紀錄。</small></div>
              {carryRows.map(row => <article className="mechanical-carry-card" key={String(row.entry_id)}>
                <div><small>{String(row.work_date)} · {SHIFTS.find(item => item.code === row.shift_code)?.label || row.shift_code}</small><strong>{String(row.work_item || '未選常用項目')}</strong><span>{String(row.result || '待續辦')} · {(Array.isArray(row.technician_ids) ? row.technician_ids : []).map(userName).join('、') || '—'}</span></div>
                <button className="secondary-btn compact" disabled={busy || Boolean(approval)} onClick={() => { setEditingEntry(null); setCarrySource(row); setEditingShift(shift.code); }}>接續處理</button>
              </article>)}
            </div>}
            <div className="mechanical-entry-list">{rows.length ? rows.map((row, entryIndex) =>
              <article className={`mechanical-entry-card${isDeleted(row) ? ' is-deleted' : ''}`} key={String(row.entry_id)} role="button" tabIndex={0} aria-label={`第 ${entryIndex + 1} 件：${String(row.work_item || '')}，${isDeleted(row) ? '已刪除，點擊查看' : '點擊修改'}`} onClick={() => openEntry(row)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEntry(row); } }}>
                <div className="mechanical-entry-main"><small><b className="mechanical-entry-number">第 {entryIndex + 1} 件</b>{row.carry_source_id && <b className="mechanical-entry-carry">續辦</b>}{String(row.category || '未分類')}</small><h3>{String(row.work_item || '未選常用項目')}</h3>{row.details && <p>{String(row.details)}</p>}</div>
                <div className="mechanical-entry-people"><small>維修人員</small><p>{(Array.isArray(row.technician_ids) ? row.technician_ids : []).map(userName).join('、') || '—'}</p>{row.notes && <p className="mechanical-entry-note">備註：{String(row.notes)}</p>}</div>
                <div className="mechanical-entry-result"><small>處理結果</small><b className={`result-badge result-${isDeleted(row) ? 'deleted' : RESULT_TONES[String(row.result || '')] || 'neutral'}`}>{isDeleted(row) ? '已刪除' : String(row.result || '—')}</b><small>維修費用</small><strong>{isDeleted(row) ? '—' : row.repair_cost == null ? '未填' : formatRepairCost(repairCostCents(row.repair_cost) || 0)}</strong></div>
                <div className="mechanical-entry-audit"><span>建立 {activityTime(row.created_at)} · {userName(row.created_by)}</span>{hasLaterUpdate(row) && <span>修改 {activityTime(row.updated_at)} · {userName(row.updated_by)}</span>}{isDeleted(row) && <span className="is-delete-event">刪除 {activityTime(row.deleted_at)} · {userName(row.deleted_by)}</span>}<b>{approval ? '已簽核鎖定' : isDeleted(row) ? '保留刪除紀錄' : '點擊修改'}</b></div>
              </article>
            ) : <p className="hs-empty">本班尚無工作紀錄，請按「新增工作」建立。</p>}</div>
            <div className="hs-signs"><div className={`hs-sign${signFor(shift.code)?.signer_id ? ' is-signed' : ''}`}>
              <span className="hs-sign-icon"><HandoverIcon name="pen" size={16} /></span>
              <div><span>值班簽名</span>
                <select disabled={busy || Boolean(approval)} aria-label={`${shift.label}值班人員`} value={String(signFor(shift.code)?.signer_id || '')} onChange={event => void saveSignature(shift.code, event.target.value)}><option value="">— 選擇值班人員 —</option>{signatureUsers.map(user => <option key={String(user.user_id)} value={String(user.user_id)}>{user.name}{scheduledIds.includes(String(user.user_id)) ? '（本班排班）' : '（機電課）'}</option>)}</select>
                <b>{userName(signFor(shift.code)?.signer_id)}{signFor(shift.code)?.updated_at && <small>{activityTime(signFor(shift.code)?.updated_at)}</small>}</b>
              </div>
            </div></div>
            </div>
          </section>;
        })}</div>
        <section className={`hs-approval${approval ? ' is-approved' : canApprove ? ' is-ready' : ''}`} aria-label="每日課長簽核">
          <div className="hs-approval-main">
            <span className="hs-approval-icon"><HandoverIcon name={approval ? 'check' : 'pen'} size={22} /></span>
            <div><span>每日課長簽核</span><strong>{approval ? '本日已完成簽核' : '本日待課長簽核'}</strong><span>{approval ? `${userName(approval.approver_id)} · ${activityTime(approval.approved_at)}` : approvalOpen ? '已開放機電課課長確認當日交接內容。' : `當日不可簽核，最早於 ${approvalOpenDate.replaceAll('-', '/')} 起由機電課課長確認。`}</span></div>
          </div>
          <div className="hs-approval-actions mechanical-approval-actions">
            {approval ? <><b className="hs-approval-seal">核准</b><div className="mechanical-approval-note is-approved"><span>批核意見</span><p>{String(approval.note || '—')}</p></div></> : canApprove ? <><button className="primary-btn" disabled={busy} onClick={() => void approveDaily()}>課長確認簽核</button><label className="mechanical-approval-note"><span>批核意見</span><input value={approvalNote} maxLength={1000} disabled={busy} onChange={event => setApprovalNote(event.target.value)} placeholder="可留白；如有意見請填寫" /></label></> : <span className="hs-muted">{approvalOpen ? '等待課長簽核' : '隔日開放簽核'}</span>}
          </div>
        </section>
      </section>

      {mounted && createPortal(<section className="mechanical-print-preview" aria-label="每日列印報表">
        {(printData?.dates || [date]).map(printDate => <PrintSheet key={printDate} date={printDate}
          entries={(printData?.entries || entries).filter(row => String(row.work_date) === printDate)}
          signatures={(printData?.signatures || signatures).filter(row => String(row.work_date) === printDate)}
          approval={(printData?.approvals || approvals).find(row => String(row.work_date) === printDate)}
          userName={userName} />)}
      </section>, document.body)}
      {mounted && previewOpen && createPortal(<DailyReportPreview date={date} entries={entries} signatures={signatures} approval={approval} userName={userName} onClose={() => setPreviewOpen(false)} onPrint={() => window.print()} />, document.body)}
    </div>
    {printOpen && <PrintRangeModal error={printError} from={printFrom} to={printTo} busy={printBusy} onFrom={setPrintFrom} onTo={setPrintTo} onClose={() => setPrintOpen(false)} onPrint={() => void preparePrint()} />}
    {optionsOpen && <MechanicalWorkOptionsModal categories={workCategories} items={workItems} onClose={() => setOptionsOpen(false)} onDone={load} />}
    {editingShift && <WorkEntryModal date={date} shiftCode={editingShift} users={mechanicalUsers} scheduledUserIds={scheduledIdsFor(editingShift)} categories={workCategories} items={workItems} entry={editingEntry} presetItem={presetItem} carrySource={carrySource} locked={Boolean(approval) || Boolean(editingEntry && isDeleted(editingEntry))} userName={userName} onClose={() => { setEditingShift(null); setEditingEntry(null); setPresetItem(''); setCarrySource(null); }} onDone={async action => { const wasCarry = Boolean(carrySource); setEditingShift(null); setEditingEntry(null); setPresetItem(''); setCarrySource(null); await load(); setNote(action === 'deleted' ? '工作紀錄已標記刪除並保留異動時間' : action === 'updated' ? '工作紀錄已修改並記錄異動時間' : wasCarry ? '上班未完成工作已建立續辦紀錄' : '維修養護工作已新增'); }} />}
  </AppShell>;
}

export function PrintRangeModal({ error, from, to, busy, onFrom, onTo, onClose, onPrint }: { error?: string; from: string; to: string; busy: boolean; onFrom: (value: string) => void; onTo: (value: string) => void; onClose: () => void; onPrint: () => void }) {
  const pages = from && to && from <= to ? dateRange(from, to).length : 0;
  return <AdminModal className="mechanical-modal mechanical-print-modal" title="列印機電交接報表" onClose={onClose}>
    <div className="mechanical-print-range"><label>開始日期<LocalizedDateInput aria-label="列印開始日期" value={from} onChange={event => onFrom(event.target.value)} /></label><span className="mechanical-print-range-arrow" aria-hidden="true">→</span><label>結束日期<LocalizedDateInput aria-label="列印結束日期" value={to} onChange={event => onTo(event.target.value)} /></label></div>
    {error && <p role="alert" className="mechanical-modal-message">{error}</p>}
    <p className="mechanical-print-hint">每一天會產生一頁 A4 報表，最多可列印 31 天（目前 <strong>{pages}</strong> 頁）。</p>
    {(!pages || pages > 31) && <p className="inline-message danger">請確認日期順序，且列印區間不可超過 31 天。</p>}
    <footer><button className="secondary-btn" onClick={onClose}>取消</button><button className="primary-btn compact" disabled={busy || !pages || pages > 31} onClick={onPrint}>{busy ? '準備中…' : '開始列印'}</button></footer>
  </AdminModal>;
}

export function fitMechanicalPrint() {
  document.querySelectorAll<HTMLElement>('.mechanical-print-sheet').forEach(sheet => {
    const content = sheet.querySelector<HTMLElement>('.mechanical-print-content');
    if (!content) return;
    content.style.removeProperty('--mechanical-print-scale');
    if (!sheet.clientHeight || !content.scrollHeight) return;
    const style = window.getComputedStyle(sheet);
    const verticalPadding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const ratio = Math.min(1, (sheet.clientHeight - verticalPadding - 2) / content.scrollHeight);
    content.style.setProperty('--mechanical-print-scale', String(ratio));
  });
}

export function fitMechanicalReportPreview() {
  const preview = document.querySelector<HTMLElement>('.mechanical-report-preview');
  const scroll = preview?.querySelector<HTMLElement>('.mechanical-report-preview-scroll');
  const frame = preview?.querySelector<HTMLElement>('.mechanical-report-preview-page');
  const sheet = frame?.querySelector<HTMLElement>('.mechanical-print-sheet');
  if (!scroll || !frame || !sheet) return;
  fitMechanicalPrint();
  sheet.style.removeProperty('transform');
  const availableWidth = Math.max(240, scroll.clientWidth - 32);
  const scale = Math.min(1, availableWidth / sheet.offsetWidth);
  sheet.style.transform = `scale(${scale})`;
  frame.style.width = `${sheet.offsetWidth * scale}px`;
  frame.style.height = `${sheet.offsetHeight * scale}px`;
}

export function DailyReportPreview({ date, entries, signatures, approval, userName, onClose, onPrint }: { date: string; entries: Row[]; signatures: Row[]; approval?: Row; userName: (id: unknown) => string; onClose: () => void; onPrint: () => void }) {
  return <div className="mechanical-report-preview" role="dialog" aria-modal="true" aria-label="機電交接本日報表預覽">
    <div className="mechanical-report-preview-bar"><div><strong>本日報表預覽</strong><span>{rocDate(date)} · A4 直式一頁，內容過多時自動等比例縮小</span></div><div><button type="button" className="primary-btn compact" onClick={onPrint}>列印本日報表</button><button type="button" className="secondary-btn compact" onClick={onClose}>關閉預覽</button></div></div>
    <div className="mechanical-report-preview-scroll"><div className="mechanical-report-preview-page"><PrintSheet date={date} entries={entries} signatures={signatures} approval={approval} userName={userName} /></div></div>
  </div>;
}

export function PrintSheet({ date, entries, signatures, approval, userName }: { date: string; entries: Row[]; signatures: Row[]; approval?: Row; userName: (id: unknown) => string }) {
  const validEntries = activeEntries(entries);
  return <article className="mechanical-print-sheet"><div className="mechanical-print-content">
    <header><h2>臺北農產運銷股份有限公司第二批發市場<br />機電設備養護紀錄表</h2><p>{rocDate(date)}</p></header>
    <table><colgroup><col className="print-shift" /><col className="print-work" /><col className="print-people" /><col className="print-result" /><col className="print-notes" /><col className="print-cost" /></colgroup>
      <thead><tr><th>班別</th><th>維修養護工作內容</th><th>維修人員</th><th>處理結果</th><th>備註</th><th>費用（元）</th></tr></thead>
      {SHIFTS.map((shift, index) => {
        const rows = entries.filter(row => row.shift_code === shift.code);
        const validRows = activeEntries(rows);
        const deletedRows = rows.length - validRows.length;
        return <tbody className="mechanical-print-shift" key={shift.code}>{(rows.length ? rows : [null]).map((row, rowIndex) => <tr className={row && isDeleted(row) ? 'is-deleted' : ''} key={row ? String(row.entry_id) : 'empty'}>
          {rowIndex === 0 && <th rowSpan={Math.max(1, rows.length)}>{['早班', '中班', '晚班'][index]}<br />{shift.label}<br />共 {validRows.length} 件{deletedRows ? <><br />刪除 {deletedRows} 件</> : null}</th>}
          <td>{row ? <><b>{rowIndex + 1}. {String(row.work_item || '未選常用項目')}</b>{row.details && <p>{String(row.details)}</p>}</> : '尚無工作紀錄'}</td>
          <td>{row ? (Array.isArray(row.technician_ids) ? row.technician_ids : []).map(userName).join('、') || '—' : '—'}</td>
          <td>{row ? isDeleted(row) ? '已刪除' : String(row.result || '—') : '—'}</td><td>{row ? <>{String(row.notes || '—')}{isDeleted(row) && <small className="mechanical-print-delete-time">刪除：{activityTime(row.deleted_at)}</small>}</> : '—'}</td>
          <td>{row && !isDeleted(row) && row.repair_cost != null ? formatRepairCost(repairCostCents(row.repair_cost) || 0).replace('NT$ ', '') : row && isDeleted(row) ? '—' : '未填'}</td>
        </tr>)}</tbody>;
      })}
    </table>
    <div className="mechanical-print-total"><strong>本日維修費用合計：{formatRepairCost(repairCostTotal(validEntries))}</strong><span>費用未填 {validEntries.filter(row => row.repair_cost == null).length} 件（不計入合計）</span></div>
    <div className="mechanical-print-signatures"><b>值班簽名</b>{SHIFTS.map(shift => <span key={shift.code}>{shift.label}<strong>{userName(signatures.find(sign => sign.shift_code === shift.code)?.signer_id)}</strong></span>)}</div>
    <div className="mechanical-print-approval"><b>課長簽核</b><span className="mechanical-print-approval-detail"><strong>{approval ? userName(approval.approver_id) : '待簽核'}</strong>{approval && <b className="mechanical-print-approval-seal">核可</b>}</span><span>{approval?.approved_at ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(String(approval.approved_at))) : '—'}</span><span className="mechanical-print-approval-note"><b>批核意見：</b>{approval?.note ? String(approval.note) : '　'}</span></div>
  </div></article>;
}

export function MechanicalWorkOptionsModal({ categories, items, onClose, onDone }: { categories: Row[]; items: Row[]; onClose: () => void; onDone: () => Promise<void> }) {
  const orderedCategories = useMemo(() => [...categories].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW')), [categories]);
  const [selectedCategoryId, setSelectedCategoryId] = useState(String(orderedCategories.find(row => row.is_active !== false)?.category_id || orderedCategories[0]?.category_id || ''));
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});
  const [itemDrafts, setItemDrafts] = useState<Record<string, string>>({});
  const [newCategory, setNewCategory] = useState('');
  const [newItem, setNewItem] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setCategoryDrafts(Object.fromEntries(categories.map(row => [String(row.category_id), String(row.name || '')])));
    setItemDrafts(Object.fromEntries(items.map(row => [String(row.item_id), String(row.name || '')])));
    if (!selectedCategoryId && categories.length) setSelectedCategoryId(String(categories.find(row => row.is_active !== false)?.category_id || categories[0].category_id));
  }, [categories, items, selectedCategoryId]);
  const selectedCategory = orderedCategories.find(row => String(row.category_id) === selectedCategoryId);
  const visibleItems = [...items].filter(row => String(row.category_id) === selectedCategoryId)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW'));
  const run = async (payload: Record<string, unknown>, success: string) => {
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('handover_save', { kind: 'mechanical_work_option', ...payload });
      await onDone(); setMessage(success); return true;
    } catch (error) { setMessage(`失敗：${errorMessage(error)}`); return false; }
    finally { setBusy(false); }
  };
  const addCategory = async () => {
    if (!newCategory.trim()) { setMessage('請輸入新的工作分類名稱'); return; }
    if (await run({ entity: 'category', operation: 'create', name: newCategory }, '工作分類已新增')) setNewCategory('');
  };
  const addItem = async () => {
    if (!selectedCategoryId) { setMessage('請先選擇工作分類'); return; }
    if (!newItem.trim()) { setMessage('請輸入新的常用工作項目'); return; }
    if (await run({ entity: 'item', operation: 'create', category_id: selectedCategoryId, name: newItem }, '常用工作項目已新增')) setNewItem('');
  };
  return <AdminModal className="mechanical-modal mechanical-options-modal" title="管理機電工作選項" onClose={onClose}>
    <div className="mechanical-options-intro"><b>工作選項主檔</b><span>新增與修改會立即套用；刪除採停用，既有交接紀錄仍保留原文字與稽核時間。</span></div>
    <div className="mechanical-options-columns">
      <section>
        <header><div><b>工作分類</b><small>{orderedCategories.filter(row => row.is_active !== false).length} 個使用中</small></div></header>
        <div className="mechanical-option-add"><input aria-label="新增工作分類" value={newCategory} onChange={event => setNewCategory(event.target.value)} placeholder="輸入新分類" /><button className="primary-btn compact" disabled={busy} onClick={() => void addCategory()}>新增</button></div>
        <div className="mechanical-option-list">{orderedCategories.map(row => {
          const optionId = String(row.category_id), active = row.is_active !== false;
          return <div className={`mechanical-option-row${active ? '' : ' is-inactive'}${selectedCategoryId === optionId ? ' is-selected' : ''}`} key={optionId}>
            <button className="mechanical-option-pick" aria-label={`選擇${String(row.name)}`} onClick={() => setSelectedCategoryId(optionId)}>{active ? '●' : '○'}</button>
            <input aria-label={`${String(row.name)}分類名稱`} disabled={!active || busy} value={categoryDrafts[optionId] ?? ''} onChange={event => setCategoryDrafts(current => ({ ...current, [optionId]: event.target.value }))} />
            {active ? <><button className="secondary-btn compact" disabled={busy || !categoryDrafts[optionId]?.trim()} onClick={() => void run({ entity: 'category', operation: 'update', option_id: optionId, name: categoryDrafts[optionId] }, '工作分類已修改')}>儲存</button><button className="danger-btn compact" disabled={busy} onClick={() => { if (window.confirm('刪除此分類會同時停用其常用工作項目，確定繼續？')) void run({ entity: 'category', operation: 'deactivate', option_id: optionId }, '工作分類與所屬項目已停用'); }}>刪除</button></> : <button className="secondary-btn compact" disabled={busy} onClick={() => void run({ entity: 'category', operation: 'activate', option_id: optionId }, '工作分類已恢復')}>恢復</button>}
          </div>;
        })}</div>
      </section>
      <section>
        <header><div><b>常用工作項目</b><small>{selectedCategory ? String(selectedCategory.name || '') : '請選分類'}</small></div><label>切換分類<select value={selectedCategoryId} onChange={event => setSelectedCategoryId(event.target.value)}><BlankSelectOption />{orderedCategories.map(row => <option key={String(row.category_id)} value={String(row.category_id)}>{String(row.name)}{row.is_active === false ? '（已停用）' : ''}</option>)}</select></label></header>
        <div className="mechanical-option-add"><input aria-label="新增常用工作項目" disabled={!selectedCategoryId || selectedCategory?.is_active === false} value={newItem} onChange={event => setNewItem(event.target.value)} placeholder="輸入新工作項目" /><button className="primary-btn compact" disabled={busy || !selectedCategoryId || selectedCategory?.is_active === false} onClick={() => void addItem()}>新增</button></div>
        <div className="mechanical-option-list">{visibleItems.length ? visibleItems.map(row => {
          const optionId = String(row.item_id), active = row.is_active !== false;
          return <div className={`mechanical-option-row${active ? '' : ' is-inactive'}`} key={optionId}>
            <span className="mechanical-option-state">{active ? '●' : '○'}</span>
            <input aria-label={`${String(row.name)}項目名稱`} disabled={!active || busy} value={itemDrafts[optionId] ?? ''} onChange={event => setItemDrafts(current => ({ ...current, [optionId]: event.target.value }))} />
            {active ? <><button className="secondary-btn compact" disabled={busy || !itemDrafts[optionId]?.trim()} onClick={() => void run({ entity: 'item', operation: 'update', option_id: optionId, category_id: selectedCategoryId, name: itemDrafts[optionId] }, '常用工作項目已修改')}>儲存</button><button className="danger-btn compact" disabled={busy} onClick={() => void run({ entity: 'item', operation: 'deactivate', option_id: optionId, category_id: selectedCategoryId }, '常用工作項目已停用')}>刪除</button></> : <button className="secondary-btn compact" disabled={busy || selectedCategory?.is_active === false} onClick={() => void run({ entity: 'item', operation: 'activate', option_id: optionId, category_id: selectedCategoryId }, '常用工作項目已恢復')}>恢復</button>}
          </div>;
        }) : <p className="mechanical-options-empty">這個分類尚無工作項目。</p>}</div>
      </section>
    </div>
    {message && <p role="status" className="mechanical-options-message">{message}</p>}
    <footer><button className="secondary-btn" onClick={onClose}>完成</button></footer>
  </AdminModal>;
}

export function WorkEntryModal({ date, shiftCode, users, scheduledUserIds, categories, items, entry, presetItem = '', carrySource, locked, userName, onClose, onDone }: { date: string; shiftCode: string; users: Row[]; scheduledUserIds: string[]; categories: Row[]; items: Row[]; entry?: Row | null; presetItem?: string; carrySource?: Row | null; locked: boolean; userName: (id: unknown) => string; onClose: () => void; onDone: (action: 'created' | 'updated' | 'deleted') => void }) {
  const sourceRow = entry || carrySource;
  const sourceItem = String(sourceRow?.work_item || presetItem || '');
  const categoryNameById = new Map(categories.map(row => [String(row.category_id), String(row.name || '')]));
  const configuredCategory = items.find(row => String(row.name || '') === sourceItem);
  const initialCategory = String(sourceRow?.category || categoryNameById.get(String(configuredCategory?.category_id || '')) || Object.keys(WORK_ITEMS).find(category => WORK_ITEMS[category].includes(sourceItem)) || '');
  const [category, setCategory] = useState(initialCategory);
  const [item, setItem] = useState(sourceItem);
  const [details, setDetails] = useState(String(sourceRow?.details || ''));
  const selectableUserIds = new Set(users.map(user => String(user.user_id)));
  const [technicians, setTechnicians] = useState<string[]>((Array.isArray(sourceRow?.technician_ids) ? sourceRow.technician_ids.map(String) : scheduledUserIds).filter(userId => selectableUserIds.has(userId)));
  const [result, setResult] = useState(entry ? String(entry.result || '正常') : carrySource ? '處理中' : '正常');
  const [notes, setNotes] = useState(String(sourceRow?.notes || ''));
  const [repairCost, setRepairCost] = useState(entry?.repair_cost == null ? '' : String(entry.repair_cost));
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const changeCategory = (value: string) => { setCategory(value); setItem(''); };
  const toggleTechnician = (id: string) => setTechnicians(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const submit = async () => {
    if (locked) return;
    if ((!item && !details.trim()) || !technicians.length) { setMessage('請選擇常用工作項目或填寫工作補充說明，並至少選擇一位維修人員'); return; }
    if (repairCostCents(repairCost) === undefined) { setMessage('維修費用請輸入 0 至 999,999,999.99 的金額，最多兩位小數'); return; }
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('handover_save', { kind: entry ? 'mechanical_entry_update' : 'mechanical_entry', entry_id: entry?.entry_id, work_date: date, shift_code: shiftCode, category, work_item: item, details, technician_ids: technicians, result, notes, repair_cost: repairCost.trim() || null, carry_source_id: carrySource?.entry_id || null });
      await onDone(entry ? 'updated' : 'created');
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  };
  const remove = async () => {
    if (!entry || locked) return;
    if (!confirmDelete) { setConfirmDelete(true); setMessage('刪除後紀錄仍會保留並以刪除線顯示；請再按一次確認刪除。'); return; }
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('handover_save', { kind: 'mechanical_entry_delete', entry_id: entry.entry_id });
      await onDone('deleted');
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  };
  const configuredCategories = categories.filter(row => row.is_active !== false).map(row => String(row.name || '')).filter(Boolean);
  const categoryOptions = [...new Set([...(category ? [category] : []), ...(configuredCategories.length ? configuredCategories : Object.keys(WORK_ITEMS))])];
  const categoryId = categories.find(row => String(row.name || '') === category)?.category_id;
  const configuredItems = items.filter(row => row.is_active !== false && String(row.category_id) === String(categoryId || '')).map(row => String(row.name || '')).filter(Boolean);
  const itemOptions = [...new Set([...(item ? [item] : []), ...(categories.length ? configuredItems : (WORK_ITEMS[category] || []))])];
  const sortedUsers = [...users].sort((a, b) => Number(scheduledUserIds.includes(String(b.user_id))) - Number(scheduledUserIds.includes(String(a.user_id))) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW'));
  const title = entry ? locked ? '查看機電工作' : '修改機電工作' : carrySource ? '接續處理' : '新增機電工作';
  return <AdminModal className="mechanical-modal mechanical-work-modal" title={`${title}｜${SHIFTS.find(shift => shift.code === shiftCode)?.label}`} onClose={onClose}>
    {carrySource && <div className="mechanical-carry-source"><b>上班續辦</b><span>{String(carrySource.work_date)} · {SHIFTS.find(shift => shift.code === carrySource.shift_code)?.label}</span><strong>{String(carrySource.work_item || '')}</strong><small>原紀錄不會被修改，本次儲存會建立新的續辦紀錄。</small></div>}
    {entry && <div className={`mechanical-edit-history${isDeleted(entry) ? ' is-deleted' : ''}`}><b>{isDeleted(entry) ? '已刪除紀錄' : locked ? '本日已簽核，僅可查看' : '異動時間紀錄'}</b><span>建立：{activityTime(entry.created_at)} · {userName(entry.created_by)}</span>{hasLaterUpdate(entry) && <span>修改：{activityTime(entry.updated_at)} · {userName(entry.updated_by)}</span>}{isDeleted(entry) && <span>刪除：{activityTime(entry.deleted_at)} · {userName(entry.deleted_by)}</span>}</div>}
    <div className="admin-form-grid mechanical-form">
      <label>工作分類<select disabled={locked} value={category} onChange={event => changeCategory(event.target.value)}><BlankSelectOption />{categoryOptions.map(value => <option key={value} value={value}>{value}</option>)}</select><small className="mechanical-blank-hint">第一列為空白，可不選分類。</small></label>
      <label>常用工作項目<select disabled={locked} value={item} onChange={event => setItem(event.target.value)}><BlankSelectOption />{itemOptions.map(value => <option key={value} value={value}>{value}</option>)}</select><small className="mechanical-blank-hint">第一列為空白；留白時請填寫下方說明。</small></label>
      <label className="wide">工作補充說明<textarea disabled={locked} rows={3} value={details} onChange={event => setDetails(event.target.value)} placeholder="例如：設備位置、異常狀況或實際處理內容" /></label>
      <fieldset className="wide" disabled={locked}><legend>維修人員（可複選） · 已選 {technicians.length} 人</legend><p className={`mechanical-roster-hint${scheduledUserIds.length ? '' : ' is-empty'}`}>{scheduledUserIds.length ? `已由二市排班表帶入本班 ${scheduledUserIds.length} 人，可依實際支援情形增減。` : '二市排班表尚未安排本班人員，請手動選擇或先完成排班。'}</p><div className="mechanical-person-grid">{sortedUsers.map(user => <label className={scheduledUserIds.includes(String(user.user_id)) ? 'is-scheduled' : ''} key={String(user.user_id)}><input type="checkbox" checked={technicians.includes(String(user.user_id))} onChange={() => toggleTechnician(String(user.user_id))} /><span>{user.name}</span><small>{scheduledUserIds.includes(String(user.user_id)) ? '本班排班' : '機電課'}</small></label>)}</div></fieldset>
      <label>處理結果<select disabled={locked} value={result} onChange={event => setResult(event.target.value)}>{RESULT_OPTIONS.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>維修費用（新臺幣元）<input disabled={locked} aria-label="維修費用（新臺幣元）" inputMode="decimal" value={repairCost} onChange={event => setRepairCost(event.target.value)} placeholder="未填可留白，無費用填 0" /></label>
      <label className="wide">備註<input disabled={locked} value={notes} onChange={event => setNotes(event.target.value)} placeholder="待辦、交班或其他說明" /></label>
    </div>
    {message && <p role="alert" className="mechanical-modal-message">{message}</p>}
    <footer><button className="secondary-btn" onClick={onClose}>{locked ? '關閉' : '取消'}</button>{entry && !locked && <button className="danger-btn compact" disabled={busy} onClick={() => void remove()}>{confirmDelete ? '確認刪除' : '刪除紀錄'}</button>}{!locked && <button className="primary-btn compact" disabled={busy} onClick={() => void submit()}>{busy ? '儲存中…' : entry ? '儲存修改' : carrySource ? '建立續辦紀錄' : '新增工作紀錄'}</button>}</footer>
  </AdminModal>;
}
