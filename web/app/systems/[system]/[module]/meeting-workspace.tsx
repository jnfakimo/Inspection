'use client';

// SYS-08 會議室預約 V2 工作區。
//
// 四個模組（預約／會議室主檔／變更申請／預約提醒）由此檔統一承接，取代原本的唯讀列表。
// 所有寫入都走既有的伺服器端入口，不在前端拼裝 insert／update：
//   create_meeting_booking_series        —— 建立預約（含每週週期，逐次檢查衝突後原子建立）
//   cancel_own_meeting_booking           —— 取消自己的預約，並連帶作廢待審的變更申請
//   create_meeting_booking_change_request—— 對他人預約提出變更申請
//   respond_meeting_booking_change_request—— 原申請人同意／婉拒（同意時於單一交易換手）
//   app-api meeting_check_in / meeting_save_room —— 報到與會議室主檔維護
// 前端的檢查只用於即時提示，時段衝突、過去時段、電話碼數、52 次上限等規則
// 一律以資料庫回傳的錯誤為準。

import { useCallback, useEffect, useMemo, useState } from 'react';
import '@/app/admin-workspace.css';
import { AppShell } from '@/components/AppShell';
import { AuthGate } from '@/components/AuthGate';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { AdminHeader, AdminModal, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from '@/components/admin/shared';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };

const BOOKING_LABEL: Record<string, string> = { booked: '已預約', checked_in: '已報到', cancelled: '已取消', expired: '已逾期' };
const BOOKING_TONE: Record<string, string> = { booked: 'assigned', checked_in: 'closed', cancelled: 'cancelled', expired: 'pending' };
const CHANGE_LABEL: Record<string, string> = { pending: '待原申請人回覆', approved: '已同意', rejected: '已婉拒', cancelled: '已作廢' };
const CHANGE_TONE: Record<string, string> = { pending: 'pending', approved: 'closed', rejected: 'cancelled', cancelled: 'cancelled' };
const NOTIFY_LABEL: Record<string, string> = { pending: '待發送', sent: '已發送', failed: '發送失敗', skipped: '略過' };
const NOTIFY_TONE: Record<string, string> = { pending: 'pending', sent: 'closed', failed: 'cancelled', skipped: 'review' };
const NOTIFY_TYPE: Record<string, string> = { reminder: '開始前提醒', expired: '逾時未報到' };
const ROOM_LABEL: Record<string, string> = { active: '開放預約', inactive: '停用' };
const ROOM_TONE: Record<string, string> = { active: 'closed', inactive: 'cancelled' };

function Pill({ value, labels, tones }: { value: unknown; labels: Record<string, string>; tones: Record<string, string> }) {
  const key = String(value || '');
  return <span className={`status-pill ${tones[key] || 'pending'}`}>{labels[key] || fmt(value)}</span>;
}

