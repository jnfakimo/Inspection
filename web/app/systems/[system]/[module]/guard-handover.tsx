'use client';

// SYS-04 駐衛警電子交接簿。
//
// 班別、班別時段、預定巡檢時段與排定人員一律來自「駐衛警巡檢系統／巡檢排班」，由
// app-api 的 handover_guard_context 在伺服器端解析後提供——交接簿使用者不一定有
// sys_guardpatrol，前端讀不到排班與打卡表。交接簿不能改排班，只能另記實際值勤人員
// 與代班說明。流程：交接中 → 交班簽名 → 接班簽名（鎖定）→ 主管每日簽核（全日鎖定）。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import { LocalizedDateTimeInput } from '@/components/LocalizedDateTimeInput';
import { AdminHeader, AdminModal, errorMessage } from '@/components/admin/shared';
import { invokeAppApi } from '@/lib/supabase';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';
import './guard-handover.css';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };
type Item = { name: string; qty: number; condition: string; note: string };
type Incident = { time: string; location: string; category: string; description: string; action: string; reported_to: string };
type PatrolSummary = {
  expected: number; checked: number; unchecked: number; rate: number;
  unchecked_floors: { floor: string; count: number }[]; checkers: string[];
  window_start: string; window_end: string; computed_at: string;
};
type GuardShift = {
  name: string; sort_order: number; shift_start: string; shift_end: string; patrol_start: string; patrol_end: string;
  scheduled_user_ids: string[]; state: 'upcoming' | 'active' | 'ended'; patrol: PatrolSummary;
};
type GuardLog = {
  log_id: string; duty_date: string; shift_name: string; shift_start: string; shift_end: string; patrol_start: string; patrol_end: string;
  scheduled_user_ids: string[]; actual_user_ids: string[]; substitute_note: string; duty_summary: string; important_notes: string;
  incidents: Incident[]; items: Item[]; patrol_snapshot: PatrolSummary | null; status: 'draft' | 'submitted' | 'received';
  handover_by: string | null; handover_at: string | null; takeover_by: string | null; takeover_at: string | null;
  created_by: string; created_at: string; updated_by: string; updated_at: string;
};
type Approval = { approval_id: string; approver_id: string; approved_at: string; note: string; shift_count: number; received_count: number };
type GuardContext = {
  duty_date: string; shifts: GuardShift[]; logs: GuardLog[]; approval: Approval | null;
  staff: { user_id: string; name: string }[]; people: Record<string, string>; previous_items: Item[];
  can_edit: boolean; can_approve: boolean; approval_open: boolean;
};

const INCIDENT_CATEGORIES = ['門禁管制', '可疑人車', '竊盜', '火警／煙霧', '設備故障', '漏水／停電', '交通事故', '民眾糾紛', '急救傷病', '其他'] as const;
const ITEM_CONDITIONS = ['正常', '短少', '損壞', '遺失'] as const;
// 第一次使用、前面也沒有任何交接時的起始清單；之後一律沿用上一班的點交結果。
const DEFAULT_ITEMS: Item[] = [
  { name: '無線電對講機', qty: 1, condition: '正常', note: '' },
  { name: '手電筒', qty: 1, condition: '正常', note: '' },
  { name: '警棍', qty: 1, condition: '正常', note: '' },
  { name: '鑰匙（串）', qty: 1, condition: '正常', note: '' },
  { name: '門禁磁卡', qty: 1, condition: '正常', note: '' },
];
const STATUS_LABELS: Record<string, string> = { draft: '交接中', submitted: '已交班・待接班', received: '已接班' };
const SHIFT_STATE_LABELS: Record<string, string> = { upcoming: '尚未開始', active: '值勤中', ended: '已結束' };

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
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(parsed);
}
function hhmm(value: unknown) { return String(value || '').slice(0, 5) || '—'; }
function incidentTime(value: string) { return value ? value.replace('T', ' ') : '—'; }
function defaultIncidentTime(date: string, shift: GuardShift) {
  if (date !== todayTaipei()) return `${date}T${hhmm(shift.shift_start)}`;
  const [day, time] = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(' ');
  const [hour, minute] = time.split(':').map(Number);
  return `${day}T${String(hour).padStart(2, '0')}:${String(Math.floor(minute / 5) * 5).padStart(2, '0')}`;
}
function itemLine(item: Item) { return `${item.name}×${item.qty}（${item.condition}${item.note ? `，${item.note}` : ''}）`; }

