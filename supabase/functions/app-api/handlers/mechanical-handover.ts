import type { AppApiContext } from '../context.ts';
import { text, validISODate } from '../validate.ts';

const id = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '')) ? String(value) : null;

/** 機電課交接雙方均以登入權杖簽認；簽名人與伺服器時間不接受前端代填。 */
export async function handleMechanicalHandoverAction(action: string, ctx: AppApiContext): Promise<Response | null> {
  if (!['mechanical_handover_day', 'mechanical_handover_receivers', 'mechanical_handover_action'].includes(action)) return null;
  const { req, body, userDb, reply, can, canModule } = ctx;
  if (!can('handover') || !canModule('handover', 'mechanical')) {
    return reply(req, { ok: false, message: '目前帳號未開放機電課交接簿' }, 403);
  }
  if (action === 'mechanical_handover_receivers') {
    const { data, error } = await userDb.rpc('mechanical_handover_receivers');
    if (error) throw error;
    return reply(req, { ok: true, data });
  }
  const date = text(body.handover_date, 10);
  if (!validISODate(date)) return reply(req, { ok: false, message: '交接日期格式無效' }, 400);
  if (action === 'mechanical_handover_day') {
    const { data, error } = await userDb.rpc('mechanical_handover_day', { p_date: date });
    if (error) throw error;
    return reply(req, { ok: true, data });
  }
  const operation = text(body.operation, 20), shift = text(body.shift_code, 10);
  const receiver = id(body.receiver_id), revision = text(body.revision, 32);
  if (!['submit', 'receive'].includes(operation) || !['01-09', '09-17', '17-01'].includes(shift)
    || (operation === 'submit' && !receiver) || !/^[a-f0-9]{32}$/.test(revision)) {
    return reply(req, { ok: false, message: '請完整選擇班別、接班人並重新確認交接內容' }, 400);
  }
  const { data, error } = await userDb.rpc('mechanical_handover_action', {
    p_action: operation, p_date: date, p_shift: shift, p_receiver: receiver || null, p_revision: revision,
  });
  if (error) return reply(req, { ok: false, message: String(error.message || '交接未完成，請重新載入') }, error.code === '42501' ? 403 : 409);
  return reply(req, { ok: true, data });
}
