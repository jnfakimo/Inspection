export type QueryErrorResult = { error?: unknown } | null | undefined;

export function firstQueryError(...results: QueryErrorResult[]): unknown | null {
  for (const result of results) {
    if (result?.error) return result.error;
  }
  return null;
}
