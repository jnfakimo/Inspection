/*
 * P0 報修流程端到端測試。
 *
 * 執行時需要：
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * 預設使用既有專用測試帳號：
 *   SUPABASE_E2E_TEST_EMAIL
 *   SUPABASE_E2E_TEST_PASSWORD
 *
 * 若要在一次性隔離測試中建立新的 Auth／系統帳號，明確設定：
 *   SUPABASE_E2E_BOOTSTRAP=1
 *
 * 測試資料會以 hidden=true 建立；測試結束後測試帳號改為 inactive，
 * 不刪除報修、工單或歷程，符合正式資料保護規則。
 */

import { randomUUID } from 'node:crypto';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/u, '');
const ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const BOOTSTRAP = process.env.SUPABASE_E2E_BOOTSTRAP === '1';

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error('需要 SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY');
}

const headers = (key, token, extra = {}) => ({
  apikey: key,
  Authorization: `Bearer ${token || key}`,
  ...extra,
});

async function request(path, { key = ANON_KEY, token, method = 'GET', body, prefer } = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: headers(key, token, {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(prefer ? { Prefer: prefer } : {}),
    }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload
      ? payload.message || payload.error_description || payload.error || JSON.stringify(payload)
      : String(payload || response.statusText);
    throw new Error(`${method} ${path} [${response.status}] ${message}`);
  }
  return payload;
}

async function authAdmin(path, options = {}) {
  return request(`/auth/v1/admin${path}`, { ...options, key: SERVICE_KEY, token: SERVICE_KEY });
}

async function rest(path, options = {}) {
  return request(`/rest/v1${path}`, options);
}

async function edgeAction(token, action, body = {}) {
  const result = await request('/functions/v1/app-api', {
    token,
    method: 'POST',
    body: { action, ...body },
  });
  if (!result || result.ok !== true) throw new Error(`app-api ${action} 失敗`);
  return result.data;
}

async function createBootstrapUsers() {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const createActor = async ({ label, usernamePrefix, role, rbacRole, supervisorId = null }) => {
    const email = `p0-e2e-${label}-${suffix}@example.invalid`;
    const password = `P0E2E!${randomUUID().replaceAll('-', '').slice(0, 18)}a1`;
    const authUser = await authAdmin('/users', {
      method: 'POST',
      body: { email, password, email_confirm: true, user_metadata: { purpose: 'p0-e2e' } },
    });
    const profile = (await rest('/users', {
      key: SERVICE_KEY,
      token: SERVICE_KEY,
      method: 'POST',
      prefer: 'return=representation',
      body: {
        auth_id: authUser.id,
        name: `P0 E2E ${label}`,
        username: `${usernamePrefix}_${suffix.replaceAll('-', '_')}`,
        email,
        role,
        rbac_role: rbacRole,
        status: 'active',
        hidden: true,
        supervisor_id: supervisorId,
        permissions: {},
      },
    }))[0];
    return { email, password, authUserId: authUser.id, profile };
  };
  const supervisor = await createActor({ label: '單位主管測試', usernamePrefix: 'p0_sup', role: 'supervisor', rbacRole: 'unit_supervisor' });
  const reporter = await createActor({ label: '一般報修測試', usernamePrefix: 'p0_reporter', role: 'inspector', rbacRole: 'reporter', supervisorId: supervisor.profile.user_id });
  const technician = await createActor({ label: '維修技師測試', usernamePrefix: 'p0_tech', role: 'maintenance', rbacRole: 'technician', supervisorId: supervisor.profile.user_id });
  return { supervisor, reporter, technician, roleSeparated: true };
}

