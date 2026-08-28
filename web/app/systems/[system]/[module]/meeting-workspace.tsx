'use client';

// SYS-08 會議室預約 V2 —— 版面與操作流程完全比照 V1 meetingroom.html：
// 單一頁面內含「週排程」「我的預約」「預約變更申請」三個面板，加上預約、變更申請、
// 會議室管理三個彈窗；時間仍採「上／下午 · 時 · 分」三段式選單，送出前先做衝突預檢。
// V1 本身不動，這裡只是把同一套模板與操作模式搬到 React。
//
// 與 V1 的唯一差異是配色改綁 V2 的 CSS 變數（見 meetingroom-v1.css），
// 讓亮色與科技版兩種主題都正常；結構、欄位、流程與按鈕行為皆維持一致。
//
// 寫入一律走既有的伺服器端入口，不在前端拼裝 insert／update：
//   create_meeting_booking_series / cancel_own_meeting_booking /
//   create_meeting_booking_change_request / respond_meeting_booking_change_request /
//   app-api 的 meeting_check_in 與 meeting_save_room

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import '@/app/admin-workspace.css';
import '@/app/meetingroom-v1.css';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { canonicalFloor } from '@/lib/floor';
import { invokeGoogleCalendar, openPersonalProfile, type GoogleCalendarStatus } from '@/lib/google-calendar';
import { AdminHeader, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from '@/components/admin/shared';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };

const DOW = ['一', '二', '三', '四', '五', '六', '日'];
const NOTIFY_LABEL: Record<string, string> = { pending: '待發送', sent: '已發送', failed: '發送失敗', skipped: '已略過' };
const NOTIFY_TYPE: Record<string, string> = { reminder: '開始前提醒', expired: '逾時未報到' };

/** 通知中心只呈現繁體中文，避免資料庫中的列舉值或第三方回應直接露出英文。 */
function notificationTypeLabel(value: unknown) {
  const key = String(value ?? '').trim().toLowerCase();
  return NOTIFY_TYPE[key] || (key ? '其他通知' : '—');
}

function notificationStatusLabel(value: unknown) {
  const key = String(value ?? '').trim().toLowerCase();
  return NOTIFY_LABEL[key] || (key ? '其他狀態' : '—');
}

function notificationResponseLabel(value: unknown) {
  if (value == null || value === '') return '—';
  let raw = '';
  try { raw = typeof value === 'object' ? (JSON.stringify(value) || '') : String(value); } catch { raw = ''; }
  if (!raw) return '已收到系統回應';
  if (/success|sent|delivered|^ok$|^200$|成功|送達|已發送/i.test(raw)) return '已送達';
  if (/fail|error|timeout|unauthori[sz]ed|forbidden|^4\d\d$|^5\d\d$|失敗|錯誤|逾時/i.test(raw)) return '發送失敗';
  if (/pending|queued|processing|待處理|處理中/i.test(raw)) return '處理中';
  return '已收到系統回應';
}

function notificationErrorMessage(error: unknown) {
  const translated = errorMessage(error, '預約提醒載入失敗');
  return /[\u4e00-\u9fff]/.test(translated) ? translated : '預約提醒載入失敗，請稍後再試';
}

/* ── 日期與時間工具（對齊 V1 的同名函式） ── */
function taipeiToday() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {} as Record<string, string>);
  return `${p.year}-${p.month}-${p.day}`;
}
const pad = (n: number) => String(n).padStart(2, '0');
function isoDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function mondayOf(d: Date) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fmtMD(d: Date) { return `${d.getMonth() + 1}/${d.getDate()}`; }
const hhmm = (v: unknown) => v ? String(v).slice(0, 5) : '';
// 以台北時區判斷時段是否已過（與資料庫 guard_meeting_booking_input 的判斷一致）。
function slotStartAt(dateStr: string, start: string) { return new Date(`${dateStr}T${start}:00+08:00`); }
/** 一天最後一個可預約的 30 分鐘刻度；用來判斷「今天是否還有時段」。 */
const LAST_SLOT = '23:30';
function bookingEndAt(row: Row) { return new Date(`${row.booking_date}T${String(row.end_time).slice(0, 8)}+08:00`); }

