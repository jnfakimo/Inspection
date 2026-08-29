/*
 * P0 公文傳送流程跨角色端到端測試。
 *
 * 執行時需要：
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_E2E_BOOTSTRAP=1
 *
 * 角色彼此分離，各自有獨立的 Auth 帳號與部室：
 *   公文管理人員（原申請人）  企劃部          permissions.official_document_manager
 *   承辦人員                  企劃推廣課      驗證第二階單位／人員連動
 *   會辦收發                  業務部          收文 → 完成會辦
 *   陳核／核決                秘書室          簽收 → 核決／退回
 *   他部室人員                財務部          越權防護的對照組
 *
 * 驗收範圍對應 Obsidian/05-待辦清單.md 的唯一未結 P0：
 *   建立／送出 → 會辦收發 → 陳核／核決 → 原申請人收訖、退回補正、
 *   條碼查詢、不可刪除時間軸，以及每一段的越權防護。
 *
 * 測試資料以 hidden=true 建立、主旨標註「驗收測試（勿使用）」；
 * 結束後測試帳號改為 inactive，公文與事件依正式資料保護規則保留不刪。
 */

import { randomUUID } from 'node:crypto';

const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/u, '');
const ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '');
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const BOOTSTRAP = process.env.SUPABASE_E2E_BOOTSTRAP === '1';

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  throw new Error('需要 SUPABASE_URL、SUPABASE_ANON_KEY、SUPABASE_SERVICE_ROLE_KEY');
}
if (!BOOTSTRAP) {
  throw new Error('P0 公文驗收需要 SUPABASE_E2E_BOOTSTRAP=1，以確保五種角色彼此分離');
}

// 這些是正式組織表既有的一階／二階單位，公文的會辦與陳核資格由單位代碼決定
// （見 app-api 的 officialDocumentUnitCapabilities：BOARD／GM／VGM／SECRE 可陳核，
// 其中只有 SECRE 同時可會辦）。
const DEPT = {
  plan: '89108533-7d50-44ef-8d9e-f6607f3bf89b',      // 企劃部（一階，可會辦）
  planPromo: '6c882750-dae4-47b0-abbf-647cf9dff6ee', // 企劃推廣課（企劃部的二階）
  biz: '34e89bc2-0aa1-48d5-9fde-77a787952c82',       // 業務部（一階，可會辦）
  secretary: 'ae8a29c7-56f7-4b6d-a927-395e9cd6aaed', // 秘書室（可陳核，也可會辦）
  finance: 'f5d7574a-5f49-4c84-b781-d1bc68c090cc',   // 財務部（越權對照組）
};

