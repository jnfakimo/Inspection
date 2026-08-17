'use client';

// SYS-03 駐衛警巡檢：補完四個先前未真正實作或有缺陷的模組。
//
// 打卡（checkins）維持既有的 GuardPatrolWorkspace，本檔承接其餘四個：
//
// - points（巡邏點清單）：原本渲染的是打卡畫面。改為真正的巡邏點清單，
//   並帶出當日打卡狀態。刻意唯讀——plan_markers 的寫入政策綁在
//   sys_structuremap（屬 SYS-06 圖臺），巡檢角色本來就不該改點位。
// - records（設備巡檢）：原本同樣渲染打卡畫面，資料完全不對。改走 app-api 的
//   inspections / create_inspection。
// - shifts（巡檢排班）：原本直接 upsert patrol_shifts，繞過 save_patrol_shift，
//   因此不會寫 assigned_user_ids、也不會同步 system_settings 的 patrol_shift_staff，
//   排定人員還直接顯示 UUID。改為呼叫既有的 RPC，並把人員以姓名呈現與指派。
//   註：班別時段（patrol_shifts.start_time/end_time）與通報時段
//   （patrol_shift_staff.workTimes）是兩組獨立的值，原畫面誤把兩者顯示成同一個。
// - notifications（逾時推播）：原本走 module_data，但該 API 只回傳設定檔列出的欄位
//   且上限 100 筆，導致 scheduled_end／assigned_names／actual_names／line_response／
//   fcm_response 永遠是空的，期間篩選也只在 100 筆內作用。改為直接查表。

