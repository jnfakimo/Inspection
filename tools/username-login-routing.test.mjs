import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`;
const originSource = await readFile(new URL('../web/lib/backend-origin.ts', import.meta.url), 'utf8');
const configSource = await readFile(new URL('../web/lib/config.ts', import.meta.url), 'utf8');
const loginSource = await readFile(new URL('../web/lib/username-login.ts', import.meta.url), 'utf8');

test('development uses existing cloud Supabase despite stale settings; production IP deployments stay same-origin', async () => {
  const savedWindow = globalThis.window;
  const savedFetch = globalThis.fetch;
  try {
    for (const development of [true, false]) {
      for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://192.168.50.192:5057']) {
        globalThis.window = { location: new URL(origin), setTimeout, clearTimeout };
        const configUrl = moduleUrl(configSource
          .replace("'./backend-origin'", JSON.stringify(moduleUrl(originSource)))
          .replaceAll('process.env.NODE_ENV', JSON.stringify(development ? 'development' : 'production'))
          .replaceAll('process.env.NEXT_PUBLIC_SUPABASE_URL', JSON.stringify('https://configured.supabase.co'))
          .replaceAll('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY', JSON.stringify('configured-public-key')));
        const config = await import(configUrl + `#${origin}`);
        assert.equal(config.SUPABASE_URL, development ? 'https://qztffronusdhgxhjjubt.supabase.co' : origin);
        assert.equal(config.SUPABASE_ANON_KEY === 'configured-public-key', !development);
        let edgeCalls = 0;
        let sameOriginCalls = 0;
        globalThis.fetch = async url => {
          sameOriginCalls++;
          assert.equal(url, `${config.SUPABASE_URL}/functions/v1/username-login`);
          return Response.json({ challenge_id: 'test' });
        };
        const loginUrl = moduleUrl(loginSource
          .replace("import { getSupabase } from './supabase';", `const getSupabase = () => ({ functions: { invoke: async () => { globalThis.__loginEdgeCall(); return { data: { challenge_id: 'test' }, error: null }; } } });`)
          .replace("'./config'", JSON.stringify(configUrl + `#${origin}`)));
        globalThis.__loginEdgeCall = () => { edgeCalls++; };
        const { invokeUsernameLogin } = await import(loginUrl);
        assert.deepEqual(await invokeUsernameLogin({ action: 'captcha' }, '失敗'), { challenge_id: 'test' });
        assert.equal(edgeCalls, 0, 'captcha must not wait for the Auth client');
        assert.equal(sameOriginCalls, 1);
        edgeCalls = 0; sameOriginCalls = 0;
        await invokeUsernameLogin({ action: 'login' }, '失敗');
        assert.equal(edgeCalls, development ? 1 : 0);
        assert.equal(sameOriginCalls, development ? 0 : 1);
      }
    }
  } finally {
    if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
    globalThis.fetch = savedFetch;
    delete globalThis.__loginEdgeCall;
  }
});

test('captcha bypasses a blocked Auth client, aborts on timeout, and does not retry HTTP 4xx', async () => {
  const savedWindow = globalThis.window;
  const savedFetch = globalThis.fetch;
  try {
    const source = loginSource
      .replace("import { getSupabase } from './supabase';", 'const getSupabase = () => { throw new Error("Auth client must not be used for captcha"); };')
      .replace("import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';", 'const SUPABASE_ANON_KEY = "public-key"; const SUPABASE_URL = "https://cloud.test";');
    const { invokeUsernameLogin } = await import(moduleUrl(source));
    globalThis.window = { setTimeout: callback => setTimeout(callback, 10), clearTimeout };
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://cloud.test/functions/v1/username-login');
      assert.equal(options.headers.Authorization, 'Bearer public-key');
      return Response.json({ challenge_id: 'captcha' });
    };
    assert.deepEqual(await invokeUsernameLogin({ action: 'captcha' }, '失敗', { retries: 0 }), { challenge_id: 'captcha' });
    globalThis.fetch = (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    await assert.rejects(invokeUsernameLogin({ action: 'captcha' }, '失敗', { retries: 0 }), /逾時/);
    let calls = 0;
    globalThis.fetch = async () => { calls++; return Response.json({ message: '請稍後再試' }, { status: 429 }); };
    await assert.rejects(invokeUsernameLogin({ action: 'captcha' }, '失敗', { retries: 3 }), /請稍後再試/);
    assert.equal(calls, 1);
  } finally {
    if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
    globalThis.fetch = savedFetch;
  }
});
