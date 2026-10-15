type RefreshResult = { ok: true } | { ok: false; error: unknown };

/** Keeps a successful create distinct from a later list-refresh failure. */
export async function createThenRefresh<T>(
  create: () => Promise<T>,
  refresh: () => Promise<RefreshResult>,
): Promise<{ created: true; refreshed: true; value: T } | { created: true; refreshed: false; value: T; error: unknown }> {
  const value = await create();
  try {
    const result = await refresh();
    if (result.ok) return { created: true, refreshed: true, value };
    return { created: true, refreshed: false, value, error: result.error };
  } catch (error) {
    return { created: true, refreshed: false, value, error };
  }
}
