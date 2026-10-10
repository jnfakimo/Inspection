export type RepairDetailSession = Readonly<{
  generation: number;
  requestId: string;
}>;

export function captureRepairDetailSession(
  active: RepairDetailSession | null,
  requestId: string,
): RepairDetailSession | null {
  if (!active || !requestId || active.requestId !== requestId) return null;
  return { generation: active.generation, requestId: active.requestId };
}

export function isRepairDetailSessionCurrent(
  active: RepairDetailSession | null,
  captured: RepairDetailSession | null,
): boolean {
  return Boolean(active && captured
    && active.generation === captured.generation
    && active.requestId === captured.requestId);
}

type RepairMutationRefreshOptions = {
  session: RepairDetailSession | null;
  getActiveSession: () => RepairDetailSession | null;
  mutate: () => Promise<unknown>;
  reload: () => Promise<unknown>;
  clearError: () => void;
  onError: (error: unknown) => void;
  setBusy: (busy: boolean) => void;
  onSuccess?: () => void;
  refreshDetail: () => void;
};

/** Keep a completed action's list refresh, but only update the detail view it started from. */
export async function runRepairMutationWithDetailRefresh({
  session,
  getActiveSession,
  mutate,
  reload,
  clearError,
  onError,
  setBusy,
  onSuccess,
  refreshDetail,
}: RepairMutationRefreshOptions): Promise<void> {
  const isCurrent = () => isRepairDetailSessionCurrent(getActiveSession(), session);
  setBusy(true);
  try {
    if (isCurrent()) clearError();
    await mutate();
    if (isCurrent()) onSuccess?.();
    await reload();
    if (isCurrent()) refreshDetail();
  } catch (error) {
    if (isCurrent()) onError(error);
  } finally {
    setBusy(false);
  }
}
