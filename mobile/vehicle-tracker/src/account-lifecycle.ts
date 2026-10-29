import type { ActiveTrackingSession } from './types';

type Dependencies<Account extends { profile: { user_id: string } }> = {
  readAccount(): Promise<Account | null>;
  readSession(): Promise<ActiveTrackingSession | null>;
  isSessionActive(session: ActiveTrackingSession): Promise<boolean>;
  writeSession(session: ActiveTrackingSession | null): Promise<void>;
  startTracking(): Promise<void>;
  stopTracking(): Promise<void>;
  publish(account: Account, session: ActiveTrackingSession | null): void;
  clearAccount(): void;
  warn(message: string): void;
};

/** Keep delayed account reads and native tracking starts from undoing sign-out. */
export function createAccountLifecycle<Account extends { profile: { user_id: string } }>(deps: Dependencies<Account>) {
  let revision = 0;
  let tracking: Promise<void> = Promise.resolve();
  let cleanupFailed = false;
  const enqueue = <T>(operation: () => Promise<T>) => {
    const result = tracking.then(operation);
    tracking = result.then(() => undefined, () => undefined);
    return result;
  };
  const discardTracking = async () => {
    // Attempt both even when native stop fails; no persisted session means callbacks cannot collect GPS.
    const results = await Promise.allSettled([deps.stopTracking(), deps.writeSession(null)]);
    const failed = results.find(result => result.status === 'rejected');
    cleanupFailed = Boolean(failed);
    if (failed?.status === 'rejected') throw failed.reason;
  };
  const clear = () => {
    revision++;
    deps.clearAccount();
    return enqueue(discardTracking);
  };
  return {
    cancelPending() { revision++; },
    capture() { const current = revision; return () => current === revision; },
    clear,
    markCompleting(session: ActiveTrackingSession, isCurrent: () => boolean) {
      return enqueue(async () => {
        if (!isCurrent()) return false;
        await deps.stopTracking();
        if (!isCurrent()) return false;
        await deps.writeSession({ ...session, completionPending: true });
        // Sign-out/new activation is serialized behind this write and owns its cleanup.
        return isCurrent();
      });
    },
    activate(session: ActiveTrackingSession, isCurrent: () => boolean) {
      return enqueue(async () => {
        if (!isCurrent()) return false;
        try {
          await deps.writeSession(session);
          if (isCurrent()) await deps.startTracking();
          if (isCurrent()) return true;
        } catch (error) {
          await discardTracking();
          throw error;
        }
        await discardTracking();
        return false;
      });
    },
    async refresh() {
      const current = ++revision;
      const isCurrent = () => current === revision;
      deps.clearAccount();
      const account = await deps.readAccount();
      if (!isCurrent()) return;
      if (!account) { await clear(); return; }
      await tracking;
      if (!isCurrent()) return;
      if (cleanupFailed) await enqueue(discardTracking);
      if (!isCurrent()) return;
      let session = await deps.readSession();
      if (!isCurrent()) return;
      if (session && session.driverId !== account.profile.user_id) {
        await enqueue(discardTracking);
        session = null;
      }
      if (!isCurrent()) return;
      if (session) {
        let active: boolean;
        try { active = await deps.isSessionActive(session); }
        catch (error) {
          // An unavailable lookup must not erase offline data or resume an unconfirmed duty.
          if (!isCurrent()) return;
          await enqueue(async () => { if (isCurrent()) await deps.stopTracking(); });
          throw error;
        }
        if (!isCurrent()) return;
        if (!active) {
          await enqueue(async () => { if (isCurrent()) await discardTracking(); });
          if (!isCurrent()) return;
          session = null;
          deps.warn('原勤務已結束或已無法使用，已停止定位；尚未補傳的資料仍保留在手機。');
        }
      }
      if (session?.completionPending) {
        await enqueue(async () => { if (isCurrent()) await deps.stopTracking(); });
        if (isCurrent()) deps.warn('勤務結束尚待確認，定位維持停止；請再次按結束勤務。');
      } else if (session) {
        await enqueue(async () => {
          if (!isCurrent()) return;
          try { await deps.startTracking(); }
          catch {
            if (isCurrent()) deps.warn('定位勤務仍在進行，但背景定位權限需要重新確認。');
          }
        });
      }
      if (isCurrent()) deps.publish(account, session);
    },
  };
}
