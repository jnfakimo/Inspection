'use client';

// SYS-04 電子交接簿：三個模組的完整搬移。
//
// 先前修正、此處延續的兩個缺陷：
// 1. 建立交接單原本必失敗：handover_records_own_insert 政策要求
//    created_by = active_user_id()，但既有實作的 insert 沒有帶 created_by。
// 2. 接收交接原本永遠做不到：畫面走 app-api 的 module_data，該 action 只回傳
//    設定檔列出的欄位，record_id、takeover_by、confirmed_at 全部取不到。改為直接查表。
//
// 本次補完 V1 handover.html 有而 V2 缺少的部分：
// - 交接單：班別／日期決定的當班設備運轉概況與每日報修概況自動帶入（對應 V1 的
//   fetchEqStatus／fetchRepairStatus）、異常與待辦改為逐項的動態清單（V1 以 \n
//   串成單一欄位存放，此處沿用同一格式，兩版互讀不會走樣）、交接單詳細檢視、
//   歷史查詢的日期區間與班別篩選。
// - 送出交接沿用 V1 的規則：交接人必須是登入者本人，且不得與接班人相同；
//   過去班次不可補單（資料庫 handover_shift_end_at 亦會擋，前端先提示）。
// - 案件：新增案件（含異常大／小類、案件編號自動編碼、發生時間不可晚於現在）與
//   附件上傳。`handover-attachments` 是私有 bucket，開啟以 createSignedUrl 產生
//   短效簽章網址，與 V2 維修附件的作法一致。
//
// 未結事項的狀態異動一律走 handover_case_action（security definer，內含與
// handover_cases_party_update 等價的授權判斷，並在同一交易寫 handover_case_logs）。

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import '@/app/admin-workspace.css';
import { AppShell } from '@/components/AppShell';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { canonicalFloor } from '@/lib/floor';
import { recordSecurityAudit } from '@/lib/security-audit';
import { AdminHeader, AdminModal, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from '@/components/admin/shared';
import { LocalizedDateTimeInput } from '@/components/LocalizedDateTimeInput';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };
type Shift = { id: string; label: string; start: string; end: string };

const DEFAULT_SHIFTS: Shift[] = [
  { id: 'morning', label: '早班', start: '06:00', end: '14:00' },
  { id: 'afternoon', label: '中班', start: '14:00', end: '22:00' },
  { id: 'night', label: '夜班', start: '22:00', end: '06:00' },
];
const CASE_STATUS: Record<string, string> = { open: '未處理', in_progress: '處理中', pending: '待料／待外部', closed: '已結案' };
const CASE_TONE: Record<string, string> = { open: 'cancelled', in_progress: 'in-progress', pending: 'review', closed: 'closed' };
const EQUIPMENT_STATUS: Record<string, string> = { active: '使用中', repair: '維修中', inactive: '停用', retired: '報廢' };
const EQUIPMENT_TONE: Record<string, string> = { active: 'closed', repair: 'in-progress', inactive: 'pending', retired: 'cancelled' };

