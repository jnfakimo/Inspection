import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldUseSameOriginUsernameLogin } from './username-login-routing.ts';

test('loopback development hosts use the configured Supabase Functions client', () => {
  for (const hostname of ['localhost', 'localhost.localdomain', '127.0.0.1', '127.12.34.56', '::1', '[::1]']) {
    assert.equal(shouldUseSameOriginUsernameLogin(hostname), false, hostname);
  }
});

test('non-loopback IPv4 hosts preserve the self-hosted same-origin proxy', () => {
  for (const hostname of ['192.168.1.40', '10.0.0.12', '203.0.113.25']) {
    assert.equal(shouldUseSameOriginUsernameLogin(hostname), true, hostname);
  }
});

test('DNS hostnames use the configured Supabase Functions client', () => {
  assert.equal(shouldUseSameOriginUsernameLogin('inspection.example.com'), false);
});

test('localhost login keeps the configured Supabase function endpoint contract', () => {
  const source = readFileSync(new URL('./username-login.ts', import.meta.url), 'utf8');
  assert.match(source, /shouldUseSameOriginUsernameLogin\(window\.location\.hostname\)/);
  assert.match(source, /getSupabase\(\)\.functions\.invoke\('username-login'/);
});
import { stripTypeScriptTypes } from 'node:module';

const sourceModuleUrl = (source: string) =>
  'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64');
const backendOriginSource = readFileSync(new URL('./backend-origin.ts', import.meta.url), 'utf8');
const configSource = readFileSync(new URL('./config.ts', import.meta.url), 'utf8');
const usernameLoginSource = readFileSync(new URL('./username-login.ts', import.meta.url), 'utf8');
const usernameLoginErrorSource = readFileSync(new URL('./username-login-error.ts', import.meta.url), 'utf8');
const loginPageSource = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');

function configModuleUrl(development: boolean, origin: string) {
  const backendModuleUrl = sourceModuleUrl(backendOriginSource);
  const code = configSource
    .replace(
      "import { usesBrowserBackendOrigin } from './backend-origin';",
      "import { usesBrowserBackendOrigin } from '" + backendModuleUrl + "';",
    )
    .replace('process.env.NODE_ENV', JSON.stringify(development ? 'development' : 'production'))
    .replaceAll('process.env.NEXT_PUBLIC_SUPABASE_URL', JSON.stringify('https://stale-config.example.test'))
    .replaceAll('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY', JSON.stringify('stale-public-key'));
  return sourceModuleUrl(code) + '#' + (development ? 'dev-' : 'prod-') + encodeURIComponent(origin);
}

async function loginHarness(origin: string, timeoutMs?: number) {
  const configUrl = configModuleUrl(true, origin);
  const routingModuleUrl = sourceModuleUrl(
    readFileSync(new URL('./username-login-routing.ts', import.meta.url), 'utf8'),
  );
  const errorModuleUrl = sourceModuleUrl(usernameLoginErrorSource);
  let code = usernameLoginSource
    .replace(
      "import { getSupabase } from './supabase';",
      'const getSupabase = () => (globalThis as any).__usernameLoginTestClient;',
    )
    .replace(
      "import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';",
      "import { SUPABASE_ANON_KEY, SUPABASE_URL } from '" + configUrl + "';",
    )
    .replace(
      "import { captchaFailureDiagnostic } from './username-login-error';",
      "import { captchaFailureDiagnostic } from '" + errorModuleUrl + "';",
    )
    .replace(
      "import { shouldUseSameOriginUsernameLogin } from './username-login-routing';",
      "import { shouldUseSameOriginUsernameLogin } from '" + routingModuleUrl + "';",
    );
  if (timeoutMs) {
    code = code.replace('const USERNAME_LOGIN_TIMEOUT_MS = 15_000;', 'const USERNAME_LOGIN_TIMEOUT_MS = ' + timeoutMs + ';');
  }
  return {
    config: await import(configUrl),
    login: await import(sourceModuleUrl(code)),
  };
}