export function GuardHandover({ system, module, profile }: Props) {
  const [date, setDate] = useState(todayTaipei());
  const [context, setContext] = useState<GuardContext | null>(null);
  const [busy, setBusy] = useState(true);
  const [acting, setActing] = useState(false);
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState<GuardShift | null>(null);
  const [approvalNote, setApprovalNote] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    try { setContext(await invokeAppApi<GuardContext>('handover_guard_context', { duty_date: date })); }
    catch (error) { setContext(null); setNote(`失敗：${errorMessage(error, '駐衛警交接資料載入失敗')}`); }
    setBusy(false);
  }, [date]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setApprovalNote(''); }, [date]);

  const shifts = useMemo(() => context?.shifts || [], [context]);
  const logs = useMemo(() => context?.logs || [], [context]);
  const approval = context?.approval || null;
  const logFor = useCallback((name: string) => logs.find(log => log.shift_name === name) || null, [logs]);
  const nameOf = useCallback((id: unknown) => {
    const key = String(id || '');
    return context?.people[key] || (key === profile.user_id ? profile.name : '—');
  }, [context, profile.name, profile.user_id]);
  const namesOf = (ids: string[] | null | undefined) => (ids || []).length ? (ids || []).map(nameOf).join('、') : '—';

  const receivedCount = shifts.filter(shift => logFor(shift.name)?.status === 'received').length;
  const pendingCount = logs.filter(log => log.status !== 'received').length;
  const missingCount = shifts.filter(shift => !logFor(shift.name)).length;
  const canEdit = Boolean(context?.can_edit) && !approval;
  const canApproveNow = Boolean(context?.approval_open) && pendingCount === 0 && (missingCount === 0 || approvalNote.trim().length > 0);
  const approvalHint = !context?.approval_open ? '本日交接須於隔日起由主管簽核。'
    : pendingCount > 0 ? `尚有 ${pendingCount} 班未完成接班，全部接班後才可簽核。`
      : missingCount > 0 ? `有 ${missingCount} 班未建立交接，簽核時須填寫說明。`
        : '本日交接均已完成接班，可進行主管簽核。';

  const run = async (kind: string, payload: Record<string, unknown>, done: string, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setActing(true); setNote('');
    try { await invokeAppApi('handover_save', { kind, ...payload }); await load(); setNote(done); }
    catch (error) { setNote(`失敗：${errorMessage(error)}`); }
    setActing(false);
  };
  const defaultItemsFor = (shift: GuardShift) => {
    const index = shifts.findIndex(row => row.name === shift.name);
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const previous = logFor(shifts[cursor].name);
      if (previous?.items?.length) return previous.items;
    }
    return context?.previous_items?.length ? context.previous_items : DEFAULT_ITEMS;
  };

  return <AppShell profile={profile} title={system.title} heading={{ system, module }}>
    <div className="guard-page">
      <AdminHeader module={module} busy={busy || acting} note={note} onReload={load}
        action={<button type="button" className="primary-btn compact" disabled={!context} onClick={() => window.print()}>列印本日報表</button>} />
      <section className="panel guard-toolbar">
        <button type="button" className="secondary-btn compact" aria-label="前一天" onClick={() => setDate(current => moveDate(current, -1))}>‹</button>
        <label>值班日期<LocalizedDateInput aria-label="值班日期（年/月/日）" value={date} onChange={event => setDate(event.target.value)} /></label>
        <button type="button" className="secondary-btn compact" aria-label="後一天" onClick={() => setDate(current => moveDate(current, 1))}>›</button>
        <button type="button" className="secondary-btn compact" onClick={() => setDate(todayTaipei())}>回到今天</button>
        <span>{rocDate(date)} · {shifts.length} 個班別 · 已接班 {receivedCount} 班</span>
      </section>

      {context && <section className={`guard-approval${approval ? ' is-approved' : canApproveNow ? ' is-ready' : ''}`} aria-label="主管簽核">
        <div>
          <strong>{approval ? `主管已簽核：${nameOf(approval.approver_id)}` : '主管每日簽核'}</strong>
          <span>{approval ? `${activityTime(approval.approved_at)}${approval.note ? `・說明：${approval.note}` : ''}（簽核後本日交接全部鎖定）` : approvalHint}</span>
        </div>
        {!approval && context.can_approve && <div className="guard-approval-actions">
          {missingCount > 0 && <input value={approvalNote} maxLength={500} onChange={event => setApprovalNote(event.target.value)} placeholder={`有 ${missingCount} 班未建立交接，請填寫說明`} aria-label="簽核說明" />}
          <button type="button" className="primary-btn compact" disabled={acting || !canApproveNow}
            onClick={() => void run('guard_approve', { duty_date: date, note: approvalNote.trim() }, '主管簽核完成，本日交接已全部鎖定',
              `確認以「${profile.name}」身分完成 ${rocDate(date)} 的主管簽核？簽核後本日交接全部鎖定，不可再修改。`)}>主管簽核</button>
        </div>}
      </section>}

      <section className="guard-sheet" aria-label="駐衛警電子交接簿">
        <header><div><small>臺北農產運銷股份有限公司　第一果菜市場</small><h2>駐衛警交接紀錄表</h2></div><b>{rocDate(date)}</b></header>
        {busy && !context ? <p className="guard-empty">載入中…</p>
          : !shifts.length ? <p className="guard-empty">巡檢排班沒有任何啟用中的班別範本，請先至「駐衛警巡檢系統 → 巡檢排班」設定班別。</p>
            : shifts.map((shift, index) => {
              const log = logFor(shift.name);
              const frozen = Boolean(log && log.status !== 'draft');
              const times = frozen && log ? log : shift;
              const scheduled = frozen && log ? log.scheduled_user_ids : shift.scheduled_user_ids;
              const patrol = frozen && log?.patrol_snapshot ? log.patrol_snapshot : shift.patrol;
              const snapshot = Boolean(frozen && log?.patrol_snapshot);
              const notStarted = shift.state === 'upcoming' && !snapshot;
              return <section className={`guard-shift guard-shift-${(index % 4) + 1}`} key={shift.name}>
                <div className="guard-shift-head">
                  <div><strong>{index + 1}</strong><span><b>{shift.name}</b><small>班別時段 {hhmm(times.shift_start)}–{hhmm(times.shift_end)} · 預定巡檢時段 {hhmm(times.patrol_start)}–{hhmm(times.patrol_end)} · {SHIFT_STATE_LABELS[shift.state] || shift.state}</small></span></div>
                  <div className="guard-shift-actions">
                    <span className={`guard-pill${log ? ` is-${log.status}` : ''}`}>{log ? STATUS_LABELS[log.status] || log.status : '尚未建立'}</span>
                    {!log && canEdit && <button type="button" className="primary-btn compact" onClick={() => setEditing(shift)}>建立交接</button>}
                    {log?.status === 'draft' && canEdit && <>
                      <button type="button" className="secondary-btn compact" onClick={() => setEditing(shift)}>編輯交接</button>
                      <button type="button" className="primary-btn compact" disabled={acting}
                        onClick={() => void run('guard_submit', { duty_date: date, shift_name: shift.name }, `${shift.name}已交班簽名，等待接班人確認`,
                          `確認以「${profile.name}」身分交班簽名？送出後內容鎖定，只能在接班前撤回。`)}>交班簽名送出</button>
                    </>}
                    {log?.status === 'submitted' && canEdit && (log.handover_by === profile.user_id
                      ? <button type="button" className="secondary-btn compact" disabled={acting}
                        onClick={() => void run('guard_withdraw', { duty_date: date, shift_name: shift.name }, `${shift.name}已撤回交班，可再修改`, '確認撤回交班簽名？撤回後可再修改內容。')}>撤回交班</button>
                      : <button type="button" className="primary-btn compact" disabled={acting}
                        onClick={() => void run('guard_receive', { duty_date: date, shift_name: shift.name }, `${shift.name}已完成接班簽名`,
                          `確認以「${profile.name}」身分接班簽名？簽名後本班交接內容鎖定。`)}>接班簽名確認</button>)}
                  </div>
                </div>
                <div className="guard-shift-body">
                  <div>
                    <div className="guard-block"><h4>值勤人員</h4><dl className="guard-staff">
                      <dt>排定人員</dt><dd>{namesOf(scheduled)}<small>（巡檢排班）</small></dd>
                      <dt>實際值勤</dt><dd>{log ? namesOf(log.actual_user_ids) : '—'}</dd>
                      {log?.substitute_note ? <><dt>代班說明</dt><dd>{log.substitute_note}</dd></> : null}
                    </dl></div>
                    {log ? <>
                      <div className="guard-block"><h4>勤務概況</h4><p className={log.duty_summary ? '' : 'guard-muted'}>{log.duty_summary || '尚未填寫'}</p></div>
                      <div className="guard-block"><h4>重要交辦事項</h4><p className={log.important_notes ? '' : 'guard-muted'}>{log.important_notes || '無'}</p></div>
                      <div className="guard-block"><h4>異常事件<small>{log.incidents.length} 件</small></h4>
                        {log.incidents.length ? <table className="guard-mini-table"><thead><tr><th>時間</th><th>地點／類別</th><th>經過與處理</th><th>通報</th></tr></thead><tbody>
                          {log.incidents.map((incident, itemIndex) => <tr key={itemIndex}><td>{incidentTime(incident.time)}</td><td>{incident.location || '—'}<br /><b>{incident.category}</b></td><td>{incident.description}{incident.action ? `\n處理：${incident.action}` : ''}</td><td>{incident.reported_to || '—'}</td></tr>)}
                        </tbody></table> : <p className="guard-muted">本班無異常事件。</p>}
                      </div>
                    </> : <p className="guard-muted">本班尚未建立交接。{canEdit ? '請由值勤人員按「建立交接」填寫。' : ''}</p>}
                  </div>
                  <div>
                    <div className="guard-block"><h4>巡邏打卡摘要<small>{snapshot ? '交班時快照' : '即時統計'}・{patrol.window_start}–{patrol.window_end}</small></h4>
                      <div className="guard-patrol-stats">
                        <div><b>{patrol.expected}</b><span>應打卡</span></div>
                        <div><b>{notStarted ? '—' : patrol.checked}</b><span>已打卡</span></div>
                        <div className={!notStarted && patrol.unchecked ? 'is-low' : ''}><b>{notStarted ? '—' : patrol.unchecked}</b><span>未打卡</span></div>
                        <div className={!notStarted && patrol.rate < 100 ? 'is-low' : ''}><b>{notStarted ? '—' : `${patrol.rate}%`}</b><span>完成率</span></div>
                      </div>
                      <p className="guard-patrol-note">{notStarted ? '本班尚未開始巡檢。'
                        : patrol.unchecked_floors.length ? `未打卡樓層：${patrol.unchecked_floors.map(floor => `${floor.floor}×${floor.count}`).join('、')}` : '所有巡邏點均已打卡。'}
                      {!notStarted && patrol.checkers.length ? `　打卡人員：${patrol.checkers.join('、')}` : ''}</p>
                    </div>
                    {log && <div className="guard-block"><h4>物品點交<small>{log.items.length} 項</small></h4>
                      {log.items.length ? <table className="guard-mini-table"><thead><tr><th>物品</th><th>數量</th><th>狀態</th><th>備註</th></tr></thead><tbody>
                        {log.items.map((item, itemIndex) => <tr key={itemIndex}><td>{item.name}</td><td>{item.qty}</td><td className={item.condition === '正常' ? '' : 'is-alert'}>{item.condition}</td><td>{item.note || '—'}</td></tr>)}
                      </tbody></table> : <p className="guard-muted">未登錄點交物品。</p>}
                    </div>}
                    {log && <div className="guard-block"><h4>交接簽名<small>最後編修 {activityTime(log.updated_at)} · {nameOf(log.updated_by)}</small></h4>
                      <div className="guard-signs">
                        <div className={log.handover_by ? '' : 'is-empty'}><span>交班人</span><b>{log.handover_by ? nameOf(log.handover_by) : '尚未簽名'}</b>{log.handover_at && <small>{activityTime(log.handover_at)}</small>}</div>
                        <div className={log.takeover_by ? '' : 'is-empty'}><span>接班人</span><b>{log.takeover_by ? nameOf(log.takeover_by) : '尚未簽名'}</b>{log.takeover_at && <small>{activityTime(log.takeover_at)}</small>}</div>
                      </div>
                    </div>}
                  </div>
                </div>
              </section>;
            })}
      </section>

      {context && <section className="guard-print-sheet" aria-label="駐衛警交接每日列印報表">
        <header><h2>臺北農產運銷股份有限公司第一果菜市場<br />駐衛警交接紀錄表</h2><p>{rocDate(date)}</p></header>
        {shifts.map(shift => {
          const log = logFor(shift.name);
          const frozen = Boolean(log && log.status !== 'draft');
          const times = frozen && log ? log : shift;
          const patrol = frozen && log?.patrol_snapshot ? log.patrol_snapshot : shift.patrol;
          const scheduled = frozen && log ? log.scheduled_user_ids : shift.scheduled_user_ids;
          return <table className="guard-print-shift" key={shift.name}><tbody>
            <tr><th className="guard-print-label">班別</th><td>{shift.name}（{hhmm(times.shift_start)}–{hhmm(times.shift_end)}）</td><th className="guard-print-label">預定巡檢</th><td>{hhmm(times.patrol_start)}–{hhmm(times.patrol_end)}　狀態：{log ? STATUS_LABELS[log.status] || log.status : '尚未建立'}</td></tr>
            <tr><th>排定人員</th><td>{namesOf(scheduled)}</td><th>實際值勤</th><td>{log ? namesOf(log.actual_user_ids) : '—'}{log?.substitute_note ? `\n代班：${log.substitute_note}` : ''}</td></tr>
            <tr><th>勤務概況</th><td colSpan={3}>{log?.duty_summary || '—'}</td></tr>
            <tr><th>重要交辦</th><td colSpan={3}>{log?.important_notes || '—'}</td></tr>
            <tr><th>異常事件</th><td colSpan={3}>{log?.incidents.length ? log.incidents.map(incident => `${incidentTime(incident.time)}　${incident.location || '—'}　${incident.category}：${incident.description}${incident.action ? `；處理：${incident.action}` : ''}${incident.reported_to ? `；通報：${incident.reported_to}` : ''}`).join('\n') : '無'}</td></tr>
            <tr><th>物品點交</th><td colSpan={3}>{log?.items.length ? log.items.map(itemLine).join('、') : '—'}</td></tr>
            <tr><th>巡邏打卡</th><td colSpan={3}>{`應打卡 ${patrol.expected}／已打卡 ${patrol.checked}／完成率 ${patrol.rate}%`}{patrol.unchecked_floors.length ? `；未打卡：${patrol.unchecked_floors.map(floor => `${floor.floor}×${floor.count}`).join('、')}` : ''}</td></tr>
            <tr><th>交班簽名</th><td>{log?.handover_by ? `${nameOf(log.handover_by)}　${activityTime(log.handover_at)}` : ''}</td><th>接班簽名</th><td>{log?.takeover_by ? `${nameOf(log.takeover_by)}　${activityTime(log.takeover_at)}` : ''}</td></tr>
          </tbody></table>;
        })}
        <footer>
          <div><b>主管簽核</b><br />{approval ? `${nameOf(approval.approver_id)}　${activityTime(approval.approved_at)}${approval.note ? `\n說明：${approval.note}` : ''}` : ''}</div>
          <div><b>列印時間</b><br />{activityTime(new Date().toISOString())}</div>
        </footer>
      </section>}
    </div>
    {editing && context && <GuardLogModal date={date} shift={editing} log={logFor(editing.name)} staff={context.staff} people={context.people}
      defaultItems={defaultItemsFor(editing)} onClose={() => setEditing(null)}
      onSaved={async () => { const name = editing.name; setEditing(null); await load(); setNote(`${name}交接內容已儲存`); }} />}
  </AppShell>;
}

