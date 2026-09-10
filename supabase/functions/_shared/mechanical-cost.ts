/** Money is validated as decimal text, then summed as integer cents. */
export function repairCostCents(value: unknown): number | null | undefined {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  const text = String(value).trim();
  if (!text) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return undefined;
  const [whole, decimal = ''] = text.split('.');
  return Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
}

export function repairCostTotal(rows: { repair_cost?: unknown }[]): number {
  return rows.reduce((sum, row) => sum + (repairCostCents(row.repair_cost) || 0), 0);
}

export function formatRepairCost(cents: number): string {
  const hasCents = cents % 100 !== 0;
  return 'NT$ ' + (cents / 100).toLocaleString('zh-TW', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  });
}
