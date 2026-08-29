'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { invokeAdminApi } from '@/lib/admin-api';
import { PASSWORD_POLICY, passwordPolicyMessage } from '@/lib/password-policy';
import { AdminHeader, AdminModal, type AdminAction, type AdminProps, errorMessage, fmtTime, PAGE_SIZE, Pager, ROLE_LABELS, type Row, StatusPill, userRole } from './shared';

export function UsersAdmin({ profile, module }: AdminProps) {
  const [users, setUsers] = useState<Row[]>([]), [roles, setRoles] = useState<Row[]>([]), [departments, setDepartments] = useState<Row[]>([]), [applications, setApplications] = useState<Row[]>([]);
  const [busy, setBusy] = useState(true), [note, setNote] = useState(''), [query, setQuery] = useState(''), [status, setStatus] = useState('active'), [page, setPage] = useState(1);
  const [editor, setEditor] = useState<Row | null>(null), [passwordUser, setPasswordUser] = useState<Row | null>(null), [password, setPassword] = useState(''), [password2, setPassword2] = useState('');
  const [applicationReview, setApplicationReview] = useState<Row | null>(null);
  const load = useCallback(async () => {
    setBusy(true); setNote('');
    try {
      const client = getSupabase();
      const [u, r, d, a] = await Promise.all([
        client.from('users').select('user_id,auth_id,username,email,name,phone,department,dept_id,role,rbac_role,supervisor_id,status,created_at').order('name').limit(2000),
        client.from('roles').select('role_id,name,sort_order').order('sort_order'),
        client.from('departments').select('dept_id,parent_id,name,code,level,status,sort_order').order('sort_order'),
        invokeAdminApi<{ data?: Row[] }>('admin_list_account_applications'),
      ]);
      if (u.error || r.error || d.error) setNote(`失敗：${errorMessage(u.error || r.error || d.error, '人員主檔載入失敗')}`);
      setUsers(u.data || []); setRoles((r.data || []).filter(row => row.role_id !== 'mgmt_supervisor')); setDepartments(d.data || []); setApplications(a.data || []);
    } catch (error) { setNote(`失敗：${errorMessage(error, '人員主檔載入失敗')}`); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const deptName = useCallback((id: unknown) => departments.find(row => row.dept_id === id)?.name || '—', [departments]);
  const supervisorName = useCallback((id: unknown) => users.find(row => row.user_id === id)?.name || '未指定', [users]);
  const activeDepartments = useMemo(() => departments.filter(dept => dept.status === 'active'), [departments]);
  const rootDepartmentId = useCallback((deptId: unknown) => {
    let current = activeDepartments.find(dept => String(dept.dept_id) === String(deptId || ''));
    const seen = new Set<string>();
    while (current?.parent_id && !seen.has(String(current.dept_id))) {
      seen.add(String(current.dept_id));
      current = activeDepartments.find(dept => String(dept.dept_id) === String(current?.parent_id || ''));
    }
    return current?.dept_id || '';
  }, [activeDepartments]);
  const secretaryReportsToDeputy = useCallback((memberDeptId: unknown, supervisorDeptId: unknown) => {
    const memberRootId = String(rootDepartmentId(memberDeptId) || ''), supervisorRootId = String(rootDepartmentId(supervisorDeptId) || '');
    const memberRoot = activeDepartments.find(dept => String(dept.dept_id) === memberRootId);
    const supervisorRoot = activeDepartments.find(dept => String(dept.dept_id) === supervisorRootId);
    const rootName = (dept: Row | undefined) => String(dept?.name || '').replace(/\s+/g, '');
    const rootCode = (dept: Row | undefined) => String(dept?.code || '').toUpperCase();
    return (rootCode(memberRoot) === 'SECRE' || rootName(memberRoot) === '秘書室')
      && (rootCode(supervisorRoot) === 'VGM' || ['副總經理', '副總經理室'].includes(rootName(supervisorRoot)));
  }, [activeDepartments, rootDepartmentId]);
  const supervisorMatchesDepartment = useCallback((supervisorDeptId: unknown, memberDeptId: unknown) => {
    const supervisorId = String(supervisorDeptId || '');
    if (!memberDeptId) return true;
    let current = activeDepartments.find(dept => String(dept.dept_id) === String(memberDeptId));
    const seen = new Set<string>();
    while (current && !seen.has(String(current.dept_id))) {
      if (String(current.dept_id) === supervisorId) return true;
      seen.add(String(current.dept_id));
      current = activeDepartments.find(dept => String(dept.dept_id) === String(current?.parent_id || ''));
    }
    return secretaryReportsToDeputy(memberDeptId, supervisorDeptId);
  }, [activeDepartments, secretaryReportsToDeputy]);
  const rootDepartments = useMemo(() => activeDepartments.filter(dept => !dept.parent_id), [activeDepartments]);
  const supervisors = useMemo(() => users.filter(user => user.status === 'active' && ['unit_supervisor', 'sysadmin'].includes(userRole(user))), [users]);
  const pendingApplications = useMemo(() => applications.filter(application => application.status === 'pending'), [applications]);
  const filtered = useMemo(() => users.filter(user => {
    const q = query.trim().toLowerCase();
    return (!status || user.status === status) && (!q || [user.name, user.username, user.email, user.phone, user.department, deptName(user.dept_id), ROLE_LABELS[userRole(user)], supervisorName(user.supervisor_id)].some(value => String(value || '').toLowerCase().includes(q)));
  }), [users, query, status, deptName, supervisorName]);
  useEffect(() => setPage(1), [query, status]);
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const userPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  useEffect(() => { if (page > userPages) setPage(userPages); }, [page, userPages]);
  const run = async (payload: AdminAction, success: string) => {
    setBusy(true); setNote('');
    try { const result = await invokeAdminApi<{ message?: string }>(payload.action, payload); setEditor(null); setApplicationReview(null); setPasswordUser(null); setPassword(''); setPassword2(''); await load(); setNote(result.message || success); }
    catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };
  const saveUser = async () => {
    if (!editor) return; const creating = !editor.user_id;
    if (!String(editor.name || '').trim() || !String(editor.username || '').trim()) { setNote('失敗：請填寫姓名與登入帳號'); return; }
    if (creating && (!String(editor.email || '').trim() || passwordPolicyMessage(String(editor.password || '')))) { setNote(`失敗：請填寫電子郵件，${passwordPolicyMessage(String(editor.password || '')) || '初始密碼格式不正確'}`); return; }
    const selectedRole = String(editor.rbac_role || 'reporter');
    if (!['unit_supervisor', 'sysadmin'].includes(selectedRole) && !editor.supervisor_id) { setNote('失敗：一般人員必須指定直屬主管'); return; }
    await run({ action: creating ? 'admin_create_user' : 'admin_update_user', user_id: editor.user_id, name: String(editor.name).trim(), username: String(editor.username).trim(), email: String(editor.email || '').trim(), phone: String(editor.phone || '').trim(), dept_id: editor.dept_id || null, rbac_role: selectedRole, supervisor_id: editor.supervisor_id || null, password: editor.password || undefined }, creating ? '帳號已建立' : '人員資料已更新');
  };
  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} action={<><span>待審申請 {pendingApplications.length} 筆</span><button className="primary-btn compact" onClick={() => setEditor({ rbac_role: 'reporter', status: 'active', department_root_id: '' })}>＋ 新增帳號</button></>}/>
    {pendingApplications.length > 0 && <section className="panel admin-panel"><h2>帳號申請待審核</h2>
      <div className="responsive-table"><table><thead><tr><th>申請人</th><th>登入帳號</th><th>所屬單位</th><th>申請說明</th><th>申請時間</th><th>操作</th></tr></thead><tbody>{pendingApplications.map(application => <tr key={application.application_id}>
        <td><strong>{application.name}</strong><small>{application.email}{application.phone ? `｜${application.phone}` : ''}</small></td><td>{application.username}</td>
        <td>{deptName(application.dept_id)}</td><td>{application.reason || '—'}</td><td>{fmtTime(application.created_at)}</td>
        <td><button className="primary-btn compact" onClick={() => setApplicationReview({ ...application, rbac_role: 'reporter', supervisor_id: '', decision_note: '' })}>審核</button></td>
      </tr>)}</tbody></table></div>
    </section>}
    <section className="panel admin-panel"><div className="admin-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋姓名、帳號、電子郵件、單位或角色"/><select value={status} onChange={event => setStatus(event.target.value)}><option value="">全部狀態</option><option value="active">啟用</option><option value="inactive">停用</option></select><span>啟用 {users.filter(user => user.status === 'active').length}／停用 {users.filter(user => user.status === 'inactive').length}</span></div>
      <div className="responsive-table"><table><thead><tr><th>姓名</th><th>登入帳號</th><th>單位</th><th>角色</th><th>直屬主管</th><th>狀態</th><th>建立時間</th><th>操作</th></tr></thead><tbody>{rows.map(user => <tr key={user.user_id}><td><strong>{user.name}</strong><small>{user.email || '—'}</small></td><td>{user.username || '—'}</td><td>{deptName(user.dept_id) !== '—' ? deptName(user.dept_id) : user.department || '—'}</td><td>{ROLE_LABELS[userRole(user)] || userRole(user)}</td><td>{['unit_supervisor', 'sysadmin'].includes(userRole(user)) ? '—' : supervisorName(user.supervisor_id)}</td><td><StatusPill value={user.status}/></td><td>{fmtTime(user.created_at)}</td><td><div className="admin-row-actions"><button onClick={() => setEditor({ ...user, rbac_role: userRole(user) })}>編輯</button><button onClick={() => setPasswordUser(user)}>重設密碼</button>{user.user_id !== profile.user_id && <button className={user.status === 'active' ? 'warn' : ''} onClick={() => window.confirm(`確定${user.status === 'active' ? '停用' : '啟用'}「${user.name}」？`) && void run({ action: 'admin_toggle_user', user_id: user.user_id, status: user.status === 'active' ? 'inactive' : 'active' }, user.status === 'active' ? '帳號已停用' : '帳號已啟用')}>{user.status === 'active' ? '停用' : '啟用'}</button>}{user.status === 'inactive' && !String(user.username || '').startsWith('deidentified-') && <button className="danger" onClick={() => window.confirm(`確定將「${user.name}」個資去識別化？此操作無法復原。`) && void run({ action: 'admin_deidentify_user', user_id: user.user_id }, '個資已去識別化')}>去識別化</button>}</div></td></tr>)}</tbody></table></div>
      {!busy && rows.length === 0 && <p className="empty">查無符合條件的人員</p>}<Pager page={page} total={filtered.length} onPage={setPage}/>
    </section>
    {editor && (() => {
      const selectedRootId = String(editor.department_root_id || rootDepartmentId(editor.dept_id));
      const childDepartments = activeDepartments.filter(dept => String(dept.parent_id || '') === selectedRootId);
      return <AdminModal title={editor.user_id ? '編輯人員帳號' : '新增人員帳號'} onClose={() => setEditor(null)}><div className="admin-form-grid"><label>姓名（必填）<input value={editor.name || ''} onChange={event => setEditor({ ...editor, name: event.target.value })}/></label><label>登入帳號（必填）<input value={editor.username || ''} onChange={event => setEditor({ ...editor, username: event.target.value })}/></label><label>電子郵件（{editor.user_id ? '唯讀' : '必填'}）<input type="email" readOnly={Boolean(editor.user_id)} value={editor.email || ''} onChange={event => setEditor({ ...editor, email: event.target.value })}/></label><label>聯絡電話<input value={editor.phone || ''} onChange={event => setEditor({ ...editor, phone: event.target.value })}/></label><label>部／室<select value={selectedRootId} onChange={event => setEditor({ ...editor, department_root_id: event.target.value, dept_id: event.target.value || null, supervisor_id: '' })}><option value="">-- 未指定 --</option>{rootDepartments.map(dept => <option value={dept.dept_id} key={dept.dept_id}>{dept.name}</option>)}</select></label><label>課／組／隊<select value={editor.dept_id || ''} disabled={!selectedRootId} onChange={event => setEditor({ ...editor, dept_id: event.target.value || null, supervisor_id: '' })}><option value={selectedRootId}>整個部／室（未指定課／組）</option>{childDepartments.map(dept => <option value={dept.dept_id} key={dept.dept_id}>{dept.name}</option>)}</select>{selectedRootId && childDepartments.length === 0 && <small>此部／室目前沒有可選的課／組／隊。</small>}</label><label>系統角色<select value={editor.rbac_role || 'reporter'} disabled={editor.user_id === profile.user_id} onChange={event => setEditor({ ...editor, rbac_role: event.target.value, supervisor_id: ['unit_supervisor', 'sysadmin'].includes(event.target.value) ? '' : editor.supervisor_id })}>{roles.map(role => <option key={role.role_id} value={role.role_id}>{role.name}</option>)}</select>{editor.user_id === profile.user_id && <small>為避免中斷管理權限，不可變更自己的角色</small>}</label>{!['unit_supervisor', 'sysadmin'].includes(String(editor.rbac_role || 'reporter')) && <label className="wide">直屬主管（必填）<select value={editor.supervisor_id || ''} onChange={event => setEditor({ ...editor, supervisor_id: event.target.value })}><option value="">-- 請選擇 --</option>{supervisors.filter(supervisor => userRole(supervisor) === 'sysadmin' || supervisorMatchesDepartment(supervisor.dept_id, editor.dept_id)).map(supervisor => <option key={supervisor.user_id} value={supervisor.user_id}>{supervisor.name}｜{deptName(supervisor.dept_id)}</option>)}</select></label>}{!editor.user_id && <label className="wide">初始密碼（{PASSWORD_POLICY.minLength} 位數字）<input type="password" minLength={PASSWORD_POLICY.minLength} maxLength={PASSWORD_POLICY.maxLength} pattern="[0-9]{8}" inputMode="numeric" value={editor.password || ''} onChange={event => setEditor({ ...editor, password: event.target.value })}/></label>}</div><footer><button className="secondary-btn" onClick={() => setEditor(null)}>取消</button><button className="primary-btn compact" disabled={busy} onClick={() => void saveUser()}>{busy ? '儲存中…' : '儲存'}</button></footer></AdminModal>;
    })()}
    {applicationReview && <AdminModal title={`審核帳號申請｜${applicationReview.name}`} onClose={() => setApplicationReview(null)}><dl className="detail-grid"><div><dt>登入帳號</dt><dd>{applicationReview.username}</dd></div><div><dt>電子郵件</dt><dd>{applicationReview.email}</dd></div><div><dt>所屬單位</dt><dd>{deptName(applicationReview.dept_id)}</dd></div><div><dt>聯絡電話</dt><dd>{applicationReview.phone || '—'}</dd></div><div><dt>申請說明</dt><dd>{applicationReview.reason || '—'}</dd></div></dl><div className="admin-form-grid"><label>系統角色（管理員核定）<select value={applicationReview.rbac_role} onChange={event => setApplicationReview({ ...applicationReview, rbac_role: event.target.value, supervisor_id: ['unit_supervisor', 'sysadmin'].includes(event.target.value) ? '' : applicationReview.supervisor_id })}>{roles.map(role => <option key={role.role_id} value={role.role_id}>{role.name}</option>)}</select></label>{!['unit_supervisor', 'sysadmin'].includes(String(applicationReview.rbac_role)) && <label>直屬主管（必填）<select value={applicationReview.supervisor_id || ''} onChange={event => setApplicationReview({ ...applicationReview, supervisor_id: event.target.value })}><option value="">-- 請選擇 --</option>{supervisors.filter(supervisor => userRole(supervisor) === 'sysadmin' || supervisorMatchesDepartment(supervisor.dept_id, applicationReview.dept_id)).map(supervisor => <option key={supervisor.user_id} value={supervisor.user_id}>{supervisor.name}｜{deptName(supervisor.dept_id)}</option>)}</select></label>}<label className="wide">審核備註（退回時必填）<textarea rows={3} value={applicationReview.decision_note || ''} onChange={event => setApplicationReview({ ...applicationReview, decision_note: event.target.value })}/></label></div><footer><button className="secondary-btn" onClick={() => setApplicationReview(null)}>取消</button><button className="secondary-btn danger" disabled={busy} onClick={() => void run({ action: 'admin_reject_account_application', application_id: applicationReview.application_id, decision_note: applicationReview.decision_note || '' }, '帳號申請已退回')}>退回</button><button className="primary-btn compact" disabled={busy || (!['unit_supervisor', 'sysadmin'].includes(String(applicationReview.rbac_role)) && !applicationReview.supervisor_id)} onClick={() => void run({ action: 'admin_approve_account_application', application_id: applicationReview.application_id, rbac_role: applicationReview.rbac_role, supervisor_id: applicationReview.supervisor_id || null, decision_note: applicationReview.decision_note || '' }, '帳號已核准')}>核准並寄啟用連結</button></footer></AdminModal>}
    {passwordUser && <AdminModal title={`重設密碼｜${passwordUser.name}`} onClose={() => { setPasswordUser(null); setPassword(''); setPassword2(''); }}><div className="admin-form-grid"><label className="wide">新密碼（{PASSWORD_POLICY.minLength} 位數字）<input type="password" minLength={PASSWORD_POLICY.minLength} maxLength={PASSWORD_POLICY.maxLength} pattern="[0-9]{8}" inputMode="numeric" value={password} onChange={event => setPassword(event.target.value)}/></label><label className="wide">再次輸入新密碼<input type="password" minLength={PASSWORD_POLICY.minLength} maxLength={PASSWORD_POLICY.maxLength} pattern="[0-9]{8}" inputMode="numeric" value={password2} onChange={event => setPassword2(event.target.value)}/></label></div><footer><button className="secondary-btn" onClick={() => { setPasswordUser(null); setPassword(''); setPassword2(''); }}>取消</button><button className="primary-btn compact" disabled={busy} onClick={() => { const passwordError = passwordPolicyMessage(password); if (passwordError) { setNote(`失敗：${passwordError}`); return; } if (password !== password2) { setNote('失敗：兩次密碼不一致'); return; } void run({ action: 'admin_reset_password', user_id: passwordUser.user_id, password }, '密碼已重設'); }}>確認重設</button></footer></AdminModal>}
  </AppShell>;
}
