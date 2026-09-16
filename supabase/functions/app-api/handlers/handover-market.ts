import type { AppApiContext } from '../context.ts';
import type { HandoverMarket } from '../handover-market.ts';

/** Read-only market choices. The choice is not authority: every write must repeat this check server-side. */
export async function handleHandoverMarketAction(action: string, ctx: AppApiContext): Promise<Response | null> {
  if (action !== 'handover_market_context') return null;
  const { req, body, profile, admin, reply, can, canModule, isSysadmin } = ctx;
  const team = body?.team;
  if (team !== 'business' && team !== 'guard' && team !== 'mechanical') {
    return reply(req, { ok: false, message: '交接簿種類無效' }, 400);
  }
  if (!can('handover') || !canModule('handover', team)) {
    return reply(req, { ok: false, message: '目前帳號未開放此交接簿' }, 403);
  }
  // 唯一判斷來源在資料庫函式；前端 profile 與自由文字 department 都不構成授權。
  const { data, error } = await admin.rpc('handover_staff_markets', { p_user: profile.user_id, p_team: team });
  if (error) throw error;
  const scoped = Array.isArray(data) ? data.filter((value): value is HandoverMarket => value === 'market_1' || value === 'market_2') : [];
  const markets: HandoverMarket[] = isSysadmin ? ['market_1', 'market_2'] : [...new Set(scoped)];
  const assigned: HandoverMarket | null = markets.length === 1 ? markets[0] : null;
  return reply(req, { ok: true, data: { markets, assigned_market: assigned } });
}