const headers = (key, token, extra = {}) => ({
  apikey: key,
  Authorization: `Bearer ${token || key}`,
  ...extra,
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// official_document_create／official_document_action 在 app-api 屬於 admin-api:write
// 限流範圍（_shared/security-monitor.ts：每位操作者 60 秒 10 次），而且限流是在
// 權限判斷「之前」計數，連被擋下的越權測試也算一次。測試會在數秒內連打數十次，
// 因此在客戶端先照同一條規則自我節流，429 退避只當最後的保險。
const WRITE_ACTIONS = new Set(['official_document_create', 'official_document_action']);
const WRITE_WINDOW_MS = 60_000;
const WRITE_MAX_PER_WINDOW = 9;
const writeHistory = new Map();

async function throttleWrite(token, action) {
  if (!WRITE_ACTIONS.has(action)) return;
  for (;;) {
    const now = Date.now();
    const stamps = (writeHistory.get(token) || []).filter(stamp => now - stamp < WRITE_WINDOW_MS);
    if (stamps.length < WRITE_MAX_PER_WINDOW) {
      stamps.push(now);
      writeHistory.set(token, stamps);
      return;
    }
    writeHistory.set(token, stamps);
    await sleep(WRITE_WINDOW_MS - (now - stamps[0]) + 500);
  }
}

// 只對 429（限流）與 502/503/504（Edge Function 冷啟動或平台暫時性錯誤）退避重試，
// 其他錯誤一律照原樣拋出，才不會掩蓋真正的流程缺陷。
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);
const RATE_LIMIT_RETRIES = 4;
const rateLimitBackoff = attempt => [5_000, 15_000, 35_000, 65_000][attempt] ?? 65_000;

async function request(path, { key = ANON_KEY, token, method = 'GET', body, prefer } = {}) {
  for (let attempt = 0; ; attempt += 1) {
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
    if (response.ok) return payload;
    if (TRANSIENT_STATUSES.has(response.status) && attempt < RATE_LIMIT_RETRIES) {
      await sleep(rateLimitBackoff(attempt));
      continue;
    }
    const message = typeof payload === 'object' && payload
      ? payload.message || payload.error_description || payload.error || JSON.stringify(payload)
      : String(payload || response.statusText);
    const error = new Error(`${method} ${path} [${response.status}] ${message}`);
    error.status = response.status;
    throw error;
  }
}

const authAdmin = (path, options = {}) => request(`/auth/v1/admin${path}`, { ...options, key: SERVICE_KEY, token: SERVICE_KEY });
const rest = (path, options = {}) => request(`/rest/v1${path}`, options);
const service = (path, options = {}) => rest(path, { ...options, key: SERVICE_KEY, token: SERVICE_KEY });

// 收文角色刻意放在業務部的子單位，驗證流程節點雖記錄根部門，
// 子單位人員仍能看到通知並完成收文／會辦。
const businessChildRows = await service('/departments?code=eq.BIZ-TRADE&select=dept_id,parent_id&limit=1');
const businessChild = businessChildRows.find(row => String(row.parent_id || '') === DEPT.biz);
const CO_SIGN_DEPT = String(businessChild?.dept_id || DEPT.biz);

async function signIn(email, password) {
  const session = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  if (!session.access_token) throw new Error('P0 公文測試登入沒有取得 access token');
  return session.access_token;
}

/** 呼叫 app-api；ok !== true 視為失敗。 */
async function appApi(token, body) {
  await throttleWrite(token, String(body?.action || ''));
  const result = await request('/functions/v1/app-api', { token, method: 'POST', body });
  if (!result || result.ok !== true) throw new Error(`app-api 失敗：${result?.message || '未知錯誤'}`);
  return result;
}

/** 呼叫 app-api 但預期被擋下；回傳擋下的原因供驗證。 */
async function expectDenied(token, body, { label, status }) {
  let payload = null;
  let httpStatus = 0;
  await throttleWrite(token, String(body?.action || ''));
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/app-api`, {
        method: 'POST',
        headers: headers(ANON_KEY, token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      httpStatus = response.status;
      payload = await response.json().catch(() => null);
    } catch (error) {
      throw new Error(`${label}：越權測試連線失敗 ${String(error.message || error)}`);
    }
    // 429／5xx 是限流或平台暫時性錯誤，不是權限判斷；重試才不會把它誤當成「已被擋下」。
    if (!TRANSIENT_STATUSES.has(httpStatus) || attempt >= RATE_LIMIT_RETRIES) break;
    await sleep(rateLimitBackoff(attempt));
  }
  if (payload?.ok === true) throw new Error(`${label}：預期被拒絕，實際卻成功`);
  if (status && httpStatus !== status) throw new Error(`${label}：預期 HTTP ${status}，實際 ${httpStatus}（${payload?.message || ''}）`);
  return { status: httpStatus, message: String(payload?.message || '') };
}

function assert(condition, message) {
  if (!condition) throw new Error(`P0 公文 E2E 驗證失敗：${message}`);
}

const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const created = { authUsers: [], profiles: [], documents: [] };

async function createProfile({ label, emailLabel, usernamePrefix, deptId = null, permissions = {}, rbacRole = 'reporter', role = 'inspector', supervisorId = null }) {
  const email = `p0-officialdoc-${emailLabel}-${suffix}@example.invalid`;
  const password = `P0Doc!${randomUUID().replaceAll('-', '').slice(0, 18)}a1`;
  const authUser = await authAdmin('/users', {
    method: 'POST',
    body: { email, password, email_confirm: true, user_metadata: { purpose: 'p0-officialdoc-e2e' } },
  });
  created.authUsers.push(authUser.id);
  const profile = (await service('/users', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      auth_id: authUser.id,
      name: `驗收測試（勿使用）公文 ${label}`,
      username: `p0doc_${usernamePrefix}_${suffix.replaceAll('-', '_')}`,
      email,
      role,
      rbac_role: rbacRole,
      dept_id: deptId,
      status: 'active',
      hidden: true,
      supervisor_id: supervisorId,
      permissions,
    },
  }))[0];
  created.profiles.push(profile.user_id);
  return { email, password, profile, token: await signIn(email, password) };
}

/** 讀取公文目前狀態、流程節點與事件軸。 */
async function readDocument(documentId) {
  const [documents, steps, events] = await Promise.all([
    service(`/official_documents?document_id=eq.${documentId}&select=document_id,document_no,document_type,subject,status,originator_id,originator_dept_id,responsible_dept_id,responsible_user_id,current_step_id,barcode_value,closed_at&limit=1`),
    service(`/official_document_steps?document_id=eq.${documentId}&select=step_id,step_no,step_type,unit_id,unit_name,status,received_by,completed_by&order=step_no.asc`),
    service(`/official_document_events?document_id=eq.${documentId}&select=event_id,action,from_status,to_status,actor_id,occurred_at&order=occurred_at.asc`),
  ]);
  return { document: documents[0] || null, steps, events };
}

const docAction = (token, documentId, documentAction, extra = {}) => appApi(token, {
  action: 'official_document_action',
  document_id: documentId,
  document_action: documentAction,
  ...extra,
});

const stages = [];
const record = (name, detail) => { stages.push({ name, detail }); console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); };

// ---------------------------------------------------------------- 建立角色

console.log('■ 建立五個彼此分離的測試角色');
// guard_user_supervisor_hierarchy 要求啟用中的一般人員必須掛直屬主管，且主管須同單位；
// 系統管理員身分的主管不受同單位限制，公文流程本身完全不讀 supervisor_id，
// 因此以一個測試用系統管理員當五個角色的共同直屬主管，不影響驗收語意。
const fixtureSupervisor = await createProfile({
  label: '固定裝置主管', emailLabel: 'sup', usernamePrefix: 'sup',
  rbacRole: 'sysadmin', role: 'admin',
});
const asStaff = deptId => ({ deptId, supervisorId: fixtureSupervisor.profile.user_id });

const manager = await createProfile({
  label: '公文管理人員', emailLabel: 'manager', usernamePrefix: 'mgr',
  ...asStaff(DEPT.plan), permissions: { official_document_manager: true },
});
const responsible = await createProfile({ label: '承辦人員', emailLabel: 'staff', usernamePrefix: 'staff', ...asStaff(DEPT.planPromo) });
const coSigner = await createProfile({ label: '會辦收發', emailLabel: 'cosign', usernamePrefix: 'cos', ...asStaff(CO_SIGN_DEPT) });
const approver = await createProfile({ label: '陳核核決', emailLabel: 'approver', usernamePrefix: 'apv', ...asStaff(DEPT.secretary) });
const outsider = await createProfile({ label: '他部室人員', emailLabel: 'outsider', usernamePrefix: 'out', ...asStaff(DEPT.finance) });
record('五個角色建立完成', `企劃部／企劃推廣課／業務部${businessChild ? '（貿易課收文）' : ''}／秘書室／財務部各一人`);

let exitCode = 0;
try {
  // ------------------------------------------------------- 流程 A：核決結案

  console.log('\n■ 流程 A：建立 → 會辦 → 陳核 → 核決 → 原申請人收訖');

  await expectDenied(coSigner.token, {
    action: 'official_document_create', subject: '驗收測試（勿使用）越權建立', responsible_dept_id: DEPT.biz,
  }, { label: '非公文管理人員建立公文', status: 403 });
  record('越權防護：非公文管理人員不能建立公文', 'HTTP 403');

  await expectDenied(manager.token, {
    action: 'official_document_create',
    subject: '驗收測試（勿使用）承辦人不符',
    responsible_dept_id: DEPT.planPromo,
    responsible_user_id: coSigner.profile.user_id,
  }, { label: '承辦人員不屬於所選第二階單位', status: 400 });
  record('連動驗證：承辦人員必須屬於所選第二階單位', 'HTTP 400');

  await expectDenied(manager.token, {
    action: 'official_document_create',
    subject: '驗收測試（勿使用）跨一階單位',
    responsible_dept_id: DEPT.finance,
    responsible_user_id: outsider.profile.user_id,
  }, { label: '第二階單位必須在登入者第一階單位底下', status: 403 });
  record('連動驗證：只能選登入者第一階單位下的第二階單位', 'HTTP 403');

  const createdDoc = await appApi(manager.token, {
    action: 'official_document_create',
    subject: '驗收測試（勿使用）P0 公文跨角色端到端',
    document_type: 'official_document',
    responsible_dept_id: DEPT.planPromo,
    responsible_user_id: responsible.profile.user_id,
  });
  const documentId = String(createdDoc.data.document_id);
  created.documents.push(documentId);
  const documentNo = String(createdDoc.data.document_no);
  assert(/^\d{11}$/.test(documentNo), `文號格式不是民國年三碼＋月日四碼＋流水四碼：${documentNo}`);
  const rocToday = (() => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).filter(part => part.type !== 'literal');
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${String(Number(map.year) - 1911).padStart(3, '0')}${map.month}${map.day}`;
  })();
  assert(documentNo.startsWith(rocToday), `文號日期段不是今天的民國日期：${documentNo} 應以 ${rocToday} 開頭`);
  assert(String(createdDoc.data.barcode_value) === documentNo, '條碼值必須與文號一致');
  record('公文建立', `文號 ${documentNo}（民國 ${rocToday.slice(0, 3)} 年 ${rocToday.slice(3, 5)}/${rocToday.slice(5)}）`);

  await expectDenied(coSigner.token, {
    action: 'official_document_action', document_id: documentId, document_action: 'send_co_sign', target_unit_id: DEPT.biz,
  }, { label: '非管理人員送出會辦', status: 403 });
  record('越權防護：非公文管理人員不能送出會辦', 'HTTP 403');

  await docAction(manager.token, documentId, 'send_co_sign', { target_unit_id: DEPT.biz, note: '請業務部會辦' });
  let state = await readDocument(documentId);
  assert(state.document.status === 'awaiting_co_sign', `送出會辦後狀態應為 awaiting_co_sign，實際 ${state.document.status}`);
  assert(state.steps.length === 1 && state.steps[0].step_type === 'co_sign', '應建立一個會辦節點');
  const coSignNotifications = await service(`/official_document_notifications?document_id=eq.${documentId}&step_id=eq.${state.steps[0].step_id}&recipient_id=eq.${coSigner.profile.user_id}&select=notification_id&limit=1`);
  assert(coSignNotifications.length === 1, '會辦通知應送達根部門下的子單位收文人員');
  record('公文管理人員送出會辦', `→ 業務部（狀態 ${state.document.status}）`);

  await expectDenied(outsider.token, {
    action: 'official_document_action', document_id: documentId, document_action: 'receive',
  }, { label: '他部室人員收文', status: 403 });
  record('越權防護：非收文部室人員不能收文', 'HTTP 403');

  await expectDenied(coSigner.token, {
    action: 'official_document_action', document_id: documentId, document_action: 'co_sign_complete',
  }, { label: '未收文即完成會辦', status: 409 });
  record('順序防護：未收文不能直接完成會辦', 'HTTP 409');

  await docAction(coSigner.token, documentId, 'receive');
  state = await readDocument(documentId);
  assert(state.steps[0].status === 'received', '收文後節點狀態應為 received');
  assert(String(state.steps[0].received_by) === String(coSigner.profile.user_id), '收文者應記錄為會辦收發本人');
  record('會辦部室收文', '業務部節點 sent → received');

  await expectDenied(manager.token, {
    action: 'official_document_action', document_id: documentId, document_action: 'send_approval', target_unit_id: DEPT.secretary,
  }, { label: '會辦未完成即送陳核', status: 409 });
  record('順序防護：會辦未完成不能送出陳核', 'HTTP 409');

  await docAction(coSigner.token, documentId, 'co_sign_complete', { note: '業務部會辦完成' });
  state = await readDocument(documentId);
  assert(state.document.status === 'ready_for_next', `完成會辦後狀態應為 ready_for_next，實際 ${state.document.status}`);
  record('會辦完成', `狀態 → ${state.document.status}`);

  await expectDenied(manager.token, {
    action: 'official_document_action', document_id: documentId, document_action: 'send_approval', target_unit_id: DEPT.biz,
  }, { label: '陳核送到不可陳核的部室', status: 400 });
  record('資格防護：陳核只能送董事長室／總經理室／副總經理室／秘書室', 'HTTP 400');

  await docAction(manager.token, documentId, 'send_approval', { target_unit_id: DEPT.secretary, note: '陳請核決' });
  state = await readDocument(documentId);
  assert(state.document.status === 'awaiting_approval', `送出陳核後狀態應為 awaiting_approval，實際 ${state.document.status}`);
  assert(state.steps.length === 2 && state.steps[1].step_type === 'approval', '應建立第二個陳核節點');
  record('送出陳核', '→ 秘書室（狀態 awaiting_approval）');

  await expectDenied(approver.token, {
    action: 'official_document_action', document_id: documentId, document_action: 'approve',
  }, { label: '未簽收即核決', status: 409 });
  record('順序防護：未簽收不能核決', 'HTTP 409');

  await expectDenied(outsider.token, {
    action: 'official_document_action', document_id: documentId, document_action: 'approval_receive',
  }, { label: '他部室人員簽收陳核', status: 403 });
  record('越權防護：非陳核部室人員不能簽收', 'HTTP 403');

  await docAction(approver.token, documentId, 'approval_receive');
  record('陳核部室簽收', '秘書室節點 sent → received');

  await expectDenied(manager.token, {
    action: 'official_document_action', document_id: documentId, document_action: 'originator_receive',
  }, { label: '尚未核決即由原申請人收訖', status: 409 });
  record('順序防護：尚未核決不能收訖', 'HTTP 409');

  await docAction(approver.token, documentId, 'approve', { note: '核決同意' });
  state = await readDocument(documentId);
  assert(state.document.status === 'awaiting_originator', `核決後狀態應為 awaiting_originator，實際 ${state.document.status}`);
  record('核決', `狀態 → ${state.document.status}`);

  await expectDenied(coSigner.token, {
    action: 'official_document_action', document_id: documentId, document_action: 'originator_receive',
  }, { label: '非原申請人收訖', status: 403 });
  record('越權防護：只有原申請人可以收訖', 'HTTP 403');

  const closeKey = `p0-doc-close-${suffix}`;
  await docAction(manager.token, documentId, 'originator_receive', { idempotency_key: closeKey });
  state = await readDocument(documentId);
  assert(state.document.status === 'closed', `收訖後狀態應為 closed，實際 ${state.document.status}`);
  assert(state.document.closed_at, '結案時間 closed_at 應寫入');
  record('原申請人收訖結案', `狀態 → closed（${state.document.closed_at}）`);

  const duplicate = await docAction(manager.token, documentId, 'originator_receive', { idempotency_key: closeKey });
  assert(duplicate.data?.duplicate === true, '重複送出相同 idempotency_key 應回報 duplicate');
  record('冪等防護：重複送出同一動作不會產生第二筆事件', 'duplicate=true');

  // 事件軸完整性
  const timeline = state.events.map(event => String(event.action));
  const expectedTimeline = ['create', 'barcode_generated', 'send_co_sign', 'receive', 'co_sign_complete', 'send_approval', 'approval_receive', 'approve', 'originator_receive'];
  assert(
    expectedTimeline.every(action => timeline.includes(action)),
    `事件軸缺少節點：期望包含 ${expectedTimeline.join('、')}，實際 ${timeline.join('、')}`,
  );
  record('事件軸完整', timeline.join(' → '));

  // ---------------------------------------------------- 條碼查詢與不可刪除

  console.log('\n■ 條碼查詢與時間軸不可刪除');
  const byBarcode = await service(`/official_documents?barcode_value=eq.${encodeURIComponent(documentNo)}&select=document_id,document_no,subject,status&limit=2`);
  assert(byBarcode.length === 1 && String(byBarcode[0].document_id) === documentId, '以條碼值查詢應唯一命中這筆公文');
  record('條碼查詢', `${documentNo} → 唯一命中`);

  const eventId = String(state.events[0].event_id);
  let deleteBlocked = '';
  try {
    await service(`/official_document_events?event_id=eq.${eventId}`, { method: 'DELETE', prefer: 'return=minimal' });
  } catch (error) { deleteBlocked = String(error.message || error); }
  assert(deleteBlocked.includes('公文流程事件不可修改或移除'), `事件刪除應被觸發器擋下，實際：${deleteBlocked || '沒有被擋'}`);
  record('時間軸不可刪除', '服務角色 DELETE 亦被 trg_official_document_events_immutable 擋下');

  let updateBlocked = '';
  try {
    await service(`/official_document_events?event_id=eq.${eventId}`, { method: 'PATCH', prefer: 'return=minimal', body: { note: '竄改測試' } });
  } catch (error) { updateBlocked = String(error.message || error); }
  assert(updateBlocked.includes('公文流程事件不可修改或移除'), `事件修改應被觸發器擋下，實際：${updateBlocked || '沒有被擋'}`);
  record('時間軸不可竄改', '服務角色 UPDATE 亦被擋下');

  // -------------------------------------------------- 流程 B：退回與補正

  console.log('\n■ 流程 B：陳核退回 → 原申請人補正重送 → 再核決結案');
  const secondDoc = await appApi(manager.token, {
    action: 'official_document_create',
    subject: '驗收測試（勿使用）P0 公文退回補正',
    document_type: 'purchase_order',
    responsible_dept_id: DEPT.planPromo,
    responsible_user_id: responsible.profile.user_id,
  });
  const returnDocId = String(secondDoc.data.document_id);
  created.documents.push(returnDocId);
  assert(String(secondDoc.data.document_no) !== documentNo, '同日第二筆公文的文號流水號必須遞增');
  record('第二筆公文建立', `文號 ${secondDoc.data.document_no}（文件類別 purchase_order）`);

  await docAction(manager.token, returnDocId, 'send_approval', { target_unit_id: DEPT.secretary, note: '直接陳核' });
  await docAction(approver.token, returnDocId, 'approval_receive');
  await docAction(approver.token, returnDocId, 'return', { note: '退回補正：請補附估價單' });
  let returnState = await readDocument(returnDocId);
  assert(returnState.document.status === 'returned', `退回後狀態應為 returned，實際 ${returnState.document.status}`);
  assert(returnState.steps.at(-1).status === 'returned', '退回時陳核節點狀態應為 returned');
  record('陳核退回', '狀態 → returned');

  await expectDenied(coSigner.token, {
    action: 'official_document_action', document_id: returnDocId, document_action: 'resubmit',
  }, { label: '非原申請人補正重送', status: 403 });
  record('越權防護：只有原申請人可以補正重送', 'HTTP 403');

  await docAction(manager.token, returnDocId, 'resubmit', { note: '已補附估價單' });
  returnState = await readDocument(returnDocId);
  assert(returnState.document.status === 'draft', `補正重送後狀態應回到 draft，實際 ${returnState.document.status}`);
  assert(!returnState.document.current_step_id, '補正重送後應清空目前流程節點');
  record('原申請人補正重送', '狀態 → draft');

  await docAction(manager.token, returnDocId, 'send_approval', { target_unit_id: DEPT.secretary, note: '補正後重新陳核' });
  await docAction(approver.token, returnDocId, 'approval_receive');
  await docAction(approver.token, returnDocId, 'approve', { note: '補正後核決同意' });
  await docAction(manager.token, returnDocId, 'originator_receive');
  returnState = await readDocument(returnDocId);
  assert(returnState.document.status === 'closed', `補正後應可結案，實際 ${returnState.document.status}`);
  const returnTimeline = returnState.events.map(event => String(event.action));
  assert(returnTimeline.includes('return') && returnTimeline.includes('resubmit'), '退回與補正事件都必須留在時間軸上');
  record('補正後重新核決結案', returnTimeline.join(' → '));

  console.log(`\n✅ P0 公文傳送流程跨角色端到端驗收通過（${stages.length} 項）`);
  console.log(JSON.stringify({
    ok: true,
    documents: created.documents,
    documentNos: [documentNo, String(secondDoc.data.document_no)],
    stages: stages.map(stage => stage.name),
  }, null, 2));
} catch (error) {
  exitCode = 1;
  console.error(`\n❌ ${String(error.message || error)}`);
} finally {
  // 正式資料保護：帳號只停用不刪除，公文與事件一律保留。
  // 必須由後建立的往回停用：guard_user_supervisor_hierarchy 不允許人員的直屬主管
  // 是停用帳號，先停用共同主管會讓其餘四個角色全部改不動。
  for (const userId of [...created.profiles].reverse()) {
    try {
      // 一併清掉 supervisor_id：主管一旦先被停用，guard_user_supervisor_hierarchy
      // 會擋下「直屬主管必須是啟用中的帳號」，剩下的角色就再也停用不掉。
      await service(`/users?user_id=eq.${userId}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'inactive', supervisor_id: null } });
    } catch (error) { console.warn(`停用測試帳號失敗 ${userId}：${String(error.message || error)}`); }
  }
  for (const authId of created.authUsers) {
    try {
      await authAdmin(`/users/${authId}`, { method: 'PUT', body: { ban_duration: '876000h' } });
    } catch (error) { console.warn(`停用 Auth 帳號失敗 ${authId}：${String(error.message || error)}`); }
  }
  console.log(`\n測試帳號已停用（${created.profiles.length} 個），公文 ${created.documents.length} 筆依資料保護規則保留。`);
}

process.exit(exitCode);