/* ── 三段式時間（上/下午 · 1–12 · 00/30），與 V1 完全相同 ── */
type TimeParts = { period: string; hour: string; minute: string };
const EMPTY_TIME: TimeParts = { period: '', hour: '', minute: '' };
function partsToValue(t: TimeParts) {
  if (!t.period || !t.hour || !t.minute) return '';
  let h = Number(t.hour) % 12;
  if (t.period === 'pm') h += 12;
  return `${pad(h)}:${t.minute}`;
}
function _valueToParts(value: string): TimeParts {
  if (!value) return EMPTY_TIME;
  const [hStr, m] = value.split(':');
  const h = Number(hStr);
  return { period: h >= 12 ? 'pm' : 'am', hour: String(h % 12 === 0 ? 12 : h % 12), minute: m };
}
// 已過去的時段直接停用，不是等到送出才擋。判斷一律走 slotStartAt——與送出前的
// startPast 用同一個函式，UI 與驗證才不可能各說各話（時區也只有那一處要維護）。
// 停用而非移除：使用者若先選好時間再把日期改到今天，移除選項會讓下拉變成空白，
// 停用則仍看得到自己選了什麼，配合上方的提示列比較好理解。
function TimeSelect({ value, onChange, label, date, now }: {
  value: TimeParts; onChange: (v: TimeParts) => void; label: string;
  /** 有給日期與現在時刻才做時間管制；未給（例如週期截止日）維持全部可選。 */
  date?: string; now?: number;
}) {
  const isPast = (parts: TimeParts) => {
    if (!date || now === undefined) return false;
    const candidate = partsToValue(parts);
    return Boolean(candidate) && slotStartAt(date, candidate).getTime() <= now;
  };
  const MINUTES = ['00', '30'];
  // 半天／整點只要還有任一個 30 分鐘刻度沒過去，就仍可選。
  const periodPast = (period: string) =>
    Array.from({ length: 12 }, (_, i) => String(i + 1))
      .every(hour => MINUTES.every(minute => isPast({ period, hour, minute })));
  const hourPast = (hour: string) =>
    Boolean(value.period) && MINUTES.every(minute => isPast({ period: value.period, hour, minute }));
  const minutePast = (minute: string) =>
    Boolean(value.period && value.hour) && isPast({ period: value.period, hour: value.hour, minute });

  return <div className="field"><label>{label}</label><div className="time-parts">
    <select aria-label={`${label}上午或下午`} value={value.period} onChange={e => onChange({ ...value, period: e.target.value })}>
      <option value="">上／下午</option>
      <option value="am" disabled={periodPast('am')}>上午</option>
      <option value="pm" disabled={periodPast('pm')}>下午</option>
    </select>
    <select aria-label={`${label}小時`} value={value.hour} onChange={e => onChange({ ...value, hour: e.target.value })}>
      <option value="">時</option>
      {Array.from({ length: 12 }, (_, i) => String(i + 1)).map(hour =>
        <option key={hour} value={hour} disabled={hourPast(hour)}>{pad(Number(hour))}</option>)}
    </select>
    <select aria-label={`${label}分鐘`} value={value.minute} onChange={e => onChange({ ...value, minute: e.target.value })}>
      <option value="">分</option>
      {MINUTES.map(minute => <option key={minute} value={minute} disabled={minutePast(minute)}>{minute}</option>)}
    </select>
  </div></div>;
}

export function MeetingWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  return <AuthGate>{profile => module.key === 'notifications'
    ? <NotificationsModule system={system} module={module} profile={profile} />
    : <MeetingRoomPage system={system} module={module} profile={profile} />}</AuthGate>;
}

/* ──────────────────── V1 版面的主頁（週排程／我的預約／變更申請） ──────────────────── */

