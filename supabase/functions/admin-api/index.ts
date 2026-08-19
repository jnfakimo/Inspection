import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';

type PortableRuntime = {
  env?: { get: (name: string) => string | undefined };
  serve?: (handler: (request: Request) => Promise<Response>) => unknown;
};

const denoRuntime = (globalThis as typeof globalThis & { Deno?: PortableRuntime }).Deno;
const nodeEnvironment = (globalThis as typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;

function requiredEnvironment(name: string) {
  const value = denoRuntime?.env?.get(name) || nodeEnvironment?.[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const SUPABASE_URL = requiredEnvironment('SUPABASE_URL');
const SERVICE_ROLE_KEY = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = requiredEnvironment('SUPABASE_ANON_KEY');
const ROLES = new Set(['reporter', 'duty', 'dispatcher', 'technician', 'unit_supervisor', 'sysadmin']);
const PERMISSIONS = new Set(['create', 'update', 'delete', 'read', 'dispatch', 'close', 'sign', 'export', 'admin', 'sys_admin', 'sys_workorder', 'sys_guardpatrol', 'sys_handover', 'sys_equipment', 'sys_equipment_manage', 'sys_structuremap', 'sys_vehicle', 'sys_meetingroom']);
const SAFE_SETTING_KEYS = new Set([
  'org_name', 'site_name', 'shifts', 'line_group_id', 'line_notify_anomaly', 'line_notify_repair',
  'line_notify_case', 'line_notify_security', 'line_notify_patrol_timeout', 'fcm_notify_patrol_timeout',
  'patrol_timeout_rules',
]);
const FIXED_SHIFT_IDS = ['morning', 'afternoon', 'night'];
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
function id(value: unknown) { const result = clean(value, 80); return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result) ? result : ''; }
function status(value: unknown) { return value === 'inactive' ? 'inactive' : 'active'; }
function safeDetails(value: unknown) { return value && typeof value === 'object' ? value : {}; }
function boolText(value: unknown) { return value === true || value === 'true' ? 'true' : 'false'; }
function validTime(value: string) { return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value); }
function canonicalFloor(value: string) {
  const normalized = value.trim().toUpperCase().replace(/\s+/g, '');
  if (normalized === 'B1' || normalized === 'B1F' || normalized === '地下1樓' || normalized === '地下一樓') return 'B1F';
  if (normalized === 'RF' || normalized === 'R' || normalized === '頂樓' || normalized === '屋頂') return 'RF';
  const match = normalized.match(/^(\d+)(?:F|樓)?$/);
  return match ? `${Number(match[1])}F` : value.trim();
}

export async function handleAdminApiRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return reply(req, { ok: false, message: '僅支援 POST' }, 405);
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return reply(req, { ok: false, message: '尚未登入' }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return reply(req, { ok: false, message: '登入狀態無效，請重新登入' }, 401);
    const { data: globalRateAllowed, error: globalRateError } = await admin.rpc('enforce_request_rate_limit', {
      p_subject: authData.user.id,
      p_scope: 'admin-api',
    });
    if (globalRateError) {
      console.error('admin-api rate limit failed:', globalRateError.message);
      return reply(req, { ok: false, message: '安全限流服務暫時無法使用' }, 503);
    }
    if (globalRateAllowed !== true) {
      return reply(req, { ok: false, message: '請求過於頻繁，請稍後再試' }, 429);
    }
    const { data: profile, error: profileError } = await admin.from('users').select('user_id,auth_id,name,username,role,rbac_role,status').eq('auth_id', authData.user.id).eq('status', 'active').maybeSingle();
    if (profileError || !profile) return reply(req, { ok: false, message: '找不到啟用中的系統帳號' }, 403);
    const roleId = profile.rbac_role || (profile.role === 'admin' ? 'sysadmin' : profile.role);
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = clean(body.action, 50);
    if (action !== 'admin_get_settings') {
      const { data: writeRateAllowed, error: writeRateError } = await admin.rpc('enforce_request_rate_limit', {
        p_subject: authData.user.id,
        p_scope: 'admin-api:write',
      });
      if (writeRateError) {
        console.error('admin-api:write rate limit failed:', writeRateError.message);
        return reply(req, { ok: false, message: '安全限流服務暫時無法使用' }, 503);
      }
      if (writeRateAllowed !== true) {
        return reply(req, { ok: false, message: '操作過於頻繁，請稍後再試' }, 429);
      }
    }
    const isAdmin = roleId === 'sysadmin' || profile.role === 'admin';
    if (!isAdmin && action !== 'admin_mark_notice') return reply(req, { ok: false, message: '僅限系統管理員執行此操作' }, 403);
    const userDb = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
    const audit = async (tableName: string, recordId: unknown, auditAction: 'insert' | 'update' | 'status_change', changes: unknown) => {
      const { error } = await admin.from('audit_logs').insert({ table_name: tableName, record_id: clean(recordId, 200) || 'unknown', action: auditAction, changes: safeDetails(changes), operator_id: profile.user_id, source: 'v2-admin' });
      if (error) console.warn('admin audit skipped:', error.message);
    };
    const departmentName = async (deptId: string | null) => {
      if (!deptId) return null;
      const { data } = await admin.from('departments').select('name').eq('dept_id', deptId).maybeSingle();
      return data?.name || null;
    };
    const roleExists = async (rbacRole: string) => {
      const { data } = await admin.from('roles').select('role_id').eq('role_id', rbacRole).maybeSingle();
      return Boolean(data);
    };

    if (action === 'admin_get_settings') {
      const keys = [...SAFE_SETTING_KEYS, 'line_channel_token'];
      const { data, error } = await admin.from('system_settings').select('key,value').in('key', keys);
      if (error) return reply(req, { ok: false, message: `系統設定載入失敗：${error.message}` }, 400);
      const settings = Object.fromEntries((data || []).map(row => [String(row.key), String(row.value ?? '')]));
      let shifts = [
        { id: 'morning', label: '早班', start: '06:00', end: '14:00' },
        { id: 'afternoon', label: '中班', start: '14:00', end: '22:00' },
        { id: 'night', label: '夜班', start: '22:00', end: '06:00' },
      ];
      let patrolRules: unknown[] = [];
      try { const parsed = JSON.parse(settings.shifts || '[]'); if (Array.isArray(parsed) && parsed.length) shifts = parsed; } catch { /* 使用固定三班預設 */ }
      try { const parsed = JSON.parse(settings.patrol_timeout_rules || '[]'); if (Array.isArray(parsed)) patrolRules = parsed; } catch { /* 使用空規則 */ }
      const enabled = (key: string) => settings[key] === 'true';
      return reply(req, { ok: true, data: {
        identity: { org_name: settings.org_name || '臺北農產運銷股份有限公司', site_name: settings.site_name || '第一果菜市場' },
        shifts: { shifts },
        line: {
          line_token_configured: Boolean(settings.line_channel_token),
          line_group_id: settings.line_group_id || '',
          line_notify_anomaly: enabled('line_notify_anomaly'),
          line_notify_repair: enabled('line_notify_repair'),
          line_notify_case: enabled('line_notify_case'),
          line_notify_security: enabled('line_notify_security'),
          line_notify_patrol_timeout: enabled('line_notify_patrol_timeout'),
          fcm_notify_patrol_timeout: enabled('fcm_notify_patrol_timeout'),
          patrol_timeout_rules: patrolRules,
        },
      } });
    }

    if (action === 'admin_save_identity') {
      const input = (body.identity && typeof body.identity === 'object' ? body.identity : body) as Record<string, unknown>;
      const orgName = clean(input.org_name, 160), siteName = clean(input.site_name, 160);
      if (!orgName || !siteName) return reply(req, { ok: false, message: '機構名稱與場所名稱皆為必填' }, 400);
      const updatedAt = new Date().toISOString();
      const { error } = await admin.from('system_settings').upsert([
        { key: 'org_name', value: orgName, updated_at: updatedAt },
        { key: 'site_name', value: siteName, updated_at: updatedAt },
      ], { onConflict: 'key' });
      if (error) return reply(req, { ok: false, message: `系統識別儲存失敗：${error.message}` }, 400);
      await audit('system_settings', 'identity', 'update', { org_name: orgName, site_name: siteName });
      return reply(req, { ok: true, data: { org_name: orgName, site_name: siteName } });
    }

    if (action === 'admin_save_shifts') {
      const source = Array.isArray(body.shifts) ? body.shifts : ((body.shifts as Record<string, unknown> | undefined)?.shifts || []);
      if (!Array.isArray(source) || source.length !== FIXED_SHIFT_IDS.length) return reply(req, { ok: false, message: '班別必須保留早班、中班、夜班三個固定流程' }, 400);
      const shifts = source.map(item => {
        const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return { id: clean(row.id, 20), label: clean(row.label, 40), start: clean(row.start, 5), end: clean(row.end, 5) };
      });
      if (new Set(shifts.map(row => row.id)).size !== 3 || FIXED_SHIFT_IDS.some(shiftId => !shifts.some(row => row.id === shiftId)) || shifts.some(row => !row.label || !validTime(row.start) || !validTime(row.end))) {
        return reply(req, { ok: false, message: '班別代碼不可變更，名稱必填，時間須為有效的 HH:MM' }, 400);
      }
      const { error } = await admin.from('system_settings').upsert({ key: 'shifts', value: JSON.stringify(shifts), updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) return reply(req, { ok: false, message: `班別設定儲存失敗：${error.message}` }, 400);
      await audit('system_settings', 'shifts', 'update', { shifts });
      return reply(req, { ok: true, data: { shifts } });
    }

    if (action === 'admin_save_line_settings') {
      const input = (body.line && typeof body.line === 'object' ? body.line : body) as Record<string, unknown>;
      const groupId = clean(input.line_group_id ?? input.group_id, 200);
      const newToken = clean(input.line_channel_token ?? input.channel_token ?? input.token, 1000);
      const { data: currentTokenRow } = await admin.from('system_settings').select('value').eq('key', 'line_channel_token').maybeSingle();
      if (!groupId) return reply(req, { ok: false, message: 'LINE 群組 ID 為必填' }, 400);
      if (!newToken && !clean(currentTokenRow?.value, 1000)) return reply(req, { ok: false, message: '尚未設定 LINE Channel Token，請先輸入 Token' }, 400);
      const rawRules = Array.isArray(input.patrol_timeout_rules) ? input.patrol_timeout_rules : [];
      const patrolRules = rawRules.map((item, index) => {
        const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        const days = Array.isArray(row.days) ? row.days.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6) : [];
        return { id: clean(row.id, 30) || `rule-${index + 1}`, label: clean(row.label, 60), start: clean(row.start, 5), end: clean(row.end, 5), days: [...new Set(days)], grace_minutes: Math.max(0, Math.min(1440, Number(row.grace_minutes || 0))) };
      });
      if (patrolRules.some(row => !row.label || !validTime(row.start) || !validTime(row.end) || !Number.isFinite(row.grace_minutes))) return reply(req, { ok: false, message: '巡檢逾時規則的名稱與有效時段為必填' }, 400);
      const rows = [
        { key: 'line_group_id', value: groupId },
        { key: 'line_notify_anomaly', value: boolText(input.line_notify_anomaly) },
        { key: 'line_notify_repair', value: boolText(input.line_notify_repair) },
        { key: 'line_notify_case', value: boolText(input.line_notify_case) },
        { key: 'line_notify_security', value: boolText(input.line_notify_security) },
        { key: 'line_notify_patrol_timeout', value: boolText(input.line_notify_patrol_timeout) },
        { key: 'fcm_notify_patrol_timeout', value: boolText(input.fcm_notify_patrol_timeout) },
        { key: 'patrol_timeout_rules', value: JSON.stringify(patrolRules) },
      ].map(row => ({ ...row, updated_at: new Date().toISOString() }));
      if (newToken) rows.push({ key: 'line_channel_token', value: newToken, updated_at: new Date().toISOString() });
      const { error } = await admin.from('system_settings').upsert(rows, { onConflict: 'key' });
      if (error) return reply(req, { ok: false, message: `LINE 推播設定儲存失敗：${error.message}` }, 400);
      await audit('system_settings', 'line', 'update', { changed_keys: rows.map(row => row.key).filter(key => key !== 'line_channel_token'), token_replaced: Boolean(newToken) });
      return reply(req, { ok: true, data: { line_token_configured: true } });
    }

    if (action === 'admin_create_user') {
      const name = clean(body.name, 100), username = clean(body.username, 64), email = clean(body.email, 200).toLowerCase(), phone = clean(body.phone, 50), password = String(body.password || ''), rbacRole = clean(body.rbac_role, 40), deptId = id(body.dept_id) || null;
      if (!name || !/^[A-Za-z0-9._-]{3,64}$/.test(username)) return reply(req, { ok: false, message: '姓名必填；登入帳號須為 3–64 個英數字、句點、底線或連字號' }, 400);
      if (!/^\S+@\S+\.\S+$/.test(email) || /[(),]/.test(email)) return reply(req, { ok: false, message: 'Email 格式不正確' }, 400);
      if (password.length < 8) return reply(req, { ok: false, message: '初始密碼至少需要 8 個字元' }, 400);
      if (!ROLES.has(rbacRole) && !(await roleExists(rbacRole))) return reply(req, { ok: false, message: '角色設定無效' }, 400);
      const [{ count: usernameCount }, { count: emailCount }] = await Promise.all([admin.from('users').select('*', { count: 'exact', head: true }).ilike('username', username), admin.from('users').select('*', { count: 'exact', head: true }).ilike('email', email)]); const count = Number(usernameCount || 0) + Number(emailCount || 0);
      if (count) return reply(req, { ok: false, message: '登入帳號或 Email 已存在' }, 409);
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name, username } });
      if (createError || !created.user) return reply(req, { ok: false, message: `Auth 帳號建立失敗：${createError?.message || '未知錯誤'}` }, 400);
      const profileData = { auth_id: created.user.id, name, username, email, phone: phone || null, dept_id: deptId, department: await departmentName(deptId), role: LEGACY_ROLE[rbacRole], rbac_role: rbacRole, permissions: {}, status: 'active', created_by: profile.user_id };
      const { data, error } = await admin.from('users').insert(profileData).select('user_id').single();
      if (error) { await admin.auth.admin.deleteUser(created.user.id); return reply(req, { ok: false, message: `人員主檔建立失敗：${error.message}` }, 400); }
      await audit('users', data.user_id, 'insert', { name, username, email, dept_id: deptId, rbac_role: rbacRole, status: 'active' });
      return reply(req, { ok: true, data });
    }

    if (action === 'admin_update_user') {
      const userId = id(body.user_id), name = clean(body.name, 100), username = clean(body.username, 64), phone = clean(body.phone, 50), rbacRole = clean(body.rbac_role, 40), deptId = id(body.dept_id) || null;
      if (!userId || !name || !/^[A-Za-z0-9._-]{3,64}$/.test(username) || (!ROLES.has(rbacRole) && !(await roleExists(rbacRole)))) return reply(req, { ok: false, message: '人員資料或角色設定無效' }, 400);
      const { data: before } = await admin.from('users').select('user_id,auth_id,name,username,phone,dept_id,department,role,rbac_role,status').eq('user_id', userId).maybeSingle();
      if (!before) return reply(req, { ok: false, message: '找不到指定使用者' }, 404);
      if (userId === profile.user_id && rbacRole !== roleId) return reply(req, { ok: false, message: '不可變更目前登入管理員自己的角色' }, 400);
      const changes = { name, username, phone: phone || null, dept_id: deptId, department: await departmentName(deptId), role: LEGACY_ROLE[rbacRole], rbac_role: rbacRole, permissions: {} };
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
      if (!userId || password.length < 8) return reply(req, { ok: false, message: '新密碼至少需要 8 個字元' }, 400);
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
      if (!PERMISSIONS.has(permission)) return reply(req, { ok: false, message: '權限代碼無效' }, 400);
      if (!ROLES.has(rbacRole) && !(await roleExists(rbacRole))) return reply(req, { ok: false, message: '角色不存在' }, 400);
      if (permission === 'sys_admin' && rbacRole !== 'sysadmin' && allowed) return reply(req, { ok: false, message: '後台管理權限只保留給系統管理員，不可委派' }, 400);
      if (rbacRole === 'sysadmin' && !allowed) return reply(req, { ok: false, message: '系統管理員的完整權限不可取消' }, 400);
      const { data: before } = await admin.from('role_permissions').select('allowed').eq('role_id', rbacRole).eq('perm', permission).maybeSingle();
      const { error } = await admin.from('role_permissions').upsert({ role_id: rbacRole, perm: permission, allowed }, { onConflict: 'role_id,perm' });
      if (error) return reply(req, { ok: false, message: `權限更新失敗：${error.message}` }, 400);
      const { error: inheritError } = await admin.from('users').update({ permissions: {} }).eq('rbac_role', rbacRole);
      if (inheritError) return reply(req, { ok: false, message: `角色權限已更新，但使用者繼承同步失敗：${inheritError.message}` }, 500);
      await audit('role_permissions', `${rbacRole}:${permission}`, 'update', { before: before?.allowed, after: allowed });
      return reply(req, { ok: true });
    }

    if (action === 'admin_assign_role') {
      const userId = id(body.user_id), rbacRole = clean(body.rbac_role, 40);
      if (!userId || (!ROLES.has(rbacRole) && !(await roleExists(rbacRole)))) return reply(req, { ok: false, message: '使用者或角色設定無效' }, 400);
      if (userId === profile.user_id) return reply(req, { ok: false, message: '不可變更目前登入管理員自己的角色' }, 400);
      const { data: before } = await admin.from('users').select('rbac_role,role').eq('user_id', userId).maybeSingle();
      if (!before) return reply(req, { ok: false, message: '找不到指定使用者' }, 404);
      const changes = { rbac_role: rbacRole, role: LEGACY_ROLE[rbacRole], permissions: {} };
      const { error } = await admin.from('users').update(changes).eq('user_id', userId);
      if (error) return reply(req, { ok: false, message: `使用者角色更新失敗：${error.message}` }, 400);
      await audit('users', userId, 'update', { before, after: changes });
      return reply(req, { ok: true });
    }

    if (action === 'admin_save_location') {
      const locationId = id(body.location_id), marketId = clean(body.market_id, 50), floor = canonicalFloor(clean(body.floor, 50)), area = clean(body.area, 120), detail = clean(body.detail, 200), nextStatus = status(body.status);
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
      let level = 1;
      if (parentId) {
        const { data: parent } = await admin.from('departments').select('level,parent_id,status').eq('dept_id', parentId).maybeSingle();
        if (!parent || parent.status !== 'active' || Number(parent.level) !== 1 || parent.parent_id) return reply(req, { ok: false, message: '上層部門必須是啟用中的一級部門' }, 400);
        if (deptId) { const { count } = await admin.from('departments').select('*', { count: 'exact', head: true }).eq('parent_id', deptId); if (count) return reply(req, { ok: false, message: '已有下層部門的一級部門不可再改為二級部門' }, 400); }
        level = 2;
      }
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
      const { data: before } = await admin.from('departments').select('status').eq('dept_id', deptId).maybeSingle();
      if (nextStatus === 'inactive') { const { count } = await admin.from('departments').select('*', { count: 'exact', head: true }).eq('parent_id', deptId).eq('status', 'active'); if (count) return reply(req, { ok: false, message: '請先停用所屬的二級部門，再停用此一級部門' }, 400); }
      const { error } = await admin.from('departments').update({ status: nextStatus }).eq('dept_id', deptId);
      if (error) return reply(req, { ok: false, message: `部門狀態更新失敗：${error.message}` }, 400); await audit('departments', deptId, 'status_change', { before: before?.status, after: nextStatus }); return reply(req, { ok: true });
    }

    if (action === 'admin_ack_alert') {
      const alertId = id(body.alert_id); if (!alertId) return reply(req, { ok: false, message: '告警識別碼無效' }, 400);
      const { data: before } = await admin.from('security_alerts').select('status,title').eq('alert_id', alertId).maybeSingle();
      const { error } = await admin.from('security_alerts').update({ status: 'acknowledged', acknowledged_at: new Date().toISOString(), acknowledged_by: profile.user_id }).eq('alert_id', alertId).eq('status', 'open');
      if (error) return reply(req, { ok: false, message: `告警處理失敗：${error.message}` }, 400); await audit('security_alerts', alertId, 'status_change', { before: before?.status, after: 'acknowledged', title: before?.title }); return reply(req, { ok: true });
    }

    if (action === 'admin_mark_notice') {
      const rawNotifId = clean(body.notif_id, 80), notifId = id(rawNotifId);
      if (rawNotifId && !notifId) return reply(req, { ok: false, message: '通知識別碼無效' }, 400);
      let query = userDb.from('notifications').update({ is_read: true }).eq('recipient_id', profile.user_id).eq('is_read', false);
      if (notifId) query = query.eq('notif_id', notifId);
      const { data, error } = await query.select('notif_id');
      if (error) return reply(req, { ok: false, message: `通知更新失敗：${error.message}` }, 400);
      await audit('notifications', notifId || `recipient:${profile.user_id}`, 'status_change', { event_type: notifId ? 'mark_read' : 'mark_all_read', count: data?.length || 0 });
      return reply(req, { ok: true, data: { count: data?.length || 0 } });
    }

    if (action === 'admin_create_role') {
      const roleId = clean(body.role_id, 40).toLowerCase(), name = clean(body.name, 80);
      if (!/^[a-z0-9_]{2,40}$/.test(roleId) || !name) return reply(req, { ok: false, message: '角色代碼須為 2–40 個小寫英數字或底線，且名稱不可空白' }, 400);
      if (ROLES.has(roleId)) return reply(req, { ok: false, message: '此角色代碼為系統保留角色，不可建立' }, 409);
      const { data: existing } = await admin.from('roles').select('role_id').eq('role_id', roleId).maybeSingle();
      if (existing) return reply(req, { ok: false, message: '角色代碼已存在' }, 409);
      const { data: maxRow } = await admin.from('roles').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle();
      const { data, error } = await admin.from('roles').insert({ role_id: roleId, name, sort_order: Number(maxRow?.sort_order || 0) + 10 }).select('role_id').single();
      if (error) return reply(req, { ok: false, message: `角色建立失敗：${error.message}` }, 400);
      await audit('roles', roleId, 'insert', { role_id: roleId, name });
      return reply(req, { ok: true, data });
    }

    if (action === 'admin_update_role') {
      const roleId = clean(body.role_id, 40).toLowerCase(), name = clean(body.name, 80);
      if (!/^[a-z0-9_]{2,40}$/.test(roleId) || !name) return reply(req, { ok: false, message: '角色代碼與名稱格式無效' }, 400);
      const { data: before } = await admin.from('roles').select('role_id,name,sort_order').eq('role_id', roleId).maybeSingle();
      if (!before) return reply(req, { ok: false, message: '找不到指定角色' }, 404);
      const { error } = await admin.from('roles').update({ name }).eq('role_id', roleId);
      if (error) return reply(req, { ok: false, message: `角色更新失敗：${error.message}` }, 400);
      await audit('roles', roleId, 'update', { before: before.name, after: name });
      return reply(req, { ok: true });
    }

    return reply(req, { ok: false, message: '不支援的後台管理動作' }, 400);
  } catch (error) {
    console.error('admin-api failed', error instanceof Error ? error.message : String(error));
    return reply(req, { ok: false, message: '後台管理 API 處理失敗，請稍後再試' }, 500);
  }
}

// Supabase Edge Functions remain available as a migration fallback. The
// Render Node.js service imports this same handler, so both runtimes enforce
// the exact same validation, RBAC, rate limits, and audit rules.
if (denoRuntime?.serve) denoRuntime.serve(handleAdminApiRequest);
