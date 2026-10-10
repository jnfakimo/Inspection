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
          assert.equal(url, `${origin}/functions/v1/username-login`);
          return Response.json({ challenge_id: 'test' });
        };
        const loginUrl = moduleUrl(loginSource
          .replace("import { getSupabase } from './supabase';", `const getSupabase = () => ({ functions: { invoke: async () => { globalThis.__loginEdgeCall(); return { data: { challenge_id: 'test' }, error: null }; } } });`)
          .replace("'./config'", JSON.stringify(configUrl + `#${origin}`)));
        globalThis.__loginEdgeCall = () => { edgeCalls++; };
        const { invokeUsernameLogin } = await import(loginUrl);
        assert.deepEqual(await invokeUsernameLogin({ action: 'captcha' }, '失敗'), { challenge_id: 'test' });
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