function MeetingRoomPage({ module, profile }: Props) {
  const isAdmin = ['sysadmin', 'admin'].includes(String(profile.rbac_role || profile.role || ''));
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [rooms, setRooms] = useState<Row[]>([]);
  const [weekBookings, setWeekBookings] = useState<Row[]>([]);
  const [myBookings, setMyBookings] = useState<Row[]>([]);
  const [requests, setRequests] = useState<Row[]>([]);
  const [myPage, setMyPage] = useState(1);
  const [requestPage, setRequestPage] = useState(1);
  const [users, setUsers] = useState<Row[]>([]);
  const [myPhone, setMyPhone] = useState('');
  const [calendarStatus, setCalendarStatus] = useState<GoogleCalendarStatus | null>(null);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [booking, setBooking] = useState<{ room_id: string; date: string } | null>(null);
  const [changeFor, setChangeFor] = useState<Row | null>(null);
  const [roomAdmin, setRoomAdmin] = useState(module.key === 'rooms');
  const [tick, setTick] = useState(Date.now());

  useEffect(() => { const t = window.setInterval(() => setTick(Date.now()), 60_000); return () => window.clearInterval(t); }, []);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const from = isoDate(days[0]), to = isoDate(days[6]);
    const [r, w, mine, req, u, me] = await Promise.all([
      client.from('meeting_rooms').select('*').order('name'),
      client.from('meeting_bookings').select('*').gte('booking_date', from).lte('booking_date', to)
        .in('status', ['booked', 'checked_in']).order('start_time'),
      client.from('meeting_bookings').select('*,meeting_rooms(name,floor)').eq('user_id', profile.user_id)
        .order('booking_date', { ascending: false }).limit(100),
      client.from('meeting_booking_change_requests')
        .select('*,meeting_bookings!target_booking_id(booking_no,booking_date,start_time,end_time,status,user_id,purpose,meeting_rooms(name)),users!requester_id(name,department)')
        .order('created_at', { ascending: false }).limit(100),
      client.from('users').select('user_id,name,department').eq('status', 'active').order('name').limit(2000),
      client.from('users').select('phone').eq('user_id', profile.user_id).maybeSingle(),
    ]);
    if (r.error || w.error) setNote(`失敗：${errorMessage(r.error || w.error, '會議室資料載入失敗')}`);
    setRooms((r.data || []).map(row => ({ ...row, floor: canonicalFloor(row.floor) })));
    setWeekBookings(w.data || []);
    setMyBookings((mine.data || []).map(row => {
      const room = Array.isArray(row.meeting_rooms) ? row.meeting_rooms[0] : row.meeting_rooms;
      return room && typeof room === 'object' ? { ...row, meeting_rooms: { ...room, floor: canonicalFloor((room as Row).floor) } } : row;
    }));
    setRequests(req.data || []); setUsers(u.data || []);
    setMyPhone(String((me.data as Row)?.phone || ''));
    setBusy(false);
  }, [days, profile.user_id]);
  useEffect(() => { void load(); }, [load]);
  const loadCalendarStatus = useCallback(async () => {
    try { setCalendarStatus(await invokeGoogleCalendar<GoogleCalendarStatus>('status')); }
    catch { setCalendarStatus(null); }
  }, []);
  useEffect(() => { void loadCalendarStatus(); }, [loadCalendarStatus]);

  // V1 的清單規則是每頁 10 筆；資料重新載入後若目前頁碼超出範圍，
  // 自動回到最後一頁，避免操作完成後顯示空白頁。
  const myTotalPages = Math.max(1, Math.ceil(myBookings.length / PAGE_SIZE));
  const requestTotalPages = Math.max(1, Math.ceil(requests.length / PAGE_SIZE));
  const cancelledCount = myBookings.filter(b => String(b.status) === 'cancelled').length;
  const expiredCount = myBookings.filter(b => String(b.status) === 'expired').length;
  const pagedMyBookings = myBookings.slice((myPage - 1) * PAGE_SIZE, myPage * PAGE_SIZE);
  const pagedRequests = requests.slice((requestPage - 1) * PAGE_SIZE, requestPage * PAGE_SIZE);
  useEffect(() => { setMyPage(page => Math.min(Math.max(page, 1), myTotalPages)); }, [myTotalPages]);
  useEffect(() => { setRequestPage(page => Math.min(Math.max(page, 1), requestTotalPages)); }, [requestTotalPages]);

  const nameOf = useCallback((id: unknown) => users.find(x => x.user_id === id)?.name || '（未知）', [users]);
  const today = taipeiToday();

  const cancel = async (row: Row) => {
    if (!window.confirm(`確定取消「${fmt(row.purpose)}」這筆預約？`)) return;
    setBusy(true); setNote('');
    const { error } = await getSupabase().rpc('cancel_own_meeting_booking', { p_booking_id: row.booking_id });
    if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    await load(); setNote('預約已取消；個人行事曆將由背景服務同步');
  };
  const checkIn = async (row: Row) => {
    setBusy(true); setNote('');
    try { await invokeAppApi('meeting_check_in', { booking_id: row.booking_id }); await load(); setNote('已完成報到'); }
    catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };
  const respond = async (row: Row, approve: boolean) => {
    if (!window.confirm(approve ? '同意後會取消你的原預約，並把時段改建立為申請人的預約。確定？' : '確定婉拒這筆變更申請？')) return;
    setBusy(true); setNote('');
    const { error } = await getSupabase().rpc('respond_meeting_booking_change_request', { p_request_id: row.request_id, p_approve: approve });
    if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    await load(); setNote(approve ? '已同意，時段已轉給申請人' : '已婉拒此變更申請');
  };

  return <AppShell profile={profile} title={module.title}>
    <div className="mr-page">
      <AdminHeader module={module} busy={busy} note={note} onReload={load} />

      <div className="mr-hero">
        <div>
          <strong className="mr-hero-title">快速預約與週排程</strong>
          <p>週視圖排程總覽 · 送出即生效 · 系統自動防止同時段重複預約</p>
        </div>
        <div className="spacer" />
        <button className={`calendar-link-status${calendarStatus?.connected ? ' is-connected' : ''}`} onClick={openPersonalProfile}>
          <span aria-hidden="true">G</span><b>{calendarStatus?.connected ? '個人行事曆已連結' : '連結個人 Google 行事曆'}</b>
          {calendarStatus?.connected && <small>{calendarStatus.google_email}</small>}
        </button>
        {isAdmin && <button className="btn" onClick={() => setRoomAdmin(true)}>🏢 會議室管理</button>}
      </div>

      {/* 週排程 */}
      <div className="mr-panel mr-schedule-panel">
        <div className="mr-panel-head">
          <strong>週排程</strong>
          <div className="spacer" />
          <div className="week-nav">
            <button className="btn" onClick={() => setWeekStart(d => addDays(d, -7))}>‹ 上週</button>
            <span className="week-label">{fmtMD(days[0])} — {fmtMD(days[6])}</span>
            <button className="btn" onClick={() => setWeekStart(d => addDays(d, 7))}>下週 ›</button>
            <button className="btn" onClick={() => setWeekStart(mondayOf(new Date()))}>本週</button>
          </div>
        </div>
        <div className="mr-panel-body">
          {!rooms.length
            ? <div className="empty">{busy ? '載入中…' : '尚未建立會議室，請洽系統管理員於「會議室管理」新增。'}</div>
            : <div className="grid-wrap"><table className="roomgrid">
              <thead><tr><th style={{ minWidth: 110 }}>會議室</th>
                {days.map(d => <th key={isoDate(d)} className={d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''}>
                  週{DOW[(d.getDay() + 6) % 7]}<br />{fmtMD(d)}</th>)}
              </tr></thead>
              <tbody>{rooms.map(room => <tr key={String(room.room_id)}>
                <td className="roomname">{fmt(room.name)}{room.capacity ? <><br /><span style={{ color: 'var(--dim)', fontWeight: 400 }}>{String(room.capacity)} 人</span></> : null}</td>
                {days.map(d => {
                  const dateStr = isoDate(d);
                  const weekend = d.getDay() === 0 || d.getDay() === 6;
                  // 過去日期整格停用；今天仍保留可預約狀態，個別已結束的時段另行灰化。
                  // 以時間判定而不是整天：今天要到最後一個可預約刻度（23:30）都過去了
                  // 才算「已過去」，在那之前仍可預約當天剩下的時段。
                  const past = dateStr < today
                    || (dateStr === today && slotStartAt(dateStr, LAST_SLOT).getTime() <= tick);
                  const items = weekBookings
                    .filter(b => b.room_id === room.room_id && b.booking_date === dateStr)
                    .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
                  return <td key={dateStr}
                    className={[weekend ? 'weekend' : '', past ? 'past' : '', !past && room.status === 'active' ? 'selectable' : ''].filter(Boolean).join(' ')}
                    title={past ? '此日已無可預約時段' : room.status !== 'active' ? '會議室已停用' : '點選選擇預約日期'}
                    aria-disabled={past || room.status !== 'active' ? true : undefined}
                    onClick={() => { if (!past && room.status === 'active') setBooking({ room_id: String(room.room_id), date: dateStr }); }}>
                    {items.map(b => {
                      const mine = b.user_id === profile.user_id;
                      const ended = bookingEndAt(b).getTime() <= tick;
                      const future = !ended;
                      const canCancel = mine && b.status === 'booked';
                      const canRequest = !mine && b.status === 'booked' && future;
                      return <div key={String(b.booking_id)}
                        className={`bk-pill${mine ? ' mine' : ''}${canCancel ? ' can-cancel' : ''}${ended ? ' past-booking' : ''}`}
                        role={canCancel ? 'button' : undefined} tabIndex={canCancel ? 0 : undefined}
                        title={canCancel ? '點擊取消此預約' : ended ? '此時段已過去' : undefined}
                        onClick={canCancel ? e => { e.stopPropagation(); void cancel(b); } : undefined}
                        onKeyDown={canCancel ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); void cancel(b); } } : undefined}>
                        <span className="bk-line">{hhmm(b.start_time)}-{hhmm(b.end_time)}</span>
                        <span className="bk-line person">{nameOf(b.user_id)}</span>
                        <span className="bk-line meeting">{b.purpose || '未填會議名稱'}</span>
                        {canCancel && <span className="bk-cancel-hint">點擊圖卡取消預約</span>}
                        {canRequest && <span><button className="bk-action" onClick={e => { e.stopPropagation(); setChangeFor(b); }}>申請變更</button></span>}
                      </div>;
                    })}
                    {!items.length && past && <span className="past-slot-label">已過去</span>}
                  </td>;
                })}
              </tr>)}</tbody>
            </table></div>}
        </div>
      </div>

      {/* 我的預約 */}
      <div className="mr-panel mr-list-panel">
        <div className="mr-panel-head">
          <strong>我的預約</strong>
          <div className="booking-status-summary" aria-label="預約狀態統計">
            <span className="booking-status-summary-item">已取消 <b>{cancelledCount}</b> 筆</span>
            <span className="booking-status-summary-item">已逾期 <b>{expiredCount}</b> 筆</span>
            <span className="booking-status-summary-total">共 {myBookings.length} 筆</span>
          </div>
        </div>
        <div className="mr-panel-body">
          {!myBookings.length ? <div className="empty">{busy ? '載入中…' : '目前沒有你的預約紀錄。'}</div>
            : <div className="mr-list my-booking-list">{pagedMyBookings.map(b => {
              const room = (b.meeting_rooms as Row) || {};
              const start = slotStartAt(String(b.booking_date), hhmm(b.start_time)).getTime();
              const end = bookingEndAt(b).getTime();
              const inWindow = tick >= start && tick <= end;
              const bookingStatus = String(b.status);
              const statusIsPink = bookingStatus === 'cancelled' || bookingStatus === 'expired';
              const statusLabel = ({ booked: '已預約', checked_in: '已報到', cancelled: '已取消', expired: '已逾期' } as Record<string, string>)[bookingStatus] || fmt(b.status);
              return <div className={`mr-card${statusIsPink ? ' booking-status-pink' : ''}`} key={String(b.booking_id)}>
                <div className="grow booking-info-grid">
                  <strong className="booking-purpose">{fmt(b.purpose)}</strong>
                  <span className="booking-number">{fmt(b.booking_no)}</span>
                  <span className="booking-room">{fmt(room.name)}</span>
                  <span className="booking-time">{fmt(b.booking_date)} {hhmm(b.start_time)}–{hhmm(b.end_time)}</span>
                  <span className={`booking-state${statusIsPink ? ' booking-status-pink-label' : ''}`}>{statusLabel}</span>
                  {b.google_sync_enabled !== false && <span className={`calendar-sync-state is-${String(b.google_calendar_sync_status || 'not_connected')}`}>{({ synced: '已同步行事曆', pending: '行事曆同步中', failed: '行事曆同步失敗', cancelled: '行事曆已取消', not_connected: '行事曆未連結' } as Record<string,string>)[String(b.google_calendar_sync_status || 'not_connected')] || '行事曆待同步'}</span>}
                </div>
                <div className="acts">
                  {b.google_calendar_sync_status === 'failed' && <button className="btn" onClick={async () => { setBusy(true); try { await invokeGoogleCalendar('retry', { booking_id: b.booking_id }); await load(); setNote('已排入 Google 行事曆重新同步'); } catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); } }}>重試同步</button>}
                  {b.status === 'booked' && inWindow && <button className="btn btn-primary checkin-btn" onClick={() => void checkIn(b)}>報到</button>}
                  {b.status === 'booked' && <button className="btn btn-danger" onClick={() => void cancel(b)}>取消預約</button>}
                </div>
              </div>;
            })}</div>}
          {myBookings.length > 0 && <Pager page={myPage} total={myBookings.length} onPage={setMyPage} />}
        </div>
      </div>

      {/* 預約變更申請 */}
      <div className="mr-panel mr-list-panel">
        <div className="mr-panel-head"><strong>預約變更申請</strong>
          <span className="hint">原申請人同意後，系統自動取消原預約並建立申請者的新預約</span></div>
        <div className="mr-panel-body">
          {!requests.length ? <div className="empty">{busy ? '載入中…' : '目前沒有變更申請。'}</div>
            : <div className="mr-list change-request-list">{pagedRequests.map(req => {
              const target = (req.meeting_bookings as Row) || {}, room = (target.meeting_rooms as Row) || {};
              const requester = (req.users as Row) || {};
              const iAmOwner = target.user_id === profile.user_id;
              return <div className="mr-card" key={String(req.request_id)}>
                <div className="grow">
                  <b>{fmt(req.requested_meeting_name)}　<span style={{ color: 'var(--dim)', fontWeight: 400 }}>
                    {{ pending: '待原申請人回覆', approved: '已同意', rejected: '已婉拒', cancelled: '已作廢' }[String(req.status)] || fmt(req.status)}</span></b>
                  <small>申請人 {fmt(requester.name)}｜聯繫 {fmt(req.contact_phone)}</small>
                  <small>原預約 {fmt(target.booking_no)}｜{fmt(room.name)}｜{fmt(target.booking_date)} {hhmm(target.start_time)}–{hhmm(target.end_time)}</small>
                  {req.reason ? <small>原因：{String(req.reason)}</small> : null}
                  {req.response_note ? <small>{String(req.response_note)}</small> : null}
                </div>
                {req.status === 'pending' && iAmOwner && <div className="acts">
                  <button className="btn btn-primary" onClick={() => void respond(req, true)}>同意讓出</button>
                  <button className="btn btn-danger" onClick={() => void respond(req, false)}>婉拒</button>
                </div>}
              </div>;
            })}</div>}
          {requests.length > 0 && <Pager page={requestPage} total={requests.length} onPage={setRequestPage} />}
        </div>
      </div>
    </div>

    {booking && <BookingModal rooms={rooms} init={booking} myPhone={myPhone} now={tick} calendarStatus={calendarStatus}
      onClose={() => setBooking(null)}
      onDone={async msg => { setBooking(null); await load(); setNote(`${msg}；個人行事曆將由背景服務同步`); }} />}
    {changeFor && <ChangeRequestModal row={changeFor} myPhone={myPhone} nameOf={nameOf}
      onClose={() => setChangeFor(null)}
      onDone={async msg => { setChangeFor(null); await load(); setNote(msg); }} />}
    {roomAdmin && <RoomAdminModal rooms={rooms} onClose={() => setRoomAdmin(false)}
      onSaved={async msg => { await load(); setNote(msg); }} />}
  </AppShell>;
}

