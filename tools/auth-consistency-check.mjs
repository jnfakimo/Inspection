import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const files = {
  v1Config: read('system/supabase-config.js'),
  v1Login: read('system/login.html'),
  handoverLogin: read('system/handover-login.html'),
  v2Login: read('web/app/login/page.tsx'),
  usernameLogin: read('web/lib/username-login.ts'),
  v2Supabase: read('web/lib/supabase.ts'),
  authGate: read('web/components/AuthGate.tsx'),
  appShell: read('web/components/AppShell.tsx'),
  cache: read('web/lib/profile-cache.ts'),
};
const v1ProfilePages = [
  'system/admin.html', 'system/dispatch.html', 'system/dashboard.html', 'system/notices.html',
  'system/handover.html', 'system/meetingroom.html', 'system/vehicle-dispatch.html',
  'system/repair.html', 'system/guardpatrol3d.html', 'system/workorder.html',
].map((file) => [file, read(file)]);

function assert(condition, message) {
  if (!condition) throw new Error(`Auth consistency check failed: ${message}`);
}

assert(files.v1Config.includes("window.SystemAuth") && files.v1Config.includes("{ action: 'profile' }"),
  'V1 must expose the shared app-api/profile loader');
assert(files.v1Login.includes('window.SystemAuth.restoreProfile') && files.v1Login.includes('window.SystemAuth.establishSession'),
  'V1 login must restore and establish sessions through SystemAuth');
assert(files.handoverLogin.includes("functions.invoke('username-login'") && files.handoverLogin.includes('captcha_id'),
  'handover login must use username-login with captcha');
assert(!/login_lookup_email|signInWithPassword|\.from\(['"]users['"]\)/.test(files.handoverLogin),
  'handover login must not bypass the shared login/profile path');
assert(files.v2Login.includes("invokeAppApi<Profile>('profile')") && files.v2Login.includes('saveProfile'),
  'V2 login must hydrate the shared profile cache');
assert(files.v2Login.includes('invokeUsernameLogin') && !files.v2Login.includes("functions.invoke('username-login'"),
  'V2 login must use the bounded username-login helper');
assert(files.usernameLogin.includes('timeout: USERNAME_LOGIN_TIMEOUT_MS') && files.usernameLogin.includes('系統服務回應逾時'),
  'username-login requests must time out with a localized message instead of leaving the UI busy forever');
assert(files.v2Supabase.includes('timeout: EDGE_API_TIMEOUT_MS'),
  'V2 app-api profile requests must have a bounded Edge Function timeout');
assert(files.authGate.includes("invokeAppApi<Profile>('profile')") && files.authGate.includes('saveProfile'),
  'V2 AuthGate must refresh the same authoritative profile');
assert(files.appShell.includes('clearProfile()'), 'V2 logout must clear the shared profile cache');
assert(files.cache.includes("inspectionSystemUserProfile") && files.cache.includes('system-user-profile-updated'),
  'V2 cache must use the V1 storage key and update event');
for (const [file, source] of v1ProfilePages) {
  assert(!source.includes("eq('auth_id'") && !source.includes('eq("auth_id"'),
    `${file} must use SystemAuth for the current user instead of a page-specific auth_id query`);
}

console.log('Auth consistency checks passed.');
