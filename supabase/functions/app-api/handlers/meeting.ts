// SYS-08 會議室預約：會議報到與會議室主檔。
// 自 index.ts 原樣搬出（app-api 依業務拆檔），業務邏輯與錯誤訊息未更動。
import type { AppApiContext } from '../context.ts';
import { text } from '../validate.ts';
import { writeAudit } from '../audit.ts';
import { canonicalFloor } from '../../_shared/floor.ts';

export const MEETING_ACTIONS = new Set(['meeting_check_in', 'meeting_save_room']);

/** 處理SYS-08 會議室預約相關 action；不屬於本業務時回傳 null，由 index.ts 繼續往下分派。 */
export async function handleMeetingAction(action: string, ctx: AppApiContext): Promise<Response | null> {
  const { req, body, profile, userDb, reply, can, canModule, isAdmin } = ctx;
  if (action === 'meeting_check_in') {
    if (!can('meetingroom')) return reply(req, { ok: false, message: '目前角色沒有會議室系統權限' }, 403);
    if (!canModule('meetingroom', 'bookings')) return reply(req, { ok: false, message: '目前帳號未開放會議預約子系統' }, 403);
    const bookingId = text(body.booking_id, 80);
    if (!/^[0-9a-f-]{36}$/i.test(bookingId)) return reply(req, { ok: false, message: '預約識別碼無效' }, 400);

    const { data: booking, error: readError } = await userDb.from('meeting_bookings')
      .select('booking_id,status,booking_date,start_time,end_time').eq('booking_id', bookingId).maybeSingle();
    if (readError) throw readError;
    if (!booking) return reply(req, { ok: false, message: '找不到這筆預約' }, 404);
    if (booking.status !== 'booked') return reply(req, { ok: false, message: '這筆預約目前狀態不可報到' }, 409);

    // 報到時段檢查原本只存在於 V1 前端（canCheckIn），資料庫沒有這道約束。
    // 這裡明確以 Asia/Taipei (+08:00) 解析，不依賴函式執行環境的時區。
    const now = Date.now();
    const startAt = Date.parse(`${booking.booking_date}T${booking.start_time}+08:00`);
    const endAt = Date.parse(`${booking.booking_date}T${booking.end_time}+08:00`);
    if (Number.isNaN(startAt) || Number.isNaN(endAt)) return reply(req, { ok: false, message: '預約時間資料異常' }, 409);
    if (now < startAt || now > endAt) return reply(req, { ok: false, message: '目前不在會議時段內，無法報到' }, 409);

    // 併帶 status 條件，避免兩個分頁同時按下造成重複報到。
    const { data: updated, error } = await userDb.from('meeting_bookings')
      .update({ status: 'checked_in', checked_in_at: new Date().toISOString() })
      .eq('booking_id', bookingId).eq('status', 'booked').select('booking_id').maybeSingle();
    if (error) throw error;
    if (!updated) return reply(req, { ok: false, message: '這筆預約已被處理，請重新整理' }, 409);

    await writeAudit(userDb, profile.user_id, 'meeting_bookings', bookingId, 'update',
      { status: booking.status }, { status: 'checked_in' });
    return reply(req, { ok: true, data: { booking_id: bookingId, status: 'checked_in' } });
  }

  if (action === 'meeting_save_room') {
    if (!can('meetingroom')) return reply(req, { ok: false, message: '目前角色沒有會議室系統權限' }, 403);
    if (!canModule('meetingroom', 'rooms')) return reply(req, { ok: false, message: '目前帳號未開放會議室管理子系統' }, 403);
    if (!isAdmin) return reply(req, { ok: false, message: '只有管理者可以維護會議室主檔' }, 403);

    const name = text(body.name, 120);
    if (!name) return reply(req, { ok: false, message: '請輸入會議室名稱' }, 400);
    const status = body.status === 'inactive' ? 'inactive' : 'active';
    const floor = canonicalFloor(text(body.floor, 40)) || null;
    const note = text(body.note, 500) || null;
    let capacity: number | null = null;
    if (body.capacity !== null && body.capacity !== undefined && body.capacity !== '') {
      const parsed = Number(body.capacity);
      if (!Number.isInteger(parsed) || parsed < 0) return reply(req, { ok: false, message: '容量請填 0 以上的整數' }, 400);
      capacity = parsed;
    }
    const payload = { name, capacity, floor, status, note };

    const roomId = text(body.room_id, 80);
    if (roomId) {
      if (!/^[0-9a-f-]{36}$/i.test(roomId)) return reply(req, { ok: false, message: '會議室識別碼無效' }, 400);
      const { data: before, error: readError } = await userDb.from('meeting_rooms')
        .select('room_id,name,capacity,floor,status,note').eq('room_id', roomId).maybeSingle();
      if (readError) throw readError;
      if (!before) return reply(req, { ok: false, message: '找不到這間會議室' }, 404);
      const { error } = await userDb.from('meeting_rooms').update(payload).eq('room_id', roomId);
      if (error) throw error;
      await writeAudit(userDb, profile.user_id, 'meeting_rooms', roomId, 'update', before, payload);
      return reply(req, { ok: true, data: { room_id: roomId, created: false } });
    }

    const { data, error } = await userDb.from('meeting_rooms')
      .insert({ ...payload, created_by: profile.user_id }).select('room_id').single();
    if (error) throw error;
    await writeAudit(userDb, profile.user_id, 'meeting_rooms', data.room_id, 'insert', null, payload);
    return reply(req, { ok: true, data: { room_id: data.room_id, created: true } });
  }
  return null;
}
