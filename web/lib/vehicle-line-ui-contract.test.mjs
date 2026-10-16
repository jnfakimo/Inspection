// 公務車個人 LINE 通知的介面契約（參考 Codex 2026-10-08 的同名測試，改寫為現行介面）。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('個人設定與派車申請頁共用同一個綁定元件，派車頁只對駕駛顯示', async () => {
  const [shell, workspace] = await Promise.all([
    read('../components/AppShell.tsx'),
    read('../app/systems/[system]/[module]/vehicle-workspace.tsx'),
  ]);
  assert.match(shell, /hasSystemAccess\(profile, 'vehicle'\) && <VehicleLineLinkSection index="03" \/>/);
  assert.match(workspace, /\{isDriver && <VehicleLineLinkSection index="LINE" \/>\}/);
});

test('綁定元件使用共用邏輯、防連點鎖與請求序號，且不讀取 LINE 使用者 ID', async () => {
  const section = await read('../components/VehicleLineLinkSection.tsx');
  for (const name of ['readVehicleLineBinding(', 'startVehicleLineLink(', 'unlinkVehicleLine(', 'vehicleLineUnavailableKind(']) {
    assert.ok(section.includes(name), `綁定元件必須呼叫 ${name}`);
  }
  assert.match(section, /statusRequests\.current\.isCurrent\(request\)/);
  assert.match(section, /actionLock\.current\.acquire\(\)/);
  assert.match(section, /checked=\{consent\}/);
  assert.match(section, /disabled=\{busy \|\| !consent\}/);
  assert.doesNotMatch(section, /line_user_id|lineUserId/);
  assert.doesNotMatch(section, /invokeAppApi<[^>]*>\('vehicle_line_/, '綁定動作要經過共用邏輯驗證回應，不可直接呼叫 API');
});

test('綁定動作只走 Edge Function', async () => {
  const client = await read('./supabase.ts');
  for (const action of ['vehicle_line_link_start', 'vehicle_line_link_status', 'vehicle_line_unlink']) {
    assert.match(client, new RegExp(`'${action}'`));
  }
});

test('後台個人通知與群組 LINE 設定分開，測試只對 022443', async () => {
  const [settings, panel] = await Promise.all([
    read('../app/systems/admin/settings/settings-client.tsx'),
    read('../app/systems/admin/settings/vehicle-line-personal-panel.tsx'),
  ]);
  assert.equal((settings.match(/type="password"/g) || []).length, 1, '群組 Token 仍是唯一的密碼欄位');
  assert.match(settings, /<VehicleLinePersonalPanel onNotice=\{setNotice\} \/>/);
  assert.doesNotMatch(settings, /admin_save_vehicle_line_personal_settings/);
  for (const action of ['admin_get_vehicle_line_personal_settings', 'admin_save_vehicle_line_personal_settings', 'admin_test_vehicle_line_personal_notification']) {
    assert.ok(panel.includes(action), `後台面板必須使用 ${action}`);
  }
  assert.match(panel, /確定送出測試/);
});
