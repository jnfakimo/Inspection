'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { systems } from '@/lib/modules';
import { getSupabase } from '@/lib/supabase';
import { invokeAdminApi } from '@/lib/admin-api';
import {
  AdminHeader, AdminModal, type AdminProps, errorMessage, Pager, PERMISSIONS,
  roleLabel, type Row, StatusPill, SYSTEM_PERMISSIONS, userRole,
} from './shared';

const ACCESS_PAGE_SIZE = 10;
type AccessMode = 'inherit' | 'allow' | 'deny';
type PermissionTab = 'actions' | 'role-systems' | 'people' | 'roles';

const accessModeLabel: Record<AccessMode, string> = {
  inherit: '跟隨角色範本', allow: '個別開放', deny: '個別拒絕',
};
const permissionModules = (systemKey: string) => {
  const system = systems.find(item => item.key === systemKey);
  const modules = system?.modules || [];
  return systemKey === 'handover' && modules.some(item => item.key === 'guard')
    ? [...modules, { key: 'guard-approve', title: '駐衛警交接主管簽核', description: '核可駐衛警每日交接內容；不另外建立入口頁。' }]
    : modules;
};

export function PermissionsAdminV2({ profile, module }: AdminProps) {
  const [roles, setRoles] = useState<Row[]>([]);
  const [permissions, setPermissions] = useState<Row[]>([]);
  const [users, setUsers] = useState<Row[]>([]);
  const [systemAccess, setSystemAccess] = useState<Row[]>([]);
  const [moduleAccess, setModuleAccess] = useState<Row[]>([]);
  const [editor, setEditor] = useState<Row | null>(null);
  const [tab, setTab] = useState<PermissionTab>('people');
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [expandedSystem, setExpandedSystem] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setNote('');
    try {
      const client = getSupabase();
      const [rolesResult, permissionResult, usersResult, systemResult, moduleResult] = await Promise.all([
        client.from('roles').select('role_id,name,sort_order').order('sort_order'),
        client.from('role_permissions').select('role_id,permission:perm,allowed').limit(2000),
        client.from('users').select('user_id,name,username,email,department,role,rbac_role,status').order('name').limit(1000),
        client.from('user_system_access').select('user_id,system_key,mode,updated_at').limit(13000),
        client.from('user_module_access').select('user_id,system_key,module_key,mode,updated_at').limit(66000),
      ]);
      const failure = rolesResult.error || permissionResult.error || usersResult.error || systemResult.error || moduleResult.error;
      if (failure) setNote(`失敗：${errorMessage(failure, '角色與個人權限載入失敗')}`);
      setRoles((rolesResult.data || []).filter(row => row.role_id !== 'mgmt_supervisor'));
      setPermissions(permissionResult.data || []); setUsers(usersResult.data || []);
      setSystemAccess(systemResult.data || []); setModuleAccess(moduleResult.data || []);
    } catch (error) { setNote(`失敗：${errorMessage(error, '角色與個人權限載入失敗')}`); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const roleAllowed = (roleId: string, permission: string) => roleId === 'sysadmin'
    || Boolean(permissions.find(row => row.role_id === roleId && row.permission === permission)?.allowed);
  const personalSystemMode = (userId: unknown, systemKey: string): AccessMode =>
    (systemAccess.find(row => String(row.user_id) === String(userId) && row.system_key === systemKey)?.mode || 'inherit') as AccessMode;
  const personalModuleMode = (userId: unknown, systemKey: string, moduleKey: string): AccessMode =>
    (moduleAccess.find(row => String(row.user_id) === String(userId) && row.system_key === systemKey && row.module_key === moduleKey)?.mode || 'inherit') as AccessMode;
  const effectiveSystemAccess = (user: Row, systemKey: string) => {
    if (userRole(user) === 'sysadmin') return true;
    if (systemKey === 'admin') return false;
    const mode = personalSystemMode(user.user_id, systemKey);
    return mode === 'allow' || (mode === 'inherit' && roleAllowed(userRole(user), `sys_${systemKey}`));
  };
  const effectiveModuleAccess = (user: Row, systemKey: string, moduleKey: string) =>
    effectiveSystemAccess(user, systemKey)
      && (userRole(user) === 'sysadmin' || personalModuleMode(user.user_id, systemKey, moduleKey) !== 'deny');

  const run = async (action: string, payload: Row, success: string) => {
    setBusy(true); setNote('');
    try { await invokeAdminApi(action, payload); await load(); setNote(success); }
    catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };

  const saveRole = async () => {
    if (!editor) return;
    const creating = !editor.is_edit;
    const roleId = String(editor.role_id || '').trim().toLowerCase();
    const name = String(editor.name || '').trim();
    if (!roleId || !name) { setNote('失敗：請填寫角色代碼與名稱'); return; }
    if (!/^[a-z0-9_]{2,40}$/.test(roleId)) { setNote('失敗：角色代碼只能包含小寫英數字與底線'); return; }
    setBusy(true); setNote('');
    try {
      await invokeAdminApi(creating ? 'admin_create_role' : 'admin_update_role', { role_id: roleId, name });
      setEditor(null); await load(); setNote(creating ? '角色已建立' : '角色已更新');
    } catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };

  const filteredUsers = useMemo(() => users.filter(user => {
    const keyword = query.trim().toLowerCase();
    return user.status === 'active' && (!keyword || [user.name, user.username, user.email, user.department, roleLabel(userRole(user), roles)]
      .some(value => String(value || '').toLowerCase().includes(keyword)));
  }), [query, roles, users]);
  const pages = Math.max(1, Math.ceil(filteredUsers.length / ACCESS_PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pagedUsers = filteredUsers.slice((currentPage - 1) * ACCESS_PAGE_SIZE, currentPage * ACCESS_PAGE_SIZE);
  const selectedUser = users.find(user => String(user.user_id) === selectedUserId && user.status === 'active') || pagedUsers[0];

  const firstPagedUserId = String(pagedUsers[0]?.user_id || '');
  useEffect(() => {
    if (!selectedUserId && firstPagedUserId) setSelectedUserId(firstPagedUserId);
  }, [firstPagedUserId, selectedUserId]);

  const permissionMatrix = (items: ReadonlyArray<readonly [string, string]>) => <div className="responsive-table permission-matrix"><table>
    <thead><tr><th>角色範本</th>{items.map(item => <th key={item[0]}>{item[1]}</th>)}</tr></thead>
    <tbody>{roles.map(role => <tr key={role.role_id}><td><div className="permission-role-name"><strong>{role.name}</strong><small>{role.role_id}</small><button type="button" className="secondary-btn compact" onClick={() => setEditor({ ...role, is_edit: true })}>編輯</button></div></td>{items.map(item => {
      const reservedAdminAccess = item[0] === 'sys_admin' && role.role_id !== 'sysadmin';
      return <td key={item[0]}><input aria-label={`${role.name} ${item[1]}`} title={reservedAdminAccess ? '後台管理不可委派給非系統管理員角色' : undefined} type="checkbox" checked={reservedAdminAccess ? false : roleAllowed(role.role_id, item[0])} disabled={busy || role.role_id === 'sysadmin' || reservedAdminAccess} onChange={event => void run('admin_set_permission', { role_id: role.role_id, permission: item[0], allowed: event.target.checked }, '角色範本已更新')}/>{reservedAdminAccess && <small>管理員專用</small>}</td>;
    })}</tr>)}</tbody>
  </table></div>;

  const selectTab = (next: PermissionTab) => { setTab(next); setQuery(''); setPage(1); };

  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load} action={<button className="primary-btn compact" onClick={() => setEditor({ is_edit: false })}>＋ 新增角色</button>}/>
    <section className="panel permission-model-guide" aria-label="權限模型說明"><strong>最小權限原則</strong><span>角色範本</span><i>→</i><span>個人大系統例外</span><i>→</i><span>個人子系統例外</span><p>主管角色不代表全部開放；個別拒絕優先於角色範本，系統管理員固定保留完整管理權。</p></section>
    <section className="panel admin-panel permission-admin-panel">
      <div className="admin-tabs permission-tabs">
        <button className={tab === 'people' ? 'active' : ''} onClick={() => selectTab('people')}>人員精細授權</button>
        <button className={tab === 'role-systems' ? 'active' : ''} onClick={() => selectTab('role-systems')}>角色系統範本</button>
        <button className={tab === 'actions' ? 'active' : ''} onClick={() => selectTab('actions')}>角色功能範本</button>
        <button className={tab === 'roles' ? 'active' : ''} onClick={() => selectTab('roles')}>使用者角色指派</button>
      </div>
      {tab === 'actions' && <><p className="permission-tab-note">設定各角色預設可執行的新增、修改、簽核、匯出等功能；個人仍受大系統與子系統權限限制。</p>{permissionMatrix(PERMISSIONS)}</>}
      {tab === 'role-systems' && <><p className="permission-tab-note">這裡是角色預設值，不是整批強制全開。可再到「人員精細授權」對同角色的不同主管個別開放或拒絕。</p>{permissionMatrix(SYSTEM_PERMISSIONS)}</>}
      {tab === 'people' && <>
        <div className="admin-toolbar permission-people-toolbar"><input value={query} onChange={event => { setQuery(event.target.value); setPage(1); setSelectedUserId(''); }} placeholder="搜尋姓名、帳號、單位或角色"/><span>啟用帳號共 {filteredUsers.length} 人，每頁固定 {ACCESS_PAGE_SIZE} 筆。</span></div>
        <div className="permission-user-layout">
          <aside className="permission-user-list" aria-label="選擇授權人員">
            {pagedUsers.map(user => {
              const openSystems = systems.filter(system => effectiveSystemAccess(user, system.key)).length;
              return <button type="button" key={user.user_id} className={String(selectedUser?.user_id) === String(user.user_id) ? 'is-selected' : ''} onClick={() => { setSelectedUserId(String(user.user_id)); setExpandedSystem(''); }}><span><strong>{user.name}</strong><small>{user.department || '未設定單位'}</small></span><span><b>{roleLabel(userRole(user), roles)}</b><small>{openSystems}／{systems.length} 系統</small></span></button>;
            })}
            {!busy && pagedUsers.length === 0 && <p className="empty">沒有符合條件的啟用帳號。</p>}
            {filteredUsers.length > 0 && <Pager
              page={currentPage}
              total={filteredUsers.length}
              onPage={next => { setPage(next); setSelectedUserId(''); setExpandedSystem(''); }}
              pageSize={ACCESS_PAGE_SIZE}
            />}
          </aside>
          <section className="permission-detail" aria-label="個人系統與子系統權限">
            {selectedUser ? <>
              <header className="permission-person-header"><div><span>目前設定人員</span><h2>{selectedUser.name}</h2><p>{selectedUser.department || '未設定單位'} · {roleLabel(userRole(selectedUser), roles)}</p></div><div><b>{systems.filter(system => effectiveSystemAccess(selectedUser, system.key)).length}</b><span>已開放大系統</span></div></header>
              <div className="permission-legend"><span className="access-pill inherited">跟隨角色</span><span className="access-pill allowed">個別開放</span><span className="access-pill denied">個別拒絕</span></div>
              <div className="granular-system-list">{systems.map(system => {
                const systemMode = personalSystemMode(selectedUser.user_id, system.key);
                const systemAllowed = effectiveSystemAccess(selectedUser, system.key);
                const roleDefault = roleAllowed(userRole(selectedUser), `sys_${system.key}`);
                const expanded = expandedSystem === system.key;
                const sysadmin = userRole(selectedUser) === 'sysadmin';
                const childModules = permissionModules(system.key);
                const moduleCount = childModules.filter(item => effectiveModuleAccess(selectedUser, system.key, item.key)).length;
                return <article key={system.key} className={`granular-system-card ${systemAllowed ? 'is-allowed' : 'is-denied'}`}>
                  <div className="granular-system-row">
                    <button type="button" className="granular-system-title" onClick={() => setExpandedSystem(expanded ? '' : system.key)} aria-expanded={expanded} disabled={childModules.length === 0}><img src={system.icon} alt=""/><span><small>{system.code}</small><strong>{system.title}</strong><em>角色預設：{roleDefault ? '開放' : '未開放'}{childModules.length ? ` · 子系統 ${moduleCount}／${childModules.length}` : ''}</em></span>{childModules.length > 0 && <b>{expanded ? '收合' : '設定子系統'}⌄</b>}</button>
                    <label>個人例外<select value={sysadmin ? 'allow' : systemMode} disabled={busy || sysadmin || system.key === 'admin'} onChange={event => void run('admin_set_user_system_access', { user_id: selectedUser.user_id, system_key: system.key, mode: event.target.value }, `${selectedUser.name}的大系統權限已更新`)}>{sysadmin ? <option value="allow">系統管理員全開</option> : <><option value="inherit">{accessModeLabel.inherit}</option><option value="allow">{accessModeLabel.allow}</option><option value="deny">{accessModeLabel.deny}</option></>}</select></label>
                    <span className={`effective-access ${systemAllowed ? 'allowed' : 'denied'}`}>{systemAllowed ? '有效：可進入' : '有效：不可進入'}</span>
                  </div>
                  {expanded && childModules.length > 0 && <div className="granular-module-grid">{childModules.map(item => {
                    const itemMode = personalModuleMode(selectedUser.user_id, system.key, item.key);
                    const itemAllowed = effectiveModuleAccess(selectedUser, system.key, item.key);
                    return <label key={item.key} className={itemAllowed ? 'is-allowed' : 'is-denied'}><span><strong>{item.title}</strong><small>{item.description}</small></span><select aria-label={`${selectedUser.name} ${system.title} ${item.title}`} value={sysadmin ? 'allow' : itemMode} disabled={busy || sysadmin || system.key === 'admin'} onChange={event => void run('admin_set_user_module_access', { user_id: selectedUser.user_id, system_key: system.key, module_key: item.key, mode: event.target.value }, `${selectedUser.name}的子系統權限已更新`)}>{sysadmin ? <option value="allow">系統管理員全開</option> : <><option value="inherit">跟隨大系統</option><option value="allow">個別開放</option><option value="deny">個別拒絕</option></>}</select><b>{itemAllowed ? '可使用' : systemAllowed ? '已拒絕' : '大系統未開放'}</b></label>;
                  })}</div>}
                </article>;
              })}</div>
            </> : <p className="empty">請先選擇要設定的人員。</p>}
          </section>
        </div>
      </>}
      {tab === 'roles' && <><div className="admin-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋姓名、帳號或單位"/><span>共 {filteredUsers.length} 人</span></div><div className="responsive-table"><table><thead><tr><th>姓名</th><th>帳號</th><th>單位</th><th>狀態</th><th>角色</th></tr></thead><tbody>{filteredUsers.map(user => <tr key={user.user_id}><td><strong>{user.name}</strong><small>{user.email || '—'}</small></td><td>{user.username || '—'}</td><td>{user.department || '—'}</td><td><StatusPill value={user.status}/></td><td><select value={userRole(user)} disabled={busy || user.user_id === profile.user_id} onChange={event => window.confirm(`確定將「${user.name}」角色改為「${roleLabel(event.target.value, roles)}」？`) && void run('admin_assign_role', { user_id: user.user_id, rbac_role: event.target.value }, '使用者角色已更新')}>{roles.map(role => <option key={role.role_id} value={role.role_id}>{role.name}</option>)}</select>{user.user_id === profile.user_id && <small>為避免中斷管理權限，不可變更自己的角色</small>}</td></tr>)}</tbody></table></div></>}
    </section>
    {editor && <AdminModal title={editor.is_edit ? '編輯角色' : '新增角色'} onClose={() => setEditor(null)}><div className="admin-form-grid"><label>角色代碼（英數字）<input value={editor.role_id || ''} readOnly={editor.is_edit} disabled={editor.is_edit} onChange={event => setEditor({ ...editor, role_id: event.target.value })} placeholder="例如：manager"/></label><label>角色名稱<input value={editor.name || ''} onChange={event => setEditor({ ...editor, name: event.target.value })} placeholder="例如：經理"/></label></div><footer><button className="secondary-btn" onClick={() => setEditor(null)}>取消</button><button className="primary-btn compact" disabled={busy} onClick={() => void saveRole()}>{busy ? '儲存中…' : '儲存'}</button></footer></AdminModal>}
  </AppShell>;
}
