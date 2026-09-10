'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { AdminHeader, errorMessage, type Row } from '@/components/admin/shared';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import {
  MECHANICAL_SCHEDULE_CODES, MECHANICAL_SCHEDULE_LABELS, isMechanicalWorkCode,
  scheduleDateOffset, scheduleMonthDates, shiftScheduleMonth, validateMechanicalSchedule,
  type MechanicalScheduleCode,
} from '@/lib/mechanical-schedule';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import './mechanical-schedule.css';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };
type MarketCode = 'market_1' | 'market_2';

const MARKET_LABELS: Record<MarketCode, string> = { market_1: '第一果菜批發市場', market_2: '第二果菜批發市場' };
const SHORT_LABELS: Record<MechanicalScheduleCode, string> = {
  '01-09': '01-09', '09-17': '09-17', '17-01': '17-01', weekly_off: '例假', rest_day: '休息日',
  rotation_off: '輪休', annual_leave: '特休', official_leave: '公假', sick_leave: '病假', personal_leave: '事假',
};
const ROC_WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

function todayMonth() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).format(new Date());
}
function monthTitle(month: string) {
  const [year, value] = month.split('-').map(Number);
  return `民國 ${year - 1911} 年 ${value} 月`;
}
function weekday(date: string) {
  return ROC_WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];
}
function isWeekend(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}
function keyOf(userId: unknown, date: string) {
  return `${String(userId)}|${date}`;
}

