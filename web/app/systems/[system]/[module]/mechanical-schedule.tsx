'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AdminHeader, errorMessage, type Row } from '@/components/admin/shared';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { selectableActiveUsers } from '@/lib/user-visibility';
import {
  copyPreviousMonthDraft, isMechanicalWorkCode, scheduleCalendarDates, scheduleDateOffset, scheduleMonthDates,
  shiftScheduleMonth, validateMechanicalSchedule,
} from '@/lib/mechanical-schedule';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import './mechanical-schedule.css';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };
type MarketCode = 'market_1' | 'market_2';
type WorkCode = '01-09' | '09-17' | '17-01';

const MARKET_LABELS: Record<MarketCode, string> = { market_1: '第一果菜批發市場', market_2: '第二果菜批發市場' };
const WORK_SHIFTS: Array<{ code: WorkCode; name: string; time: string; short: string }> = [
  { code: '01-09', name: '早班', time: '01:00–09:00', short: '早' },
  { code: '09-17', name: '中班', time: '09:00–17:00', short: '中' },
  { code: '17-01', name: '晚班', time: '17:00–翌日 01:00', short: '晚' },
];
const ROC_WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

function todayISO() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function todayMonth() { return todayISO().slice(0, 7); }
function monthTitle(month: string) {
  const [year, value] = month.split('-').map(Number);
  return `民國 ${year - 1911} 年 ${value} 月`;
}
function weekday(date: string) { return ROC_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()]; }
function isWeekend(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}
function rocDay(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return `民國 ${year - 1911} 年 ${month} 月 ${day} 日（星期${weekday(date)}）`;
}
function keyOf(userId: unknown, date: string) { return `${String(userId)}|${date}`; }

