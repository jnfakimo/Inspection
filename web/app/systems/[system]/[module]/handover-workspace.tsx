'use client';

// SYS-04 電子交接簿：補完三個模組，並修正兩個讓核心流程完全失效的缺陷。
//
// 1. 建立交接單原本必失敗：handover_records_own_insert 政策要求
//    created_by = active_user_id()，但既有實作的 insert 沒有帶 created_by，
//    欄位為 NULL 便通不過 with check。
// 2. 接收交接原本永遠做不到：畫面走 app-api 的 module_data，而該 action 只回傳
//    設定檔列出的欄位（shift_date/shift_type/issues/pending/notes/status/created_at），
//    record_id、takeover_by、confirmed_at 全部取不到——按鈕條件永遠不成立，
//    就算成立也會用 undefined 的 record_id 去更新。改為直接查表。
// 3. equipment（設備概況）原本渲染的是交接表單。改為交接當下的設備狀態總覽。
//
// 未結事項改用既有的案件模型 handover_cases，異動一律走 handover_case_action
// （security definer，內含與 handover_cases_party_update 等價的授權判斷，
// 並在同一交易寫入 handover_case_logs）。

import { useCallback, useEffect, useMemo, useState } from 'react';
import '@/app/admin-workspace.css';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { AdminHeader, AdminModal, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from '@/components/admin/shared';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };

const DEFAULT_SHIFTS = [
  { id: 'morning', label: '早班', start: '06:00', end: '14:00' },
  { id: 'afternoon', label: '中班', start: '14:00', end: '22:00' },
  { id: 'night', label: '夜班', start: '22:00', end: '06:00' },
];
const CASE_STATUS: Record<string, string> = { open: '未處理', in_progress: '處理中', pending: '待料／待外部', closed: '已結案' };
const CASE_TONE: Record<string, string> = { open: 'cancelled', in_progress: 'in-progress', pending: 'review', closed: 'closed' };
const EQUIPMENT_STATUS: Record<string, string> = { active: '使用中', repair: '維修中', inactive: '停用', retired: '報廢' };
const EQUIPMENT_TONE: Record<string, string> = { active: 'closed', repair: 'in-progress', inactive: 'pending', retired: 'cancelled' };