import { useCallback, useEffect, useMemo, useState } from 'react';
import '@/app/admin-workspace.css';
import { AppShell } from '@/components/AppShell';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { AdminHeader, AdminModal, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from '@/components/admin/shared';
import type { ModuleDefinition, SystemDefinition } from '@/lib/modules';
import type { Profile } from '@/types/app';

type Props = { system: SystemDefinition; module: ModuleDefinition; profile: Profile };

function taipeiToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).reduce((acc, part) => (acc[part.type] = part.value, acc), {} as Record<string, string>);
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function shiftDate(base: string, delta: number) {
  const date = new Date(`${base}T00:00:00`);
  date.setDate(date.getDate() + delta);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
const hhmm = (value: unknown) => value ? String(value).slice(0, 5) : '—';

export function PatrolWorkspace({ system, module, profile }: Props) {
  if (module.key === 'points') return <PointsModule system={system} module={module} profile={profile} />;
  if (module.key === 'records') return <RecordsModule system={system} module={module} profile={profile} />;
  if (module.key === 'shifts') return <ShiftsModule system={system} module={module} profile={profile} />;
  return <NotificationsModule system={system} module={module} profile={profile} />;
}

/* ──────────────────────────── 巡邏點清單 ──────────────────────────── */

function PointsModule({ module, profile }: Props) {
  const [points, setPoints] = useState<Row[]>([]);
  const [checkins, setCheckins] = useState<Row[]>([]);
  const [date, setDate] = useState(taipeiToday());
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [floor, setFloor] = useState(''), [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [m, c] = await Promise.all([
      client.from('plan_markers').select('marker_id,floor_id,label,kind,note,status,x,y').eq('kind', 'patrol').order('floor_id').order('label').limit(2000),
      client.from('checkin_logs').select('checkin_id,target_id,label,floor_id,user_name,checkin_at')
        .gte('checkin_at', `${date}T00:00:00+08:00`).lte('checkin_at', `${date}T23:59:59+08:00`).limit(2000),
    ]);
    if (m.error || c.error) setNote(`失敗：${errorMessage(m.error || c.error, '巡邏點資料載入失敗')}`);
    setPoints(m.data || []); setCheckins(c.data || []); setBusy(false);
  }, [date]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [query, floor, date]);

  // 以 target_id 對應，label 僅作為舊資料的後備。
  const checkinByPoint = useMemo(() => {
    const map = new Map<string, Row>();
    for (const row of checkins) {
      const key = String(row.target_id || `${row.floor_id}|${row.label}`);
      if (!map.has(key)) map.set(key, row);
    }
    return map;
  }, [checkins]);
  const hitFor = (point: Row) => checkinByPoint.get(String(point.marker_id)) || checkinByPoint.get(`${point.floor_id}|${point.label}`);

  const floors = useMemo(() => [...new Set(points.map(p => String(p.floor_id || '未分類')))].sort(), [points]);
  const filtered = useMemo(() => points.filter(point => {
    const q = query.trim().toLowerCase();
    return (!floor || String(point.floor_id || '未分類') === floor) &&
      (!q || [point.label, point.floor_id, point.note].some(v => String(v || '').toLowerCase().includes(q)));
  }), [points, query, floor]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const done = filtered.filter(p => hitFor(p)).length;

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋巡邏點名稱、樓層或說明" />
        <select value={floor} onChange={e => setFloor(e.target.value)}>
          <option value="">全部樓層</option>{floors.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <label>打卡日期<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <span>{date} 已打卡 {done}／{filtered.length} 點</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>樓層</th><th>巡邏點</th><th>座標</th><th>巡檢說明</th><th>當日打卡</th><th>狀態</th></tr></thead>
        <tbody>{paged.map(point => {
          const hit = hitFor(point);
          return <tr key={String(point.marker_id)}>
            <td>{fmt(point.floor_id)}</td>
            <td><strong>{fmt(point.label)}</strong></td>
            <td>{point.x != null && point.y != null ? `${point.x}, ${point.y}` : '—'}</td>
            <td>{fmt(point.note)}</td>
            <td>{hit
              ? <><span className="status-pill closed">已打卡</span><small>{fmt(hit.user_name)}｜{fmtTime(hit.checkin_at)}</small></>
              : <span className="status-pill pending">未打卡</span>}</td>
            <td><span className={`status-pill ${point.status === 'inactive' ? 'cancelled' : 'closed'}`}>{point.status === 'inactive' ? '停用' : '啟用'}</span></td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有巡邏點</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
      <p className="inline-message">巡邏點的新增與座標調整屬「專案關係與設備圖臺」系統（plan_markers 的寫入權限為 sys_structuremap），請至圖臺的整合標記模組維護。</p>
    </section>
  </AppShell>;
}

/* ──────────────────────────── 設備巡檢 ──────────────────────────── */

function RecordsModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [equipment, setEquipment] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ equipment_id: '', run_status: 'normal', location_point: '', abnormal_note: '' });

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    try {
      const data = await invokeAppApi<{ rows: Row[]; equipment: Row[] }>('inspections');
      setRows(data.rows || []); setEquipment(data.equipment || []);
    } catch (error) { setNote(`失敗：${errorMessage(error)}`); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [query, status]);

  const filtered = useMemo(() => rows.filter(row => {
    const eq = (row.equipment as Row) || {}, who = (row.users as Row) || {};
    const q = query.trim().toLowerCase();
    return (!status || row.run_status === status) &&
      (!q || [eq.name, eq.asset_code, eq.floor, who.name, row.location_point, row.abnormal_note].some(v => String(v || '').toLowerCase().includes(q)));
  }), [rows, query, status]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const submit = async () => {
    if (!form.equipment_id) { setNote('失敗：請選擇設備'); return; }
    if (form.run_status === 'abnormal' && !form.abnormal_note.trim()) { setNote('失敗：異常巡檢必須填寫說明'); return; }
    setBusy(true); setNote('');
    try {
      await invokeAppApi('create_inspection', {
        equipment_id: form.equipment_id, run_status: form.run_status,
        location_point: form.location_point.trim() || null,
        abnormal_note: form.run_status === 'abnormal' ? form.abnormal_note.trim() : null,
      });
      setCreating(false); setForm({ equipment_id: '', run_status: 'normal', location_point: '', abnormal_note: '' });
      await load(); setNote('巡檢紀錄已新增');
    } catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={<button className="primary-btn compact" onClick={() => setCreating(true)}>＋ 新增巡檢</button>} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜尋設備、資產碼、巡檢人員或異常說明" />
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部結果</option><option value="normal">正常</option><option value="abnormal">異常</option>
        </select>
        <span>異常 {filtered.filter(r => r.run_status === 'abnormal').length}／共 {filtered.length} 筆</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>巡檢時間</th><th>設備</th><th>位置</th><th>巡檢人員</th><th>結果</th><th>異常說明</th></tr></thead>
        <tbody>{paged.map(row => {
          const eq = (row.equipment as Row) || {}, who = (row.users as Row) || {};
          return <tr key={String(row.record_id)}>
            <td>{fmtTime(row.inspect_time)}</td>
            <td><strong>{fmt(eq.name)}</strong><small>{[eq.asset_code, eq.floor].filter(Boolean).join('｜') || '—'}</small></td>
            <td>{fmt(row.location_point)}</td>
            <td>{fmt(who.name)}</td>
            <td><span className={`status-pill ${row.run_status === 'abnormal' ? 'cancelled' : 'closed'}`}>{row.run_status === 'abnormal' ? '異常' : '正常'}</span></td>
            <td>{fmt(row.abnormal_note)}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">目前沒有設備巡檢紀錄</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
    </section>

    {creating && <AdminModal title="新增設備巡檢" onClose={() => setCreating(false)}>
      <div className="admin-form-grid">
        <label className="wide">設備（必填）<select value={form.equipment_id} onChange={e => setForm({ ...form, equipment_id: e.target.value })}>
          <option value="">-- 請選擇 --</option>
          {equipment.map(eq => <option key={String(eq.equipment_id)} value={String(eq.equipment_id)}>{`${eq.asset_code || ''} ${eq.name || ''}`.trim()}{eq.floor ? `｜${eq.floor}` : ''}</option>)}
        </select></label>
        <label>巡檢結果<select value={form.run_status} onChange={e => setForm({ ...form, run_status: e.target.value })}>
          <option value="normal">正常</option><option value="abnormal">異常</option>
        </select></label>
        <label>位置說明<input value={form.location_point} onChange={e => setForm({ ...form, location_point: e.target.value })} /></label>
        {form.run_status === 'abnormal' && <label className="wide">異常說明（必填）
          <textarea rows={2} value={form.abnormal_note} onChange={e => setForm({ ...form, abnormal_note: e.target.value })} /></label>}
      </div>
      <footer>
        <button className="secondary-btn" onClick={() => setCreating(false)}>取消</button>
        <button className="primary-btn compact" disabled={busy} onClick={() => void submit()}>{busy ? '送出中…' : '送出'}</button>
      </footer>
    </AdminModal>}
  </AppShell>;
}

/* ──────────────────────────── 巡檢排班 ──────────────────────────── */

type StaffConfig = {
  templates: Record<string, string[]>;
  dates: Record<string, Record<string, string[]>>;
  workTimes: { templates: Record<string, { start?: string; end?: string }>; dates: Record<string, Record<string, { start?: string; end?: string }>> };
};

function ShiftsModule({ module, profile }: Props) {
  const [date, setDate] = useState(taipeiToday());
  const [shifts, setShifts] = useState<Row[]>([]);
  const [templates, setTemplates] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [config, setConfig] = useState<StaffConfig | null>(null);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [editor, setEditor] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const [s, t, u, c] = await Promise.all([
      client.from('patrol_shifts').select('*').eq('shift_date', date).order('sort_order').order('start_time'),
      client.from('patrol_shift_template').select('*').order('sort_order'),
      client.from('users').select('user_id,name,username,department').eq('status', 'active').order('name').limit(2000),
      client.from('system_settings').select('value').eq('key', 'patrol_shift_staff').maybeSingle(),
    ]);
    if (s.error || t.error || u.error) setNote(`失敗：${errorMessage(s.error || t.error || u.error, '排班資料載入失敗')}`);
    setShifts(s.data || []); setTemplates(t.data || []); setUsers(u.data || []);
    // system_settings 為 admin-only，非管理者讀不到；此時通報時段留白即可，不擋畫面。
    try { setConfig(c.data?.value ? JSON.parse(String(c.data.value)) : null); } catch { setConfig(null); }
    setBusy(false);
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  const nameOf = useCallback((id: unknown) => users.find(u => u.user_id === id)?.name || String(id ?? ''), [users]);
  const namesOf = useCallback((ids: unknown) => Array.isArray(ids) && ids.length ? ids.map(nameOf).join('、') : '—', [nameOf]);
  const workTimeOf = (scope: 'date' | 'template', name: string) => {
    const node = scope === 'date' ? config?.workTimes?.dates?.[date]?.[name] : config?.workTimes?.templates?.[name];
    return node?.start && node?.end ? `${node.start} ～ ${node.end}` : '—';
  };

  // 班別時段與通報時段是兩組獨立的值，儲存時必須各自帶入，
  // 否則會像先前那樣把通報時段覆寫成班別時段。
  const save = async () => {
    if (!editor) return;
    const isTemplate = editor.__scope === 'template';
    if (!String(editor.name || '').trim()) { setNote('失敗：請填寫班別名稱'); return; }
    if (!editor.start_time || !editor.end_time) { setNote('失敗：請填寫班別時段'); return; }
    setBusy(true); setNote('');
    const staff = Array.isArray(editor.assigned_user_ids) ? editor.assigned_user_ids : [];
    const client = getSupabase();
    const args = {
      p_name: String(editor.name).trim(),
      p_start_time: editor.start_time, p_end_time: editor.end_time,
      p_sort_order: Number(editor.sort_order ?? 0) || 0,
      p_staff: staff,
      p_work_start: String(editor.work_start || '').trim() || null,
      p_work_end: String(editor.work_end || '').trim() || null,
    };
    const { error } = isTemplate
      ? await client.rpc('save_patrol_shift_template', { p_template_id: editor.template_id || null, ...args })
      : await client.rpc('save_patrol_shift', { p_shift_date: date, ...args });
    if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    setEditor(null); await load(); setNote(isTemplate ? '班別範本已儲存' : '當日班別已儲存');
  };

  const openEditor = (row: Row, scope: 'date' | 'template') => {
    const node = scope === 'date' ? config?.workTimes?.dates?.[date]?.[String(row.name)] : config?.workTimes?.templates?.[String(row.name)];
    setEditor({
      ...row, __scope: scope,
      start_time: hhmm(row.start_time) === '—' ? '' : hhmm(row.start_time),
      end_time: hhmm(row.end_time) === '—' ? '' : hhmm(row.end_time),
      work_start: node?.start || '', work_end: node?.end || '',
      assigned_user_ids: Array.isArray(row.assigned_user_ids) ? row.assigned_user_ids : [],
    });
  };
  const toggleStaff = (id: string) => setEditor(prev => {
    if (!prev) return prev;
    const list: string[] = Array.isArray(prev.assigned_user_ids) ? prev.assigned_user_ids : [];
    return { ...prev, assigned_user_ids: list.includes(id) ? list.filter(x => x !== id) : [...list, id] };
  });

  const applyTemplate = (tpl: Row) => openEditor({
    name: tpl.name, start_time: tpl.start_time, end_time: tpl.end_time, sort_order: tpl.sort_order,
    assigned_user_ids: Array.isArray(tpl.assigned_user_ids) ? tpl.assigned_user_ids : [],
  }, 'date');

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={<button className="primary-btn compact" onClick={() => openEditor({ name: '', start_time: '', end_time: '', sort_order: shifts.length, assigned_user_ids: [] }, 'date')}>＋ 新增當日班別</button>} />

    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <button className="secondary-btn" onClick={() => setDate(d => shiftDate(d, -1))}>◀ 前一天</button>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        <button className="secondary-btn" onClick={() => setDate(d => shiftDate(d, 1))}>後一天 ▶</button>
        <button className="secondary-btn" onClick={() => setDate(taipeiToday())}>今天</button>
        <span>當日 {shifts.length} 個班別</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>班別</th><th>班別時段</th><th>通報時段</th><th>排定人員</th><th>操作</th></tr></thead>
        <tbody>{shifts.map(row => <tr key={String(row.shift_id)}>
          <td><strong>{fmt(row.name)}</strong></td>
          <td>{hhmm(row.start_time)} ～ {hhmm(row.end_time)}</td>
          <td>{workTimeOf('date', String(row.name))}</td>
          <td>{namesOf(row.assigned_user_ids)}</td>
          <td><div className="admin-row-actions"><button onClick={() => openEditor(row, 'date')}>編輯</button></div></td>
        </tr>)}</tbody>
      </table></div>
      {!busy && shifts.length === 0 && <p className="empty">尚未設定當日班別，可從下方範本套用</p>}
    </section>

    <section className="panel admin-panel">
      <div className="admin-toolbar"><span>班別範本（固定班別，供每日套用）</span></div>
      <div className="responsive-table"><table>
        <thead><tr><th>班別名稱</th><th>班別時段</th><th>通報時段</th><th>預設人員</th><th>操作</th></tr></thead>
        <tbody>{templates.map(row => <tr key={String(row.template_id)}>
          <td><strong>{fmt(row.name)}</strong></td>
          <td>{hhmm(row.start_time)} ～ {hhmm(row.end_time)}</td>
          <td>{workTimeOf('template', String(row.name))}</td>
          <td>{namesOf(row.assigned_user_ids)}</td>
          <td><div className="admin-row-actions">
            <button onClick={() => applyTemplate(row)}>套用到 {date}</button>
            <button onClick={() => openEditor(row, 'template')}>編輯範本</button>
          </div></td>
        </tr>)}</tbody>
      </table></div>
      {!busy && templates.length === 0 && <p className="empty">尚未建立班別範本</p>}
    </section>

    {editor && <AdminModal title={editor.__scope === 'template' ? `班別範本｜${fmt(editor.name) === '—' ? '新增' : editor.name}` : `當日班別｜${date}`} onClose={() => setEditor(null)}>
      <div className="admin-form-grid">
        <label>班別名稱（必填）<input value={String(editor.name || '')} onChange={e => setEditor({ ...editor, name: e.target.value })} /></label>
        <label>排序<input type="number" value={String(editor.sort_order ?? 0)} onChange={e => setEditor({ ...editor, sort_order: e.target.value })} /></label>
        <label>班別開始<input type="time" value={String(editor.start_time || '')} onChange={e => setEditor({ ...editor, start_time: e.target.value })} /></label>
        <label>班別結束<input type="time" value={String(editor.end_time || '')} onChange={e => setEditor({ ...editor, end_time: e.target.value })} /></label>
        <label>通報開始<input type="time" value={String(editor.work_start || '')} onChange={e => setEditor({ ...editor, work_start: e.target.value })} /></label>
        <label>通報結束<input type="time" value={String(editor.work_end || '')} onChange={e => setEditor({ ...editor, work_end: e.target.value })} /></label>
      </div>
      <div className="detail-timeline">
        <h3>排定人員（{Array.isArray(editor.assigned_user_ids) ? editor.assigned_user_ids.length : 0} 人）</h3>
        <div className="admin-toolbar" style={{ flexWrap: 'wrap', gap: 6 }}>
          {users.map(user => {
            const on = Array.isArray(editor.assigned_user_ids) && editor.assigned_user_ids.includes(user.user_id);
            return <button key={String(user.user_id)} type="button"
              className={on ? 'primary-btn compact' : 'secondary-btn'}
              onClick={() => toggleStaff(String(user.user_id))}>{on ? '✓ ' : ''}{user.name}</button>;
          })}
        </div>
      </div>
      <p className="inline-message">班別時段與通報時段是兩組獨立的值：前者存在班別資料表，後者存在排班設定的 workTimes，儲存時會各自寫入。</p>
      <footer>
        <button className="secondary-btn" onClick={() => setEditor(null)}>取消</button>
        <button className="primary-btn compact" disabled={busy} onClick={() => void save()}>{busy ? '儲存中…' : '儲存'}</button>
      </footer>
    </AdminModal>}
  </AppShell>;
}

/* ──────────────────────────── 逾時推播 ──────────────────────────── */

function NotificationsModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [period, setPeriod] = useState('30'), [shift, setShift] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    // 直接查表而非 module_data：後者只回傳設定檔列出的欄位且上限 100 筆，
    // 會讓下方的通報時間、排定／實際人員與推播回應永遠是空的。
    const { data, error } = await getSupabase().from('patrol_timeout_notifications')
      .select('*').order('shift_date', { ascending: false }).order('scheduled_end', { ascending: false }).limit(1000);
    if (error) setNote(`失敗：${errorMessage(error, '推播紀錄載入失敗')}`);
    setRows(data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => setPage(1), [period, shift, status]);

  const filtered = useMemo(() => {
    const cutoff = period === 'all' ? '' : shiftDate(taipeiToday(), -Number(period));
    return rows.filter(row => (!cutoff || String(row.shift_date || '') >= cutoff)
      && (!shift || String(row.shift_name || '') === shift)
      && (!status || String(row.status || '') === status));
  }, [rows, period, shift, status]);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const shiftNames = useMemo(() => [...new Set(rows.map(r => String(r.shift_name || '')))].filter(Boolean), [rows]);

  const statusPill = (value: unknown) => {
    const key = String(value || '');
    const label = { sent: '發送成功', failed: '發送失敗', skipped: '無須發送', pending: '處理中' }[key] || fmt(value);
    const tone = key === 'sent' ? 'closed' : key === 'failed' ? 'cancelled' : key === 'skipped' ? 'pending' : 'review';
    return <span className={`status-pill ${tone}`}>{label}</span>;
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} />
    <section className="panel admin-panel">
      <div className="admin-toolbar">
        <select value={period} onChange={e => setPeriod(e.target.value)}>
          <option value="7">最近 7 天</option><option value="30">最近 30 天</option>
          <option value="90">最近 90 天</option><option value="all">全部紀錄</option>
        </select>
        <select value={shift} onChange={e => setShift(e.target.value)}>
          <option value="">全部班別</option>{shiftNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">全部狀態</option><option value="sent">發送成功</option>
          <option value="failed">發送失敗</option><option value="skipped">無須發送</option><option value="pending">處理中</option>
        </select>
        <span>共 {filtered.length} 筆｜未打卡 {filtered.reduce((sum, r) => sum + Number(r.unchecked_count || 0), 0)} 點次</span>
      </div>
      <div className="responsive-table"><table>
        <thead><tr><th>巡檢日期</th><th>班別／通報時間</th><th>完成狀況</th><th>排定人員</th><th>實際打卡</th><th>推播狀態</th><th>發送時間</th><th>回應／失敗原因</th></tr></thead>
        <tbody>{paged.map(row => <tr key={String(row.notification_id)}>
          <td>{fmt(row.shift_date)}</td>
          <td><strong>{fmt(row.shift_name)}</strong><small>{fmtTime(row.scheduled_end)}</small></td>
          <td>{Number(row.checked_count || 0)} / {Number(row.expected_count || 0)}
            <small>{Number(row.unchecked_count || 0) > 0 ? `未打卡 ${row.unchecked_count}` : '全數完成'}</small></td>
          <td>{fmt(row.assigned_names)}{row.assigned_departments ? <small>{fmt(row.assigned_departments)}</small> : null}</td>
          <td>{fmt(row.actual_names)}</td>
          <td>{statusPill(row.status)}{row.fcm_status ? <small>FCM {fmt(row.fcm_status)}（成功 {Number(row.fcm_success_count || 0)}／失敗 {Number(row.fcm_failure_count || 0)}）</small> : null}</td>
          <td>{fmtTime(row.sent_at)}</td>
          <td>{fmt(row.line_response || row.fcm_response)}</td>
        </tr>)}</tbody>
      </table></div>
      {!busy && paged.length === 0 && <p className="empty">查無符合條件的推播紀錄</p>}
      <Pager page={page} total={filtered.length} onPage={setPage} />
      <p className="inline-message">推播紀錄的讀取權限限系統管理者（patrol_timeout_notifications 的 select 政策為 is_admin()）。</p>
    </section>
  </AppShell>;
}