async function loadExistingTestUser() {
  const email = String(process.env.SUPABASE_E2E_TEST_EMAIL || '');
  const password = String(process.env.SUPABASE_E2E_TEST_PASSWORD || '');
  if (!email || !password) throw new Error('非 bootstrap 模式需要 SUPABASE_E2E_TEST_EMAIL 與 SUPABASE_E2E_TEST_PASSWORD');
  const authUsers = await authAdmin('/users?page=1&per_page=1000');
  const authUser = (authUsers.users || []).find((item) => String(item.email || '').toLowerCase() === email.toLowerCase());
  if (!authUser) throw new Error('找不到指定的 P0 E2E Auth 測試帳號');
  const profiles = await rest(`/users?auth_id=eq.${encodeURIComponent(authUser.id)}&select=user_id,auth_id,name,role,rbac_role,status,hidden&limit=1`, { key: SERVICE_KEY, token: SERVICE_KEY });
  const sysadmin = profiles[0];
  if (!sysadmin || sysadmin.status !== 'active') throw new Error('P0 E2E 測試帳號沒有啟用中的系統人員資料');
  if (!['sysadmin', 'admin'].includes(String(sysadmin.rbac_role || sysadmin.role))) throw new Error('非 bootstrap 測試帳號必須具備系統管理員權限');
  const technicians = await rest('/users?rbac_role=eq.technician&status=eq.active&select=user_id,name,role,rbac_role&limit=1', { key: SERVICE_KEY, token: SERVICE_KEY });
  if (!technicians[0]) throw new Error('找不到啟用中的維修技師測試資料');
  return {
    supervisor: { email, password, authUserId: authUser.id, profile: sysadmin },
    reporter: { email, password, authUserId: authUser.id, profile: sysadmin },
    technician: { profile: technicians[0] },
    roleSeparated: false,
  };
}

async function signIn(email, password) {
  const session = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  if (!session.access_token) throw new Error('P0 E2E 測試登入沒有取得 access token');
  return session.access_token;
}

async function readFlow(token, requestId) {
  const [requestRows, orderRows, logs] = await Promise.all([
    rest(`/repair_requests?request_id=eq.${requestId}&select=request_id,status,hidden,created_by&limit=1`, { token }),
    rest(`/maintenance_orders?request_id=eq.${requestId}&select=order_id,status,assignee_id,hidden&order=created_at.desc&limit=1`, { token }),
    rest(`/case_status_log?request_id=eq.${requestId}&select=from_status,to_status&order=created_at.asc`, { token }),
  ]);
  return { request: requestRows[0] || null, order: orderRows[0] || null, logs };
}

function assert(condition, message) {
  if (!condition) throw new Error(`P0 E2E 驗證失敗：${message}`);
}

const fixture = BOOTSTRAP ? await createBootstrapUsers() : await loadExistingTestUser();
let requestId = '';
let orderId = '';
const result = { bootstrap: BOOTSTRAP, roleSeparated: fixture.roleSeparated, stages: [], negativeGuard: false };