function GuardLogModal({ date, shift, log, staff, people, defaultItems, onClose, onSaved }: {
  date: string; shift: GuardShift; log: GuardLog | null; staff: { user_id: string; name: string }[]; people: Record<string, string>;
  defaultItems: Item[]; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const [actual, setActual] = useState<string[]>(log?.actual_user_ids?.length ? log.actual_user_ids : shift.scheduled_user_ids);
  const [substitute, setSubstitute] = useState(log?.substitute_note || '');
  const [summary, setSummary] = useState(log?.duty_summary || '');
  const [important, setImportant] = useState(log?.important_notes || '');
  const [incidents, setIncidents] = useState<Incident[]>(log?.incidents || []);
  const [items, setItems] = useState<Item[]>(log?.items?.length ? log.items : defaultItems.map(item => ({ ...item })));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const scheduled = useMemo(() => new Set(shift.scheduled_user_ids), [shift.scheduled_user_ids]);
  const differs = actual.length !== scheduled.size || actual.some(id => !scheduled.has(id));
  // 可勾選 = 駐警單位人員 ∪ 排定人員 ∪ 已勾選人員。已指派的人一定要看得到，才取消得掉。
  const choices = useMemo(() => {
    const map = new Map(staff.map(person => [person.user_id, person.name] as const));
    for (const id of [...shift.scheduled_user_ids, ...actual]) if (!map.has(id)) map.set(id, people[id] || '（未知人員）');
    return [...map].map(([userId, name]) => ({ user_id: userId, name }));
  }, [staff, people, shift.scheduled_user_ids, actual]);

  const toggle = (id: string) => setActual(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  const updateItem = (index: number, patch: Partial<Item>) => setItems(current => current.map((item, cursor) => cursor === index ? { ...item, ...patch } : item));
  const updateIncident = (index: number, patch: Partial<Incident>) => setIncidents(current => current.map((incident, cursor) => cursor === index ? { ...incident, ...patch } : incident));

  const save = async () => {
    if (!actual.length) return setMessage('請至少勾選一位實際值勤人員');
    if (differs && !substitute.trim()) return setMessage('實際值勤人員與巡檢排班不同，請填寫代班說明');
    if (items.some(item => !item.name.trim())) return setMessage('物品點交有尚未填寫名稱的項目');
    if (incidents.some(incident => !incident.time || !incident.category || !incident.description.trim())) return setMessage('異常事件請填寫發生時間、類別與事件經過');
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('handover_save', {
        kind: 'guard_save', duty_date: date, shift_name: shift.name, actual_user_ids: actual,
        substitute_note: substitute.trim(), duty_summary: summary.trim(), important_notes: important.trim(), incidents, items,
      });
      await onSaved();
    } catch (error) { setMessage(errorMessage(error)); setBusy(false); }
  };

  return <AdminModal className="guard-modal" title={`${log ? '編輯' : '建立'}交接｜${shift.name}（${hhmm(shift.shift_start)}–${hhmm(shift.shift_end)}）`} onClose={onClose}>
    <div className="guard-form">
      <fieldset><legend>值勤人員</legend>
        <small>排定人員（巡檢排班）：{shift.scheduled_user_ids.length ? shift.scheduled_user_ids.map(id => people[id] || '（未知人員）').join('、') : '尚未排定'}</small>
        <div className="guard-staff-picker">{choices.map(person => <label key={person.user_id}>
          <input type="checkbox" checked={actual.includes(person.user_id)} onChange={() => toggle(person.user_id)} />{person.name}{scheduled.has(person.user_id) ? '（排定）' : ''}
        </label>)}</div>
        <label>代班說明{differs ? '（必填）' : ''}<input value={substitute} maxLength={500} onChange={event => setSubstitute(event.target.value)} placeholder="例：原排定人員請假，由某某代班" /></label>
      </fieldset>
      <fieldset><legend>勤務概況</legend>
        <label>安全狀況概述<textarea rows={4} value={summary} maxLength={4000} onChange={event => setSummary(event.target.value)} placeholder="本班門禁、巡邏與場區整體狀況；無特殊狀況請填「本班勤務正常」" /><small>交班簽名送出時為必填。</small></label>
        <label>重要交辦事項<textarea rows={3} value={important} maxLength={4000} onChange={event => setImportant(event.target.value)} placeholder="需要下一班接續處理或特別留意的事項" /></label>
      </fieldset>
      <fieldset><legend>異常事件（{incidents.length} 件）</legend>
        <div className="guard-row-editor">{incidents.map((incident, index) => <div className="guard-incident-row" key={index}>
          <label>發生時間<LocalizedDateTimeInput value={incident.time} onChange={value => updateIncident(index, { time: value })} ariaLabel={`第 ${index + 1} 件異常事件發生時間`} stepMinutes={5} /></label>
          <label>地點<input value={incident.location} maxLength={100} onChange={event => updateIncident(index, { location: event.target.value })} placeholder="例：B1 卸貨區" /></label>
          <label>類別<select value={incident.category} onChange={event => updateIncident(index, { category: event.target.value })}><option value="">— 請選擇 —</option>{INCIDENT_CATEGORIES.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <button type="button" className="danger-btn compact" onClick={() => setIncidents(current => current.filter((_, cursor) => cursor !== index))}>移除</button>
          <label className="wide">事件經過<textarea rows={2} value={incident.description} maxLength={2000} onChange={event => updateIncident(index, { description: event.target.value })} /></label>
          <label className="wide">處理情形<textarea rows={2} value={incident.action} maxLength={2000} onChange={event => updateIncident(index, { action: event.target.value })} /></label>
          <label className="wide">通報對象<input value={incident.reported_to} maxLength={100} onChange={event => updateIncident(index, { reported_to: event.target.value })} placeholder="例：指揮台、總務課、110" /></label>
        </div>)}</div>
        <button type="button" className="secondary-btn compact" disabled={incidents.length >= 50}
          onClick={() => setIncidents(current => [...current, { time: defaultIncidentTime(date, shift), location: '', category: '', description: '', action: '', reported_to: '' }])}>＋ 新增異常事件</button>
        {!incidents.length && <small>本班無異常事件時免填。</small>}
      </fieldset>
      <fieldset><legend>物品點交（{items.length} 項）</legend>
        <div className="guard-row-editor">{items.map((item, index) => <div className="guard-item-row" key={index}>
          <label>物品<input value={item.name} maxLength={50} onChange={event => updateItem(index, { name: event.target.value })} /></label>
          <label>數量<select value={item.qty} onChange={event => updateItem(index, { qty: Number(event.target.value) })}>{Array.from({ length: 51 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>狀態<select value={item.condition} onChange={event => updateItem(index, { condition: event.target.value })}>{ITEM_CONDITIONS.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>備註<input value={item.note} maxLength={200} onChange={event => updateItem(index, { note: event.target.value })} /></label>
          <button type="button" className="danger-btn compact" onClick={() => setItems(current => current.filter((_, cursor) => cursor !== index))}>移除</button>
        </div>)}</div>
        <button type="button" className="secondary-btn compact" disabled={items.length >= 40}
          onClick={() => setItems(current => [...current, { name: '', qty: 1, condition: '正常', note: '' }])}>＋ 新增點交物品</button>
        <small>預設帶入上一班的點交結果，請依實際清點修改數量與狀態。</small>
      </fieldset>
    </div>
    {message && <p role="alert" className="inline-message danger">{message}</p>}
    <footer><button type="button" className="secondary-btn" onClick={onClose}>取消</button><button type="button" className="primary-btn compact" disabled={busy} onClick={() => void save()}>{busy ? '儲存中…' : '儲存交接內容'}</button></footer>
  </AdminModal>;
}
