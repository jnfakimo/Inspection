'use client';

// SYS-03 駐衛警巡檢：補完四個先前未真正實作或有缺陷的模組。
//
// 打卡（checkins）維持既有的 GuardPatrolWorkspace，本檔承接其餘四個：
//
// - points（巡邏點清單）：2026-08-19 改為 V1 patrollist.html 的移植，元件搬到
//   patrol-pointlist.tsx。刻意唯讀——plan_markers 的寫入政策綁在
//   sys_structuremap（屬 SYS-06 圖臺），巡檢角色本來就不該改點位。
//   當日打卡的視角改由同系統的「巡邏打卡」模組負責，不在本頁重複。
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
import { LocalizedDateInput } from '@/components/LocalizedDateInput';
import '@/app/admin-workspace.css';
import { AppShell } from '@/components/AppShell';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { isDeletedShift, isNightShiftName } from '@/lib/patrol-status';
import { AdminHeader, AdminModal, errorMessage, fmt, fmtTime, PAGE_SIZE, Pager, type Row } from '@/components/admin/shared';
import { TimeSelect } from '@/components/TimeSelect';
import { ComboboxSelect } from '@/components/ComboboxSelect';
import { locationOptions, type LocationLike } from '@/lib/locations';
import { PatrolMap3DModule } from './patrol-map3d';
import { PointListModule } from './patrol-pointlist';
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
  if (module.key === 'points') return <PointListModule module={module} profile={profile} />;
  if (module.key === 'records') return <RecordsModule system={system} module={module} profile={profile} />;
  if (module.key === 'shifts') return <ShiftsModule system={system} module={module} profile={profile} />;
  if (module.key === 'map3d') return <PatrolMap3DModule module={module} profile={profile} />;
  return <NotificationsModule system={system} module={module} profile={profile} />;
}

/* ──────────────────────────── 設備巡檢 ──────────────────────────── */

function RecordsModule({ module, profile }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [equipment, setEquipment] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  // location_point 是自由文字的現場描述；location_id 綁場域位置主檔，位置分析才統計得到。
  const [form, setForm] = useState({ equipment_id: '', run_status: 'normal', location_point: '', abnormal_note: '', location_id: '' });
  const [locationChoices, setLocationChoices] = useState<LocationLike[]>([]);

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    try {
      const data = await invokeAppApi<{ rows: Row[]; equipment: Row[]; locations?: LocationLike[] }>('inspections');
      setRows(data.rows || []); setEquipment(data.equipment || []); setLocationChoices(data.locations || []);
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
        location_id: form.location_id || null,
      });
      setCreating(false); setForm({ equipment_id: '', run_status: 'normal', location_point: '', abnormal_note: '', location_id: '' });
      await load(); setNote('巡檢紀錄已新增');
    } catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={<button className="primary-btn compact" onClick={() => setCreating(true)}>＋ 新增巡檢</button>} />
    <section className="panel admin-panel patrol-notifications-panel">
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
        <label>場域位置（選填，供位置統計）<ComboboxSelect value={form.location_id} onChange={value => setForm(current => ({ ...current, location_id: value }))} options={locationOptions(locationChoices)} placeholder="輸入可篩選，留白代表不綁定" ariaLabel="場域位置" /></label>
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

