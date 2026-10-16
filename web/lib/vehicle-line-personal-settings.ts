// 後台「公務車個人 LINE 通知」設定的資料整理與測試按鈕的啟用條件（純函式，便於單元測試）。

export type VehicleLineTestRecipient = {
  username: string;
  name: string;
  active: boolean;
  driver_active: boolean;
  linked: boolean;
  ready: boolean;
};

export type VehicleLinePersonalSettings = {
  personal_enabled: boolean;
  assignment_enabled: boolean;
  assignment_revoked_enabled: boolean;
  test_enabled: boolean;
  test_recipient: VehicleLineTestRecipient | null;
};

export type VehicleLineSwitchKey = 'personal_enabled' | 'assignment_enabled' | 'assignment_revoked_enabled' | 'test_enabled';

export const VEHICLE_LINE_SWITCHES: ReadonlyArray<{ key: VehicleLineSwitchKey; label: string; description: string }> = [
  { key: 'personal_enabled', label: '啟用個人通知', description: '總開關；關閉時所有個人派車通知都不會送出。' },
  { key: 'assignment_enabled', label: '指派通知', description: '派車指派給司機時，通知已綁定 LINE 的司機本人。' },
  { key: 'assignment_revoked_enabled', label: '取消指派通知', description: '派車改派或取消時，通知原本被指派的司機。' },
  { key: 'test_enabled', label: '測試模式', description: '允許對固定測試帳號 022443 發送測試訊息；正式啟用後可關閉。' },
];

const bool = (value: unknown) => value === true;

export function normalizeVehicleLinePersonalSettings(value: unknown): VehicleLinePersonalSettings {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const raw = row.test_recipient && typeof row.test_recipient === 'object' ? row.test_recipient as Record<string, unknown> : null;
  return {
    personal_enabled: bool(row.personal_enabled),
    assignment_enabled: bool(row.assignment_enabled),
    assignment_revoked_enabled: bool(row.assignment_revoked_enabled),
    test_enabled: bool(row.test_enabled),
    test_recipient: raw ? {
      username: typeof raw.username === 'string' ? raw.username : '',
      name: typeof raw.name === 'string' ? raw.name : '',
      active: bool(raw.active),
      driver_active: bool(raw.driver_active),
      linked: bool(raw.linked),
      ready: bool(raw.ready),
    } : null,
  };
}

/** 回傳「發送測試」不能按的原因；可以按時回傳空字串。測試依據的是伺服器已儲存的設定，不是畫面上尚未儲存的勾選。 */
export function vehicleLineTestBlocker(
  saved: VehicleLinePersonalSettings | null,
  draft: VehicleLinePersonalSettings | null,
): string {
  if (!saved || !draft) return '設定尚未載入。';
  const dirty = (['personal_enabled', 'assignment_enabled', 'assignment_revoked_enabled', 'test_enabled'] as const)
    .some(key => saved[key] !== draft[key]);
  if (dirty) return '請先儲存設定，再發送測試。';
  if (!saved.test_enabled) return '請先開啟「測試模式」並儲存。';
  if (!saved.test_recipient?.ready) return '測試帳號 022443 需為啟用中、在駕駛名冊，且已完成本人 LINE 綁定。';
  return '';
}
