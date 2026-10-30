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
  let sessionRevision = 0;
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
        sessionRevision++;
        await deps.stopTracking();
        if (!isCurrent()) return false;
        await deps.writeSession({ ...session, completionPending: true });
        // Sign-out/new activation is serialized behind this write and owns its cleanup.
        return isCurrent();
      });
    },
    clearCompleted(session: ActiveTrackingSession, isCurrent: () => boolean) {
      return enqueue(async () => {
        if (!isCurrent()) return false;
        const stored = await deps.readSession();
        if (!isCurrent() || (stored && (stored.sessionId !== session.sessionId || stored.driverId !== session.driverId))) return false;
        sessionRevision++;
        await deps.writeSession(null);
        return isCurrent();
      });
    },
    activate(session: ActiveTrackingSession, isCurrent: () => boolean) {
      return enqueue(async () => {
        if (!isCurrent()) return false;
        sessionRevision++;
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
      while (isCurrent()) {
        await tracking;
        if (!isCurrent()) return;
        if (cleanupFailed) await enqueue(async () => { if (isCurrent()) await discardTracking(); });
        if (!isCurrent()) return;
        const currentSession = sessionRevision;
        const isSnapshotCurrent = () => isCurrent() && currentSession === sessionRevision;
        let session = await deps.readSession();
        if (!isSnapshotCurrent()) continue;
        if (session && session.driverId !== account.profile.user_id) {
          await enqueue(async () => { if (isSnapshotCurrent()) await discardTracking(); });
          if (!isSnapshotCurrent()) continue;
          session = null;
        }
        if (session) {
          let active: boolean;
          try { active = await deps.isSessionActive(session); }
          catch (error) {
            // Ignore a stale failure; a current failure pauses without erasing offline data.
            if (!isSnapshotCurrent()) continue;
            await enqueue(async () => { if (isSnapshotCurrent()) await deps.stopTracking(); });
            if (!isSnapshotCurrent()) continue;
            throw error;
          }
          // No network request holds the native-operation queue. Re-read after a local
          // activation/completion instead of applying an old response to the new duty.
          if (!isSnapshotCurrent()) continue;
          if (!active) {
            await enqueue(async () => { if (isSnapshotCurrent()) await discardTracking(); });
            if (!isSnapshotCurrent()) continue;
            session = null;
            deps.warn('原勤務已結束或已無法使用，已停止定位；尚未補傳的資料仍保留在手機。');
          }
        }
        if (session?.completionPending) {
          await enqueue(async () => { if (isSnapshotCurrent()) await deps.stopTracking(); });
          if (isSnapshotCurrent()) deps.warn('勤務結束尚待確認，定位維持停止；請再次按結束勤務。');
        } else if (session) {
          await enqueue(async () => {
            if (!isSnapshotCurrent()) return;
            try { await deps.startTracking(); }
            catch {
              if (isSnapshotCurrent()) deps.warn('定位勤務仍在進行，但背景定位權限需要重新確認。');
            }
          });
        }
        if (isSnapshotCurrent()) { deps.publish(account, session); return; }
      }
    },
  };
}
