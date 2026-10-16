import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVehicleLinePersonalSettings, vehicleLineTestBlocker, VEHICLE_LINE_SWITCHES } from './vehicle-line-personal-settings.ts';

const ready = { username: '022443', name: '測試司機', active: true, driver_active: true, linked: true, ready: true };

test('缺值或非布林一律視為關閉（預設全關）', () => {
  const value = normalizeVehicleLinePersonalSettings({ personal_enabled: 'true', assignment_enabled: 1 });
  assert.deepEqual(value, {
    personal_enabled: false, assignment_enabled: false, assignment_revoked_enabled: false, test_enabled: false, test_recipient: null,
  });
  assert.equal(normalizeVehicleLinePersonalSettings(null).personal_enabled, false);
});

test('保留伺服器回傳的測試帳號狀態，但不接受額外欄位', () => {
  const value = normalizeVehicleLinePersonalSettings({ test_enabled: true, test_recipient: { ...ready, line_user_id: 'Uxxx' } });
  assert.deepEqual(value.test_recipient, ready);
});

test('測試按鈕：未儲存的變更要先儲存', () => {
  const saved = normalizeVehicleLinePersonalSettings({ test_enabled: true, test_recipient: ready });
  const draft = { ...saved, personal_enabled: true };
  assert.match(vehicleLineTestBlocker(saved, draft), /先儲存/);
});

test('測試按鈕：測試模式未開啟或測試帳號未就緒時不可按', () => {
  const off = normalizeVehicleLinePersonalSettings({ test_enabled: false, test_recipient: ready });
  assert.match(vehicleLineTestBlocker(off, off), /測試模式/);
  const unlinked = normalizeVehicleLinePersonalSettings({ test_enabled: true, test_recipient: { ...ready, linked: false, ready: false } });
  assert.match(vehicleLineTestBlocker(unlinked, unlinked), /LINE 綁定/);
  const missing = normalizeVehicleLinePersonalSettings({ test_enabled: true });
  assert.notEqual(vehicleLineTestBlocker(missing, missing), '');
});

test('測試按鈕：已儲存、測試模式開啟且帳號就緒時可按', () => {
  const saved = normalizeVehicleLinePersonalSettings({ test_enabled: true, test_recipient: ready });
  assert.equal(vehicleLineTestBlocker(saved, { ...saved }), '');
  assert.equal(vehicleLineTestBlocker(null, saved), '設定尚未載入。');
});

test('四個開關與 admin-api 接受的欄位一一對應', () => {
  assert.deepEqual(VEHICLE_LINE_SWITCHES.map(item => item.key),
    ['personal_enabled', 'assignment_enabled', 'assignment_revoked_enabled', 'test_enabled']);
});
