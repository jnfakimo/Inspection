import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ROLES = new Set(['reporter', 'duty', 'dispatcher', 'technician', 'unit_supervisor', 'sysadmin']);
const PERMISSIONS = new Set(['create', 'update', 'delete', 'read', 'dispatch', 'close', 'sign', 'export', 'admin', 'sys_admin', 'sys_workorder', 'sys_guardpatrol', 'sys_handover', 'sys_equipment', 'sys_structuremap', 'sys_vehicle', 'sys_meetingroom']);
const LEGACY_ROLE: Record<string, string> = { reporter: 'inspector', duty: 'maintenance', dispatcher: 'maintenance', technician: 'maintenance', unit_supervisor: 'supervisor', sysadmin: 'admin' };
const allowedOrigins = new Set(['https://jnfakimo.github.io', 'http://localhost:3000', 'http://127.0.0.1:3000']);

function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  return { 'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://jnfakimo.github.io', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
}
function reply(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
function clean(value: unknown, max = 500) { return String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }
function id(value: unknown) { const result = clean(value, 80); return /^[0-9a-f]{8}-[0-9a-f-]{28}$/i.test(result) ? result : ''; }
function status(value: unknown) { return value === 'inactive' ? 'inactive' : 'active'; }
function safeDetails(value: unknown) { return value && typeof value === 'object' ? value : {}; }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return reply(req, { ok: false, message: '僅支援 POST' }, 405);
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return reply(req, { ok: false, message: '尚未登入' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return reply(req, { ok: false, message: '登入狀態無效，請重新登入' }, 401);
    const { data: profile, error: profileError } = await admin.from('users').select('user_id,auth_id,name,username,role,rbac_role,status').eq('auth_id', authData.user.id).eq('status', 'active').maybeSingle();
    if (profileError || !profile) return reply(req, { ok: false, message: '找不到啟用中的系統帳號' }, 403);
    const roleId = profile.rbac_role || (profile.role === 'admin' ? 'sysadmin' : profile.role);
    if (roleId !== 'sysadmin' && profile.role !== 'admin') return reply(req, { ok: false, message: '僅限系統管理員執行此操作' }, 403);
    const userDb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = clean(body.action, 50);
    const audit = async (tableName: string, recordId: unknown, auditAction: 'insert' | 'update' | 'status_change', changes: unknown) => {
      const { error } = await admin.from('audit_logs').insert({ table_name: tableName, record_id: clean(recordId, 200) || 'unknown', action: auditAction, changes: safeDetails(changes), operator_id: profile.user_id, source: 'v2-admin' });
      if (error) console.warn('admin audit skipped:', error.message);
    };
    const permissionJson = async (rbacRole: string) => {
      const { data } = await admin.from('role_permissions').select('perm,allowed').eq('role_id', rbacRole);
      return Object.fromEntries((data || []).map(row => [row.perm, Boolean(row.allowed)]));
    };
    const departmentName = async (deptId: string | null) => {
      if (!deptId) return null;
      const { data } = await admin.from('departments').select('name').eq('dept_id', deptId).maybeSingle();
      return data?.name || null;
    };

    if (action === 'admin_create_user') {
      const name = clean(body.name, 100), username = clean(body.username, 64), email = clean(body.email, 200).toLowerCase(), phone = clean(body.phone, 50), password = String(body.password || ''), rbacRole = clean(body.rbac_role, 40), deptId = id(body.dept_id) || null;
      if (!name || !/^[A-Za-z0-9._-]{3,64}$/.test(username)) return reply(req, { ok: false, message: '姓名必填；登入帳號須為 3–64 個英數字、句點、底線或連字號' }, 400);
      if (!/^\S+@\S+\.\S+$/.test(email) || /[(),]/.test(email)) return reply(req, { ok: false, message: 'Email 格式不正確' }, 400);
      if (password.length < 6) return reply(req, { ok: false, message: '初始密碼至少需要 6 個字元' }, 400);
      if (!ROLES.has(rbacRole)) return reply(req, { ok: false, message: '角色設定無效' }, 400);
      const { count } = await admin.from('users').select('*', { count: 'exact', head: true }).or(`username.eq.${username},email.eq.${email}`);
      if (count) return reply(req, { ok: false, message: '登入帳號或 Email 已存在' }, 409);
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name, username } });
      if (createError || !created.user) return reply(req, { ok: false, message: `Auth 帳號建立失敗：${createError?.message || '未知錯誤'}` }, 400);
      const profileData = { auth_id: created.user.id, name, username, email, phone: phone || null, dept_id: deptId, department: await departmentName(deptId), role: LEGACY_ROLE[rbacRole], rbac_role: rbacRole, permissions: await permissionJson(rbacRole), status: 'active', created_by: profile.user_id };
      const { data, error } = await admin.from('users').insert(profileData).select('user_id').single();
      if (error) { await admin.auth.admin.deleteUser(created.user.id); return reply(req, { ok: false, message: `人員主檔建立失敗：${error.message}` }, 400); }
      await audit('users', data.user_id, 'insert', { name, username, email, dept_id: deptId, rbac_role: rbacRole, status: 'active' });
      return reply(req, { ok: true, data });
    }

    if (action === 'admin_update_user') {
      const userId = id(body.user_id), name = clean(body.name, 100), username = clean(body.username, 64), phone = clean(body.phone, 50), rbacRole = clean(body.rbac_role, 40), deptId = id(body.dept_id) || null;
      if (!userId || !name || !/^[A-Za-z0-9._-]{3,64}$/.test(username) || !ROLES.has(rbacRole)) return reply(req, { ok: false, message: '人員資料或角色設定無效' }, 400);
      const { data: before } = await admin.from('users').select('user_id,auth_id,name,username,phone,dept_id,department,role,rbac_role,status').eq('user_id', userId).maybeSingle();
      if (!before) return reply(req, { ok: false, message: '找不到指定使用者' }, 404);
      const changes = { name, username, phone: phone || null, dept_id: deptId, department: await departmentName(deptId), role: LEGACY_ROLE[rbacRole], rbac_role: rbacRole, permissions: await permissionJson(rbacRole) };
      const { error } = await admin.from('users').update(changes).eq('user_id', userId);
      if (error) return reply(req, { ok: false, message: `人員資料更新失敗：${error.message}` }, 400);
      if (before.auth_id) await admin.auth.admin.updateUserById(before.auth_id, { user_metadata: { name, username } });
      await audit('users', userId, 'update', { before, after: changes });
      return reply(req, { ok: true });
    }

    if (action === 'admin_toggle_user') {
      const userId = id(body.user_id), nextStatus = status(body.status);
      if (!userId) return reply(req, { ok: false, message: '使用者識別碼無效' }, 400);
      if (userId === profile.user_id && nextStatus === 'inactive') return reply(req, { ok: false, message: '不可停用目前登入的管理員帳號' }, 400);
      const { data: before } = await admin.from('users').select('user_id,name,status').eq('user_id', userId).maybeSingle();
      if (!before) return reply(req, { ok: false, message: '找不到指定使用者' }, 404);
      const { error } = await admin.from('users').update({ status: nextStatus }).eq('user_id', userId);
      if (error) return reply(req, { ok: false, message: `帳號狀態更新失敗：${error.message}` }, 400);
      await audit('users', userId, 'status_change', { before: before.status, after: nextStatus });
      return reply(req, { ok: true });
    }

    if (action === 'admin_reset_password') {
      const userId = id(body.user_id), password = String(body.password || '');
      if (!userId || password.length < 6) return reply(req, { ok: false, message: '新密碼至少需要 6 個字元' }, 400);
      const { data: target } = await admin.from('users').select('auth_id,name').eq('user_id', userId).maybeSingle();
      if (!target?.auth_id) return reply(req, { ok: false, message: '此帳號尚未連結 Supabase Auth' }, 400);
      const { error } = await admin.auth.admin.updateUserById(target.auth_id, { password });
      if (error) return reply(req, { ok: false, message: `密碼重設失敗：${error.message}` }, 400);
      await audit('users', userId, 'update', { event_type: 'password_reset', target_name: target.name });
      return reply(req, { ok: true });
    }

    if (action === 'admin_deidentify_user') {
      const userId = id(body.user_id);
      if (!userId || userId === profile.user_id) return reply(req, { ok: false, message: '不可對目前登入帳號執行去識別化' }, 400);
      const { data: target } = await admin.from('users').select('user_id,auth_id,name,status').eq('user_id', userId).maybeSingle();
      if (!target) return reply(req, { ok: false, message: '找不到指定使用者' }, 404);
      if (target.status !== 'inactive') return reply(req, { ok: false, message: '只能對已停用帳號執行去識別化' }, 400);
      const { error } = await userDb.rpc('deidentify_departed_user', { p_user_id: userId });
      if (error) return reply(req, { ok: false, message: `個資去識別化失敗：${error.message}` }, 400);
      if (target.auth_id) await admin.auth.admin.updateUserById(target.auth_id, { email: `deidentified-${userId}@example.invalid`, password: crypto.randomUUID() + crypto.randomUUID(), user_metadata: { name: `已離職人員-${userId.slice(-4)}`, username: `deidentified-${userId}` } });
      await audit('users', userId, 'update', { event_type: 'pii_deidentified', previous_name: target.name });
      return reply(req, { ok: true });
    }

    if (action === 'admin_set_permission') {
      const rbacRole = clean(body.role_id, 40), permission = clean(body.permission, 60), allowed = Boolean(body.allowed);
      if (!ROLES.has(rbacRole) || !PERMISSIONS.has(permission)) return reply(req, { ok: false, message: '角色或權限代碼無效' }, 400);
      if (rbacRole === 'sysadmin' && !allowed) return reply(req, { ok: false, message: '系統管理員的完整權限不可取消' }, 400);
      const { data: before } = await admin.from('role_permissions').select('allowed').eq('role_id', rbacRole).eq('perm', permission).maybeSingle();
      const { error } = await admin.from('role_permissions').upsert({ role_id: rbacRole, perm: permission, allowed }, { onConflict: 'role_id,perm' });
      if (error) return reply(req, { ok: false, message: `權限更新失敗：${error.message}` }, 400);
      await audit('role_permissions', `${rbacRole}:${permission}`, 'update', { before: before?.allowed, after: allowed });
      return reply(req, { ok: true });
    }

    if (action === 'admin_assign_role') {
      const userId = id(body.user_id), rbacRole = clean(body.rbac_role, 40);
      if (!userId || !ROLES.has(rbacRole)) return reply(req, { ok: false, message: '使用者或角色設定無效' }, 400);
      if (userId === profile.user_id) return reply(req, { ok: false, message: '不可變更目前登入管理員自己的角色' }, 400);
      const { data: before } = await admin.from('users').select('rbac_role,role').eq('user_id', userId).maybeSingle();
      if (!before) return reply(req, { ok: false, message: '找不到指定使用者' }, 404);
      const changes = { rbac_role: rbacRole, role: LEGACY_ROLE[rbacRole], permissions: await permissionJson(rbacRole) };
      const { error } = await admin.from('users').update(changes).eq('user_id', userId);
      if (error) return reply(req, { ok: false, message: `使用者角色更新失敗：${error.message}` }, 400);
      await audit('users', userId, 'update', { before, after: changes });
      return reply(req, { ok: true });
    }

    if (action === 'admin_save_location') {
      const locationId = id(body.location_id), marketId = clean(body.market_id, 50), floor = clean(body.floor, 50), area = clean(body.area, 120), detail = clean(body.detail, 200), nextStatus = status(body.status);
      if (!marketId || !floor || !area) return reply(req, { ok: false, message: '市場、樓層與區域為必填' }, 400);
      const values = { market_id: marketId, floor, floor_order: Number(body.floor_order || 0), area, area_order: Number(body.area_order || 0), detail, detail_order: Number(body.detail_order || 0), status: nextStatus };
      if (locationId) {
        const { data: before } = await admin.from('locations').select('*').eq('location_id', locationId).maybeSingle();
        const { error } = await admin.from('locations').update(values).eq('location_id', locationId);
        if (error) return reply(req, { ok: false, message: `位置更新失敗：${error.message}` }, 400);
        await audit('locations', locationId, 'update', { before, after: values }); return reply(req, { ok: true });
      }
      const { data, error } = await admin.from('locations').insert({ ...values, created_by: profile.user_id }).select('location_id').single();
      if (error) return reply(req, { ok: false, message: `位置新增失敗：${error.message}` }, 400);
      await audit('locations', data.location_id, 'insert', values); return reply(req, { ok: true, data });
    }

    if (action === 'admin_toggle_location') {
      const locationId = id(body.location_id), nextStatus = status(body.status);
      if (!locationId) return reply(req, { ok: false, message: '位置識別碼無效' }, 400);
      const { data: before } = await admin.from('locations').select('status').eq('location_id', locationId).maybeSingle();
      const { error } = await admin.from('locations').update({ status: nextStatus }).eq('location_id', locationId);
      if (error) return reply(req, { ok: false, message: `位置狀態更新失敗：${error.message}` }, 400);
      await audit('locations', locationId, 'status_change', { before: before?.status, after: nextStatus }); return reply(req, { ok: true });
    }

    if (action === 'admin_save_department') {
      const deptId = id(body.dept_id), parentId = id(body.parent_id) || null, name = clean(body.name, 120), code = clean(body.code, 60) || null, nextStatus = status(body.status);
      if (!name || (deptId && deptId === parentId)) return reply(req, { ok: false, message: '部門名稱或上層部門設定無效' }, 400);
      let level = 1; if (parentId) { const { data } = await admin.from('departments').select('level').eq('dept_id', parentId).maybeSingle(); level = Number(data?.level || 0) + 1; }
      const values = { parent_id: parentId, name, code, level, sort_order: Number(body.sort_order || 0), status: nextStatus };
      if (deptId) {
        const { data: before } = await admin.from('departments').select('*').eq('dept_id', deptId).maybeSingle(); const { error } = await admin.from('departments').update(values).eq('dept_id', deptId);
        if (error) return reply(req, { ok: false, message: `部門更新失敗：${error.message}` }, 400); await audit('departments', deptId, 'update', { before, after: values }); return reply(req, { ok: true });
      }
      const { data, error } = await admin.from('departments').insert(values).select('dept_id').single();
      if (error) return reply(req, { ok: false, message: `部門新增失敗：${error.message}` }, 400); await audit('departments', data.dept_id, 'insert', values); return reply(req, { ok: true, data });
    }

    if (action === 'admin_toggle_department') {
      const deptId = id(body.dept_id), nextStatus = status(body.status);
      if (!deptId) return reply(req, { ok: false, message: '部門識別碼無效' }, 400);
      const { data: before } = await admin.from('departments').select('status').eq('dept_id', deptId).maybeSingle(); const { error } = await admin.from('departments').update({ status: nextStatus }).eq('dept_id', deptId);
      if (error) return reply(req, { ok: false, message: `部門狀態更新失敗：${error.message}` }, 400); await audit('departments', deptId, 'status_change', { before: before?.status, after: nextStatus }); return reply(req, { ok: true });
    }

    if (action === 'admin_ack_alert') {
      const alertId = id(body.alert_id); if (!alertId) return reply(req, { ok: false, message: '告警識別碼無效' }, 400);
      const { data: before } = await admin.from('security_alerts').select('status,title').eq('alert_id', alertId).maybeSingle();
      const { error } = await admin.from('security_alerts').update({ status: 'acknowledged', acknowledged_at: new Date().toISOString(), acknowledged_by: profile.user_id }).eq('alert_id', alertId).eq('status', 'open');
      if (error) return reply(req, { ok: false, message: `告警處理失敗：${error.message}` }, 400); await audit('security_alerts', alertId, 'status_change', { before: before?.status, after: 'acknowledged', title: before?.title }); return reply(req, { ok: true });
    }

    if (action === 'admin_mark_notice') {
      const notifId = id(body.notif_id); let query = userDb.from('notifications').update({ is_read: true }).eq('recipient_id', profile.user_id).eq('is_read', false);
      if (notifId) query = query.eq('notif_id', notifId);
      const { data, error } = await query.select('notif_id');
      if (error) return reply(req, { ok: false, message: `通知更新失敗：${error.message}` }, 400);
      await audit('notifications', notifId || `recipient:${profile.user_id}`, 'status_change', { event_type: notifId ? 'mark_read' : 'mark_all_read', count: data?.length || 0 });
      return reply(req, { ok: true, data: { count: data?.length || 0 } });
    }

    return reply(req, { ok: false, message: '不支援的後台管理動作' }, 400);
  } catch (error) {
    console.error('admin-api failed', error instanceof Error ? error.message : String(error));
    return reply(req, { ok: false, message: '後台管理 API 處理失敗，請稍後再試' }, 500);
  }
});
