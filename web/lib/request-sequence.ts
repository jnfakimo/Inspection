/** Invalidates stale async results when inputs change or their owner unmounts. */
export type DateRange = { from: string; to: string };

export function dateRangeChanged(current: DateRange, next: DateRange) {
  return current.from !== next.from || current.to !== next.to;
}

export function isValidDateRange(range: DateRange) {
  return Boolean(range.from && range.to && range.from <= range.to);
}

export function createRequestSequence() {
  let current = 0;

  return {
    begin() {
      current += 1;
      return current;
    },
    invalidate() {
      current += 1;
    },
    isCurrent(sequence: number) {
      return sequence === current;
    },
  };
}
