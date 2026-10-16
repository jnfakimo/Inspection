// 非同步載入防呆：過期回應不得覆寫畫面、卸載時作廢請求、查詢失敗不顯示假的空清單。
// 主體為 Codex 2026-10-10 撰寫的測試（G 槽快照），2026-10-16 整合；另含 firstQueryError 單元測試與設備頁重新載入提示。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { firstQueryError } from './async-load-safety.ts';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const equipment = source('../app/systems/[system]/[module]/equipment-workspace.tsx');
const dashboard = source('../app/dashboard-client.tsx');
const meeting = source('../app/systems/[system]/[module]/meeting-workspace.tsx');
const officialDocs = source('../app/systems/[system]/[module]/official-docs-workspace.tsx');
const guardCheckins = source('../app/systems/[system]/[module]/operations-workspace.tsx');
const workorderExtras = source('../app/systems/[system]/[module]/workorder-extras.tsx');
const alertsAdmin = source('../components/admin/AlertsAdminV2.tsx');
const noticesAdmin = source('../components/admin/NoticesAdmin.tsx');
const auditAdmin = source('../components/admin/AuditAdminV2.tsx');
const permissionsAdmin = source('../components/admin/PermissionsAdminV2.tsx');
const authGate = source('../components/AuthGate.tsx');

test('equipment list loading settles, rejects stale results, and does not show empty on errors', () => {
  assert.match(equipment, /loadSequence\.current\.begin\(\)/);
  assert.match(equipment, /if \(!loadSequence\.current\.isCurrent\(sequence\)\) return false/);
  assert.match(equipment, /finally \{\s*if \(loadSequence\.current\.isCurrent\(sequence\)\) setBusy\(false\)/);
  assert.match(equipment, /!busy && !note && paged\.length === 0/);
  assert.match(equipment, /return \(\) => loadSequence\.current\.invalidate\(\)/);
  assert.match(equipment, /firstQueryError\(main, eq, cat\)/);
  assert.match(equipment, /if \(queryError\) \{[\s\S]*?setRows\(\[\]\); setEquipment\(\[\]\); setCategories\(\[\]\)/);
});

test('date or search driven dashboard, meeting, and official document loads ignore stale responses', () => {
  for (const [name, component] of [['dashboard', dashboard], ['meeting', meeting], ['official documents', officialDocs], ['work order analytics', workorderExtras]] as const) {
    assert.match(component, /loadSequence\.current\.begin\(\)/, `${name} starts a request generation`);
    assert.match(component, /loadSequence\.current\.isCurrent\(sequence\)/, `${name} checks the active generation`);
    assert.match(component, /loadSequence\.current\.invalidate\(\)/, `${name} invalidates on cleanup`);
  }
});

test('guard check-in request results cannot update after the selected date changes', () => {
  assert.match(guardCheckins, /createRequestSequence/);
  assert.match(guardCheckins, /markerResult\.error \|\| floorResult\.error/);
  assert.match(meeting, /mine\.error \|\| req\.error \|\| u\.error \|\| me\.error/);
});

test('admin alert polling, audit filters, and notice realtime loads discard stale responses', () => {
  for (const [name, component] of [['alerts', alertsAdmin], ['audit', auditAdmin], ['notices', noticesAdmin]] as const) {
    assert.match(component, /loadSequence\.current\.begin\(\)/, `${name} starts a request generation`);
    assert.match(component, /loadSequence\.current\.isCurrent\(sequence\)/, `${name} checks the active generation`);
    assert.match(component, /loadSequence\.current\.invalidate\(\)/, `${name} invalidates on cleanup`);
  }
  assert.match(alertsAdmin, /if \(loadSequence\.current\.isCurrent\(sequence\)\) setBusy\(false\)/);
  assert.match(noticesAdmin, /if \(!error\) setNotices\(data \|\| \[\]\)/);
});

test('permission editor stays unavailable when any permission source fails to load', () => {
  assert.match(permissionsAdmin, /roleModuleResult\.error/);
  assert.match(permissionsAdmin, /if \(failure\) \{ setLoadBlocked\(true\); return; \}/);
  assert.match(permissionsAdmin, /if \(loadBlocked\) \{\s*return <AppShell/);
});

test('AuthGate stale session and error completions cannot clear the active profile', async () => {
  assert.match(authGate, /await client\.auth\.getSession\(\);\s*if \(!active\) return;/);
  assert.match(authGate, /catch \(error\) \{\s*if \(!active\) return;\s*clearProfile\(\);/);

  let active = true;
  let profile = 'new-session-profile';
  let signOutCalls = 0;
  let clearCalls = 0;
  let resolveSession!: (value: null) => void;
  const session = new Promise<null>(resolve => { resolveSession = resolve; });
  const oldSessionCompletion = session.then(value => {
    if (!active) return;
    if (!value) { signOutCalls += 1; clearCalls += 1; profile = ''; }
  });
  active = false;
  resolveSession(null);
  await oldSessionCompletion;
  assert.equal(signOutCalls, 0);
  assert.equal(clearCalls, 0);
  assert.equal(profile, 'new-session-profile');

  active = true;
  let rejectFailure!: (error: unknown) => void;
  const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  const oldFailureCompletion = failure.catch(() => {
    if (!active) return;
    clearCalls += 1;
    profile = '';
  });
  active = false;
  rejectFailure(new Error('stale lookup failure'));
  await oldFailureCompletion;
  assert.equal(clearCalls, 0);
  assert.equal(profile, 'new-session-profile');
});

test('firstQueryError 回傳第一個失敗的查詢，全部成功時回傳 null', () => {
  const failure = { message: 'permission denied' };
  assert.equal(firstQueryError({ error: null }, { error: failure }, { error: { message: 'later' } }), failure);
  assert.equal(firstQueryError({ error: null }, null, undefined, {}), null);
});

test('設備頁儲存或確認事件後清單重新載入失敗時，不顯示「已完成」而提示重新載入', () => {
  assert.match(equipment, /const refreshed = await load\(\);\s*setNote\(refreshed \? \(id \? '資料已更新' : '資料已新增'\) : '資料已儲存，但清單更新失敗，請重新載入'\)/);
  assert.match(equipment, /setNote\(refreshed \? '事件已確認' : '事件已確認，但清單更新失敗，請重新載入'\)/);
});