/* ──────────────────────────── 預約表單彈窗 ──────────────────────────── */

function BookingModal({ rooms, init, myPhone, now, calendarStatus, onClose, onDone }: {
  rooms: Row[]; init: { room_id: string; date: string }; myPhone: string;
  now: number; calendarStatus: GoogleCalendarStatus | null;
  onClose: () => void; onDone: (message: string) => void;
}) {
  const [roomId, setRoomId] = useState(init.room_id);
  const [date, setDate] = useState(init.date);
  const [purpose, setPurpose] = useState('');
  const [start, setStart] = useState<TimeParts>(EMPTY_TIME);
  const [end, setEnd] = useState<TimeParts>(EMPTY_TIME);
  const [contactPhone, setContactPhone] = useState(myPhone);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [repeatUntil, setRepeatUntil] = useState('');
  const [syncGoogle, setSyncGoogle] = useState(Boolean(calendarStatus?.connected));
  const [conflict, setConflict] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');

  const startValue = partsToValue(start), endValue = partsToValue(end);
  const startPast = Boolean(date && startValue && slotStartAt(date, startValue).getTime() <= now);

  // 送出前的衝突預檢，與 V1 的 checkConflictSoon 相同用意：先查同室同日的既有預約。
  useEffect(() => {
    let active = true;
    if (!roomId || !date || !startValue || !endValue || endValue <= startValue) { setConflict(''); return; }
    const timer = window.setTimeout(async () => {
      const dates = [date];
      if (repeatWeekly && repeatUntil >= date) {
        let cursor = date;
        while (true) {
          const next = isoDate(addDays(new Date(`${cursor}T00:00:00`), 7));
          if (next > repeatUntil || dates.length >= 52) break;
          dates.push(next); cursor = next;
        }
      }
      const { data } = await getSupabase().from('meeting_bookings')
        .select('booking_no,booking_date,start_time,end_time')
        .eq('room_id', roomId).in('booking_date', dates).in('status', ['booked', 'checked_in']);
      if (!active) return;
      const hit = (data || []).find(b => startValue < hhmm(b.end_time) && endValue > hhmm(b.start_time));
      setConflict(hit ? `${hit.booking_date} 已有預約 ${hit.booking_no}（${hhmm(hit.start_time)}–${hhmm(hit.end_time)}）` : '');
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [roomId, date, startValue, endValue, repeatWeekly, repeatUntil]);

  const submit = async () => {
    if (!roomId) return setMessage('請選擇會議室');
    if (!purpose.trim()) return setMessage('請填寫會議名稱');
    if (!startValue || !endValue) return setMessage('請選擇完整的開始與結束時間');
    if (endValue <= startValue) return setMessage('結束時間必須晚於開始時間');
    if (startPast) return setMessage('開始時間已經過去，不能預約過去時段');
    const phone = contactPhone.trim();
    if (!myPhone && !phone) return setMessage('系統未登記你的電話，請填寫聯繫電話');
    if (phone && phone.replace(/[^0-9#*]/g, '').length < 4) return setMessage('聯繫電話請至少填寫 4 碼的電話或分機');
    if (repeatWeekly && !repeatUntil) return setMessage('請選擇週期截止日期');
    if (repeatWeekly && repeatUntil < date) return setMessage('週期截止日期不得早於首次預約日期');

    setBusy(true); setMessage('');
    const { data, error } = await getSupabase().rpc('create_meeting_booking_series', {
      p_room_id: roomId, p_purpose: purpose.trim(),
      p_booking_date: date, p_start_time: startValue, p_end_time: endValue,
      p_booker_phone: myPhone || null, p_contact_phone: phone || null,
      p_repeat_weekly: repeatWeekly, p_repeat_until: repeatWeekly ? repeatUntil : null,
    });
    if (error) { setMessage(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    const created = Array.isArray((data as Row)?.bookings) ? (data as Row).bookings as Row[] : [];
    if (!syncGoogle && created.length) {
      const ids = created.map(row => row.booking_id).filter(Boolean);
      if (ids.length) await getSupabase().rpc('set_own_meeting_booking_google_sync', { p_booking_ids: ids, p_enabled: false });
    }
    const count = Number((data as Row)?.count || 1);
    onDone(count > 1 ? `已建立 ${count} 筆週期預約` : '預約已建立');
  };

  return <div className="mr-modal-bg" role="dialog" aria-modal="true" aria-label="新增預約">
    <div className="mr-modal booking-modal">
      <div className="mr-modal-head">
        <div className="booking-modal-heading">
          <span className="booking-modal-mark" aria-hidden="true" />
          <div>
            <span className="modal-eyebrow">MEETING ROOM RESERVATION</span>
            <span className="modal-title">新增預約</span>
            <small>填寫會議資訊並確認使用時段</small>
          </div>
        </div>
        <button className="modal-close" onClick={onClose} aria-label="關閉">✕</button>
      </div>
      <div className="mr-modal-body">
        {conflict && <div className="conflict-alert">時段衝突：{conflict}</div>}
        {startPast && <div className="past-time-alert">開始時間已經過去，請選擇未來時段</div>}
        <section className="booking-form-section">
          <div className="booking-section-head"><span>01</span><div><b>基本資訊</b><small>選擇空間並填寫本次會議名稱</small></div></div>
          <div className="booking-section-fields">
            <div className="field field-wide"><label>會議室</label>
              <select value={roomId} onChange={e => setRoomId(e.target.value)}>
                <option value="">-- 請選擇 --</option>
                {rooms.filter(r => r.status === 'active').map(r => <option key={String(r.room_id)} value={String(r.room_id)}>
                  {r.name}{r.capacity ? `（${r.capacity} 人）` : ''}{r.floor ? `｜${r.floor}` : ''}</option>)}
              </select></div>
            <div className="field"><label>日期（年/月/日）</label><LocalizedDateInput aria-label="預約日期（年/月/日）" min={taipeiToday()} value={date} onChange={e => setDate(e.target.value)} /></div>
            <div className="field"><label>會議名稱</label><input list="meeting-purpose-options" value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="-- 請選擇或輸入 --" /><datalist id="meeting-purpose-options"><option value="" /><option value="主管會議" /><option value="擴大主管會議" /><option value="面試" /><option value="管控會議" /><option value="教育訓練" /><option value="開／決標" /></datalist></div>
          </div>
        </section>
        <section className="booking-form-section">
          <div className="booking-section-head"><span>02</span><div><b>使用時段</b><small>設定開始與結束時間，系統將自動檢查衝突</small></div></div>
          <div className="row2">
            <TimeSelect label="開始時間（上午／下午・時・分）" value={start} onChange={setStart} date={date} now={now} />
            <TimeSelect label="結束時間（上午／下午・時・分）" value={end} onChange={setEnd} date={date} now={now} />
          </div>
        </section>
        <section className="booking-form-section">
          <div className="booking-section-head"><span>03</span><div><b>聯絡與週期</b><small>確認聯繫方式，並視需要設定重複預約</small></div></div>
          <div className="row2">
            <div className="field"><label>系統登記電話</label><input type="tel" readOnly value={myPhone || '（未登記）'} /></div>
            <div className="field"><label>聯繫電話</label><input type="tel" autoComplete="tel" value={contactPhone}
              onChange={e => setContactPhone(e.target.value)} placeholder="請輸入可聯繫的電話或分機" /></div>
          </div>
          <div className={`booking-repeat-panel${repeatWeekly ? ' is-active' : ''}`}>
            <label className="booking-repeat"><input type="checkbox" checked={repeatWeekly}
              onChange={e => setRepeatWeekly(e.target.checked)} /><span><b>每週重複預約</b><small>於相同星期與時段自動建立預約</small></span></label>
            {repeatWeekly && <div className="field"><label>週期截止日期（最多 52 次）</label>
              <LocalizedDateInput aria-label="週期截止日期（年/月/日）" min={date} value={repeatUntil} onChange={e => setRepeatUntil(e.target.value)} /></div>}
          </div>
          <div className={`booking-repeat-panel calendar-sync-option${syncGoogle ? ' is-active' : ''}`}>
            <label className="booking-repeat"><input type="checkbox" checked={syncGoogle} disabled={!calendarStatus?.connected}
              onChange={e => setSyncGoogle(e.target.checked)} /><span><b>同步到我的 Google 行事曆</b><small>{calendarStatus?.connected ? `已連結 ${calendarStatus.google_email || '個人帳號'}` : '請先至個人資料設定連結 Google 帳號'}</small></span></label>
            {!calendarStatus?.connected && <button type="button" className="btn" onClick={openPersonalProfile}>前往個人資料設定</button>}
          </div>
        </section>
      </div>
      <div className="mr-modal-foot">
        <div className="booking-submit-note"><span className="msg">{message}</span>{!message && <small>送出前請再次確認會議室與使用時段</small>}</div>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={busy || startPast} onClick={() => void submit()}>{busy ? '送出中…' : '送出預約'}</button>
      </div>
    </div>
  </div>;
}

/* ──────────────────────────── 變更申請彈窗 ──────────────────────────── */

function ChangeRequestModal({ row, myPhone, nameOf, onClose, onDone }: {
  row: Row; myPhone: string; nameOf: (id: unknown) => string;
  onClose: () => void; onDone: (message: string) => void;
}) {
  const [meetingName, setMeetingName] = useState('');
  const [phone, setPhone] = useState(myPhone);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');

  const submit = async () => {
    if (!meetingName.trim()) return setMessage('請填寫承接此時段的會議名稱');
    if (phone.replace(/[^0-9#*]/g, '').length < 4) return setMessage('請填寫至少 4 碼的聯繫電話或分機');
    setBusy(true); setMessage('');
    const { error } = await getSupabase().rpc('create_meeting_booking_change_request', {
      p_target_booking_id: row.booking_id, p_meeting_name: meetingName.trim(),
      p_contact_phone: phone.trim(), p_reason: reason.trim() || null,
    });
    if (error) { setMessage(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    onDone('變更申請已送出，待原申請人回覆');
  };

  return <div className="mr-modal-bg" role="dialog" aria-modal="true" aria-label="申請變更預約時段">
    <div className="mr-modal">
      <div className="mr-modal-head"><span className="modal-title">申請變更預約時段</span><button onClick={onClose} aria-label="關閉">✕</button></div>
      <div className="mr-modal-body">
        <div className="field"><label>原預約資訊</label>
          <input type="text" readOnly value={`${row.booking_date} ${hhmm(row.start_time)}–${hhmm(row.end_time)}｜${row.purpose || '未填會議名稱'}｜${nameOf(row.user_id)}`} /></div>
        <div className="field"><label>申請者會議名稱</label>
          <input type="text" value={meetingName} onChange={e => setMeetingName(e.target.value)} placeholder="請填寫承接此時段的會議名稱" /></div>
        <div className="field"><label>聯繫電話</label>
          <input type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} /></div>
        <div className="field"><label>申請原因</label>
          <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder="請說明需要此時段的原因" /></div>
      </div>
      <div className="mr-modal-foot">
        <span className="msg">{message}</span>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => void submit()}>{busy ? '送出中…' : '送出變更申請'}</button>
      </div>
    </div>
  </div>;
}

/* ──────────────────────────── 會議室管理彈窗 ──────────────────────────── */

function RoomAdminModal({ rooms, onClose, onSaved }: { rooms: Row[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState<Row>({ name: '', capacity: '', floor: '', status: 'active', note: '' });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const editing = Boolean(form.room_id);

  const reset = () => { setForm({ name: '', capacity: '', floor: '', status: 'active', note: '' }); setMessage(''); };
  const save = async () => {
    if (!String(form.name || '').trim()) return setMessage('請輸入會議室名稱');
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('meeting_save_room', {
        room_id: form.room_id || undefined, name: String(form.name).trim(),
        capacity: form.capacity === '' || form.capacity == null ? null : form.capacity,
        floor: String(form.floor || '').trim() || null, status: String(form.status || 'active'),
        note: String(form.note || '').trim() || null,
      });
      reset(); await onSaved(editing ? '會議室已更新' : '會議室已新增');
    } catch (error) { setMessage(`失敗：${errorMessage(error)}`); }
    finally { setBusy(false); }
  };

  return <div className="mr-modal-bg" role="dialog" aria-modal="true" aria-label="會議室管理">
    <div className="mr-modal wide">
      <div className="mr-modal-head"><span className="modal-title">會議室管理</span><button onClick={onClose} aria-label="關閉">✕</button></div>
      <div className="mr-modal-body">
        <div className="row2">
          <div className="field"><label>名稱</label><input type="text" value={String(form.name || '')} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="例：3F 大會議室" /></div>
          <div className="field"><label>可容納人數</label><input type="number" min={0} value={String(form.capacity ?? '')} onChange={e => setForm({ ...form, capacity: e.target.value })} placeholder="0" /></div>
        </div>
        <div className="row2">
          <div className="field"><label>樓層</label><input type="text" value={String(form.floor || '')} onChange={e => setForm({ ...form, floor: e.target.value })} placeholder="例：3F" /></div>
          <div className="field"><label>狀態</label><select value={String(form.status || 'active')} onChange={e => setForm({ ...form, status: e.target.value })}>
            <option value="active">啟用</option><option value="inactive">停用</option></select></div>
        </div>
        <div className="field"><label>備註</label><input type="text" value={String(form.note || '')} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="選填" /></div>
        {/* 用 class 而非行內樣式，手機版才有辦法用 media query 改成靠右。 */}
        <div className="mr-form-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            {editing ? '儲存變更' : <><span className="mr-add-icon" aria-hidden="true">＋</span> 新增會議室</>}
          </button>
          {editing && <button className="btn" onClick={reset}>取消編輯</button>}
        </div>
        {message && <p className="conflict-alert">{message}</p>}
        {!rooms.length ? <div className="empty">尚未建立會議室</div>
          : <div className="mr-list room-admin-list">{rooms.map((room, index) => <div className={`mr-card room-admin-card room-color-${index % 4}`} key={String(room.room_id)}>
            <div className="grow">
              <b>{fmt(room.name)}</b>
              <small>{room.capacity != null ? `${room.capacity} 人` : '未設人數'}｜{fmt(room.floor)}｜{room.status === 'inactive' ? '停用' : '啟用'}</small>
              {room.note ? <small>{String(room.note)}</small> : null}
            </div>
            <div className="acts"><button className="btn" onClick={() => { setForm({ ...room, capacity: room.capacity ?? '' }); setMessage(''); }}>編輯</button></div>
          </div>)}</div>}
      </div>
    </div>
  </div>;
}

/* ──────────────────────────── 預約提醒（V2 專有） ──────────────────────────── */

function NotificationsModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const { data, error } = await getSupabase()
      .from('meeting_booking_notifications')
      .select('*,meeting_bookings(booking_no,booking_date,start_time,end_time,purpose,meeting_rooms(name))')
      .order('created_at', { ascending: false }).limit(300);
    if (error) setNote(`失敗：${notificationErrorMessage(error)}`);
    setRows(data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [status]);

  const filtered = useMemo(() => rows.filter(r => !status || r.status === status), [rows, status]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return <AppShell profile={profile} title={module.title}>
    <div className="meetingroom-notifications-page">
      <AdminHeader module={module} busy={busy} note={note} onReload={load} />
      <section className="panel admin-panel">
      <div className="admin-toolbar">
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部狀態</option>
          {Object.entries(NOTIFY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span>共 {filtered.length} 筆</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>建立時間</th><th>預約</th><th>類型</th><th>狀態</th><th>發送時間</th><th>回應</th></tr></thead>
        <tbody>{paged.map(row => {
          const b = (row.meeting_bookings as Row) || {}, room = (b.meeting_rooms as Row) || {};
          return <tr key={String(row.notification_id)}>
            <td>{fmtTime(row.created_at)}</td>
            <td><strong>{fmt(b.booking_no)}</strong><small>{fmt(room.name)}｜{fmt(b.booking_date)} {hhmm(b.start_time)}–{hhmm(b.end_time)}</small></td>
            <td>{notificationTypeLabel(row.notification_type)}</td>
            <td>{notificationStatusLabel(row.status)}</td>
            <td>{fmtTime(row.sent_at)}</td>
            <td>{notificationResponseLabel(row.line_response)}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有提醒紀錄</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
      </section>
    </div>
  </AppShell>;
}
