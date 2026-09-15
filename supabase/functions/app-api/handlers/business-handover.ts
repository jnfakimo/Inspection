import type { AppApiContext } from '../context.ts';
import { text, validISODate } from '../validate.ts';

const id = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || '')) ? String(value) : null;

/** 雙方簽認、續帶與完成均由資料庫交易處理；身分取登入權杖，不接受代簽。 */
export async function handleBusinessHandoverAction(action: string, ctx: AppApiContext): Promise<Response | null> {
  if (!['business_handover_day', 'business_handover_receivers', 'business_handover_action'].includes(action)) return null;
  const { req, body, userDb, reply, can, canModule } = ctx;
  if (!can('handover') || !canModule('handover', 'business')) {
    return reply(req, { ok: false, message: '目前帳號未開放業管組交接簿' }, 403);
  }
  if (action === 'business_handover_receivers') {
    const { data, error } = await userDb.rpc('business_handover_receivers');
    if (error) throw error;
    return reply(req, { ok: true, data });
  }
  const date = text(body.handover_date, 10);
  if (!validISODate(date)) return reply(req, { ok: false, message: '交接日期格式無效' }, 400);
  if (action === 'business_handover_day') {
    const { data, error } = await userDb.rpc('business_handover_day', { p_date: date });
    if (error) throw error;
    return reply(req, { ok: true, data });
  }
  const operation = text(body.operation, 20), shift = text(body.shift_code, 10);
  if (!['complete', 'submit', 'receive'].includes(operation) || !['01-09', '09-17', '17-01'].includes(shift)) {
    return reply(req, { ok: false, message: '交接動作或班別無效' }, 400);
  }
  const entry = id(body.entry_id), receiver = id(body.receiver_id), revision = text(body.revision, 32);
  if ((operation === 'complete' && !entry) || (operation === 'submit' && !receiver)
    || (operation !== 'complete' && !/^[a-f0-9]{32}$/.test(revision))) {
    return reply(req, { ok: false, message: '請完整選擇交接事項、接班人並重新確認內容' }, 400);
  }
  const { data, error } = await userDb.rpc('business_handover_action', {
    p_action: operation, p_date: date, p_shift: shift, p_entry: entry || null,
    p_receiver: receiver || null, p_revision: revision || null,
  });
  if (error) return reply(req, { ok: false, message: String(error.message || '交接未完成，請重新載入') }, error.code === '42501' ? 403 : 409);
  return reply(req, { ok: true, data });
}
