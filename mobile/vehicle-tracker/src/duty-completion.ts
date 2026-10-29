import type { ActiveTrackingSession } from './types';

type Dependencies = {
  stopTracking(): Promise<void>;
  flushQueue(): Promise<number>;
  hasPendingPoints(sessionId: string): Promise<boolean>;
  endSession(sessionId: string): Promise<void>;
  clearSession(): Promise<void>;
};

/** Never close the server duty while its offline points still require an active duty for RLS. */
export async function completeTrackingDuty(session: ActiveTrackingSession, deps: Dependencies) {
  await deps.stopTracking();
  try {
    await deps.flushQueue();
    if (await deps.hasPendingPoints(session.sessionId)) throw new Error('pending points');
  } catch {
    throw new Error('定位資料尚未完成補傳，勤務尚未結束。定位已停止，請恢復網路後再次按結束勤務。');
  }
  await deps.endSession(session.sessionId);
  await deps.clearSession();
}
