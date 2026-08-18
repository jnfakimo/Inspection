'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { invokeAdminApi } from '@/lib/admin-api';
import { AdminHeader, AdminModal, type AdminAction, type AdminProps, errorMessage, fmtTime, PAGE_SIZE, Pager, ROLE_LABELS, type Row, StatusPill, userRole } from './shared';

export function UsersAdmin({ profile, module }: AdminProps) {
  const [users, setUsers] = useState<Row[]>([]), [roles, setRoles] = useState<Row[]>([]), [departments, setDepartments] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('active'), [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Row | null>(null), [passwordUser, setPasswordUser] = useState<Row | null>(null), [password, setPassword] = useState(''), [password2, setPassword2] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setNote(''); const client = getSupabase();
    const [u, r, d] = await Promise.all([
      client.from('users').select('user_id,auth_id,username,email,name,phone,department,dept_id,role,rbac_role,status,created_at').order('name').limit(2000),
      client.from('roles').select('role_id,name,sort_order').order('sort_order'),
      client.from('departments').select('dept_id,parent_id,name,code,level,status,sort_order').order('sort_order'),
    ]);
    if (u.error || r.error || d.error) setNote(`失敗：${errorMessage(u.error || r.error || d.error, '人員主檔載入失敗')}`);
    setUsers(u.data || []); setRoles((r.data || []).filter(row => row.role_id !== 'mgmt_supervisor')); setDepartments(d.data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const deptName = useCallback((id: unknown) => departments.find(row => row.dept_id === id)?.name || '—', [departments]);
  const filtered = useMemo(() => users.filter(user => {
    const q = query.trim().toLowerCase();
    return (!status || user.status === status) && (!q || [user.name, user.username, user.email, user.phone, user.department, deptName(user.dept_id), ROLE_LABELS[userRole(user)]].some(value => String(value || '').toLowerCase().includes(q)));
  }), [users, query, status, deptName]);
  useEffect(() => setPage(1), [query, status]);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const run = async (payload: AdminAction, success: string) => {
    setBusy(true); setNote('');
    try { await invokeAdminApi(payload.action, payload); setEditor(null); setPasswordUser(null); setPassword(''); setPassword2(''); await load(); setNote(success); }
    catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };
  const saveUser = async () => {
    if (!editor) return; const creating = !editor.user_id;
    if (!String(editor.name || '').trim() || !String(editor.username || '').trim()) { setNote('失敗：請填寫姓名與登入帳號'); return; }
    if (creating && (!String(editor.email || '').trim() || String(editor.password || '').length < 8)) { setNote('失敗：請填寫 Email，初始密碼至少 8 個字元'); return; }
    await run({ action: creating ? 'admin_create_user' : 'admin_update_user', user_id: editor.user_id, name: String(editor.name).trim(), username: String(editor.username).trim(), email: String(editor.email || '').trim(), phone: String(editor.phone || '').trim(), dept_id: editor.dept_id || null, rbac_role: editor.rbac_role || 'reporter', password: editor.password || undefined }, creating ? '帳號已建立' : '人員資料已更新');
  };
  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} action={<button className="primary-btn compact" onClick={() => setEditor({ rbac_role: 'reporter', status: 'active' })}>＋ 新增帳號</button>}/>
    <section className="panel admin-panel"><div className="admin-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋姓名、帳號、電子郵件、單位或角色"/><select value={status} onChange={event => setStatus(event.target.value)}><option value="">全部狀態</option><option value="active">啟用</option><option value="inactive">停用</option></select><span>啟用 {users.filter(user => user.status === 'active').length}／停用 {users.filter(user => user.status === 'inactive').length}</span></div>
      <div className="responsive-table"><table><thead><tr><th>姓名</th><th>登入帳號</th><th>單位</th><th>角色</th><th>狀態</th><th>建立時間</th><th>操作</th></tr></thead><tbody>{rows.map(user => <tr key={user.user_id}><td><strong>{user.name}</strong><small>{user.email || '—'}</small></td><td>{user.username || '—'}</td><td>{deptName(user.dept_id) !== '—' ? deptName(user.dept_id) : user.department || '—'}</td><td>{ROLE_LABELS[userRole(user)] || userRole(user)}</td><td><StatusPill value={user.status}/></td><td>{fmtTime(user.created_at)}</td><td><div className="admin-row-actions"><button onClick={() => setEditor({ ...user, rbac_role: userRole(user) })}>編輯</button><button onClick={() => setPasswordUser(user)}>重設密碼</button>{user.user_id !== profile.user_id && <button className={user.status === 'active' ? 'warn' : ''} onClick={() => window.confirm(`確定${user.status === 'active' ? '停用' : '啟用'}「${user.name}」？`) && void run({ action: 'admin_toggle_user', user_id: user.user_id, status: user.status === 'active' ? 'inactive' : 'active' }, user.status === 'active' ? '帳號已停用' : '帳號已啟用')}>{user.status === 'active' ? '停用' : '啟用'}</button>}{user.status === 'inactive' && !String(user.username || '').startsWith('deidentified-') && <button className="danger" onClick={() => window.confirm(`確定將「${user.name}」個資去識別化？此操作無法復原。`) && void run({ action: 'admin_deidentify_user', user_id: user.user_id }, '個資已去識別化')}>去識別化</button>}</div></td></tr>)}</tbody></table></div>
      {!busy && rows.length === 0 && <p className="empty">查無符合條件的人員</p>}<Pager page={page} total={filtered.length} onPage={setPage}/>
    </section>
    {editor && <AdminModal title={editor.user_id ? '編輯人員帳號' : '新增人員帳號'} onClose={() => setEditor(null)}><div className="admin-form-grid"><label>姓名（必填）<input value={editor.name || ''} onChange={event => setEditor({ ...editor, name: event.target.value })}/></label><label>登入帳號（必填）<input value={editor.username || ''} onChange={event => setEditor({ ...editor, username: event.target.value })}/></label><label>Email（{editor.user_id ? '唯讀' : '必填'}）<input type="email" readOnly={Boolean(editor.user_id)} value={editor.email || ''} onChange={event => setEditor({ ...editor, email: event.target.value })}/></label><label>聯絡電話<input value={editor.phone || ''} onChange={event => setEditor({ ...editor, phone: event.target.value })}/></label><label>所屬單位<select value={editor.dept_id || ''} onChange={event => setEditor({ ...editor, dept_id: event.target.value || null })}><option value="">-- 未指定 --</option>{departments.filter(dept => dept.status === 'active').map(dept => <option value={dept.dept_id} key={dept.dept_id}>{dept.name}</option>)}</select></label><label>系統角色<select value={editor.rbac_role || 'reporter'} disabled={editor.user_id === profile.user_id} onChange={event => setEditor({ ...editor, rbac_role: event.target.value })}>{roles.map(role => <option key={role.role_id} value={role.role_id}>{role.name}</option>)}</select>{editor.user_id === profile.user_id && <small>為避免中斷管理權限，不可變更自己的角色</small>}</label>{!editor.user_id && <label className="wide">初始密碼（至少 8 個字元）<input type="password" value={editor.password || ''} onChange={event => setEditor({ ...editor, password: event.target.value })}/></label>}</div><footer><button className="secondary-btn" onClick={() => setEditor(null)}>取消</button><button className="primary-btn compact" disabled={busy} onClick={() => void saveUser()}>{busy ? '儲存中…' : '儲存'}</button></footer></AdminModal>}
    {passwordUser && <AdminModal title={`重設密碼｜${passwordUser.name}`} onClose={() => setPasswordUser(null)}><div className="admin-form-grid"><label className="wide">新密碼（至少 8 個字元）<input type="password" value={password} onChange={event => setPassword(event.target.value)}/></label><label className="wide">再次輸入新密碼<input type="password" value={password2} onChange={event => setPassword2(event.target.value)}/></label></div><footer><button className="secondary-btn" onClick={() => setPasswordUser(null)}>取消</button><button className="primary-btn compact" disabled={busy} onClick={() => { if (password.length < 8) { setNote('失敗：密碼至少 8 個字元'); return; } if (password !== password2) { setNote('失敗：兩次密碼不一致'); return; } void run({ action: 'admin_reset_password', user_id: passwordUser.user_id, password }, '密碼已重設'); }}>確認重設</button></footer></AdminModal>}
  </AppShell>;
}