function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((acc, part) => (acc[part.type] = part.value, acc), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function timeText(value: unknown) { return value ? String(value).slice(0, 5) : '—'; }
// 預約時段限 00／30 分，選單直接列出所有合法值，避免使用者踩到資料庫的格式檢查。
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
// 台北時區下該筆預約的起訖絕對時間；用來判斷是否在可報到區間。
function bookingWindow(row: Row) {
  const start = Date.parse(`${row.booking_date}T${String(row.start_time).slice(0, 8)}+08:00`);
  const end = Date.parse(`${row.booking_date}T${String(row.end_time).slice(0, 8)}+08:00`);
  return { start, end };
}

export function MeetingWorkspace({ system, module }: { system: SystemDefinition; module: ModuleDefinition }) {
  return <AuthGate>{profile => {
    if (module.key === 'rooms') return <RoomsModule system={system} module={module} profile={profile} />;
    if (module.key === 'changes') return <ChangesModule system={system} module={module} profile={profile} />;
    if (module.key === 'notifications') return <NotificationsModule system={system} module={module} profile={profile} />;
    return <BookingsModule system={system} module={module} profile={profile} />;
  }}</AuthGate>;
}

function useIsAdmin(profile: Profile) {
  const role = String(profile.rbac_role || profile.role || '');
  return role === 'sysadmin' || role === 'admin';
}

/* ──────────────────────────── 會議預約 ──────────────────────────── */

function BookingsModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [rooms, setRooms] = useState<Row[]>([]);
  const [myPhone, setMyPhone] = useState('');
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [scope, setScope] = useState('upcoming'), [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [changeFor, setChangeFor] = useState<Row | null>(null);
  const [tick, setTick] = useState(Date.now());

  // 報到按鈕會隨時間進出可用狀態，每分鐘重算一次即可。
  useEffect(() => { const timer = window.setInterval(() => setTick(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [b, r, u] = await Promise.all([
      client.from('meeting_bookings').select('*,meeting_rooms(name,floor),users(name,department)').order('booking_date', { ascending: false }).order('start_time', { ascending: false }).limit(500),
      client.from('meeting_rooms').select('room_id,name,capacity,floor,status').order('name'),
      client.from('users').select('phone').eq('user_id', profile.user_id).maybeSingle(),
    ]);
    if (b.error || r.error) setNote(`失敗：${errorMessage(b.error || r.error, '會議預約資料載入失敗')}`);
    setRows(b.data || []); setRooms(r.data || []); setMyPhone(String((u.data as Row)?.phone || '')); setBusy(false);
  }, [profile.user_id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [query, status, scope]);

  const today = taipeiToday();
  const filtered = useMemo(() => rows.filter(row => {
    const q = query.trim().toLowerCase();
    const room = (row.meeting_rooms as Row) || {}, user = (row.users as Row) || {};
    if (scope === 'upcoming' && String(row.booking_date) < today) return false;
    if (scope === 'mine' && row.user_id !== profile.user_id) return false;
    return (!status || row.status === status) &&
      (!q || [row.booking_no, row.purpose, room.name, user.name, row.contact_phone].some(v => String(v || '').toLowerCase().includes(q)));
  }), [rows, query, status, scope, today, profile.user_id]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const checkIn = async (row: Row) => {
    setBusy(true); setNote('');
    try { await invokeAppApi('meeting_check_in', { booking_id: row.booking_id }); await load(); setNote('已完成報到'); }
    catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };
  const cancel = async (row: Row) => {
    if (!window.confirm(`確定取消「${fmt(row.purpose)}」這筆預約？`)) return;
    setBusy(true); setNote('');
    const { error } = await getSupabase().rpc('cancel_own_meeting_booking', { p_booking_id: row.booking_id });
    if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    await load(); setNote('預約已取消');
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={<button className="primary-btn compact" onClick={() => setCreating(true)}>＋ 新增預約</button>} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋預約編號、會議名稱、會議室或預約人" />
        <select value={scope} onChange={e => setScope(e.target.value)}>
          <option value="upcoming">今日與未來</option>
          <option value="mine">我的預約</option>
          <option value="all">全部</option>
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部狀態</option>
          {Object.entries(BOOKING_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <span>共 {filtered.length} 筆</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>預約編號</th><th>日期／時段</th><th>會議室</th><th>會議名稱</th><th>預約人</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>{paged.map(row => {
          const room = (row.meeting_rooms as Row) || {}, user = (row.users as Row) || {};
          const mine = row.user_id === profile.user_id;
          const { start, end } = bookingWindow(row);
          const inWindow = tick >= start && tick <= end;
          const ended = tick > end;
          return <tr key={String(row.booking_id)}>
            <td><strong>{fmt(row.booking_no)}</strong><small>建立 {fmtTime(row.created_at)}</small></td>
            <td>{fmt(row.booking_date)}<small>{timeText(row.start_time)}–{timeText(row.end_time)}</small></td>
            <td>{fmt(room.name)}{room.floor ? <small>{String(room.floor)}</small> : null}</td>
            <td>{fmt(row.purpose)}{row.contact_phone ? <small>聯繫 {String(row.contact_phone)}</small> : null}</td>
            <td>{fmt(user.name)}{mine ? <small>我的預約</small> : user.department ? <small>{String(user.department)}</small> : null}</td>
            <td><Pill value={row.status} labels={BOOKING_LABEL} tones={BOOKING_TONE} /></td>
            <td><div className="admin-row-actions">
              {mine && row.status === 'booked' && inWindow && <button onClick={() => void checkIn(row)}>報到</button>}
              {mine && row.status === 'booked' && <button className="warn" onClick={() => void cancel(row)}>取消</button>}
              {!mine && row.status === 'booked' && !ended && <button onClick={() => setChangeFor(row)}>申請變更</button>}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">查無符合條件的預約</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
    </section>

    {creating && <CreateBookingModal rooms={rooms} myPhone={myPhone} onClose={() => setCreating(false)}
      onDone={async (message) => { setCreating(false); await load(); setNote(message); }} />}
    {changeFor && <ChangeRequestModal row={changeFor} myPhone={myPhone} onClose={() => setChangeFor(null)}
      onDone={async (message) => { setChangeFor(null); await load(); setNote(message); }} />}
  </AppShell>;
}

function CreateBookingModal({ rooms, myPhone, onClose, onDone }: { rooms: Row[]; myPhone: string; onClose: () => void; onDone: (message: string) => void }) {
  const [form, setForm] = useState({
    room_id: '', purpose: '', booking_date: taipeiToday(), start_time: '09:00', end_time: '10:00',
    contact_phone: myPhone, repeat_weekly: false, repeat_until: '',
  });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const set = (key: string, value: string | boolean) => setForm(prev => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.room_id) return setMessage('請選擇會議室');
    if (!form.purpose.trim()) return setMessage('請填寫會議名稱');
    if (form.end_time <= form.start_time) return setMessage('結束時間必須晚於開始時間');
    // 系統未登記電話時，聯繫電話為必填（與資料庫的 guard 一致）。
    const phone = form.contact_phone.trim();
    if (!myPhone && !phone) return setMessage('系統未登記你的電話，請填寫聯繫電話');
    if (phone && phone.replace(/[^0-9#*]/g, '').length < 4) return setMessage('聯繫電話請至少填寫 4 碼的電話或分機');
    if (form.repeat_weekly && !form.repeat_until) return setMessage('請選擇週期截止日期');
    if (form.repeat_weekly && form.repeat_until < form.booking_date) return setMessage('週期截止日期不得早於首次預約日期');

    setBusy(true); setMessage('');
    const { data, error } = await getSupabase().rpc('create_meeting_booking_series', {
      p_room_id: form.room_id, p_purpose: form.purpose.trim(),
      p_booking_date: form.booking_date, p_start_time: form.start_time, p_end_time: form.end_time,
      p_booker_phone: myPhone || null, p_contact_phone: phone || null,
      p_repeat_weekly: form.repeat_weekly, p_repeat_until: form.repeat_weekly ? form.repeat_until : null,
    });
    if (error) { setMessage(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    const count = Number((data as Row)?.count || 1);
    onDone(count > 1 ? `已建立 ${count} 筆週期預約` : '預約已建立');
  };

  return <AdminModal title="新增會議室預約" onClose={onClose}>
    <div className="admin-form-grid">
      <label>會議室（必填）<select value={form.room_id} onChange={e => set('room_id', e.target.value)}>
        <option value="">-- 請選擇 --</option>
        {rooms.filter(room => room.status === 'active').map(room =>
          <option key={String(room.room_id)} value={String(room.room_id)}>{room.name}{room.capacity ? `（${room.capacity} 人）` : ''}{room.floor ? `｜${room.floor}` : ''}</option>)}
      </select></label>
      <label>預約日期（必填）<input type="date" min={taipeiToday()} value={form.booking_date} onChange={e => set('booking_date', e.target.value)} /></label>
      <label>開始時間<select value={form.start_time} onChange={e => set('start_time', e.target.value)}>{HALF_HOURS.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
      <label>結束時間<select value={form.end_time} onChange={e => set('end_time', e.target.value)}>{HALF_HOURS.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
      <label className="wide">會議名稱（必填）<input value={form.purpose} onChange={e => set('purpose', e.target.value)} placeholder="例：設備維護月會" /></label>
      <label className="wide">聯繫電話{myPhone ? '（可留空，預設用系統登記的號碼）' : '（必填）'}
        <input value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} placeholder="分機或手機，至少 4 碼" /></label>
      <label className="wide checkbox"><input type="checkbox" checked={form.repeat_weekly} onChange={e => set('repeat_weekly', e.target.checked)} />每週重複（同一星期幾、同一時段）</label>
      {form.repeat_weekly && <label className="wide">週期截止日期（最多 52 次）
        <input type="date" min={form.booking_date} value={form.repeat_until} onChange={e => set('repeat_until', e.target.value)} /></label>}
    </div>
    {message && <p className="inline-message danger">{message}</p>}
    <footer>
      <button className="secondary-btn" onClick={onClose}>取消</button>
      <button className="primary-btn compact" disabled={busy} onClick={() => void submit()}>{busy ? '送出中…' : '送出預約'}</button>
    </footer>
  </AdminModal>;
}

function ChangeRequestModal({ row, myPhone, onClose, onDone }: { row: Row; myPhone: string; onClose: () => void; onDone: (message: string) => void }) {
  const room = (row.meeting_rooms as Row) || {}, owner = (row.users as Row) || {};
  const [form, setForm] = useState({ meeting_name: '', contact_phone: myPhone, reason: '' });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!form.meeting_name.trim()) return setMessage('請填寫你的會議名稱');
    if (form.contact_phone.replace(/[^0-9#*]/g, '').length < 4) return setMessage('請填寫至少 4 碼的聯繫電話或分機');
    setBusy(true); setMessage('');
    const { error } = await getSupabase().rpc('create_meeting_booking_change_request', {
      p_target_booking_id: row.booking_id, p_meeting_name: form.meeting_name.trim(),
      p_contact_phone: form.contact_phone.trim(), p_reason: form.reason.trim() || null,
    });
    if (error) { setMessage(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    onDone('變更申請已送出，待原申請人回覆');
  };

  return <AdminModal title="申請變更他人預約" onClose={onClose}>
    <dl className="detail-grid">
      <div><dt>原預約</dt><dd>{fmt(row.booking_no)}｜{fmt(row.purpose)}</dd></div>
      <div><dt>原申請人</dt><dd>{fmt(owner.name)}</dd></div>
      <div><dt>會議室</dt><dd>{fmt(room.name)}</dd></div>
      <div><dt>時段</dt><dd>{fmt(row.booking_date)} {timeText(row.start_time)}–{timeText(row.end_time)}</dd></div>
    </dl>
    <div className="admin-form-grid">
      <label className="wide">你的會議名稱（必填）<input value={form.meeting_name} onChange={e => set('meeting_name', e.target.value)} /></label>
      <label className="wide">聯繫電話（必填，至少 4 碼）<input value={form.contact_phone} onChange={e => set('contact_phone', e.target.value)} /></label>
      <label className="wide">申請原因<textarea rows={2} value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="讓原申請人判斷是否讓出時段" /></label>
    </div>
    <p className="inline-message">送出後由<b>原申請人</b>決定是否讓出。同意時系統會在同一筆交易內取消原預約並改建立你的預約，時段與會議室不變。</p>
    {message && <p className="inline-message danger">{message}</p>}
    <footer>
      <button className="secondary-btn" onClick={onClose}>取消</button>
      <button className="primary-btn compact" disabled={busy} onClick={() => void submit()}>{busy ? '送出中…' : '送出申請'}</button>
    </footer>
  </AdminModal>;
}

/* ──────────────────────────── 會議室主檔 ──────────────────────────── */

function RoomsModule({ module, profile }: Props) {
  const isAdmin = useIsAdmin(profile);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState(''), [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const { data, error } = await getSupabase().from('meeting_rooms').select('*').order('name');
    if (error) setNote(`失敗：${errorMessage(error, '會議室主檔載入失敗')}`);
    setRows(data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => rows.filter(row => {
    const q = query.trim().toLowerCase();
    return !q || [row.name, row.floor, row.note].some(v => String(v || '').toLowerCase().includes(q));
  }), [rows, query]);

  const save = async () => {
    if (!editor) return;
    if (!String(editor.name || '').trim()) { setNote('失敗：請輸入會議室名稱'); return; }
    setBusy(true); setNote('');
    try {
      await invokeAppApi('meeting_save_room', {
        room_id: editor.room_id || undefined, name: String(editor.name).trim(),
        capacity: editor.capacity === '' || editor.capacity == null ? null : editor.capacity,
        floor: String(editor.floor || '').trim() || null, status: String(editor.status || 'active'),
        note: String(editor.note || '').trim() || null,
      });
      setEditor(null); await load(); setNote(editor.room_id ? '會議室已更新' : '會議室已新增');
    } catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={isAdmin ? <button className="primary-btn compact" onClick={() => setEditor({ status: 'active' })}>＋ 新增會議室</button> : undefined} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋會議室名稱、樓層或備註" />
        <span>開放 {rows.filter(r => r.status === 'active').length}／共 {rows.length} 間</span>
        {!isAdmin && <span className="inline-message">僅管理者可維護會議室主檔</span>}
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>會議室</th><th>容量</th><th>樓層</th><th>備註</th><th>狀態</th>{isAdmin && <th>操作</th>}</tr></thead>
        <tbody>{filtered.map(row => <tr key={String(row.room_id)}>
          <td><strong>{fmt(row.name)}</strong></td>
          <td>{row.capacity == null ? '—' : `${row.capacity} 人`}</td>
          <td>{fmt(row.floor)}</td>
          <td>{fmt(row.note)}</td>
          <td><Pill value={row.status} labels={ROOM_LABEL} tones={ROOM_TONE} /></td>
          {isAdmin && <td><div className="admin-row-actions"><button onClick={() => setEditor({ ...row })}>編輯</button></div></td>}
        </tr>)}</tbody>
      </table></div>
      {!busy && filtered.length === 0 && <p className="empty">目前沒有會議室資料</p>}
    </section>

    {editor && <AdminModal title={editor.room_id ? `編輯會議室｜${fmt(editor.name)}` : '新增會議室'} onClose={() => setEditor(null)}>
      <div className="admin-form-grid">
        <label>名稱（必填）<input value={String(editor.name || '')} onChange={e => setEditor({ ...editor, name: e.target.value })} /></label>
        <label>容量（人）<input type="number" min={0} value={editor.capacity == null ? '' : String(editor.capacity)} onChange={e => setEditor({ ...editor, capacity: e.target.value })} /></label>
        <label>樓層<input value={String(editor.floor || '')} onChange={e => setEditor({ ...editor, floor: e.target.value })} placeholder="例：3F" /></label>
        <label>狀態<select value={String(editor.status || 'active')} onChange={e => setEditor({ ...editor, status: e.target.value })}>
          {Object.entries(ROOM_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label className="wide">備註<input value={String(editor.note || '')} onChange={e => setEditor({ ...editor, note: e.target.value })} /></label>
      </div>
      <footer>
        <button className="secondary-btn" onClick={() => setEditor(null)}>取消</button>
        <button className="primary-btn compact" disabled={busy} onClick={() => void save()}>{busy ? '儲存中…' : '儲存'}</button>
      </footer>
    </AdminModal>}
  </AppShell>;
}

/* ──────────────────────────── 變更申請 ──────────────────────────── */

function ChangesModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState(''), [status, setStatus] = useState('pending'), [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const { data, error } = await getSupabase()
      .from('meeting_booking_change_requests')
      // 這張表對 users 有兩個外鍵（requester_id／responded_by），對 meeting_bookings
      // 也有兩個（target_booking_id／created_booking_id），兩者都必須指定要 join 哪一個，
      // 否則 PostgREST 會回 PGRST201。以欄位名稱指定，不依賴 constraint 命名。
      .select('*,meeting_bookings!target_booking_id(booking_no,booking_date,start_time,end_time,status,user_id,purpose,meeting_rooms(name)),users!requester_id(name,department)')
      .order('created_at', { ascending: false }).limit(300);
    if (error) setNote(`失敗：${errorMessage(error, '變更申請載入失敗')}`);
    setRows(data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [status]);

  const filtered = useMemo(() => rows.filter(row => !status || row.status === status), [rows, status]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const respond = async (row: Row, approve: boolean) => {
    if (!window.confirm(approve ? '同意後會取消你的原預約，並把時段改建立為申請人的預約。確定？' : '確定婉拒這筆變更申請？')) return;
    setBusy(true); setNote('');
    const { error } = await getSupabase().rpc('respond_meeting_booking_change_request', { p_request_id: row.request_id, p_approve: approve });
    if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    await load(); setNote(approve ? '已同意，時段已轉給申請人' : '已婉拒此變更申請');
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部狀態</option>
          {Object.entries(CHANGE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <span>共 {filtered.length} 筆</span>
        <span className="inline-message">只有原預約的申請人可以同意或婉拒</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>申請時間</th><th>原預約</th><th>申請人</th><th>申請會議名稱</th><th>原因</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>{paged.map(row => {
          const booking = (row.meeting_bookings as Row) || {}, requester = (row.users as Row) || {};
          const room = (booking.meeting_rooms as Row) || {};
          const iAmOwner = booking.user_id === profile.user_id;
          return <tr key={String(row.request_id)}>
            <td>{fmtTime(row.created_at)}</td>
            <td><strong>{fmt(booking.booking_no)}</strong><small>{fmt(room.name)}｜{fmt(booking.booking_date)} {timeText(booking.start_time)}–{timeText(booking.end_time)}</small></td>
            <td>{fmt(requester.name)}{requester.department ? <small>{String(requester.department)}</small> : null}<small>聯繫 {fmt(row.contact_phone)}</small></td>
            <td>{fmt(row.requested_meeting_name)}</td>
            <td>{fmt(row.reason)}{row.response_note ? <small>{String(row.response_note)}</small> : null}</td>
            <td><Pill value={row.status} labels={CHANGE_LABEL} tones={CHANGE_TONE} />{row.responded_at ? <small>{fmtTime(row.responded_at)}</small> : null}</td>
            <td><div className="admin-row-actions">
              {row.status === 'pending' && iAmOwner && <>
                <button onClick={() => void respond(row, true)}>同意讓出</button>
                <button className="warn" onClick={() => void respond(row, false)}>婉拒</button>
              </>}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有變更申請</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
    </section>
  </AppShell>;
}

/* ──────────────────────────── 預約提醒 ──────────────────────────── */

function NotificationsModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const { data, error } = await getSupabase()
      .from('meeting_booking_notifications')
      .select('*,meeting_bookings(booking_no,booking_date,start_time,end_time,purpose,meeting_rooms(name))')
      .order('created_at', { ascending: false }).limit(300);
    if (error) setNote(`失敗：${errorMessage(error, '預約提醒載入失敗')}`);
    setRows(data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [status]);

  const filtered = useMemo(() => rows.filter(row => !status || row.status === status), [rows, status]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部狀態</option>
          {Object.entries(NOTIFY_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <span>共 {filtered.length} 筆</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>建立時間</th><th>預約</th><th>類型</th><th>狀態</th><th>發送時間</th><th>回應</th></tr></thead>
        <tbody>{paged.map(row => {
          const booking = (row.meeting_bookings as Row) || {}, room = (booking.meeting_rooms as Row) || {};
          return <tr key={String(row.notification_id)}>
            <td>{fmtTime(row.created_at)}</td>
            <td><strong>{fmt(booking.booking_no)}</strong><small>{fmt(room.name)}｜{fmt(booking.booking_date)} {timeText(booking.start_time)}–{timeText(booking.end_time)}</small></td>
            <td>{NOTIFY_TYPE[String(row.notification_type)] || fmt(row.notification_type)}</td>
            <td><Pill value={row.status} labels={NOTIFY_LABEL} tones={NOTIFY_TONE} /></td>
            <td>{fmtTime(row.sent_at)}</td>
            <td>{fmt(row.line_response)}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有提醒紀錄</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
    </section>
  </AppShell>;
}
