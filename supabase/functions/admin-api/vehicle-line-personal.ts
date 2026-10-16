export const VEHICLE_LINE_PERSONAL_ACTIONS = new Set([
  'admin_get_vehicle_line_personal_settings',
  'admin_save_vehicle_line_personal_settings',
  'admin_test_vehicle_line_personal_notification',
]);
export const VEHICLE_LINE_TEST_RECIPIENT_USERNAME = '022443';
export const VEHICLE_LINE_TEST_MESSAGE = '公務車個人 LINE 通知測試：此為管理員發起的合成測試，沒有建立或變更任何派車案件。';

export type VehicleLinePersonalPreferences = {
  personal_enabled: boolean;
  assignment_enabled: boolean;
  assignment_revoked_enabled: boolean;
  test_enabled: boolean;
  test_recipient_user_id: string | null;
};

export type VehicleLineTestRecipient = {
  username: string;
  name: string;
  active: boolean;
  driver_active: boolean;
  linked: boolean;
};

export type VehicleLinePersonalAdminDependencies = {
  isAdmin: boolean;
  actorId: string;
  readPreferences: () => Promise<VehicleLinePersonalPreferences | null>;
  resolveTestRecipient: () => Promise<{ userId: string; username: string; name: string } | null>;
  readTestRecipient: (userId: string) => Promise<VehicleLineTestRecipient | null>;
  savePreferences: (input: VehicleLinePersonalPreferences & { updatedBy: string }) => Promise<void>;
  createTestRun: (actorId: string) => Promise<string>;
  runTestWorker: (testRunId: string) => Promise<boolean>;
  audit: (recordId: string, changes: Record<string, unknown>) => Promise<void>;
};

export type VehicleLinePersonalAdminResult = {
  status: number;
  body: Record<string, unknown>;
} | null;

const DEFAULT_PREFERENCES: VehicleLinePersonalPreferences = {
  personal_enabled: false,
  assignment_enabled: false,
  assignment_revoked_enabled: false,
  test_enabled: false,
  test_recipient_user_id: null,
};

function failure(status: number, message: string): VehicleLinePersonalAdminResult {
  return { status, body: { ok: false, message } };
}

function exactActionBody(body: Record<string, unknown>, action: string, allowed: readonly string[]): boolean {
  return body.action === action && Object.keys(body).every((key) => key === 'action' || allowed.includes(key));
}

function preferencesFromBody(body: Record<string, unknown>): Omit<VehicleLinePersonalPreferences, 'test_recipient_user_id'> | null {
  if (typeof body.personal_enabled !== 'boolean'
      || typeof body.assignment_enabled !== 'boolean'
      || typeof body.assignment_revoked_enabled !== 'boolean'
      || typeof body.test_enabled !== 'boolean') return null;
  return {
    personal_enabled: body.personal_enabled,
    assignment_enabled: body.assignment_enabled,
    assignment_revoked_enabled: body.assignment_revoked_enabled,
    test_enabled: body.test_enabled,
  };
}

export async function executeVehicleLinePersonalAdminAction(
  action: string,
  body: Record<string, unknown>,
  dependencies: VehicleLinePersonalAdminDependencies,
): Promise<VehicleLinePersonalAdminResult> {
  if (!VEHICLE_LINE_PERSONAL_ACTIONS.has(action)) return null;
  if (!dependencies.isAdmin) return failure(403, '僅系統管理員可設定公務車個人 LINE 通知。');

  if (action === 'admin_get_vehicle_line_personal_settings') {
    if (!exactActionBody(body, action, [])) return failure(400, '通知設定讀取參數無效。');
    try {
      const preferences = await dependencies.readPreferences();
      const value = { ...DEFAULT_PREFERENCES, ...(preferences ?? {}) };
      let recipientId = value.test_recipient_user_id;
      if (!recipientId) {
        const candidate = await dependencies.resolveTestRecipient();
        if (candidate?.username === VEHICLE_LINE_TEST_RECIPIENT_USERNAME) {
          recipientId = candidate.userId;
        }
      }
      const recipient = recipientId ? await dependencies.readTestRecipient(recipientId) : null;
      return {
        status: 200,
        body: {
          ok: true,
          data: {
            personal_enabled: value.personal_enabled,
            assignment_enabled: value.assignment_enabled,
            assignment_revoked_enabled: value.assignment_revoked_enabled,
            test_enabled: value.test_enabled,
            test_recipient: recipient ? {
              username: recipient.username,
              name: recipient.name,
              active: recipient.active,
              driver_active: recipient.driver_active,
              linked: recipient.linked,
              ready: recipient.username === VEHICLE_LINE_TEST_RECIPIENT_USERNAME
                && recipient.active && recipient.driver_active && recipient.linked,
            } : null,
          },
        },
      };
    } catch {
      return failure(503, '個人 LINE 通知設定暫時無法讀取。');
    }
  }

  if (action === 'admin_save_vehicle_line_personal_settings') {
    const input = preferencesFromBody(body);
    if (!input || !exactActionBody(body, action, [
      'personal_enabled', 'assignment_enabled', 'assignment_revoked_enabled', 'test_enabled',
    ])) return failure(400, '請提供完整且有效的個人 LINE 通知開關。');
    try {
      const selected = await dependencies.resolveTestRecipient();
      const testRecipientId = selected?.username === VEHICLE_LINE_TEST_RECIPIENT_USERNAME ? selected.userId : null;
      if (input.test_enabled && !testRecipientId) {
        return failure(400, '測試模式僅能指定已啟用且列入駕駛名冊的 022443 帳號。');
      }
      await dependencies.savePreferences({
        ...input,
        test_recipient_user_id: testRecipientId,
        updatedBy: dependencies.actorId,
      });
      await dependencies.audit('preferences', {
        personal_enabled: input.personal_enabled,
        assignment_enabled: input.assignment_enabled,
        assignment_revoked_enabled: input.assignment_revoked_enabled,
        test_enabled: input.test_enabled,
      });
      return { status: 200, body: { ok: true, data: { saved: true } } };
    } catch {
      return failure(503, '個人 LINE 通知設定儲存失敗，請確認帳號與資料庫狀態。');
    }
  }

  if (!exactActionBody(body, action, [])) return failure(400, '測試通知不接受收件人或訊息參數。');
  let testRunId: string;
  try {
    testRunId = await dependencies.createTestRun(dependencies.actorId);
  } catch {
    return failure(409, '測試未啟動。請確認測試模式已開啟，且 022443 帳號已啟用、列入駕駛名冊並完成 LINE 綁定。');
  }

  let accepted = false;
  try {
    accepted = await dependencies.runTestWorker(testRunId);
  } catch {
    accepted = false;
  }
  await dependencies.audit(testRunId, { mode: 'synthetic_test', result: accepted ? 'accepted' : 'failed' });
  return accepted
    ? { status: 200, body: { ok: true, data: { accepted: true }, message: '測試通知已由 LINE API 接受，沒有建立或變更派車案件。' } }
    : failure(502, '測試通知未完成；請檢查伺服器設定與 022443 帳號綁定狀態。');
}
