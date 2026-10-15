export const MECHANICAL_PRINT_SINGLE_PAGE_SCALE_FLOOR = 0.82;

export type MechanicalPrintFit =
  | { mode: 'fit'; scale: number }
  | { mode: 'multipage'; scale: 1 };

export function calculateMechanicalPrintFit(availableHeight: number, contentHeight: number): MechanicalPrintFit {
  if (!Number.isFinite(availableHeight) || !Number.isFinite(contentHeight) || availableHeight <= 0 || contentHeight <= 0) {
    return { mode: 'fit', scale: 1 };
  }

  const scale = Math.min(1, availableHeight / contentHeight);
  if (scale < MECHANICAL_PRINT_SINGLE_PAGE_SCALE_FLOOR) return { mode: 'multipage', scale: 1 };
  return { mode: 'fit', scale };
}
