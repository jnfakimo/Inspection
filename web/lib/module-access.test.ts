import assert from 'node:assert/strict';
import test from 'node:test';
import { hasModuleAccess, hasSystemAccess } from './modules.ts';

test('大系統權限支援明確清單與系統管理員萬用權限', () => {
  assert.equal(hasSystemAccess({ allowed_systems: ['workorder'] }, 'workorder'), true);
  assert.equal(hasSystemAccess({ allowed_systems: ['workorder'] }, 'handover'), false);
  assert.equal(hasSystemAccess({ allowed_systems: ['*'] }, 'handover'), true);
});

test('子系統拒絕後即使知道網址也不可進入', () => {
  const profile = {
    allowed_systems: ['workorder'],
    allowed_modules: ['workorder/requests'],
  };
  assert.equal(hasModuleAccess(profile, 'workorder', 'requests'), true);
  assert.equal(hasModuleAccess(profile, 'workorder', 'dispatch'), false);
  assert.equal(hasModuleAccess({ ...profile, allowed_modules: ['*'] }, 'handover', 'records'), false);
});

test('資料庫升級期間保留舊交接簿白名單，其餘系統沿用父權限', () => {
  assert.equal(hasModuleAccess({ allowed_systems: ['equipment'] }, 'equipment', 'assets'), true);
  const legacyProfile = {
    allowed_systems: ['handover'],
    allowed_handover_modules: ['mechanical'],
  };
  assert.equal(hasModuleAccess(legacyProfile, 'handover', 'mechanical'), true);
  assert.equal(hasModuleAccess(legacyProfile, 'handover', 'records'), false);
});

test('具有駐衛警巡檢或報修權限的使用者自動開通平面樓層圖', () => {
  const patrolProfile = {
    allowed_systems: ['guardpatrol'],
    allowed_modules: ['guardpatrol/map3d'],
  };
  assert.equal(hasModuleAccess(patrolProfile, 'structuremap', 'floor2d'), true);
  assert.equal(hasModuleAccess(patrolProfile, 'structuremap', 'models'), false);

  const workorderProfile = {
    allowed_systems: ['workorder'],
    allowed_modules: ['workorder/repairmap3d'],
  };
  assert.equal(hasModuleAccess(patrolProfile, 'structuremap', 'floor2d'), true);
  assert.equal(hasModuleAccess(workorderProfile, 'structuremap', 'floor2d'), true);

  const pureEquipmentProfile = {
    allowed_systems: ['equipment'],
  };
  assert.equal(hasModuleAccess(pureEquipmentProfile, 'structuremap', 'floor2d'), false);
});