// 排班只從駐警隊帶人。比對用關鍵字而非完整名稱：正式環境的單位叫「駐警隊」，
// 但需求與文件裡也出現過「駐衛隊」「駐衛警隊」的寫法，兩個關鍵字都收才不會漏。
// 用單位過濾而不是寫死人名，日後新進同仁只要單位設對就會自動出現在清單裡。
// 完全比不到時寧可留白並說明原因，也不要悄悄退回顯示全公司的人。
const PATROL_UNIT_KEYWORDS = ['駐警', '駐衛'];
const matchesPatrolUnit = (unit: string) => PATROL_UNIT_KEYWORDS.some(keyword => unit.includes(keyword));

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
  const [departments, setDepartments] = useState<Row[]>([]);
  const [config, setConfig] = useState<StaffConfig | null>(null);
  const [busy, setBusy] = useState(true), [note, setNote] = useState('');
  const [editor, setEditor] = useState<Row | null>(null);
  const [applyTpl, setApplyTpl] = useState<Row | null>(null);
  const [applyRange, setApplyRange] = useState({ from: taipeiToday(), to: taipeiToday() });

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    const client = getSupabase();
    const overnightStorageDate = shiftDate(date, 1);
    const [s, t, u, c, d] = await Promise.all([
      client.from('patrol_shifts').select('*').in('shift_date', [date, overnightStorageDate]).order('sort_order').order('start_time'),
      client.from('patrol_shift_template').select('*').neq('status', 'inactive').order('sort_order'),
      client.from('users').select('user_id,name,username,department,dept_id').eq('status', 'active').order('name').limit(1000),
      client.from('system_settings').select('value').eq('key', 'patrol_shift_staff').maybeSingle(),
      client.from('departments').select('dept_id,name').limit(1000),
    ]);
    if (s.error || t.error || u.error) setNote(`失敗：${errorMessage(s.error || t.error || u.error, '排班資料載入失敗')}`);
    const rawShifts = (s.data || []).filter(row => !isDeletedShift(row.name));
    const storedOvernightNames = new Set(rawShifts
      .filter(row => isNightShiftName(row.name) && String(row.shift_date) === overnightStorageDate)
      .map(row => String(row.name)));
    setShifts(rawShifts
      .filter(row => {
        if (!isNightShiftName(row.name)) return String(row.shift_date) === date;
        // 相容 2026-08-26 前已存成值班日的舊夜班；新資料優先使用隔日列。
        return String(row.shift_date) === overnightStorageDate
          || (String(row.shift_date) === date && !storedOvernightNames.has(String(row.name)));
      })
      .map(row => {
        const legacyNightDate = isNightShiftName(row.name) && String(row.shift_date) === date && !storedOvernightNames.has(String(row.name));
        return { ...row, __storageDate: legacyNightDate ? overnightStorageDate : String(row.shift_date), __configDate: legacyNightDate ? date : String(row.shift_date), __dutyDate: date };
      }));
    setTemplates(t.data || []); 
    setUsers(u.data || []);
    setDepartments(d.data || []);
    // system_settings 為 admin-only，非管理者讀不到；此時通報時段留白即可，不擋畫面。
    try { setConfig(c.data?.value ? JSON.parse(String(c.data.value)) : null); } catch { setConfig(null); }
    setBusy(false);
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  // 單位以 dept_id 對 departments 為準、users.department 只當後備：後台那張表就是
  // 這樣解析的，只讀副本會出現「後台看得到單位、排班卻抓不到人」而查不出原因。
  // 名稱查詢仍用完整名冊：早期指派、後來調離的人，名字才不會退化成 UUID。
  const patrolStaff = useMemo(() => {
    const nameOfDept = new Map(departments.map(dept => [dept.dept_id, String(dept.name ?? '')]));
    return users.filter(user => matchesPatrolUnit(
      nameOfDept.get(user.dept_id) || String(user.department ?? '')));
  }, [users, departments]);
  // 可勾選清單 = 駐警隊 ∪ 目前已指派的人。過濾只限制「能加誰」，不能把已經指派的
  // 人藏起來——藏起來就等於取消不掉、換不了人。
  const staffChoices = useMemo(() => {
    const assigned = new Set((Array.isArray(editor?.assigned_user_ids) ? editor.assigned_user_ids : []).map(String));
    const inUnit = new Set(patrolStaff.map(user => String(user.user_id)));
    const outsiders = users.filter(user => assigned.has(String(user.user_id)) && !inUnit.has(String(user.user_id)));
    return [...patrolStaff, ...outsiders];
  }, [patrolStaff, users, editor]);

  const nameOf = useCallback((id: unknown) => users.find(u => u.user_id === id)?.name || String(id ?? ''), [users]);
  const namesOf = useCallback((ids: unknown) => Array.isArray(ids) && ids.length ? ids.map(nameOf).join('、') : '—', [nameOf]);
  const workTimeOf = (scope: 'date' | 'template', name: string, storageDate = date, configDate = storageDate) => {
    const node = scope === 'date' ? config?.workTimes?.dates?.[configDate]?.[name] : config?.workTimes?.templates?.[name];
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
    const storageDate = String(editor.__newDateRow && isNightShiftName(editor.name) ? shiftDate(date, 1) : (editor.__storageDate || date));
    const { error } = isTemplate
      ? await client.rpc('save_patrol_shift_template', { p_template_id: editor.template_id || null, ...args })
      : await client.rpc('save_patrol_shift', { p_shift_date: storageDate, ...args });
    if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    setEditor(null); await load(); setNote(isTemplate ? '班別範本已儲存' : '當日班別已儲存');
  };

  const openEditor = (row: Row, scope: 'date' | 'template') => {
    const storageDate = String(row.__storageDate || (isNightShiftName(row.name) ? shiftDate(date, 1) : date));
    const configDate = String(row.__configDate || storageDate);
    const node = scope === 'date' ? config?.workTimes?.dates?.[configDate]?.[String(row.name)] : config?.workTimes?.templates?.[String(row.name)];
    setEditor({
      ...row, __scope: scope, __newDateRow: scope === 'date' && !row.shift_id, __storageDate: storageDate, __configDate: configDate, __dutyDate: date,
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

  const openApply = (tpl: Row) => { setApplyRange({ from: date, to: date }); setApplyTpl(tpl); };

  // 整段區間在資料庫端的單一交易內完成，中途失敗不會留下半套班表。
  const runApply = async () => {
    if (!applyTpl) return;
    if (!applyRange.from || !applyRange.to) { setNote('失敗：請填寫套用的起訖日期'); return; }
    if (applyRange.to < applyRange.from) { setNote('失敗：迄日不可早於起日'); return; }
    setBusy(true); setNote('');
    const { data, error } = await getSupabase().rpc('apply_patrol_shift_template_range', {
      p_template_id: applyTpl.template_id, p_from: applyRange.from, p_to: applyRange.to,
    });
    if (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); return; }
    const name = String(applyTpl.name);
    setApplyTpl(null); await load();
    setNote(`已套用「${name}」到 ${applyRange.from} ～ ${applyRange.to}，共 ${Number(data ?? 0)} 天`);
  };

  const confirmDelete = async (row: Row, scope: 'date' | 'template') => {
    if (!confirm(`確定要刪除${scope === 'template' ? '範本' : '班別'}「${row.name}」嗎？`)) return;
    setBusy(true); setNote('');
    try {
      await invokeAppApi('patrol_shift_delete', scope === 'template'
        ? { scope: 'template', template_id: row.template_id }
        : { scope: 'date', shift_id: row.shift_id });
      setNote(scope === 'template' ? '範本已刪除' : '班別已刪除');
      await load();
    } catch (error) { setNote(`刪除失敗：${errorMessage(error)}`); }
    setBusy(false);
  };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}
      action={<button className="primary-btn compact" onClick={() => openEditor({ name: '', start_time: '', end_time: '', sort_order: shifts.length, assigned_user_ids: [] }, 'date')}>＋ 新增當日班別</button>} />

    <div className="patrol-shift-shell">
      <section className="panel admin-panel">
        <div className="admin-toolbar patrol-shift-toolbar">
          <button className="secondary-btn" onClick={() => setDate(d => shiftDate(d, -1))}>◀ 前一天</button>
          <span className="admin-toolbar-date"><LocalizedDateInput aria-label="巡檢日期（年/月/日）" value={date} onChange={e => setDate(e.target.value)} /></span>
          <button className="secondary-btn" onClick={() => setDate(d => shiftDate(d, 1))}>後一天 ▶</button>
          <button className="secondary-btn" onClick={() => setDate(taipeiToday())}>今天</button>
          <span>值班日 {date}｜{shifts.length} 個班別（夜班歸前一日隔夜）</span>
        </div>
        <div className="responsive-table"><table>
          <thead><tr><th>班別名稱</th><th>班別時段</th><th>通報時段</th><th>排定人員</th><th>操作</th></tr></thead>
          <tbody>{shifts.map(row => <tr key={String(row.shift_id)}>
            <td><strong>{fmt(row.name)}{isNightShiftName(row.name) ? '（隔夜）' : ''}</strong></td>
            <td>{hhmm(row.start_time)} ～ {hhmm(row.end_time)}</td>
            <td>{workTimeOf('date', String(row.name), String(row.__storageDate || date), String(row.__configDate || row.__storageDate || date))}</td>
            <td>{namesOf(row.assigned_user_ids)}</td>
            <td><div className="admin-row-actions">
              <button onClick={() => openEditor(row, 'date')}>編輯</button>
              <button onClick={() => confirmDelete(row, 'date')} className="danger">刪除</button>
            </div></td>
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
            <button onClick={() => openApply(row)}>套用到期間</button>
            <button onClick={() => openEditor(row, 'template')}>編輯範本</button>
            <button onClick={() => confirmDelete(row, 'template')} className="danger">刪除</button>
          </div></td>
        </tr>)}</tbody>
      </table></div>
      {!busy && templates.length === 0 && <p className="empty">尚未建立班別範本</p>}
    </section>
    </div>

    {editor && <AdminModal title={editor.__scope === 'template' ? `班別範本｜${fmt(editor.name) === '—' ? '新增' : editor.name}` : `當日班別｜${date}`} onClose={() => setEditor(null)}>
      <div className="admin-form-grid">
        <label>班別名稱（必填）<input value={String(editor.name || '')} onChange={e => setEditor({ ...editor, name: e.target.value })} /></label>
        <label>排序<input type="number" value={String(editor.sort_order ?? 0)} onChange={e => setEditor({ ...editor, sort_order: e.target.value })} /></label>
        <label>班別開始<TimeSelect value={String(editor.start_time || '')} onChange={e => setEditor({ ...editor, start_time: e.target.value })} /></label>
        <label>班別結束<TimeSelect value={String(editor.end_time || '')} onChange={e => setEditor({ ...editor, end_time: e.target.value })} /></label>
        <label>通報開始<TimeSelect value={String(editor.work_start || '')} onChange={e => setEditor({ ...editor, work_start: e.target.value })} /></label>
        <label>通報結束<TimeSelect value={String(editor.work_end || '')} onChange={e => setEditor({ ...editor, work_end: e.target.value })} /></label>
      </div>
      <div className="detail-timeline">
        <h3>排定人員（{Array.isArray(editor.assigned_user_ids) ? editor.assigned_user_ids.length : 0} 人）</h3>
        <div className="admin-toolbar" style={{ flexWrap: 'wrap', gap: 6 }}>
          {staffChoices.map(user => {
            const on = Array.isArray(editor.assigned_user_ids) && editor.assigned_user_ids.includes(user.user_id);
            const outsider = !patrolStaff.some(member => member.user_id === user.user_id);
            return <button key={String(user.user_id)} type="button"
              className={on ? 'primary-btn compact' : 'secondary-btn'}
              title={outsider ? '此人不在駐警隊，僅因既有指派而列出，取消後就不會再出現' : undefined}
              onClick={() => toggleStaff(String(user.user_id))}>{on ? '✓ ' : ''}{user.name}{outsider ? '（非駐警隊）' : ''}</button>;
          })}
        </div>
        {!busy && staffChoices.length === 0 && <p className="inline-message danger">
          找不到單位含「{PATROL_UNIT_KEYWORDS.join('」或「')}」的啟用中人員。請到後台的人員管理確認駐警隊同仁的單位設定。
        </p>}
      </div>
      <p className="inline-message">班別時段與通報時段是兩組獨立的值：前者存在班別資料表，後者存在排班設定的 workTimes；夜班資料列存於隔日，但歸屬前一日值班日。</p>
      <footer>
        <button className="secondary-btn" onClick={() => setEditor(null)}>取消</button>
        <button className="primary-btn compact" disabled={busy} onClick={() => void save()}>{busy ? '儲存中…' : '儲存'}</button>
      </footer>
    </AdminModal>}

    {applyTpl && <AdminModal title={`套用班別範本｜${fmt(applyTpl.name)}`} onClose={() => setApplyTpl(null)}>
      <div className="admin-form-grid">
        <label>起<LocalizedDateInput aria-label="套用起日（年/月/日）" value={applyRange.from}
          onChange={e => setApplyRange(prev => ({ ...prev, from: e.target.value }))} /></label>
        <label>迄<LocalizedDateInput aria-label="套用迄日（年/月/日）" value={applyRange.to}
          onChange={e => setApplyRange(prev => ({ ...prev, to: e.target.value }))} /></label>
      </div>
      <p className="inline-message">
        區間內的每一天都會建立「{fmt(applyTpl.name)}」，時段、排定人員與通報時段沿用範本；
        某天已經有同名班別時會以範本內容覆寫。一次最多 366 天。
      </p>
      <footer>
        <button className="secondary-btn" onClick={() => setApplyTpl(null)}>取消</button>
        <button className="primary-btn compact" disabled={busy} onClick={() => void runApply()}>{busy ? '套用中…' : '套用'}</button>
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
    <div className="patrol-notifications-page">
      <AdminHeader module={module} busy={busy} note={note} onReload={load} />
      <section className="panel admin-panel patrol-notifications-panel">
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
    </div>
  </AppShell>;
}