function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((acc, part) => (acc[part.type] = part.value, acc), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function Pill({ value, labels, tones }: { value: unknown; labels: Record<string, string>; tones: Record<string, string> }) {
  const key = String(value || '');
  return <span className={`status-pill ${tones[key] || 'pending'}`}>{labels[key] || fmt(value)}</span>;
}

export function HandoverModules({ system, module, profile }: Props) {
  if (module.key === 'open-items') return <CasesModule system={system} module={module} profile={profile} />;
  if (module.key === 'equipment') return <EquipmentOverview system={system} module={module} profile={profile} />;
  return <RecordsModule system={system} module={module} profile={profile} />;
}

/* ──────────────────────────── 交接紀錄 ──────────────────────────── */

function RecordsModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [shifts, setShifts] = useState(DEFAULT_SHIFTS);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    // 直接查表才拿得到 record_id／takeover_by／confirmed_at，接收流程才可能成立。
    const [r, u, s] = await Promise.all([
      client.from('handover_records').select('*').order('shift_date', { ascending: false }).order('created_at', { ascending: false }).limit(500),
      client.from('users').select('user_id,name,department').eq('status', 'active').order('name').limit(2000),
      client.from('system_settings').select('value').eq('key', 'shifts').maybeSingle(),
    ]);
    if (r.error || u.error) setNote(`失敗：${errorMessage(r.error || u.error, '交接資料載入失敗')}`);
    setRows(r.data || []); setUsers(u.data || []);
    // system_settings 為管理者專屬，讀不到就沿用與資料庫 handover_shift_end_at 相同的預設三班制。
    try {
      const parsed = s.data?.value ? JSON.parse(String(s.data.value)) : null;
      if (Array.isArray(parsed) && parsed.length) {
        setShifts(parsed.map((item: Row) => ({ id: String(item.id), label: String(item.name || item.label || item.id), start: String(item.start || ''), end: String(item.end || '') })));
      }
    } catch { /* 設定格式異常時沿用預設 */ }
    setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [query, status]);

  const nameOf = useCallback((id: unknown) => users.find(u => u.user_id === id)?.name || (id ? String(id) : '—'), [users]);
  const shiftLabel = useCallback((id: unknown) => shifts.find(s => s.id === id)?.label || fmt(id), [shifts]);
  const stateOf = (row: Row) => row.confirmed_at ? 'done' : row.status === 'confirmed' ? 'waiting' : 'draft';

  const filtered = useMemo(() => rows.filter(row => {
    const q = query.trim().toLowerCase();
    const state = stateOf(row);
    return (!status || state === status) &&
      (!q || [row.shift_date, shiftLabel(row.shift_type), nameOf(row.handover_by), nameOf(row.takeover_by), row.issues, row.pending, row.notes].some(v => String(v || '').toLowerCase().includes(q)));
  }), [rows, query, status, nameOf, shiftLabel]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const receive = async (row: Row) => {
    setBusy(true); setNote('');
    const { data, error } = await getSupabase().from('handover_records')
      .update({ confirmed_by: profile.user_id, confirmed_at: new Date().toISOString() })
      .eq('record_id', row.record_id).eq('takeover_by', profile.user_id).eq('status', 'confirmed')
      .select('record_id').maybeSingle();
    if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    if (!data) { setNote('失敗：這筆交接單已被處理或你不是指定的接班人'); setBusy(false); return; }
    await load(); setNote('已接收，交接正式完成');
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={<button className="primary-btn compact" onClick={() => setCreating(true)}>＋ 新增交接單</button>} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋日期、班別、交接人、異常或待辦" />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部狀態</option>
          <option value="draft">草稿</option><option value="waiting">待接班人接收</option><option value="done">交接完成</option>
        </select>
        <span>待接收 {rows.filter(r => stateOf(r) === 'waiting').length}／共 {filtered.length} 筆</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>日期／班別</th><th>交接人 → 接班人</th><th>異常事項</th><th>待辦</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>{paged.map(row => {
          const state = stateOf(row);
          const mine = String(row.takeover_by) === profile.user_id;
          return <tr key={String(row.record_id)}>
            <td><strong>{fmt(row.shift_date)}</strong><small>{shiftLabel(row.shift_type)}</small></td>
            <td>{nameOf(row.handover_by)} → {nameOf(row.takeover_by)}
              {row.confirmed_at ? <small>接收於 {fmtTime(row.confirmed_at)}</small> : null}</td>
            <td>{fmt(row.issues)}</td>
            <td>{fmt(row.pending)}</td>
            <td><span className={`status-pill ${state === 'done' ? 'closed' : state === 'waiting' ? 'review' : 'pending'}`}>
              {state === 'done' ? '交接完成' : state === 'waiting' ? '待接班人接收' : '草稿'}</span></td>
            <td><div className="admin-row-actions">
              {state === 'waiting' && mine && <button onClick={() => void receive(row)}>接收交接</button>}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有交接紀錄</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
    </section>

    {creating && <CreateRecordModal users={users} shifts={shifts} profile={profile}
      onClose={() => setCreating(false)}
      onDone={async (message) => { setCreating(false); await load(); setNote(message); }} />}
  </AppShell>;
}

function CreateRecordModal({ users, shifts, profile, onClose, onDone }: {
  users: Row[]; shifts: typeof DEFAULT_SHIFTS; profile: Profile; onClose: () => void; onDone: (message: string) => void;
}) {
  const [form, setForm] = useState({
    shift_date: taipeiToday(), shift_type: shifts[0]?.id || 'morning',
    handover_by: profile.user_id, takeover_by: '',
    eq_normal: '', eq_abnormal: '', issues: '', pending: '', notes: '',
  });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  const save = async (status: 'draft' | 'confirmed') => {
    if (!form.shift_date || !form.handover_by || !form.takeover_by) return setMessage('請選擇交接日期、交接人與接班人');
    if (form.handover_by === form.takeover_by) return setMessage('交接人與接班人不可為同一人');
    setBusy(true); setMessage('');
    const num = (v: string) => { const n = Number(String(v).trim()); return Number.isFinite(n) && String(v).trim() ? n : null; };
    const { error } = await getSupabase().from('handover_records').insert({
      shift_date: form.shift_date, shift_type: form.shift_type,
      handover_by: form.handover_by, takeover_by: form.takeover_by,
      eq_normal: num(form.eq_normal), eq_abnormal: num(form.eq_abnormal),
      issues: form.issues.trim() || null, pending: form.pending.trim() || null, notes: form.notes.trim() || null,
      status,
      // handover_records_own_insert 政策要求 created_by = active_user_id()，不帶會被擋下。
      created_by: profile.user_id,
    });
    if (error) {
      const raw = String(error.message || '');
      setMessage(/row-level security/i.test(raw)
        ? '失敗：沒有建立交接單的權限（需要電子交接簿系統權限）'
        : /已經結束|不能建立過去班次/.test(raw) ? '失敗：所選交接日期與班別已經結束，不能建立過去班次的交接單'
          : `失敗：${errorMessage(error)}`);
      setBusy(false); return;
    }
    onDone(status === 'draft' ? '草稿已儲存' : '交接單已送出，等待指定接班人接收');
  };

  return <AdminModal title="新增交接單" onClose={onClose}>
    <div className="admin-form-grid">
      <label>交接日期（必填）<input type="date" value={form.shift_date} onChange={e => set('shift_date', e.target.value)} /></label>
      <label>班別<select value={form.shift_type} onChange={e => set('shift_type', e.target.value)}>
        {shifts.map(s => <option key={s.id} value={s.id}>{s.label}{s.start ? ` ${s.start}–${s.end}` : ''}</option>)}
      </select></label>
      <label>交接人（離班，必填）<select value={form.handover_by} onChange={e => set('handover_by', e.target.value)}>
        <option value="">— 選擇人員 —</option>
        {users.map(u => <option key={String(u.user_id)} value={String(u.user_id)}>{u.name}{u.department ? `（${u.department}）` : ''}</option>)}
      </select></label>
      <label>接班人（到班，必填）<select value={form.takeover_by} onChange={e => set('takeover_by', e.target.value)}>
        <option value="">— 選擇人員 —</option>
        {users.map(u => <option key={String(u.user_id)} value={String(u.user_id)}>{u.name}{u.department ? `（${u.department}）` : ''}</option>)}
      </select></label>
      <label>設備正常數<input type="number" min={0} value={form.eq_normal} onChange={e => set('eq_normal', e.target.value)} /></label>
      <label>設備異常數<input type="number" min={0} value={form.eq_abnormal} onChange={e => set('eq_abnormal', e.target.value)} /></label>
      <label className="wide">異常事項<textarea rows={3} value={form.issues} onChange={e => set('issues', e.target.value)} placeholder="一行一項" /></label>
      <label className="wide">待辦事項<textarea rows={3} value={form.pending} onChange={e => set('pending', e.target.value)} placeholder="一行一項" /></label>
      <label className="wide">備註<textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} /></label>
    </div>
    <p className="inline-message">雙層稽核：交接人送出後，需由指定接班人登入並點選「接收交接」，系統才登記交接完成。</p>
    {message && <p className="inline-message danger">{message}</p>}
    <footer>
      <button className="secondary-btn" onClick={onClose}>取消</button>
      <button className="secondary-btn" disabled={busy} onClick={() => void save('draft')}>儲存草稿</button>
      <button className="primary-btn compact" disabled={busy} onClick={() => void save('confirmed')}>{busy ? '送出中…' : '送出交接'}</button>
    </footer>
  </AdminModal>;
}

/* ──────────────────────────── 未結事項（案件） ──────────────────────────── */

function CasesModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [logs, setLogs] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [status, setStatus] = useState('open'), [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Row | null>(null);
  const [content, setContent] = useState(''), [assignee, setAssignee] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [c, u] = await Promise.all([
      client.from('handover_cases').select('*').order('created_at', { ascending: false }).limit(500),
      client.from('users').select('user_id,name,department').eq('status', 'active').order('name').limit(2000),
    ]);
    if (c.error || u.error) setNote(`失敗：${errorMessage(c.error || u.error, '案件資料載入失敗')}`);
    setRows(c.data || []); setUsers(u.data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [query, status]);

  const nameOf = useCallback((id: unknown) => users.find(u => u.user_id === id)?.name || (id ? String(id) : '—'), [users]);
  const filtered = useMemo(() => rows.filter(row => {
    const q = query.trim().toLowerCase();
    return (!status || row.status === status) &&
      (!q || [row.case_no, row.title, row.description, row.incident_location, row.responsible_unit, nameOf(row.assigned_to)].some(v => String(v || '').toLowerCase().includes(q)));
  }), [rows, query, status, nameOf]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const openDetail = async (row: Row) => {
    setDetail(row); setContent(''); setAssignee(String(row.assigned_to || '')); setLogs([]);
    const { data } = await getSupabase().from('handover_case_logs').select('*').eq('case_id', row.case_id).order('created_at');
    setLogs(data || []);
  };
  const act = async (action: string, extra: Row = {}, success = '已完成') => {
    if (!detail) return;
    setBusy(true); setNote('');
    const { error } = await getSupabase().rpc('handover_case_action', {
      p_case_id: detail.case_id, p_action: action,
      p_content: extra.content ?? null, p_assigned_to: extra.assigned_to ?? null, p_new_status: extra.new_status ?? null,
    });
    if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    setDetail(null); await load(); setNote(success);
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋案件編號、標題、地點或負責人" />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部狀態</option>
          {Object.entries(CASE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span>未結 {rows.filter(r => r.status !== 'closed').length}／共 {filtered.length} 筆</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>案件編號</th><th>標題</th><th>發生時間／地點</th><th>負責人</th><th>期限</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>{paged.map(row => <tr key={String(row.case_id)}>
          <td><strong>{fmt(row.case_no)}</strong><small>{fmt(row.reporter)}</small></td>
          <td>{fmt(row.title)}<small>{fmt(row.anomaly_category)}</small></td>
          <td>{fmtTime(row.incident_time)}<small>{fmt(row.incident_location)}</small></td>
          <td>{nameOf(row.assigned_to)}<small>{fmt(row.responsible_unit)}</small></td>
          <td>{fmt(row.due_date)}</td>
          <td><Pill value={row.status} labels={CASE_STATUS} tones={CASE_TONE} /></td>
          <td><div className="admin-row-actions"><button onClick={() => void openDetail(row)}>詳細</button></div></td>
        </tr>)}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有符合條件的案件</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
    </section>

    {detail && <AdminModal title={`案件｜${fmt(detail.case_no)}`} onClose={() => setDetail(null)}>
      <dl className="detail-grid">
        <div><dt>標題</dt><dd>{fmt(detail.title)}</dd></div>
        <div><dt>狀態</dt><dd>{CASE_STATUS[String(detail.status)] || fmt(detail.status)}</dd></div>
        <div><dt>通報人／單位</dt><dd>{fmt(detail.reporter)}｜{fmt(detail.reporter_unit)}</dd></div>
        <div><dt>發生時間</dt><dd>{fmtTime(detail.incident_time)}</dd></div>
        <div><dt>地點</dt><dd>{fmt(detail.incident_location)}</dd></div>
        <div><dt>異常分類</dt><dd>{[detail.anomaly_category, detail.anomaly_sub, detail.anomaly_other].filter(Boolean).join('／') || '—'}</dd></div>
        <div><dt>負責單位</dt><dd>{fmt(detail.responsible_unit)}</dd></div>
        <div><dt>期限</dt><dd>{fmt(detail.due_date)}</dd></div>
        <div><dt>說明</dt><dd>{fmt(detail.description)}</dd></div>
        <div><dt>已採取措施</dt><dd>{fmt(detail.action_taken)}</dd></div>
        <div><dt>後續追蹤</dt><dd>{fmt(detail.followup)}</dd></div>
        {detail.closed_at ? <div><dt>結案時間</dt><dd>{fmtTime(detail.closed_at)}</dd></div> : null}
      </dl>

      {logs.length > 0 && <div className="detail-timeline"><h3>處理歷程</h3>
        <ol>{logs.map(log => <li key={String(log.log_id)}>
          <b>{fmt(log.action)}</b><span>{nameOf(log.created_by)}</span><time>{fmtTime(log.created_at)}</time>
          {log.content ? <p>{String(log.content)}</p> : null}
        </li>)}</ol></div>}

      <div className="admin-form-grid">
        <label className="wide">指派給<select value={assignee} onChange={e => setAssignee(e.target.value)}>
          <option value="">— 不指派 —</option>
          {users.map(u => <option key={String(u.user_id)} value={String(u.user_id)}>{u.name}{u.department ? `（${u.department}）` : ''}</option>)}
        </select></label>
        <label className="wide">進度說明／異動原因<textarea rows={2} value={content} onChange={e => setContent(e.target.value)} /></label>
      </div>
      <footer>
        <button className="secondary-btn" onClick={() => setDetail(null)}>關閉</button>
        <button className="secondary-btn" disabled={busy} onClick={() => void act('assign', { assigned_to: assignee || null, content }, '已更新負責人')}>指派／轉派</button>
        <button className="secondary-btn" disabled={busy || !content.trim()} onClick={() => void act('note', { content }, '已新增進度')}>新增進度</button>
        {detail.status !== 'closed'
          ? <>
            {detail.status !== 'in_progress' && <button className="secondary-btn" disabled={busy} onClick={() => void act('status', { new_status: 'in_progress', content }, '已改為處理中')}>改為處理中</button>}
            {detail.status !== 'pending' && <button className="secondary-btn" disabled={busy} onClick={() => void act('status', { new_status: 'pending', content }, '已改為待料')}>改為待料</button>}
            <button className="primary-btn compact" disabled={busy} onClick={() => void act('status', { new_status: 'closed', content }, '案件已結案')}>結案</button>
          </>
          : <button className="primary-btn compact" disabled={busy} onClick={() => void act('reopen', { content }, '案件已重新開啟')}>重新開啟</button>}
      </footer>
    </AdminModal>}
  </AppShell>;
}

/* ──────────────────────────── 設備概況 ──────────────────────────── */

function EquipmentOverview({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [floor, setFloor] = useState(''), [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const { data, error } = await getSupabase().from('equipment')
      .select('equipment_id,asset_code,qr_code,name,category,floor,location,status,next_maintenance_on,responsible_name')
      .order('floor').order('name').limit(2000);
    if (error) setNote(`失敗：${errorMessage(error, '設備概況載入失敗')}`);
    setRows(data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [query, status, floor]);

  const today = taipeiToday();
  const floors = useMemo(() => [...new Set(rows.map(r => String(r.floor || '未分類')))].sort(), [rows]);
  const filtered = useMemo(() => rows.filter(row => {
    const q = query.trim().toLowerCase();
    return (!status || row.status === status) && (!floor || String(row.floor || '未分類') === floor) &&
      (!q || [row.asset_code, row.qr_code, row.name, row.category, row.location, row.responsible_name].some(v => String(v || '').toLowerCase().includes(q)));
  }), [rows, query, status, floor]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const overdue = filtered.filter(r => r.next_maintenance_on && String(r.next_maintenance_on) < today).length;

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋設備、資產碼、位置或負責人" />
        <select value={floor} onChange={e => setFloor(e.target.value)}>
          <option value="">全部樓層</option>{floors.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部狀態</option>
          {Object.entries(EQUIPMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <span>維修中 {filtered.filter(r => r.status === 'repair').length}｜保養逾期 {overdue}｜共 {filtered.length} 台</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>設備編號</th><th>設備名稱</th><th>位置</th><th>負責人</th><th>下次保養</th><th>狀態</th></tr></thead>
        <tbody>{paged.map(row => {
          const late = row.next_maintenance_on && String(row.next_maintenance_on) < today;
          return <tr key={String(row.equipment_id)}>
            <td><strong>{fmt(row.asset_code || row.qr_code)}</strong><small>{fmt(row.category)}</small></td>
            <td>{fmt(row.name)}</td>
            <td>{fmt(row.floor)}<small>{fmt(row.location)}</small></td>
            <td>{fmt(row.responsible_name)}</td>
            <td>{fmt(row.next_maintenance_on)}{late ? <small style={{ color: '#b42318' }}>已逾期</small> : null}</td>
            <td><Pill value={row.status} labels={EQUIPMENT_STATUS} tones={EQUIPMENT_TONE} /></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有設備資料</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
      <p className="inline-message">此頁提供交接當下的設備狀態總覽；設備主檔的維護請至「設備建置系統」。</p>
    </section>
  </AppShell>;
}