export function MechanicalSchedule({ system, module, profile }: Props) {
  const [month, setMonth] = useState(todayMonth());
  const [market, setMarket] = useState<MarketCode>('market_1');
  const [users, setUsers] = useState<Row[]>([]);
  const [persisted, setPersisted] = useState<Row[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');

  const dates = useMemo(() => scheduleMonthDates(month), [month]);
  const monthStart = dates[0] || `${month}-01`;
  const monthEnd = dates.at(-1) || monthStart;

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const rangeStart = scheduleDateOffset(monthStart, -7), rangeEnd = scheduleDateOffset(monthEnd, 8);
    const client = getSupabase();
    const [people, departments, schedule] = await Promise.all([
      client.from('users').select('user_id,name,dept_id,status').eq('status', 'active').order('name').limit(1000),
      client.from('departments').select('dept_id,name,level,status').eq('name', '機電課').eq('level', 2).eq('status', 'active').limit(20),
      client.from('mechanical_schedule_assignments').select('*').gte('duty_date', rangeStart).lt('duty_date', rangeEnd).eq('is_active', true).order('duty_date').limit(5000),
    ]);
    const failure = people.error || departments.error || schedule.error;
    if (failure) { setNote(`失敗：${failure.message || '機電課排班資料載入失敗'}`); setBusy(false); return; }
    const departmentIds = new Set((departments.data || []).map(row => String(row.dept_id)));
    const staff = (people.data || []).filter(row => departmentIds.has(String(row.dept_id)))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-TW'));
    const rows = schedule.data || [];
    const nextDraft: Record<string, string> = {};
    rows.filter(row => row.market_code === market && String(row.duty_date).startsWith(`${month}-`))
      .forEach(row => { nextDraft[keyOf(row.user_id, String(row.duty_date))] = String(row.duty_code || ''); });
    setUsers(staff); setPersisted(rows); setDraft(nextDraft); setBusy(false);
  }, [market, month, monthEnd, monthStart]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const clear = () => document.body.classList.remove('mechanical-schedule-printing');
    window.addEventListener('afterprint', clear);
    return () => { window.removeEventListener('afterprint', clear); clear(); };
  }, []);

  const candidateRows = useMemo(() => users.flatMap(user => dates.flatMap(date => {
    const dutyCode = draft[keyOf(user.user_id, date)];
    return dutyCode ? [{ user_id: String(user.user_id), duty_date: date, duty_code: dutyCode, market_code: market }] : [];
  })), [dates, draft, market, users]);
  const combinedRows = useMemo(() => persisted
    .filter(row => !(row.market_code === market && String(row.duty_date).startsWith(`${month}-`)))
    .concat(candidateRows), [candidateRows, market, month, persisted]);
  const violations = useMemo(() => validateMechanicalSchedule(combinedRows, { start: monthStart, end: monthEnd }), [combinedRows, monthEnd, monthStart]);
  const errors = violations.filter(item => item.severity === 'error');
  const warnings = violations.filter(item => item.severity === 'warning');
  const invalidCells = useMemo(() => new Set(errors.map(item => keyOf(item.userId, item.date))), [errors]);
  const workCount = candidateRows.filter(row => isMechanicalWorkCode(row.duty_code)).length;
  const unfilled = Math.max(0, users.length * dates.length - candidateRows.length);
  const currentRows = persisted.filter(row => row.market_code === market && String(row.duty_date).startsWith(`${month}-`));
  const latest = [...currentRows].sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))[0];
  const names = new Map(users.map(user => [String(user.user_id), String(user.name || '未命名')]));

  const setDuty = (userId: unknown, date: string, dutyCode: string) => {
    setDraft(current => ({ ...current, [keyOf(userId, date)]: dutyCode }));
    setNote('');
  };
  const save = async () => {
    if (errors.length) { setNote('班表有紅色違規項目，修正後才能儲存。'); return; }
    setSaving(true); setNote('');
    try {
      await invokeAppApi('handover_save', { kind: 'mechanical_schedule_save', year_month: month, market_code: market, assignments: candidateRows });
      await load();
      setNote(`${MARKET_LABELS[market]} ${monthTitle(month)}班表已儲存，異動時間已寫入稽核紀錄。`);
    } catch (error) { setNote(`失敗：${errorMessage(error)}`); }
    finally { setSaving(false); }
  };
  const print = () => {
    document.body.classList.add('mechanical-schedule-printing');
    window.setTimeout(() => window.print(), 80);
  };

  return <AppShell profile={profile} title={module.title} heading={{ system, module, title: module.title, metaTitle: system.title }}>
    <div className="mechanical-schedule-page">
      <AdminHeader module={module} busy={busy} note={note} onReload={() => void load()} action={<><button className="secondary-btn compact" disabled={busy} onClick={print}>列印本月班表</button><button className="primary-btn compact" disabled={busy || saving || errors.length > 0} onClick={() => void save()}>{saving ? '儲存中…' : unfilled ? '儲存草稿' : '儲存班表'}</button></>} />

      <section className="panel mechanical-schedule-toolbar">
        <div className="mechanical-schedule-month"><button className="secondary-btn compact" aria-label="前一個月" onClick={() => setMonth(current => shiftScheduleMonth(current, -1))}>‹</button><div><small>排班月份</small><b>{monthTitle(month)}</b></div><button className="secondary-btn compact" aria-label="後一個月" onClick={() => setMonth(current => shiftScheduleMonth(current, 1))}>›</button><button className="secondary-btn compact" onClick={() => setMonth(todayMonth())}>本月</button></div>
        <div className="mechanical-market-tabs" role="group" aria-label="市場別"><button className={market === 'market_1' ? 'is-active' : ''} aria-pressed={market === 'market_1'} onClick={() => setMarket('market_1')}>一市</button><button className={market === 'market_2' ? 'is-active' : ''} aria-pressed={market === 'market_2'} onClick={() => setMarket('market_2')}>二市</button></div>
      </section>

      <section className="mechanical-schedule-summary" aria-label="排班摘要">
        <article><small>排班人員</small><strong>{users.length}</strong><span>機電課同仁</span></article>
        <article><small>已排工作</small><strong>{workCount}</strong><span>共 {workCount * 8} 小時</span></article>
        <article><small>尚未排定</small><strong>{unfilled}</strong><span>{unfilled ? '可先儲存草稿' : '本月已填滿'}</span></article>
        <article className={errors.length ? 'is-danger' : 'is-safe'}><small>工時卡控</small><strong>{errors.length}</strong><span>{errors.length ? '項必須修正' : '目前無違規'}</span></article>
      </section>

      <section className="panel mechanical-legal-rules">
        <div><b>11 小時</b><span>更換班次前，至少連續休息 11 小時。</span></div>
        <div><b>8／40 小時</b><span>一般工時每日最多 8 小時、每週最多 40 小時。</span></div>
        <div><b>例假＋休息日</b><span>完整七日須各有一日，且不得連續工作超過 6 日。</span></div>
        <p>目前採「一般工時」嚴格卡控；變形工時例外未啟用。若公司已依法完成工會或勞資會議同意及必要備查，應另由管理制度確認後再調整。<a href="https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001" target="_blank" rel="noreferrer">查看勞動基準法</a></p>
      </section>

      {(errors.length > 0 || warnings.length > 0) && <section className={`panel mechanical-schedule-checks${errors.length ? ' has-errors' : ''}`}>
        <header><div><small>自動檢核</small><h3>{errors.length ? `發現 ${errors.length} 項違規，已禁止儲存` : '尚有未排定日期'}</h3></div><span>{warnings.length} 項提醒</span></header>
        <div>{[...errors, ...warnings].slice(0, 16).map((item, index) => <p className={item.severity} key={`${item.rule}-${item.userId}-${item.date}-${index}`}><b>{names.get(item.userId) || '機電課同仁'}</b><span>{item.date}｜{item.message}</span></p>)}</div>
        {errors.length + warnings.length > 16 && <small>另有 {errors.length + warnings.length - 16} 項，請依紅色日期儲存格逐一修正。</small>}
      </section>}

      <section className="mechanical-schedule-sheet" aria-label={`${MARKET_LABELS[market]}月排班表`}>
        <header><div><small>臺北農產運銷股份有限公司</small><h2>管理部機電課輪值人員月排班表</h2></div><div><b>{monthTitle(month)}</b><span>{MARKET_LABELS[market]}</span></div></header>
        <div className="mechanical-schedule-legend">{MECHANICAL_SCHEDULE_CODES.map(code => <span className={`duty-${code}`} key={code}><i />{MECHANICAL_SCHEDULE_LABELS[code]}</span>)}</div>
        {busy ? <p className="mechanical-schedule-loading">排班資料載入中…</p> : users.length === 0 ? <p className="mechanical-schedule-loading">找不到第二階機電課的在職人員。</p> : <>
          <div className="mechanical-schedule-table-wrap">
            <table><thead><tr><th>日期</th><th>星期</th>{users.map(user => <th key={String(user.user_id)}>{String(user.name || '')}</th>)}</tr></thead><tbody>{dates.map(date => <tr className={isWeekend(date) ? 'is-weekend' : ''} key={date}><th>{Number(date.slice(-2))}</th><th>{weekday(date)}</th>{users.map(user => {
              const cellKey = keyOf(user.user_id, date), value = draft[cellKey] || '';
              return <td className={`${value ? `duty-${value}` : 'duty-empty'}${invalidCells.has(cellKey) ? ' is-invalid' : ''}`} key={String(user.user_id)}><select aria-label={`${date} ${String(user.name)} 排班`} value={value} onChange={event => setDuty(user.user_id, date, event.target.value)}><option value="">未排</option>{MECHANICAL_SCHEDULE_CODES.map(code => <option value={code} key={code}>{SHORT_LABELS[code]}</option>)}</select><span className="mechanical-print-duty">{value ? SHORT_LABELS[value as MechanicalScheduleCode] : '—'}</span></td>;
            })}</tr>)}</tbody></table>
          </div>
          <div className="mechanical-schedule-mobile">{dates.map(date => <article className={isWeekend(date) ? 'is-weekend' : ''} key={date}><header><b>{Number(date.slice(-2))} 日</b><span>星期{weekday(date)}</span></header><div>{users.map(user => {
            const cellKey = keyOf(user.user_id, date), value = draft[cellKey] || '';
            return <label className={invalidCells.has(cellKey) ? 'is-invalid' : ''} key={String(user.user_id)}><span>{String(user.name || '')}</span><select className={value ? `duty-${value}` : ''} value={value} onChange={event => setDuty(user.user_id, date, event.target.value)}><option value="">未排</option>{MECHANICAL_SCHEDULE_CODES.map(code => <option value={code} key={code}>{SHORT_LABELS[code]}</option>)}</select></label>;
          })}</div></article>)}</div>
        </>}
        <footer><span>班次均以 8 小時計；未排定欄位不代表休假，例假與休息日請分別明確標示。</span><span>最後異動：{latest?.updated_at ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(String(latest.updated_at))) : '尚無紀錄'}</span></footer>
      </section>
    </div>
  </AppShell>;
}