try {
  const supervisorToken = await signIn(fixture.supervisor.email, fixture.supervisor.password);
  const reporterToken = fixture.roleSeparated ? await signIn(fixture.reporter.email, fixture.reporter.password) : supervisorToken;
  const technicianToken = fixture.roleSeparated ? await signIn(fixture.technician.email, fixture.technician.password) : supervisorToken;
  const created = (await rest('/repair_requests', {
    token: reporterToken,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      source: 'direct',
      reporter: 'P0 E2E 自動測試',
      department: 'P0-E2E',
      fault_location: 'P0-E2E 測試位置',
      fault_type: 'P0 E2E 流程測試',
      fault_desc: 'P0 報修至結案端到端測試資料',
      urgency: 'normal',
      mobile: '0900000000',
      status: 'pending',
      hidden: true,
      created_by: fixture.reporter.profile.user_id,
    },
  }))[0];
  requestId = created.request_id;
  assert(requestId, '報修案件未建立');

  const stages = [
    ['dispatch', supervisorToken, { technician: fixture.technician.profile.user_id, work_content: 'P0 端到端派工測試' }, 'assigned'],
    ['engineer_accept', technicianToken, {}, 'accepted'],
    ['engineer_start', technicianToken, {}, 'in_progress'],
    ['engineer_complete', technicianToken, { fault_cause: '測試故障原因', handle_method: '測試處理方式', labor_hours: 1, parts_used: '測試零件', note: 'P0 E2E' }, 'pending_review'],
  ];
  for (const [action, actorToken, payload, expected] of stages) {
    await edgeAction(actorToken, 'workorder_workflow', { request_id: requestId, workflow_action: action, payload });
    const state = await readFlow(supervisorToken, requestId);
    const actual = action === 'engineer_accept' ? state.order?.status : state.request?.status;
    assert(actual === expected, `${action} 後狀態應為 ${expected}，實際為 ${actual}`);
    result.stages.push({ action, status: actual });
    if (!orderId && state.order?.order_id) orderId = state.order.order_id;
  }

  try {
    await edgeAction(supervisorToken, 'workorder_workflow', { request_id: requestId, workflow_action: 'supervisor_accept', payload: {} });
    throw new Error('待報修人驗收時不應允許主管直接結案');
  } catch (error) {
    assert(/目前案件狀態|報修人驗收|先完成/u.test(String(error.message)), `非法越級驗收錯誤訊息不符：${error.message}`);
    result.negativeGuard = true;
  }

  await edgeAction(reporterToken, 'workorder_workflow', { request_id: requestId, workflow_action: 'reporter_accept', payload: {} });
  result.stages.push({ action: 'reporter_accept', status: (await readFlow(supervisorToken, requestId)).request?.status });
  assert(result.stages.at(-1).status === 'completed', '報修人驗收後案件應為 completed');

  await edgeAction(supervisorToken, 'workorder_workflow', { request_id: requestId, workflow_action: 'supervisor_accept', payload: {} });
  const finalState = await readFlow(supervisorToken, requestId);
  result.stages.push({ action: 'supervisor_accept', status: finalState.request?.status });
  assert(finalState.request?.status === 'closed', '主管驗收後報修案件應為 closed');
  assert(finalState.order?.status === 'closed', '主管驗收後維修工單應為 closed');
  assert(finalState.order?.assignee_id === fixture.technician.profile.user_id, '工單指派技師不一致');
  const transitionStatuses = finalState.logs.map((row) => row.to_status);
  for (const expected of ['assigned', 'accepted', 'in_progress', 'pending_review', 'completed', 'closed']) {
    assert(transitionStatuses.includes(expected), `歷程缺少 ${expected}`);
  }
  result.requestId = requestId;
  result.orderId = orderId || finalState.order?.order_id || '';
  result.logCount = finalState.logs.length;
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} finally {
  if (requestId) {
    await rest(`/repair_requests?request_id=eq.${requestId}`, {
      key: SERVICE_KEY,
      token: SERVICE_KEY,
      method: 'PATCH',
      body: { hidden: true },
    }).catch(() => undefined);
    await rest(`/maintenance_orders?request_id=eq.${requestId}`, {
      key: SERVICE_KEY,
      token: SERVICE_KEY,
      method: 'PATCH',
      body: { hidden: true },
    }).catch(() => undefined);
  }
  if (BOOTSTRAP) {
    // 先停用下屬報修人／技師，再停用主管；階層觸發器要求啟用中的人員
    // 不能指向已停用的直屬主管。
    await rest(`/users?user_id=eq.${fixture.reporter.profile.user_id}`, {
      key: SERVICE_KEY,
      token: SERVICE_KEY,
      method: 'PATCH',
      body: { status: 'inactive', hidden: true },
    }).catch(() => undefined);
    await rest(`/users?user_id=eq.${fixture.technician.profile.user_id}`, {
      key: SERVICE_KEY,
      token: SERVICE_KEY,
      method: 'PATCH',
      body: { status: 'inactive', hidden: true },
    }).catch(() => undefined);
    await rest(`/users?user_id=eq.${fixture.supervisor.profile.user_id}`, {
      key: SERVICE_KEY,
      token: SERVICE_KEY,
      method: 'PATCH',
      body: { status: 'inactive', hidden: true },
    }).catch(() => undefined);
  }
}