// 異常大類與小類沿用 V1 handover.html 的 ANOMALY_SUBS，兩版填出來的分類值必須一致。
const ANOMALY_SUBS: Record<string, string[]> = {
  機電設備類: ['高壓設備', '變壓器', '發電機', '冰水主機', '空調設備', '電梯設備', '給排水設備', '消防設備', '弱電設備'],
  工務事項類: ['設施損壞', '工程施工', '漏水事件', '照明異常', '環境設施異常'],
  駐警隊類: ['門禁異常', '車輛事故', '人員糾紛', '緊急事件'],
  市場營運類: ['拍賣設備異常', '攤商陳情', '環境清潔', '廢棄物處理'],
  其他: [],
};
// 與 V1 的 REPAIR_ACTIVE_STATUSES／REPAIR_WAITING_STATUSES 相同，交接看到的件數才會一致。
const REPAIR_ACTIVE = ['pending', 'transferred', 'assigned', 'in_progress', 'waiting_parts', 'waiting_vendor', 'pending_review', 'overdue', 'returned', 'rejected'];
const REPAIR_WAITING = ['pending', 'transferred', 'overdue', 'returned', 'rejected'];
const REPAIR_STATUS_LABEL: Record<string, string> = {
  pending: '待處理', transferred: '待轉派', assigned: '已派工', in_progress: '維修中',
  waiting_parts: '等待料件', waiting_vendor: '等待廠商', pending_review: '待驗收',
  overdue: '已逾期', returned: '退回待派', rejected: '退件', completed: '已完工', closed: '已結案',
};
const ATTACHMENT_ACCEPT = '.jpg,.jpeg,.png,.pdf,.docx,.xlsx';
const ATTACHMENT_MAX = 20;
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((acc, part) => (acc[part.type] = part.value, acc), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
// 班別時段以 +08:00 明確標註，避免瀏覽器時區不同導致抓到的巡檢區間位移。
function shiftBounds(date: string, shift: Shift | undefined) {
  if (!date || !shift?.start || !shift?.end) return null;
  const start = new Date(`${date}T${shift.start.slice(0, 5)}:00+08:00`);
  const end = new Date(`${date}T${shift.end.slice(0, 5)}:00+08:00`);
  if (end <= start) end.setDate(end.getDate() + 1);
  return { start, end };
}
function dayBounds(date: string) {
  const start = new Date(`${date}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 86400000) };
}
const lines = (value: unknown) => String(value || '').split('\n').map(item => item.trim()).filter(Boolean);
const fileSize = (bytes: unknown) => {
  const size = Number(bytes || 0);
  if (!size) return '—';
  return size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
};
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
  const [departments, setDepartments] = useState<Row[]>([]);
  const [shifts, setShifts] = useState<Shift[]>(DEFAULT_SHIFTS);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [shift, setShift] = useState('');
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false), [detail, setDetail] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    // 直接查表才拿得到 record_id／takeover_by／confirmed_at，接收流程才可能成立。
    const [r, u, d, s] = await Promise.all([
      client.from('handover_records').select('*').order('shift_date', { ascending: false }).order('created_at', { ascending: false }).limit(500),
      client.from('users').select('user_id,name,department,dept_id').eq('status', 'active').order('name').limit(2000),
      client.from('departments').select('dept_id,parent_id,name,status').order('sort_order').limit(1000),
      client.from('system_settings').select('value').eq('key', 'shifts').maybeSingle(),
    ]);
    if (r.error || u.error) setNote(`失敗：${errorMessage(r.error || u.error, '交接資料載入失敗')}`);
    setRows(r.data || []); setUsers(u.data || []); setDepartments(d.data || []);
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
  useEffect(() => setPage(1), [query, status, shift, from, to]);

  const nameOf = useCallback((id: unknown) => users.find(u => u.user_id === id)?.name || (id ? String(id) : '—'), [users]);
  const deptOf = useCallback((id: unknown) => departments.find(d => d.dept_id === id)?.name || '—', [departments]);
  const shiftLabel = useCallback((id: unknown) => shifts.find(s => s.id === id)?.label || fmt(id), [shifts]);
  const stateOf = (row: Row) => row.confirmed_at ? 'done' : row.status === 'confirmed' ? 'waiting' : 'draft';

  const filtered = useMemo(() => rows.filter(row => {
    const q = query.trim().toLowerCase();
    const date = String(row.shift_date || '');
    return (!status || stateOf(row) === status) && (!shift || String(row.shift_type) === shift)
      && (!from || date >= from) && (!to || date <= to)
      && (!q || [row.shift_date, shiftLabel(row.shift_type), nameOf(row.handover_by), nameOf(row.takeover_by), deptOf(row.dept_id), row.issues, row.pending, row.notes].some(v => String(v || '').toLowerCase().includes(q)));
  }), [rows, query, status, shift, from, to, nameOf, deptOf, shiftLabel]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const receive = async (row: Row) => {
    setBusy(true); setNote('');
    try {
      await invokeAppApi('handover_save', { kind: 'receive', record_id: row.record_id });
      setDetail(null); await load(); setNote('已接收，交接正式完成');
    } catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={<button className="primary-btn compact handover-create-btn" onClick={() => setCreating(true)}>＋ 新增交接單</button>} />
    <section className="panel admin-panel handover-records-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋日期、班別、交接人、異常或待辦" />
        <select value={shift} onChange={e => setShift(e.target.value)}>
          <option value="">全部班別</option>{shifts.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部狀態</option>
          <option value="draft">草稿</option><option value="waiting">待接班人接收</option><option value="done">交接完成</option>
        </select>
        <label>起日<LocalizedDateInput aria-label="起始日期（年/月/日）" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>迄日<LocalizedDateInput aria-label="結束日期（年/月/日）" value={to} onChange={e => setTo(e.target.value)} /></label>
        <button className="secondary-btn" onClick={() => { setQuery(''); setShift(''); setStatus(''); setFrom(''); setTo(''); }}>清除</button>
        <span>待接收 {rows.filter(r => stateOf(r) === 'waiting').length}／共 {filtered.length} 筆</span>
      </div>
      <div className="responsive-table"><table className="center-head">
        {/* 事項摘要是唯一該吸收剩餘寬度的欄；其餘四欄標成 nowrap，否則日期會斷成
            「2026-08-」「05」、部門斷成「系統管理」「課」、按鈕文字直排。
            對齊由表格層的 center-head 統一決定：只有標題列置中，內容維持
            文字靠左、數量靠右，欄位不寫行內樣式。 */}
        <thead><tr><th className="nowrap">日期／班別</th><th className="nowrap">部門</th><th>交接人 → 接班人</th><th className="nowrap">正常／異常</th><th>事項摘要</th><th className="nowrap">狀態</th><th className="nowrap">操作</th></tr></thead>
        <tbody>{paged.map(row => {
          const state = stateOf(row);
          const mine = String(row.takeover_by) === profile.user_id;
          const summary = [...lines(row.issues).slice(0, 1), ...lines(row.pending).slice(0, 1)];
          return <tr key={String(row.record_id)}>
            <td className="nowrap"><strong>{fmt(row.shift_date)}</strong><small>{shiftLabel(row.shift_type)}</small></td>
            <td className="nowrap">{deptOf(row.dept_id)}</td>
            <td>{nameOf(row.handover_by)} → {nameOf(row.takeover_by)}
              {row.confirmed_at ? <small>接收於 {fmtTime(row.confirmed_at)}</small> : null}</td>
            <td className="nowrap num">{Number(row.eq_normal || 0)}／{Number(row.eq_abnormal || 0)}</td>
            <td>{summary.length ? summary.join('；') : '—'}
              <small>異常 {lines(row.issues).length}｜待辦 {lines(row.pending).length}</small></td>
            <td className="nowrap"><span className={`status-pill ${state === 'done' ? 'closed' : state === 'waiting' ? 'review' : 'pending'}`}>
              {state === 'done' ? '交接完成' : state === 'waiting' ? '待接班人接收' : '草稿'}</span></td>
            <td className="nowrap"><div className="admin-row-actions">
              <button onClick={() => setDetail(row)}>詳細</button>
              {state === 'waiting' && mine && <button onClick={() => void receive(row)}>接收交接</button>}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有符合條件的交接紀錄</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
    </section>

    {detail && <AdminModal title={`交接單｜${fmt(detail.shift_date)} ${shiftLabel(detail.shift_type)}`} onClose={() => setDetail(null)}>
      <dl className="detail-grid">
        <div><dt>交接日期／班別</dt><dd>{fmt(detail.shift_date)}　{shiftLabel(detail.shift_type)}</dd></div>
        <div><dt>部門</dt><dd>{deptOf(detail.dept_id)}</dd></div>
        <div><dt>交接人</dt><dd>{nameOf(detail.handover_by)}</dd></div>
        <div><dt>接班人</dt><dd>{nameOf(detail.takeover_by)}</dd></div>
        <div><dt>設備正常／異常</dt><dd>{Number(detail.eq_normal || 0)}／{Number(detail.eq_abnormal || 0)}</dd></div>
        <div><dt>建立時間</dt><dd>{fmtTime(detail.created_at)}</dd></div>
        {detail.confirmed_at ? <div><dt>接收時間</dt><dd>{fmtTime(detail.confirmed_at)}（{nameOf(detail.confirmed_by)}）</dd></div> : null}
      </dl>
      <div className="detail-timeline">
        <h3>異常事項（{lines(detail.issues).length}）</h3>
        <ol>{lines(detail.issues).map((item, index) => <li key={index}><p>{item}</p></li>)}</ol>
        {!lines(detail.issues).length && <p className="empty">未填列異常事項</p>}
      </div>
      <div className="detail-timeline">
        <h3>待辦事項（{lines(detail.pending).length}）</h3>
        <ol>{lines(detail.pending).map((item, index) => <li key={index}><p>{item}</p></li>)}</ol>
        {!lines(detail.pending).length && <p className="empty">未填列待辦事項</p>}
      </div>
      {detail.notes ? <p className="inline-message">備註：{String(detail.notes)}</p> : null}
      <footer>
        <button className="secondary-btn" onClick={() => setDetail(null)}>關閉</button>
        {stateOf(detail) === 'waiting' && String(detail.takeover_by) === profile.user_id
          && <button className="primary-btn compact" disabled={busy} onClick={() => void receive(detail)}>接收交接</button>}
      </footer>
    </AdminModal>}

    {creating && <CreateRecordModal users={users} departments={departments} shifts={shifts} profile={profile}
      onClose={() => setCreating(false)}
      onDone={async (message) => { setCreating(false); await load(); setNote(message); }} />}
  </AppShell>;
}

/* ──────────────────────────── 新增交接單 ──────────────────────────── */

function CreateRecordModal({ users, departments, shifts, profile, onClose, onDone }: {
  users: Row[]; departments: Row[]; shifts: Shift[]; profile: Profile; onClose: () => void; onDone: (message: string) => void;
}) {
  // 預設部門取登入者在 users 主檔上的所屬單位，Profile 本身沒有帶 dept_id。
  const [form, setForm] = useState({
    shift_date: taipeiToday(), shift_type: shifts[0]?.id || 'morning',
    dept_id: String(users.find(user => String(user.user_id) === profile.user_id)?.dept_id || ''),
    handover_by: profile.user_id, takeover_by: '', notes: '',
  });
  // V1 的預設提示文字，讓沒有異常／待辦的班別也留下明確紀錄而不是空白。
  const [issues, setIssues] = useState<string[]>(['無異常事項。如果有需要再填列']);
  const [pending, setPending] = useState<string[]>(['無代辦事項。如果有需要再填列']);
  const [issueInput, setIssueInput] = useState(''), [pendingInput, setPendingInput] = useState('');
  const [equipment, setEquipment] = useState({ normal: 0, abnormal: 0, total: 0, note: '選擇班別與日期後自動載入當班巡檢結果' });
  const [repair, setRepair] = useState({ today: 0, waiting: 0, progress: 0, completed: 0, items: [] as Row[], note: '' });
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');

  const shift = shifts.find(item => item.id === form.shift_type);
  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  // 當班設備概況：對應 V1 的 fetchEqStatus，取班別時段內的巡檢紀錄。
  const fetchEquipment = useCallback(async () => {
    const bounds = shiftBounds(form.shift_date, shift);
    if (!bounds) return;
    const { data, error } = await getSupabase().from('inspection_records')
      .select('run_status,abnormal_note,equipment(name)')
      .gte('inspect_time', bounds.start.toISOString()).lte('inspect_time', bounds.end.toISOString()).limit(2000);
    if (error) { setEquipment(prev => ({ ...prev, note: `巡檢結果載入失敗：${errorMessage(error)}` })); return; }
    const records = data || [];
    const abnormal = records.filter(row => row.run_status === 'abnormal');
    setEquipment({
      normal: records.filter(row => row.run_status === 'normal').length,
      abnormal: abnormal.length, total: records.length,
      note: records.length
        ? `已取得 ${form.shift_date} ${shift?.label || ''} 共 ${records.length} 筆巡檢紀錄`
        : `${form.shift_date} ${shift?.label || ''} 尚無巡檢紀錄`,
    });
    // 沿用 V1：只在使用者還沒動過異常清單時，才用當班異常巡檢預填。
    if (abnormal.length) setIssues(prev => prev.length === 1 && prev[0].startsWith('無異常事項')
      ? abnormal.map(row => `【${(row.equipment as Row)?.name || '設備'}】${row.abnormal_note || '異常'}`)
      : prev);
  }, [form.shift_date, shift]);

  // 每日報修概況：對應 V1 的 fetchRepairStatus，三段查詢的狀態集合與 V1 相同。
  const fetchRepair = useCallback(async () => {
    const bounds = dayBounds(form.shift_date);
    const fields = 'request_id,req_no,status,created_at,updated_at,fault_desc,fault_location,department,equipment(name)';
    const client = getSupabase();
    const [todayResult, activeResult, doneResult] = await Promise.all([
      client.from('repair_requests').select(fields).eq('hidden', false).gte('created_at', bounds.start.toISOString()).lt('created_at', bounds.end.toISOString()).order('created_at', { ascending: false }),
      client.from('repair_requests').select(fields).eq('hidden', false).in('status', REPAIR_ACTIVE).order('created_at', { ascending: false }).limit(50),
      client.from('repair_requests').select(fields).eq('hidden', false).in('status', ['completed', 'closed']).gte('updated_at', bounds.start.toISOString()).lt('updated_at', bounds.end.toISOString()),
    ]);
    const error = todayResult.error || activeResult.error || doneResult.error;
    if (error) { setRepair(prev => ({ ...prev, note: `報修資料載入失敗：${errorMessage(error)}` })); return; }
    const active = activeResult.data || [];
    const waiting = active.filter(row => REPAIR_WAITING.includes(String(row.status))).length;
    setRepair({
      today: (todayResult.data || []).length, waiting, progress: active.length - waiting,
      completed: (doneResult.data || []).length, items: active,
      note: `${form.shift_date}：今日報修 ${(todayResult.data || []).length} 件、今日完成 ${(doneResult.data || []).length} 件；跨日未結案 ${active.length} 件`,
    });
  }, [form.shift_date]);

  useEffect(() => { void fetchEquipment(); void fetchRepair(); }, [fetchEquipment, fetchRepair]);

  const addItem = (value: string, setList: (fn: (prev: string[]) => string[]) => void, clear: () => void) => {
    const text = value.trim();
    if (!text) return;
    setList(prev => [...prev.filter(item => !item.startsWith('無異常事項') && !item.startsWith('無代辦事項')), text]);
    clear();
  };

  const save = async (mode: 'draft' | 'confirmed') => {
    if (!form.shift_date) return setMessage('請選擇交接日期');
    const bounds = shiftBounds(form.shift_date, shift);
    if (!bounds || bounds.end <= new Date()) return setMessage('所選交接日期與班別已經結束，不能建立過去班次的交接單');
    if (!form.handover_by && !form.takeover_by) return setMessage('請至少填寫交接人或接班人');
    if (mode === 'confirmed') {
      if (!form.handover_by || !form.takeover_by) return setMessage('送出交接必須同時指定交接人與接班人');
      // 與 V1 相同的規則：不得代替他人送出。
      if (form.handover_by !== profile.user_id) return setMessage('交接人必須是目前登入的帳號，禁止代替他人送出');
      if (form.handover_by === form.takeover_by) return setMessage('交接人與接班人不可為同一人');
    }
    setBusy(true); setMessage('');
    try {
      await invokeAppApi('handover_save', {
        kind: 'record', shift_date: form.shift_date, shift_type: form.shift_type, dept_id: form.dept_id || null,
        handover_by: form.handover_by || null, takeover_by: form.takeover_by || null,
        eq_normal: equipment.normal, eq_abnormal: equipment.abnormal,
        // V1 以換行串接存於同一欄位，維持相同格式，兩版讀到的內容才會一致。
        issues: issues.join('\n') || null, pending: pending.join('\n') || null,
        notes: form.notes.trim() || null, status: mode,
      });
      onDone(mode === 'draft' ? '草稿已儲存' : '交接單已送出，等待指定接班人接收');
    } catch (error) {
      setMessage(`失敗：${errorMessage(error)}`);
      setBusy(false);
    }
  };

  const personOptions = (list: Row[]) => list.map(u => <option key={String(u.user_id)} value={String(u.user_id)}>{u.name}{u.department ? `（${u.department}）` : ''}</option>);

  return <AdminModal title="新增交接單" className="handover-create-modal" onClose={onClose}>
    <div className="admin-form-grid">
      <label>交接日期（必填）<LocalizedDateInput aria-label="交接日期（年/月/日）" value={form.shift_date} onChange={e => set('shift_date', e.target.value)} /></label>
      <label>班別<select value={form.shift_type} onChange={e => set('shift_type', e.target.value)}>
        {shifts.map(s => <option key={s.id} value={s.id}>{s.label}{s.start ? ` ${s.start}–${s.end}` : ''}</option>)}
      </select></label>
      <label>所屬部門<select value={form.dept_id} onChange={e => set('dept_id', e.target.value)}>
        <option value="">— 未指定 —</option>
        {departments.filter(d => d.status === 'active').map(d => <option key={String(d.dept_id)} value={String(d.dept_id)}>{d.name}</option>)}
      </select></label>
      <label>交接人（離班）<select value={form.handover_by} onChange={e => set('handover_by', e.target.value)}>
        <option value="">— 選擇人員 —</option>{personOptions(users)}
      </select></label>
      <label>接班人（到班）<select value={form.takeover_by} onChange={e => set('takeover_by', e.target.value)}>
        <option value="">— 選擇人員 —</option>{personOptions(users)}
      </select></label>
    </div>

    <div className="detail-timeline">
      <h3>設備運轉概況（依班別時段自動帶入）</h3>
      <dl className="detail-grid">
        <div><dt>正常台數</dt><dd>{equipment.normal}</dd></div>
        <div><dt>異常台數</dt><dd>{equipment.abnormal}</dd></div>
        <div><dt>巡檢總數</dt><dd>{equipment.total}</dd></div>
      </dl>
      <p className="inline-message">{equipment.note}
        <button className="secondary-btn" style={{ marginLeft: 8 }} onClick={() => void fetchEquipment()}>重新抓取</button></p>
    </div>

    <div className="detail-timeline">
      <h3>每日報修與維修狀況</h3>
      <dl className="detail-grid">
        <div><dt>今日報修</dt><dd>{repair.today}</dd></div>
        <div><dt>待處理</dt><dd>{repair.waiting}</dd></div>
        <div><dt>維修中</dt><dd>{repair.progress}</dd></div>
        <div><dt>今日完成</dt><dd>{repair.completed}</dd></div>
      </dl>
      <ol>{repair.items.slice(0, 10).map(row => <li key={String(row.request_id)}>
        <b>{fmt(row.req_no)}</b><span>{REPAIR_STATUS_LABEL[String(row.status)] || fmt(row.status)}</span>
        <p>{fmt((row.equipment as Row)?.name || row.fault_location)}｜{fmt(row.fault_desc)}</p>
      </li>)}</ol>
      {!repair.items.length && <p className="empty">目前沒有進行中的報修或維修案件</p>}
      <p className="inline-message">{repair.note || '選擇日期後自動載入報修與維修資料'}
        <button className="secondary-btn" style={{ marginLeft: 8 }} onClick={() => void fetchRepair()}>重新抓取</button></p>
    </div>

    <div className="detail-timeline">
      <h3>異常事項（{issues.length}）</h3>
      <ol>{issues.map((item, index) => <li key={index}>
        <p>{item}</p>
        <button className="secondary-btn" onClick={() => setIssues(prev => prev.filter((_, i) => i !== index))}>移除</button>
      </li>)}</ol>
      <div className="admin-toolbar">
        <input value={issueInput} onChange={e => setIssueInput(e.target.value)} placeholder="輸入異常事項後按 Enter 新增"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(issueInput, setIssues, () => setIssueInput('')); } }} />
        <button className="secondary-btn" onClick={() => addItem(issueInput, setIssues, () => setIssueInput(''))}>＋ 新增</button>
      </div>
    </div>

    <div className="detail-timeline">
      <h3>待辦事項（{pending.length}）</h3>
      <ol>{pending.map((item, index) => <li key={index}>
        <p>{item}</p>
        <button className="secondary-btn" onClick={() => setPending(prev => prev.filter((_, i) => i !== index))}>移除</button>
      </li>)}</ol>
      <div className="admin-toolbar">
        <input value={pendingInput} onChange={e => setPendingInput(e.target.value)} placeholder="輸入待辦事項後按 Enter 新增"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem(pendingInput, setPending, () => setPendingInput('')); } }} />
        <button className="secondary-btn" onClick={() => addItem(pendingInput, setPending, () => setPendingInput(''))}>＋ 新增</button>
      </div>
    </div>

    <div className="admin-form-grid">
      <label className="wide">備註<textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="其他需要說明的事項…" /></label>
    </div>
    <p className="inline-message">雙層稽核：交接人送出後，需由指定接班人登入並點選「接收交接」，系統才登記交接完成。</p>
    {message && <p className="inline-message danger">{message}</p>}
    <footer>
      <button className="secondary-btn" onClick={onClose}>取消</button>
      <button className="secondary-btn" disabled={busy} onClick={() => void save('draft')}>儲存草稿</button>
      <button className="primary-btn compact handover-submit-btn" disabled={busy} onClick={() => void save('confirmed')}>{busy ? '送出中…' : '送出交接'}</button>
    </footer>
  </AdminModal>;
}

/* ──────────────────────────── 未結事項（案件） ──────────────────────────── */

// 處理歷程存的是英文動作代碼（handover_case_action 與 log_handover_case_created
// 寫入 create／assign／transfer／close／update／reopen），直接印出來畫面上就會出現
// 英文。對照表的做法沿用稽核頁的 ACTION_LABELS。
const CASE_LOG_ACTION_LABELS: Record<string, string> = {
  create: '案件建立', assign: '指派', transfer: '轉派',
  close: '結案', update: '更新', reopen: '重新開啟',
};

function CasesModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [departments, setDepartments] = useState<Row[]>([]);
  const [logs, setLogs] = useState<Row[]>([]);
  const [attachments, setAttachments] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [status, setStatus] = useState('open'), [category, setCategory] = useState('');
  const [from, setFrom] = useState(''), [to, setTo] = useState(''), [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Row | null>(null), [creating, setCreating] = useState(false);
  const [content, setContent] = useState(''), [assignee, setAssignee] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [c, u, d] = await Promise.all([
      client.from('handover_cases').select('*').order('created_at', { ascending: false }).limit(500),
      client.from('users').select('user_id,name,department,dept_id').eq('status', 'active').order('name').limit(2000),
      client.from('departments').select('dept_id,parent_id,name,status').order('sort_order').limit(1000),
    ]);
    if (c.error || u.error) setNote(`失敗：${errorMessage(c.error || u.error, '案件資料載入失敗')}`);
    setRows(c.data || []); setUsers(u.data || []); setDepartments(d.data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [query, status, category, from, to]);

  const nameOf = useCallback((id: unknown) => users.find(u => u.user_id === id)?.name || (id ? String(id) : '—'), [users]);
  const filtered = useMemo(() => rows.filter(row => {
    const q = query.trim().toLowerCase();
    const created = String(row.created_at || '').slice(0, 10);
    return (!status || row.status === status) && (!category || row.anomaly_category === category)
      && (!from || created >= from) && (!to || created <= to)
      && (!q || [row.case_no, row.title, row.description, row.incident_location, row.responsible_unit, nameOf(row.assigned_to)].some(v => String(v || '').toLowerCase().includes(q)));
  }), [rows, query, status, category, from, to, nameOf]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const today = taipeiToday();
  const overdue = rows.filter(row => row.status !== 'closed' && row.due_date && String(row.due_date) < today).length;

  const loadAttachments = useCallback(async (caseId: unknown) => {
    const { data } = await getSupabase().from('handover_case_attachments')
      .select('*').eq('case_id', caseId).order('uploaded_at', { ascending: false });
    setAttachments(data || []);
  }, []);

  const openDetail = async (row: Row) => {
    setDetail(row); setContent(''); setAssignee(String(row.assigned_to || '')); setLogs([]); setAttachments([]);
    const { data } = await getSupabase().from('handover_case_logs').select('*').eq('case_id', row.case_id).order('created_at');
    setLogs(data || []);
    await loadAttachments(row.case_id);
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

  // 私有 bucket，開啟一律以短效簽章網址，不外流長期可讀的連結。
  const openAttachment = async (row: Row) => {
    setNote('');
    const { data, error } = await getSupabase().storage.from('handover-attachments').createSignedUrl(String(row.storage_path), 300);
    if (error || !data?.signedUrl) { setNote(`失敗：${errorMessage(error, '附件連結產生失敗')}`); return; }
    const resource = `handover-attachments/${String(row.storage_path)}`;
    recordSecurityAudit('file_read', {
      feature: '開啟交接附件', access_kind: 'file', resource,
      request_path: resource, method: '短效簽章連結', result: '使用者要求開啟',
      user_initiated: true, access_origin: 'user_action', risk_level: '一般',
    });
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={<button className="primary-btn compact" onClick={() => setCreating(true)}>＋ 新增案件</button>} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋案件編號、標題、地點或負責人" />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部狀態</option>
          {Object.entries(CASE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">全部類別</option>
          {Object.keys(ANOMALY_SUBS).map(key => <option key={key} value={key}>{key}</option>)}
        </select>
        <label>起日<LocalizedDateInput aria-label="起始日期（年/月/日）" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>迄日<LocalizedDateInput aria-label="結束日期（年/月/日）" value={to} onChange={e => setTo(e.target.value)} /></label>
        <span>未結 {rows.filter(r => r.status !== 'closed').length}｜逾期 {overdue}｜共 {filtered.length} 筆</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>案件編號</th><th>異常類別</th><th>標題</th><th>發生時間／地點</th><th>負責人</th><th>期限</th><th>狀態</th><th>操作</th></tr></thead>
        <tbody>{paged.map(row => {
          const late = row.status !== 'closed' && row.due_date && String(row.due_date) < today;
          return <tr key={String(row.case_id)}>
            <td><strong>{fmt(row.case_no)}</strong><small>{fmt(row.reporter)}</small></td>
            <td>{fmt(row.anomaly_category)}<small>{fmt(row.anomaly_sub || row.anomaly_other)}</small></td>
            <td>{fmt(row.title)}</td>
            <td>{fmtTime(row.incident_time)}<small>{fmt(row.incident_location)}</small></td>
            <td>{nameOf(row.assigned_to)}<small>{fmt(row.responsible_unit)}</small></td>
            <td>{fmt(row.due_date)}{late ? <small style={{ color: '#b42318' }}>已逾期</small> : null}</td>
            <td><Pill value={row.status} labels={CASE_STATUS} tones={CASE_TONE} /></td>
            <td><div className="admin-row-actions"><button onClick={() => void openDetail(row)}>詳細</button></div></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有符合條件的案件</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
    </section>

    {creating && <CaseFormModal users={users} departments={departments} profile={profile}
      onClose={() => setCreating(false)}
      onDone={async (message) => { setCreating(false); await load(); setNote(message); }} />}

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

      <CaseAttachments caseId={detail.case_id} rows={attachments} profile={profile}
        onOpen={openAttachment} onChanged={() => void loadAttachments(detail.case_id)} onError={setNote} />

      {logs.length > 0 && <div className="detail-timeline"><h3>處理歷程</h3>
        <ol>{logs.map(log => <li key={String(log.log_id)}>
          <b>{CASE_LOG_ACTION_LABELS[String(log.action)] || fmt(log.action)}</b><span>{nameOf(log.created_by)}</span><time>{fmtTime(log.created_at)}</time>
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

/* ──────────────────────────── 案件附件 ──────────────────────────── */

function CaseAttachments({ caseId, rows, profile: _profile, onOpen, onChanged, onError }: {
  caseId: unknown; rows: Row[]; profile: Profile;
  onOpen: (row: Row) => void; onChanged: () => void; onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    if (rows.length + list.length > ATTACHMENT_MAX) {
      onError(`失敗：目前 ${rows.length} 個附件，每案上限 ${ATTACHMENT_MAX} 個`); return;
    }
    setBusy(true); onError('');
    const client = getSupabase();
    for (const file of list) {
      if (!/\.(jpg|jpeg|png|pdf|docx|xlsx)$/i.test(file.name)) { onError(`失敗：不支援的格式 ${file.name}`); continue; }
      if (file.size > ATTACHMENT_MAX_BYTES) { onError(`失敗：檔案超過 10MB ${file.name}`); continue; }
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
      const path = `${caseId}/${Date.now()}_${crypto.randomUUID()}_${safeName}`;
      const upload = await client.storage.from('handover-attachments').upload(path, file);
      if (upload.error) { onError(`失敗：附件上傳失敗 ${file.name}（${errorMessage(upload.error)}）`); continue; }
      try {
        await invokeAppApi('handover_save', {
          kind: 'add_attachment', case_id: caseId, file_name: file.name, file_type: file.type,
          file_size: file.size, storage_path: path,
        });
      } catch {
        // 檔案已上傳但索引寫入失敗時把檔案收回，避免留下查不到的孤兒物件。
        await client.storage.from('handover-attachments').remove([path]);
        onError(`失敗：附件紀錄寫入失敗 ${file.name}`);
      }
    }
    setBusy(false); onChanged();
  };

  return <div className="detail-timeline">
    <h3>附件（{rows.length}／{ATTACHMENT_MAX}）</h3>
    <ol>{rows.map(row => <li key={String(row.attachment_id)}>
      <b>{fmt(row.file_name)}</b><span>{fileSize(row.file_size)}</span><time>{fmtTime(row.uploaded_at)}</time>
      <button className="secondary-btn" onClick={() => onOpen(row)}>開啟</button>
    </li>)}</ol>
    {!rows.length && <p className="empty">尚無附件</p>}
    <div className="admin-toolbar">
      <input type="file" accept={ATTACHMENT_ACCEPT} multiple disabled={busy}
        onChange={e => { void upload(e.target.files); e.target.value = ''; }} />
      <span>支援 JPG／PNG／PDF／DOCX／XLSX，單檔 10MB 以內</span>
    </div>
  </div>;
}

/* ──────────────────────────── 新增案件 ──────────────────────────── */

function CaseFormModal({ users, departments, profile: _profile, onClose, onDone }: {
  users: Row[]; departments: Row[]; profile: Profile; onClose: () => void; onDone: (message: string) => void;
}) {
  const [form, setForm] = useState({
    case_no: '', shift_type: 'morning', unit_l1: '', reporter: '', incident_location: '',
    incident_time: '', anomaly_category: '', anomaly_sub: '', anomaly_other: '',
    title: '', description: '', action_taken: '', followup: '', note: '',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));

  // 案件編號沿用 V1 的 genCaseNo：當日流水號，格式 YYYYMMDD-NNN。
  useEffect(() => {
    void (async () => {
      const today = taipeiToday();
      const { count } = await getSupabase().from('handover_cases')
        .select('*', { count: 'exact', head: true }).gte('created_at', `${today}T00:00:00+08:00`);
      const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
      setForm(prev => ({
        ...prev,
        case_no: `${today.replace(/-/g, '')}-${String((count || 0) + 1).padStart(3, '0')}`,
        shift_type: hour >= 6 && hour < 14 ? 'morning' : hour >= 14 && hour < 22 ? 'afternoon' : 'night',
      }));
    })();
  }, []);

  const subs = ANOMALY_SUBS[form.anomaly_category] || [];
  const reporters = useMemo(() => users.filter(u => !form.unit_l1 || String(u.dept_id || '') === form.unit_l1), [users, form.unit_l1]);

  const submit = async () => {
    if (!form.anomaly_category) return setMessage('請選擇異常大類');
    if (form.incident_time && new Date(form.incident_time) > new Date()) return setMessage('發生時間不得晚於目前時間');
    setBusy(true); setMessage('');
    const reporterUser = users.find(u => String(u.user_id) === form.reporter);
    const title = form.title.trim()
      || [form.anomaly_category, form.anomaly_sub, form.anomaly_other].filter(Boolean).join(' – ');
    let caseId = '';
    try {
      const result = await invokeAppApi<{ case_id: string }>('handover_save', {
        kind: 'create_case', case_no: form.case_no, title, shift_type: form.shift_type,
        reporter: reporterUser?.name || null,
        reporter_unit: reporterUser?.department || departments.find(d => String(d.dept_id) === form.unit_l1)?.name || null,
        incident_time: form.incident_time ? new Date(form.incident_time).toISOString() : null,
        incident_location: form.incident_location.trim() || null,
        anomaly_category: form.anomaly_category,
        anomaly_sub: form.anomaly_sub || null, anomaly_other: form.anomaly_other.trim() || null,
        description: form.description.trim() || null, action_taken: form.action_taken.trim() || null,
        followup: form.followup.trim() || null, note: form.note.trim() || null,
      });
      caseId = String(result.case_id || '');
    } catch (error) {
      setMessage(`失敗：${errorMessage(error)}`); setBusy(false); return;
    }

    let attachmentWarning = '';
    const client = getSupabase();
    for (const file of files) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
      const path = `${caseId}/${Date.now()}_${crypto.randomUUID()}_${safeName}`;
      const upload = await client.storage.from('handover-attachments').upload(path, file);
      if (upload.error) { attachmentWarning = `，但附件「${file.name}」上傳失敗`; continue; }
      try {
        await invokeAppApi('handover_save', {
          kind: 'add_attachment', case_id: caseId, file_name: file.name, file_type: file.type,
          file_size: file.size, storage_path: path,
        });
      } catch {
        await client.storage.from('handover-attachments').remove([path]);
        attachmentWarning = `，但附件「${file.name}」紀錄寫入失敗`;
      }
    }
    onDone(`案件 ${form.case_no} 已建立${attachmentWarning}`);
  };

  const pick = (list: FileList | null) => {
    if (!list?.length) return;
    const picked = Array.from(list).filter(file => {
      if (!/\.(jpg|jpeg|png|pdf|docx|xlsx)$/i.test(file.name)) { setMessage(`不支援的格式：${file.name}`); return false; }
      if (file.size > ATTACHMENT_MAX_BYTES) { setMessage(`檔案超過 10MB：${file.name}`); return false; }
      return true;
    });
    setFiles(prev => [...prev, ...picked].slice(0, ATTACHMENT_MAX));
  };

  return <AdminModal title="新增案件" onClose={onClose}>
    <div className="admin-form-grid">
      <label>案件編號<input value={form.case_no} readOnly /></label>
      <label>班別<select value={form.shift_type} onChange={e => set('shift_type', e.target.value)}>
        {DEFAULT_SHIFTS.map(s => <option key={s.id} value={s.id}>{s.label} {s.start}–{s.end}</option>)}
      </select></label>
      <label>所屬單位<select value={form.unit_l1} onChange={e => { set('unit_l1', e.target.value); set('reporter', ''); }}>
        <option value="">— 全部單位 —</option>
        {departments.filter(d => d.status === 'active').map(d => <option key={String(d.dept_id)} value={String(d.dept_id)}>{d.name}</option>)}
      </select></label>
      <label>通報人<select value={form.reporter} onChange={e => set('reporter', e.target.value)}>
        <option value="">— 選擇通報人 —</option>
        {reporters.map(u => <option key={String(u.user_id)} value={String(u.user_id)}>{u.name}</option>)}
      </select></label>
      <label>發生地點<input value={form.incident_location} onChange={e => set('incident_location', e.target.value)} placeholder="發生地點" /></label>
      <label>發生時間<LocalizedDateTimeInput ariaLabel="發生時間" value={form.incident_time} onChange={value => set('incident_time', value)} /></label>
      <label>異常大類（必填）<select value={form.anomaly_category} onChange={e => { set('anomaly_category', e.target.value); set('anomaly_sub', ''); }}>
        <option value="">— 選擇大類 —</option>
        {Object.keys(ANOMALY_SUBS).map(key => <option key={key} value={key}>{key}</option>)}
      </select></label>
      <label>異常小類<select value={form.anomaly_sub} disabled={!subs.length} onChange={e => set('anomaly_sub', e.target.value)}>
        <option value="">{form.anomaly_category ? (subs.length ? '— 選擇小類 —' : '— 無小類 —') : '— 請先選擇大類 —'}</option>
        {subs.map(sub => <option key={sub} value={sub}>{sub}</option>)}
      </select></label>
      {form.anomaly_category === '其他' && <label className="wide">其他說明
        <input value={form.anomaly_other} onChange={e => set('anomaly_other', e.target.value)} placeholder="請說明異常事項" /></label>}
      <label className="wide">案件標題<input value={form.title} onChange={e => set('title', e.target.value)} placeholder="簡短描述案件（留空則依異常分類自動產生）" /></label>
      <label className="wide">異常事項詳述<textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)} /></label>
      <label className="wide">處理情形<textarea rows={2} value={form.action_taken} onChange={e => set('action_taken', e.target.value)} /></label>
      <label className="wide">後續交接事項<textarea rows={2} value={form.followup} onChange={e => set('followup', e.target.value)} /></label>
      <label className="wide">備註<textarea rows={2} value={form.note} onChange={e => set('note', e.target.value)} /></label>
    </div>

    <div className="detail-timeline">
      <h3>附件（{files.length}／{ATTACHMENT_MAX}）</h3>
      <ol>{files.map((file, index) => <li key={`${file.name}-${index}`}>
        <b>{file.name}</b><span>{fileSize(file.size)}</span>
        <button className="secondary-btn" onClick={() => setFiles(prev => prev.filter((_, i) => i !== index))}>移除</button>
      </li>)}</ol>
      {!files.length && <p className="empty">尚無附件</p>}
      <div className="admin-toolbar">
        <input type="file" accept={ATTACHMENT_ACCEPT} multiple onChange={e => { pick(e.target.files); e.target.value = ''; }} />
        <span>支援 JPG／PNG／PDF／DOCX／XLSX，單檔 10MB 以內</span>
      </div>
    </div>

    <p className="inline-message">負責單位、承辦人與到期日由主管於案件詳情指派，與 V1 相同。</p>
    {message && <p className="inline-message danger">{message}</p>}
    <footer>
      <button className="secondary-btn" onClick={onClose}>取消</button>
      <button className="primary-btn compact" disabled={busy} onClick={() => void submit()}>{busy ? '提交中…' : '提交案件'}</button>
    </footer>
  </AdminModal>;
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
    setRows((data || []).map(row => ({ ...row, floor: canonicalFloor(row.floor) }))); setBusy(false);
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
