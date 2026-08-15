'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { getSupabase } from '@/lib/supabase';
import { invokeAdminApi } from '@/lib/admin-api';
import { AdminHeader, type AdminProps, errorMessage, PERMISSIONS, ROLE_LABELS, type Row, StatusPill, SYSTEM_PERMISSIONS, userRole } from './shared';

export function PermissionsAdminV2({ profile, module }: AdminProps) {
  const [roles, setRoles] = useState<Row[]>([]), [permissions, setPermissions] = useState<Row[]>([]), [users, setUsers] = useState<Row[]>([]);
  const [tab, setTab] = useState<'matrix' | 'systems' | 'users'>('matrix'), [busy, setBusy] = useState(true), [note, setNote] = useState(''), [query, setQuery] = useState('');
  const load = useCallback(async () => {
    setBusy(true); setNote(''); const client = getSupabase();
    const [rolesResult, permissionResult, usersResult] = await Promise.all([
      client.from('roles').select('role_id,name,sort_order').order('sort_order'),
      client.from('role_permissions').select('role_id,permission:perm,allowed').limit(2000),
      client.from('users').select('user_id,name,username,email,department,role,rbac_role,status').order('name').limit(2000),
    ]);
    if (rolesResult.error || permissionResult.error || usersResult.error) setNote(`失敗：${errorMessage(rolesResult.error || permissionResult.error || usersResult.error, '角色權限載入失敗')}`);
    setRoles((rolesResult.data || []).filter(row => row.role_id !== 'mgmt_supervisor')); setPermissions(permissionResult.data || []); setUsers(usersResult.data || []); setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const isAllowed = (role: string, permission: string) => role === 'sysadmin' || Boolean(permissions.find(row => row.role_id === role && row.permission === permission)?.allowed);
  const run = async (action: string, payload: Row, success: string) => {
    setBusy(true); setNote('');
    try { await invokeAdminApi(action, payload); setNote(success); await load(); }
    catch (error) { setNote(`失敗：${errorMessage(error)}`); setBusy(false); }
  };
  const filteredUsers = users.filter(user => { const q = query.trim().toLowerCase(); return !q || [user.name, user.username, user.email, user.department, ROLE_LABELS[userRole(user)]].some(value => String(value || '').toLowerCase().includes(q)); });
  const matrix = (items: ReadonlyArray<readonly [string, string]>) => <div className="responsive-table permission-matrix"><table><thead><tr><th>角色</th>{items.map(item => <th key={item[0]}>{item[1]}</th>)}</tr></thead><tbody>{roles.map(role => <tr key={role.role_id}><td><strong>{role.name}</strong><small>{role.role_id}</small></td>{items.map(item => <td key={item[0]}><input aria-label={`${role.name} ${item[1]}`} type="checkbox" checked={isAllowed(role.role_id, item[0])} disabled={busy || role.role_id === 'sysadmin'} onChange={event => void run('admin_set_permission', { role_id: role.role_id, permission: item[0], allowed: event.target.checked }, '權限已更新')}/></td>)}</tr>)}</tbody></table></div>;
  return <AppShell profile={profile} title={module.title}>
    <AdminHeader module={module} busy={busy} note={note} onReload={load}/>
    <section className="panel admin-panel"><div className="admin-tabs"><button className={tab === 'matrix' ? 'active' : ''} onClick={() => setTab('matrix')}>功能權限矩陣</button><button className={tab === 'systems' ? 'active' : ''} onClick={() => setTab('systems')}>系統存取權限</button><button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>使用者角色指派</button></div>{tab === 'matrix' && matrix(PERMISSIONS)}{tab === 'systems' && matrix(SYSTEM_PERMISSIONS)}
      {tab === 'users' && <><div className="admin-toolbar"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜尋姓名、帳號或單位"/><span>共 {filteredUsers.length} 人</span></div><div className="responsive-table"><table><thead><tr><th>姓名</th><th>帳號</th><th>單位</th><th>狀態</th><th>角色</th></tr></thead><tbody>{filteredUsers.map(user => <tr key={user.user_id}><td><strong>{user.name}</strong><small>{user.email || '—'}</small></td><td>{user.username || '—'}</td><td>{user.department || '—'}</td><td><StatusPill value={user.status}/></td><td><select value={userRole(user)} disabled={busy || user.user_id === profile.user_id} onChange={event => window.confirm(`確定將「${user.name}」角色改為「${ROLE_LABELS[event.target.value] || event.target.value}」？`) && void run('admin_assign_role', { user_id: user.user_id, rbac_role: event.target.value }, '使用者角色已更新')}>{roles.map(role => <option key={role.role_id} value={role.role_id}>{role.name}</option>)}</select>{user.user_id === profile.user_id && <small>為避免中斷管理權限，不可變更自己的角色</small>}</td></tr>)}</tbody></table></div></>}
    </section>
  </AppShell>;
}
