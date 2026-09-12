import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedPostLoginPath, resolvePostLoginDestination } from './login-destination.ts';

const inspector = {
  role: 'inspector', rbac_role: 'reporter',
  allowed_systems: ['guardpatrol', 'handover'],
  allowed_modules: ['guardpatrol/records', 'handover/guard'],
};
const sysadmin = { role: 'admin', rbac_role: 'sysadmin', allowed_systems: ['*'], allowed_modules: ['*'] };

test('一般使用者首次登入不會被送進先前開啟的後台網址', () => {
  const requested = '/Inspection/v2/systems/admin/users/?v=a1238e9e3';
  assert.equal(resolvePostLoginDestination(requested, inspector), '/Inspection/v2/systems/');
  assert.equal(resolvePostLoginDestination(requested, sysadmin), requested);
});

test('個人通知仍可由一般使用者開啟', () => {
  const requested = '/Inspection/v2/systems/admin/notices/';
  assert.equal(resolvePostLoginDestination(requested, inspector), requested);
});

test('一般系統與子系統都依正式 profile 權限決定登入目的頁', () => {
  assert.equal(resolvePostLoginDestination('/Inspection/v2/systems/guardpatrol/records/', inspector), '/Inspection/v2/systems/guardpatrol/records/');
  assert.equal(resolvePostLoginDestination('/Inspection/v2/systems/guardpatrol/shifts/', inspector), '/Inspection/v2/systems/');
  assert.equal(resolvePostLoginDestination('/Inspection/v2/systems/equipment/', inspector), '/Inspection/v2/systems/');
});

test('舊入口 redirect 可安全轉成 V2 網址，外部與登入網址一律拒絕', () => {
  assert.equal(requestedPostLoginPath('?redirect=%2Fsystems%2Fhandover%2F'), '/Inspection/v2/systems/handover/');
  assert.equal(resolvePostLoginDestination(requestedPostLoginPath('?redirect=%2Fsystems%2Fhandover%2F'), inspector), '/Inspection/v2/systems/handover/');
  assert.equal(resolvePostLoginDestination('https://example.com/Inspection/v2/systems/', sysadmin), '/Inspection/v2/systems/');
  assert.equal(resolvePostLoginDestination('/Inspection/v2/login/', sysadmin), '/Inspection/v2/systems/');
});