export function MechanicalSchedule({ system, module, profile }: Props) {
  const [month, setMonth] = useState(todayMonth());
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [market, setMarket] = useState<MarketCode>('market_1');
  const [allUsers, setAllUsers] = useState<Row[]>([]);
  const [marketScopes, setMarketScopes] = useState<Row[]>([]);
  const [persisted, setPersisted] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [savingScope, setSavingScope] = useState('');
  const [note, setNote] = useState('');

  const dates = useMemo(() => scheduleMonthDates(month), [month]);
  const calendarDates = useMemo(() => scheduleCalendarDates(month), [month]);
  const monthStart = dates[0] || `${month}-01`;
  const monthEnd = dates.at(-1) || monthStart;

  useEffect(() => {
    if (!selectedDate.startsWith(`${month}-`)) setSelectedDate(monthStart);
  }, [month, monthStart, selectedDate]);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const rangeStart = scheduleDateOffset(monthStart, -7), rangeEnd = scheduleDateOffset(monthEnd, 8);
    const client = getSupabase();
    const [people, departments, schedule, scopes] = await Promise.all([
      client.from('users').select('user_id,name,username,email,dept_id,status').eq('status', 'active').order('name').limit(1000),
      client.from('departments').select('dept_id,name,level,status').eq('name', '機電課').eq('level', 2).eq('status', 'active').limit(20),
      client.from('mechanical_schedule_assignments').select('*').gte('duty_date', rangeStart).lt('duty_date', rangeEnd).eq('is_active', true).order('duty_date').limit(5000),
      client.from('mechanical_staff_market_scopes').select('user_id,market_code,is_active,updated_at').eq('is_active', true).limit(1000),
    ]);
    const failure = people.error || departments.error || schedule.error || scopes.error;
    if (failure) { setNote(`失敗：${failure.message || '機電課排班資料載入失敗'}`); setBusy(false); return; }
    const departmentIds = new Set((departments.data || []).map(row => String(row.dept_id)));
    const staff = selectableActiveUsers(people.data || []).filter(row => departmentIds.has(String(row.dept_id)))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW'));
    const rows = schedule.data || [];
    const nextDraft: Record<string, string> = {};
    rows.filter(row => row.market_code === market && String(row.duty_date).startsWith(`${month}-`) && isMechanicalWorkCode(row.duty_code))
      .forEach(row => { nextDraft[keyOf(row.user_id, String(row.duty_date))] = String(row.duty_code || ''); });
    setAllUsers(staff); setMarketScopes(scopes.data || []); setPersisted(rows); setDraft(nextDraft); setBusy(false);
  }, [market, month, monthEnd, monthStart]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const clear = () => document.body.classList.remove('mechanical-schedule-printing');
    window.addEventListener('afterprint', clear);
    return () => { window.removeEventListener('afterprint', clear); clear(); };
  }, []);

  const scopeByUser = useMemo(() => new Map(marketScopes.map(row => [String(row.user_id), String(row.market_code)])), [marketScopes]);
  const users = useMemo(() => allUsers.filter(user => scopeByUser.get(String(user.user_id)) === market), [allUsers, market, scopeByUser]);
  const marketOneCount = allUsers.filter(user => scopeByUser.get(String(user.user_id)) === 'market_1').length;
  const marketTwoCount = allUsers.filter(user => scopeByUser.get(String(user.user_id)) === 'market_2').length;
  const unassignedCount = allUsers.length - marketOneCount - marketTwoCount;

  const candidateRows = useMemo(() => users.flatMap(user => dates.flatMap(date => {
    const dutyCode = draft[keyOf(user.user_id, date)];
    return isMechanicalWorkCode(dutyCode) ? [{ user_id: String(user.user_id), duty_date: date, duty_code: dutyCode, market_code: market }] : [];
  })), [dates, draft, market, users]);
  const combinedRows = useMemo(() => persisted
    .filter(row => !(row.market_code === market && String(row.duty_date).startsWith(`${month}-`)))
    .concat(candidateRows), [candidateRows, market, month, persisted]);
  const violations = useMemo(() => validateMechanicalSchedule(combinedRows, { start: monthStart, end: monthEnd }), [combinedRows, monthEnd, monthStart]);
  const errors = violations.filter(item => item.severity === 'error');
  const warnings = violations.filter(item => item.severity === 'warning');
  const invalidCells = useMemo(() => new Set(errors.map(item => keyOf(item.userId, item.date))), [errors]);
  const names = useMemo(() => new Map(users.map(user => [String(user.user_id), String(user.name || '未命名')])), [users]);
  const currentRows = persisted.filter(row => row.market_code === market && String(row.duty_date).startsWith(`${month}-`));
  const latest = [...currentRows].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0];

  const dutyFor = useCallback((userId: unknown, date: string) => {
    if (date.startsWith(`${month}-`)) return draft[keyOf(userId, date)] || '';
    const row = persisted.find(item => item.market_code === market && String(item.user_id) === String(userId)
      && String(item.duty_date) === date && item.is_active !== false && isMechanicalWorkCode(item.duty_code));
    return String(row?.duty_code || '');
  }, [draft, market, month, persisted]);
  const assignedUsers = useCallback((date: string, code: WorkCode) => users.filter(user => dutyFor(user.user_id, date) === code), [dutyFor, users]);
  const assignedShiftCount = dates.reduce((total, date) => total + WORK_SHIFTS.filter(shift => assignedUsers(date, shift.code).length > 0).length, 0);
  const openShiftCount = Math.max(0, dates.length * WORK_SHIFTS.length - assignedShiftCount);

  const assignUser = (date: string, code: WorkCode, userId: string) => {
    if (!userId || !date.startsWith(`${month}-`)) return;
    setDraft(current => ({ ...current, [keyOf(userId, date)]: code }));
    setNote('');
  };
  const removeUser = (date: string, userId: unknown) => {
    setDraft(current => ({ ...current, [keyOf(userId, date)]: '' }));
    setNote('');
  };
  const openDate = (date: string) => {
    if (!date.startsWith(`${month}-`)) setMonth(date.slice(0, 7));
    setSelectedDate(date);
  };
  const saveMarketScope = async (user: Row, nextMarket: string) => {
    const userId = String(user.user_id || '');
    const currentMarket = scopeByUser.get(userId) || '';
    if (!userId || nextMarket === currentMarket) return;
    const nextLabel = nextMarket ? MARKET_LABELS[nextMarket as MarketCode] : '待分配';
    const confirmed = window.confirm(`確定將「${String(user.name || '此人員')}」設定為${nextLabel}？\n今日起不符合新市場歸屬的既有班次會停用並保留異動紀錄。`);
    if (!confirmed) return;
    setSavingScope(userId); setNote('');
    try {
      await invokeAppApi('handover_save', { kind: 'mechanical_staff_market_save', user_id: userId, market_code: nextMarket || null });
      await load();
      setNote(`${String(user.name || '機電課人員')}已設定為${nextLabel}，一市與二市名單保持分離。`);
    } catch (error) { setNote(`失敗：${errorMessage(error)}`); }
    finally { setSavingScope(''); }
  };
  const copyPreviousMonth = async () => {
    const sourceMonth = shiftScheduleMonth(month, -1);
    if (!users.length) { setNote(`${MARKET_LABELS[market]}尚未分配機電課人員，無法複製班表。`); return; }
    const confirmed = window.confirm(`確定將${monthTitle(sourceMonth)}的${MARKET_LABELS[market]}班表複製到${monthTitle(month)}？\n將依相同日期複製（1 日對應 1 日），取代目前畫面中的本月草稿；確認儲存前不會寫入資料庫。`);
    if (!confirmed) return;
    setCopying(true); setNote('');
    try {
      const client = getSupabase();
      const { data, error } = await client.from('mechanical_schedule_assignments').select('user_id,duty_date,duty_code,market_code,is_active')
        .eq('market_code', market).eq('is_active', true).gte('duty_date', `${sourceMonth}-01`).lt('duty_date', `${month}-01`).order('duty_date').limit(5000);
      if (error) throw error;
      const copiedDraft = copyPreviousMonthDraft(data || [], month, market, users.map(user => user.user_id));
      const copiedCount = Object.keys(copiedDraft).length;
      if (!copiedCount) { setNote(`${MARKET_LABELS[market]} ${monthTitle(sourceMonth)}尚無可複製的班表。`); return; }
      setDraft(copiedDraft);
      setSelectedDate(monthStart);
      setNote(`已將${monthTitle(sourceMonth)}的 ${copiedCount} 筆排班複製為本月草稿；請確認勞基法檢核後再儲存。`);
    } catch (error) { setNote(`失敗：${errorMessage(error)}`); }
    finally { setCopying(false); }
  };
  const save = async () => {
    if (errors.length) { setNote('班表有紅色違規項目，修正後才能儲存。'); return; }
    setSaving(true); setNote('');
    try {
      await invokeAppApi('handover_save', { kind: 'mechanical_schedule_save', year_month: month, market_code: market, assignments: candidateRows });
      await load();
      setNote(`${MARKET_LABELS[market]} ${monthTitle(month)}班表已儲存，並已提供機電交接簿讀取。`);
    } catch (error) { setNote(`失敗：${errorMessage(error)}`); }
    finally { setSaving(false); }
  };
  const print = () => {
    document.body.classList.add('mechanical-schedule-printing');
    window.setTimeout(() => window.print(), 80);
  };

  return <AppShell profile={profile} title={module.title} heading={{ system, module, title: module.title, metaTitle: system.title }}>
    <div className="mechanical-schedule-page">
      <AdminHeader module={module} busy={busy} note={note} onReload={() => void load()} action={<><button className="secondary-btn compact" disabled={busy || saving || copying} onClick={() => void copyPreviousMonth()}>{copying ? '複製中…' : '複製上月班表'}</button><button className="secondary-btn compact" disabled={busy} onClick={print}>列印本月班表</button><button className="primary-btn compact" disabled={busy || saving || copying || errors.length > 0} onClick={() => void save()}>{saving ? '儲存中…' : openShiftCount ? '儲存草稿' : '儲存班表'}</button></>} />

      <section className="panel mechanical-schedule-toolbar">
        <div className="mechanical-schedule-month"><button className="secondary-btn compact" aria-label="前一個月" onClick={() => setMonth(current => shiftScheduleMonth(current, -1))}>‹</button><div><small>萬年曆月份</small><b>{monthTitle(month)}</b></div><button className="secondary-btn compact" aria-label="後一個月" onClick={() => setMonth(current => shiftScheduleMonth(current, 1))}>›</button><button className="secondary-btn compact" onClick={() => { setMonth(todayMonth()); setSelectedDate(todayISO()); }}>本月</button></div>
        <div className="mechanical-market-tabs" role="group" aria-label="市場別"><button className={market === 'market_1' ? 'is-active' : ''} aria-pressed={market === 'market_1'} onClick={() => setMarket('market_1')}>一市</button><button className={market === 'market_2' ? 'is-active' : ''} aria-pressed={market === 'market_2'} onClick={() => setMarket('market_2')}>二市</button></div>
      </section>

      <details className="panel mechanical-staff-market-scope" open={unassignedCount > 0}>
        <summary><span><small>人員市場歸屬</small><b>一市 {marketOneCount} 人・二市 {marketTwoCount} 人・待分配 {unassignedCount} 人</b></span><strong>{unassignedCount ? '請先完成名單分流' : '展開設定'}</strong></summary>
        <p>每位機電課同仁只能歸屬一個市場；改派後不會同時出現在另一市場的排班或交接簿。</p>
        <div className="mechanical-staff-market-grid">{allUsers.map(user => {
          const userId = String(user.user_id);
          return <label key={userId}><span><b>{String(user.name || '未命名')}</b><small>{scopeByUser.get(userId) ? MARKET_LABELS[scopeByUser.get(userId) as MarketCode] : '尚未分配市場'}</small></span><select aria-label={`${String(user.name || '機電課人員')}市場歸屬`} disabled={busy || Boolean(savingScope)} value={scopeByUser.get(userId) || ''} onChange={event => void saveMarketScope(user, event.target.value)}><option value="">待分配</option><option value="market_1">第一果菜批發市場</option><option value="market_2">第二果菜批發市場</option></select></label>;
        })}</div>
      </details>

      <section className="mechanical-schedule-summary" aria-label="排班摘要">
        <article><small>{market === 'market_1' ? '一市' : '二市'}機電課人員</small><strong>{users.length}</strong><span>僅顯示本市場名單</span></article>
        <article><small>已排班次</small><strong>{assignedShiftCount}</strong><span>共 {candidateRows.length * 8} 人時</span></article>
        <article><small>尚未排班別</small><strong>{openShiftCount}</strong><span>{openShiftCount ? '可先儲存草稿' : '三班皆已安排'}</span></article>
        <article className={errors.length ? 'is-danger' : 'is-safe'}><small>勞基法卡控</small><strong>{errors.length}</strong><span>{errors.length ? '項必須修正' : '目前無違規'}</span></article>
      </section>

      <section className="panel mechanical-legal-rules">
        <div><b>11 小時</b><span>更換班次前，至少連續休息 11 小時。</span></div>
        <div><b>8／40 小時</b><span>每天最多一班 8 小時，每週正常工時最多 40 小時。</span></div>
        <div><b>7 日保留 2 日</b><span>任一連續 7 日最多工作 5 日，不得連續工作超過 6 日。</span></div>
        <p>一市、二市分開排班，但同一人的工時會跨市場合併檢查。變形工時例外未啟用。<a href="https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001" target="_blank" rel="noreferrer">查看勞動基準法</a></p>
      </section>

      {(errors.length > 0 || warnings.length > 0) && <section className={`panel mechanical-schedule-checks${errors.length ? ' has-errors' : ''}`}>
        <header><div><small>即時自動檢核</small><h3>{errors.length ? `發現 ${errors.length} 項違規，已禁止儲存` : '尚有排班提醒'}</h3></div><span>{warnings.length} 項提醒</span></header>
        <div>{[...errors, ...warnings].slice(0, 16).map((item, index) => <p className={item.severity} key={`${item.rule}-${item.userId}-${item.date}-${index}`}><b>{names.get(item.userId) || '機電課同仁'}</b><span>{item.date}｜{item.message}</span></p>)}</div>
      </section>}

      <section className="panel mechanical-day-editor" aria-label="單日三班排班">
        <header><div><small>{MARKET_LABELS[market]}</small><h2>{rocDay(selectedDate)}</h2><p>一天固定早、中、晚三班；從下拉選單加入當班人員，同一班可安排多人。</p></div><span className={errors.some(item => item.date === selectedDate) ? 'is-danger' : ''}>{errors.filter(item => item.date === selectedDate).length ? `${errors.filter(item => item.date === selectedDate).length} 項違規` : '即時檢核中'}</span></header>
        <div className="mechanical-shift-editor-grid">{WORK_SHIFTS.map(shift => {
          const assigned = assignedUsers(selectedDate, shift.code);
          return <article className={`duty-${shift.code}`} key={shift.code}><div><b>{shift.name}</b><span>{shift.time}</span></div><label>加入當班人員<select value="" disabled={busy} onChange={event => { assignUser(selectedDate, shift.code, event.target.value); event.target.value = ''; }}><option value="">— 選擇機電課人員 —</option>{users.map(user => {
            const currentDuty = dutyFor(user.user_id, selectedDate);
            const currentShift = WORK_SHIFTS.find(item => item.code === currentDuty);
            return <option value={String(user.user_id)} key={String(user.user_id)}>{String(user.name || '')}{currentShift ? `（目前${currentShift.name}）` : ''}</option>;
          })}</select></label><div className="mechanical-assigned-people">{assigned.length ? assigned.map(user => <span className={invalidCells.has(keyOf(user.user_id, selectedDate)) ? 'is-invalid' : ''} key={String(user.user_id)}><b>{String(user.name || '')}</b><button type="button" aria-label={`移除 ${String(user.name || '')}`} onClick={() => removeUser(selectedDate, user.user_id)}>×</button></span>) : <em>本班尚未安排人員</em>}</div></article>;
        })}</div>
      </section>

      <section className="panel mechanical-calendar-screen" aria-label={`${MARKET_LABELS[market]}萬年曆排班`}>
        <header><div><small>整月排班總覽</small><h2>{monthTitle(month)}・{MARKET_LABELS[market]}</h2></div><p>點選日期後，在上方三個班別加入或調整人員。</p></header>
        <div className="mechanical-calendar-weekdays">{ROC_WEEKDAY.map(day => <span key={day}>星期{day}</span>)}</div>
        <div className="mechanical-calendar-grid">{calendarDates.map(date => {
          const outside = !date.startsWith(`${month}-`), today = date === todayISO();
          const dateErrors = errors.filter(item => item.date === date).length;
          return <button type="button" className={`mechanical-calendar-day${outside ? ' is-outside' : ''}${isWeekend(date) ? ' is-weekend' : ''}${selectedDate === date ? ' is-selected' : ''}${today ? ' is-today' : ''}${dateErrors ? ' has-errors' : ''}`} onClick={() => openDate(date)} key={date}>
            <span className="mechanical-calendar-date"><b>{Number(date.slice(-2))}</b>{today && <em>今天</em>}{dateErrors > 0 && <strong>{dateErrors}</strong>}</span>
            <span className="mechanical-calendar-shifts">{WORK_SHIFTS.map(shift => {
              const assigned = assignedUsers(date, shift.code);
              return <span className={`duty-${shift.code}`} key={shift.code}><b>{shift.short}</b><em>{assigned.length ? assigned.map(user => String(user.name || '')).join('、') : '未排'}</em></span>;
            })}</span>
          </button>;
        })}</div>
      </section>

      <section className="mechanical-schedule-sheet" aria-label={`${MARKET_LABELS[market]}列印月排班表`}>
        <header><div><small>臺北農產運銷股份有限公司</small><h2>管理部機電課輪值人員月排班表</h2></div><div><b>{monthTitle(month)}</b><span>{MARKET_LABELS[market]}</span></div></header>
        <div className="mechanical-schedule-legend">{WORK_SHIFTS.map(shift => <span className={`duty-${shift.code}`} key={shift.code}><i />{shift.name} {shift.time}</span>)}</div>
        <div className="mechanical-schedule-table-wrap"><table><thead><tr><th>日期</th><th>星期</th>{users.map(user => <th key={String(user.user_id)}>{String(user.name || '')}</th>)}</tr></thead><tbody>{dates.map(date => <tr className={isWeekend(date) ? 'is-weekend' : ''} key={date}><th>{Number(date.slice(-2))}</th><th>{weekday(date)}</th>{users.map(user => {
          const value = dutyFor(user.user_id, date), shift = WORK_SHIFTS.find(item => item.code === value);
          return <td className={shift ? `duty-${shift.code}` : ''} key={String(user.user_id)}>{shift ? shift.name : '—'}</td>;
        })}</tr>)}</tbody></table></div>
        <footer><span>每班 8 小時；空白表示未排班。系統另依跨市場班表檢查休息間隔與法定工時。</span><span>最後異動：{latest?.updated_at ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(String(latest.updated_at))) : '尚無紀錄'}</span></footer>
      </section>
    </div>
  </AppShell>;
}
