/*
 * P0 帳號申請與派車核可階層端到端測試。
 *
 * 流程：公開帳號申請 → 系統管理員核准並指定直屬主管 →
 * 一般使用者送出派車申請 → 單位主管核可 → 派車管理員派車 → 駕駛接單。
 *
 * 需要 SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY。
 * SUPABASE_E2E_BOOTSTRAP=1 會建立一次性 hidden 測試帳號與車輛；測試結束
 * 只停用測試帳號／名單／車輛，保留申請與流程歷程供稽核，不做實體刪除。
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

async function invokeFunction(name, body, token = ANON_KEY) {
  const result = await request(`/functions/v1/${name}`, { token, method: 'POST', body });
  if (!result || result.ok !== true) throw new Error(`${name} 失敗：${result?.message || '未知錯誤'}`);
  return result;
}

async function invokeFunctionRaw(name, body, token) {
  try {
    return { ok: true, result: await request(`/functions/v1/${name}`, { token, method: 'POST', body }) };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

async function signIn(email, password) {
  const session = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  if (!session.access_token) throw new Error('P0 派車測試登入沒有取得 access token');
  return session.access_token;
}

const CAPTCHA_SEGMENTS = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'd', 'e', 'g'],
  '3': ['a', 'b', 'c', 'd', 'g'],
  '4': ['b', 'c', 'f', 'g'],
  '5': ['a', 'c', 'd', 'f', 'g'],
  '6': ['a', 'c', 'd', 'e', 'f', 'g'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
};
const CAPTCHA_PATHS = {
  a: 'M4 2H20L17 5H7Z', b: 'M21 4V18L18 21V7Z', c: 'M21 22V36L18 33V25Z',
  d: 'M4 38H20L17 35H7Z', e: 'M3 22V36L6 33V25Z', f: 'M3 4V18L6 21V7Z',
  g: 'M4 20H20L17 23H7Z',
};

// captcha 回傳的是包含七段顯示器 path 的 SVG；從每個數字的 g 區塊還原答案，
// 只用於自動驗收，不會繞過正式驗證流程。
function decodeCaptcha(image) {
  const encoded = String(image || '').replace(/^data:image\/svg\+xml;base64,/u, '');
  const svg = Buffer.from(encoded, 'base64').toString('utf8');
  const digits = [];
  const groups = [...svg.matchAll(/<g transform="[^"]+">([\s\S]*?)<\/g>/gu)];
  for (const group of groups) {
    const present = Object.entries(CAPTCHA_PATHS)
      // 每個數字的七段 path 會合併在同一個 d 屬性中，不能以完整 d= 比對。
      .filter(([, path]) => group[1].includes(path))
      .map(([segment]) => segment)
      .sort();
    const digit = Object.entries(CAPTCHA_SEGMENTS).find(([, segments]) => [...segments].sort().join('') === present.join(''))?.[0];
    if (!digit) throw new Error('無法解析帳號申請驗證碼');
    digits.push(digit);
  }
  if (digits.length !== 6) throw new Error('帳號申請驗證碼長度不符');
  return digits.join('');
}

async function submitAccountApplication({ name, username, email, deptId }) {
  const captcha = await invokeFunction('username-login', { action: 'captcha' });
  const answer = decodeCaptcha(captcha.image);
  return invokeFunction('username-login', {
    action: 'account_application',
    captcha_id: captcha.challenge_id,
    captcha_answer: answer,
    name,
    username,
    email,
    phone: '0900000000',
    dept_id: deptId,
    reason: 'P0 帳號申請與派車階層驗收',
  });
}

async function createProfile({ label, emailLabel, usernamePrefix, role, rbacRole, supervisorId = null, deptId = null }) {
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const email = `p0-vehicle-${emailLabel}-${suffix}@example.invalid`;
  const password = `P0Vehicle!${randomUUID().replaceAll('-', '').slice(0, 18)}a1`;
  const authUser = await authAdmin('/users', {
    method: 'POST',
    body: { email, password, email_confirm: true, user_metadata: { purpose: 'p0-vehicle-e2e' } },
  });
  const profile = (await rest('/users', {
    key: SERVICE_KEY,
    token: SERVICE_KEY,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      auth_id: authUser.id,
      name: `P0 派車 ${label}`,
      username: `${usernamePrefix}_${suffix.replaceAll('-', '_')}`,
      email,
      role,
      rbac_role: rbacRole,
      department: 'P0 派車驗收單位',
      dept_id: deptId,
      status: 'active',
      hidden: true,
      supervisor_id: supervisorId,
      permissions: {},
    },
  }))[0];
  return { email, password, authUserId: authUser.id, profile };
}

async function createBootstrapFixture() {
  const deptId = 'ca6d761d-4c32-4b8a-898a-5c563f4c5438';
  const sysadmin = await createProfile({ label: '系統管理員測試', emailLabel: 'sysadmin', usernamePrefix: 'p0_car_sys', role: 'admin', rbacRole: 'sysadmin' });
  const supervisor = await createProfile({ label: '單位主管測試', emailLabel: 'supervisor', usernamePrefix: 'p0_car_sup', role: 'supervisor', rbacRole: 'unit_supervisor', deptId });
  const dispatcher = await createProfile({ label: '派車管理員測試', emailLabel: 'dispatcher', usernamePrefix: 'p0_car_mgr', role: 'maintenance', rbacRole: 'dispatcher', supervisorId: supervisor.profile.user_id, deptId });
  const driver = await createProfile({ label: '駕駛測試', emailLabel: 'driver', usernamePrefix: 'p0_car_driver', role: 'maintenance', rbacRole: 'duty', supervisorId: supervisor.profile.user_id, deptId });

  await rest('/vehicle_dispatch_managers', {
    key: SERVICE_KEY, token: SERVICE_KEY, method: 'POST', prefer: 'return=minimal',
    body: { user_id: dispatcher.profile.user_id, active: true, assigned_by: sysadmin.profile.user_id },
  });
  await rest('/vehicle_dispatch_drivers', {
    key: SERVICE_KEY, token: SERVICE_KEY, method: 'POST', prefer: 'return=minimal',
    body: { user_id: driver.profile.user_id, active: true, assigned_by: sysadmin.profile.user_id },
  });
  const vehicle = (await rest('/official_vehicles', {
    key: SERVICE_KEY, token: SERVICE_KEY, method: 'POST', prefer: 'return=representation',
    body: { plate_no: `P0-${Date.now().toString().slice(-6)}`, vehicle_name: 'P0 派車驗收車', seats: 5, status: 'active', created_by: sysadmin.profile.user_id },
  }))[0];

  const applicantEmail = `p0-vehicle-applicant-${Date.now()}-${randomUUID().slice(0, 8)}@example.invalid`;
  const applicantUsername = `p0_car_app_${Date.now()}_${randomUUID().slice(0, 6)}`;
  const application = await submitAccountApplication({
    name: 'P0 派車 一般使用者', username: applicantUsername, email: applicantEmail, deptId,
  });
  const applicationId = application.application_id;
  const sysadminToken = await signIn(sysadmin.email, sysadmin.password);
  const approved = await invokeFunction('admin-api', {
    action: 'admin_approve_account_application',
    application_id: applicationId,
    rbac_role: 'reporter',
    supervisor_id: supervisor.profile.user_id,
    decision_note: 'P0 E2E 指定直屬課室主管',
  }, sysadminToken);
  const applicantRows = await rest(`/users?user_id=eq.${encodeURIComponent(approved.data.user_id)}&select=user_id,auth_id,username,name,role,rbac_role,dept_id,supervisor_id,status&limit=1`, { key: SERVICE_KEY, token: SERVICE_KEY });
  const applicantProfile = applicantRows[0];
  if (!applicantProfile || applicantProfile.supervisor_id !== supervisor.profile.user_id) throw new Error('核准後一般使用者未綁定指定直屬主管');
  // admin-api 依安全設計只寄送啟用連結；測試帳號改成已知密碼，不影響正式帳號。
  const applicantPassword = `P0Vehicle!${randomUUID().replaceAll('-', '').slice(0, 18)}a1`;
  await authAdmin(`/users/${applicantProfile.auth_id}`, { method: 'PUT', body: { password: applicantPassword, email_confirm: true } });
  return { sysadmin, supervisor, dispatcher, driver, applicant: { email: applicantEmail, password: applicantPassword, profile: applicantProfile }, vehicle, applicationId };
}

function assert(condition, message) {
  if (!condition) throw new Error(`P0 派車 E2E 驗證失敗：${message}`);
}

async function readVehicleFlow(requestId) {
  const [rows, logs] = await Promise.all([
    rest(`/vehicle_dispatch_requests?request_id=eq.${requestId}&select=request_id,request_no,status,applicant_id,supervisor_id,vehicle_manager_id,vehicle_id,driver_id,driver_accepted_at,driver_accepted_by&limit=1`, { key: SERVICE_KEY, token: SERVICE_KEY }),
    rest(`/vehicle_dispatch_logs?request_id=eq.${requestId}&select=from_status,to_status,action,operator_id&order=created_at.asc`, { key: SERVICE_KEY, token: SERVICE_KEY }),
  ]);
  return { request: rows[0] || null, logs };
}

async function vehicleAction(token, requestId, action, extra = {}) {
  const data = await rest('/rpc/vehicle_request_action', {
    method: 'POST', token,
    body: { p_request_id: requestId, p_action: action, p_note: extra.note || null, p_vehicle_id: extra.vehicleId || null, p_driver_id: extra.driverId || null },
  });
  return data;
}

const fixture = BOOTSTRAP ? await createBootstrapFixture() : null;
if (!fixture) throw new Error('目前 P0 派車驗收需要 SUPABASE_E2E_BOOTSTRAP=1，以確保四種角色彼此分離');

let requestId = '';
const result = { ok: false, bootstrap: true, roleSeparated: true, accountApplicationId: fixture.applicationId, stages: [], negativeGuard: false };

try {
  const applicantToken = await signIn(fixture.applicant.email, fixture.applicant.password);
  const supervisorToken = await signIn(fixture.supervisor.email, fixture.supervisor.password);
  const dispatcherToken = await signIn(fixture.dispatcher.email, fixture.dispatcher.password);
  const driverToken = await signIn(fixture.driver.email, fixture.driver.password);

  // 先確認派車管理員不能越權代替單位主管核可。
  const created = await invokeFunction('app-api', {
    action: 'vehicle_create_request',
    trip_date: new Date(Date.now() + 86400000 + 8 * 3600000).toISOString().slice(0, 10),
    planned_departure_time: '09:00', planned_return_time: '10:00',
    origin_location: '第一果菜市場', destination_location: 'P0 驗收目的地',
    trip_purpose: 'P0 帳號申請與派車階層驗收', passenger_count: 1,
    applicant_phone: '0900000000', applicant_note: 'P0 E2E，保留流程歷程',
  }, applicantToken);
  requestId = created.data.request_id;
  assert(requestId, '一般使用者未能建立派車申請');
  result.stages.push({ action: 'account_application_approved', status: 'active', supervisor_id: fixture.applicant.profile.supervisor_id });
  result.stages.push({ action: 'vehicle_create_request', status: 'pending_approval' });

  // app-api 沒有越權核可 action；直接以 RPC 驗證資料庫 guard。
  try {
    await vehicleAction(dispatcherToken, requestId, 'approve', { note: '不應由派車管理員核可' });
    throw new Error('派車管理員不應能代替單位主管核可');
  } catch (error) {
    assert(/沒有異動|核可權限|unit|主管|42501|目前角色/u.test(String(error.message)), `越權核可未被阻擋：${error.message}`);
    result.negativeGuard = true;
  }

  await vehicleAction(supervisorToken, requestId, 'approve', { note: 'P0 單位主管核可' });
  let state = await readVehicleFlow(requestId);
  assert(state.request?.status === 'approved', `主管核可後狀態應為 approved，實際為 ${state.request?.status}`);
  assert(state.request?.supervisor_id === fixture.supervisor.profile.user_id, '核可主管不是申請人直屬主管');
  result.stages.push({ action: 'supervisor_approve', status: state.request.status, operator_id: state.request.supervisor_id });

  await vehicleAction(dispatcherToken, requestId, 'dispatch', { vehicleId: fixture.vehicle.vehicle_id, driverId: fixture.driver.profile.user_id, note: 'P0 派車管理員派車' });
  state = await readVehicleFlow(requestId);
  assert(state.request?.status === 'assigned', `派車後狀態應為 assigned，實際為 ${state.request?.status}`);
  assert(state.request?.vehicle_manager_id === fixture.dispatcher.profile.user_id, '派車管理員紀錄不一致');
  assert(state.request?.driver_id === fixture.driver.profile.user_id, '指定駕駛不一致');
  result.stages.push({ action: 'dispatcher_assign', status: state.request.status, operator_id: state.request.vehicle_manager_id, driver_id: state.request.driver_id });

  await vehicleAction(driverToken, requestId, 'accept', { note: 'P0 駕駛接單' });
  state = await readVehicleFlow(requestId);
  assert(state.request?.status === 'assigned', '駕駛接單不應改變派車狀態');
  assert(state.request?.driver_accepted_at && state.request?.driver_accepted_by === fixture.driver.profile.user_id, '駕駛接單欄位未正確寫入');
  result.stages.push({ action: 'driver_accept', status: state.request.status, operator_id: state.request.driver_accepted_by });
  const actions = state.logs.map((row) => row.action);
  for (const expected of ['單位主管核可', '派車管理員完成派車', '司機接單']) assert(actions.includes(expected), `流程歷程缺少「${expected}」`);
  result.requestId = requestId;
  result.logCount = state.logs.length;
  result.finalStatus = state.request.status;
  result.ok = true;
  console.log(JSON.stringify(result, null, 2));
} finally {
  // 保留派車申請與派車紀錄；只停用測試主檔，避免測試人員出現在正式名單。
  if (fixture) {
    await rest(`/vehicle_dispatch_managers?user_id=eq.${fixture.dispatcher.profile.user_id}`, { key: SERVICE_KEY, token: SERVICE_KEY, method: 'PATCH', body: { active: false } }).catch(() => undefined);
    await rest(`/vehicle_dispatch_drivers?user_id=eq.${fixture.driver.profile.user_id}`, { key: SERVICE_KEY, token: SERVICE_KEY, method: 'PATCH', body: { active: false } }).catch(() => undefined);
    await rest(`/official_vehicles?vehicle_id=eq.${fixture.vehicle.vehicle_id}`, { key: SERVICE_KEY, token: SERVICE_KEY, method: 'PATCH', body: { status: 'inactive' } }).catch(() => undefined);
    const people = [fixture.applicant, fixture.dispatcher, fixture.driver, fixture.supervisor, fixture.sysadmin];
    for (const person of people) {
      await rest(`/users?user_id=eq.${person.profile.user_id}`, { key: SERVICE_KEY, token: SERVICE_KEY, method: 'PATCH', body: { status: 'inactive', hidden: true } }).catch(() => undefined);
      await authAdmin(`/users/${person.profile.auth_id}`, { method: 'PUT', body: { ban_duration: '876000h' } }).catch(() => undefined);
    }
  }
}
