import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Exercise the actual admin handler without sending a LINE message.
const output = await build({
  entryPoints: ['supabase/functions/admin-api/index.ts'], bundle: true, write: false,
  platform: 'node', format: 'esm',
  plugins: [{ name: 'services', setup(builder) {
    builder.onResolve({ filter: /^https:|security-monitor\.ts$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.startsWith('https:')
      ? 'export const createClient=()=>globalThis.lineTestDb;'
      : 'export const enforceDurableRateLimit=async()=>({allowed:true});export const recordRateLimitDenial=async()=>{};export const securityRequestId=()=>"test";' }));
  } }],
});
process.env.SUPABASE_URL = 'https://fixture.invalid';
process.env.SUPABASE_ANON_KEY = 'fixture';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture';
const { handleAdminApiRequest } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

let profile = { user_id: 'admin', auth_id: 'auth', rbac_role: 'sysadmin', role: 'admin', status: 'active' };
const audits = [];
let fetchCount = 0;
let upstream = new Response(JSON.stringify({ ok: true }), { status: 200 });
globalThis.lineTestDb = {
  auth: { getUser: async () => ({ data: { user: { id: 'auth' } }, error: null }) },
  from(table) {
    const query = {
      select() { return query; }, eq() { return query; },
      maybeSingle: async () => ({ data: table === 'users' ? profile : null, error: null }),
      insert(changes) { audits.push(changes); return Promise.resolve({ error: null }); },
    };
    return query;
  },
};
globalThis.fetch = async (url, options) => {
  fetchCount++;
  assert.equal(url, 'https://fixture.invalid/functions/v1/line-notify');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer user-jwt');
  assert.deepEqual(JSON.parse(options.body), { test: true });
  assert.ok(options.signal instanceof AbortSignal, '通知請求必須設逾時');
  return upstream;
};
async function call(token = true) {
  const response = await handleAdminApiRequest(new Request('https://fixture.invalid/admin-api', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer user-jwt' } : {}) },
    body: JSON.stringify({ action: 'admin_test_line_notification' }),
  }));
  return { status: response.status, body: await response.json() };
}
assert.equal((await call(false)).status, 401);
assert.equal(fetchCount, 0);
profile = { ...profile, role: 'reporter', rbac_role: 'reporter' };
assert.equal((await call()).status, 403);
assert.equal(fetchCount, 0);
profile = { ...profile, role: 'admin', rbac_role: 'sysadmin' };
assert.deepEqual(await call(), { status: 200, body: { ok: true, message: 'LINE 測試訊息已送出' } });
assert.equal(audits.at(-1).changes.result, '送出');

for (const [status, result, expected] of [
  [200, { ok: false, msg: 'LINE not configured' }, /尚未設定/],
  [502, { ok: false, msg: 'LINE delivery failed' }, /LINE 平台拒絕推播/],
  [401, { ok: false, msg: 'Unauthorized' }, /未能完成推播/],
]) {
  upstream = new Response(JSON.stringify(result), { status });
  const response = await call();
  assert.equal(response.status, 502);
  assert.match(response.body.message, expected);
  assert.equal(audits.at(-1).changes.result, '失敗');
  assert.equal(audits.at(-1).changes.http_status, status);
}
upstream = new Response('invalid', { status: 200 });
assert.equal((await call()).status, 502);
const originalFetch = globalThis.fetch;
const originalError = console.error;
try {
  globalThis.fetch = async () => { throw new Error('private-token'); };
  console.error = () => {};
  const response = await call();
  assert.equal(response.status, 502);
  assert.doesNotMatch(response.body.message, /private-token/);
  assert.equal(audits.at(-1).changes.reason, '通知服務連線異常');
} finally {
  globalThis.fetch = originalFetch;
  console.error = originalError;
}
assert.ok(!JSON.stringify(audits).includes('user-jwt'), 'Audit must not store the user JWT');
console.log('LINE 測試推播檢查通過：管理員權限、既有通知服務、成功／設定缺漏／投遞失敗與稽核。');