test('development routes CAPTCHA to cloud config while production self-hosting preserves browser origin', async () => {
  const previousWindow = (globalThis as any).window;
  try {
    for (const origin of ['http://localhost:3000', 'http://127.0.0.1:3000']) {
      (globalThis as any).window = { location: new URL(origin) };
      const config = await import(configModuleUrl(true, origin));
      assert.notEqual(config.SUPABASE_URL, new URL(origin).origin);
      assert.notEqual(config.SUPABASE_URL, 'https://stale-config.example.test');
      assert.notEqual(config.SUPABASE_ANON_KEY, 'stale-public-key');
    }

    const productionOrigin = 'https://192.168.50.192:5057';
    (globalThis as any).window = { location: new URL(productionOrigin) };
    const productionConfig = await import(configModuleUrl(false, productionOrigin));
    assert.equal(productionConfig.SUPABASE_URL, productionOrigin);
    assert.equal(productionConfig.SUPABASE_ANON_KEY, 'stale-public-key');
  } finally {
    if (previousWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previousWindow;
  }
});

test('CAPTCHA uses a direct public request and leaves normal login on the Supabase client', async () => {
  const previousWindow = (globalThis as any).window;
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const clientCalls: Array<{ name: string; options: unknown }> = [];
  try {
    (globalThis as any).window = {
      location: new URL('http://127.0.0.1:3000'),
      setTimeout,
      clearTimeout,
    };
    (globalThis as any).__usernameLoginTestClient = {
      functions: {
        invoke: async (name: string, options: unknown) => {
          clientCalls.push({ name, options });
          return { data: { ok: true }, error: null };
        },
      },
    };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init || {} });
      return Response.json({
        challenge_id: 'synthetic-challenge',
        image: 'data:image/svg+xml;base64,PHN2Zy8+',
      });
    }) as typeof fetch;

    const { config, login } = await loginHarness('http://127.0.0.1:3000');
    const captcha = await login.invokeUsernameLogin(
      { action: 'captcha' },
      '驗證碼載入失敗',
      { retries: 2 },
    );

    assert.deepEqual(captcha, {
      challenge_id: 'synthetic-challenge',
      image: 'data:image/svg+xml;base64,PHN2Zy8+',
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, config.SUPABASE_URL + '/functions/v1/username-login');
    assert.equal(calls[0].init.method, 'POST');
    const headers = calls[0].init.headers as Record<string, string>;
    assert.ok(headers.apikey);
    assert.equal(headers.Authorization, 'Bearer ' + headers.apikey);
    assert.notEqual(headers.apikey, 'stale-public-key');
    assert.equal(clientCalls.length, 0, 'CAPTCHA must not enter the Auth-aware Functions transport');

    await login.invokeUsernameLogin({ action: 'login' }, '登入失敗');
    assert.equal(clientCalls.length, 1, 'normal login still uses the existing Supabase client');
    assert.equal(calls.length, 1, 'normal login does not use the CAPTCHA transport');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previousWindow;
    delete (globalThis as any).__usernameLoginTestClient;
  }
});

test('CAPTCHA 429 is safe and never retried', async () => {
  const previousWindow = (globalThis as any).window;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  try {
    (globalThis as any).window = {
      location: new URL('http://127.0.0.1:3000'),
      setTimeout,
      clearTimeout,
    };
    (globalThis as any).__usernameLoginTestClient = { functions: { invoke: async () => { throw new Error('must not use Auth client'); } } };
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({ message: 'private backend detail' }, { status: 429 });
    }) as typeof fetch;

    const { login } = await loginHarness('http://127.0.0.1:3000');
    await assert.rejects(
      login.invokeUsernameLogin({ action: 'captcha' }, '驗證碼載入失敗', { retries: 2 }),
      error => {
        assert.match((error as Error).message, /HTTP 429／代碼 captcha_rate_limited/);
        assert.doesNotMatch((error as Error).message, /private backend detail/);
        return true;
      },
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previousWindow;
    delete (globalThis as any).__usernameLoginTestClient;
  }
});

test('CAPTCHA transport times out and the login page suppresses duplicate requests', async () => {
  const previousWindow = (globalThis as any).window;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  try {
    (globalThis as any).window = {
      location: new URL('http://127.0.0.1:3000'),
      setTimeout,
      clearTimeout,
    };
    (globalThis as any).__usernameLoginTestClient = { functions: { invoke: async () => { throw new Error('must not use Auth client'); } } };
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('mock fetch aborted')), { once: true });
      });
    }) as typeof fetch;

    const { login } = await loginHarness('http://127.0.0.1:3000', 5);
    await assert.rejects(
      login.invokeUsernameLogin({ action: 'captcha' }, '驗證碼載入失敗'),
      error => {
        assert.match((error as Error).message, /captcha_timeout/);
        return true;
      },
    );
    assert.equal(calls, 1);
    assert.match(loginPageSource, /const captchaInFlight = useRef\(false\)/);
    assert.match(loginPageSource, /if \(captchaInFlight\.current\) return;/);
    assert.match(loginPageSource, /disabled=\{busy \|\| !captcha \|\| captchaLoading\}/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = previousWindow;
    delete (globalThis as any).__usernameLoginTestClient;
  }
});
const supabaseAdapterSource = readFileSync(new URL('./supabase.ts', import.meta.url), 'utf8');

test('development disables app-api node routing and CAPTCHA starts before session inspection', () => {
  assert.match(
    supabaseAdapterSource,
    /process\.env\.NODE_ENV === 'development' \|\| usesLocalBackendOrigin/,
  );
  const captchaStart = loginPageSource.indexOf('void loadCaptcha();');
  const sessionRead = loginPageSource.indexOf('withTimeout(getSupabase().auth.getSession()');
  assert.ok(captchaStart >= 0 && sessionRead > captchaStart);
  assert.match(loginPageSource, /if \(captchaInFlight\.current\) return;/);
});