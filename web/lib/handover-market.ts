export type HandoverMarket = 'market_1' | 'market_2';

export const HANDOVER_MARKETS: Record<HandoverMarket, { short: string; name: string }> = {
  market_1: { short: '一市', name: '第一果菜批發市場' },
  market_2: { short: '二市', name: '第二果菜批發市場' },
};

export function isHandoverMarket(value: unknown): value is HandoverMarket {
  return value === 'market_1' || value === 'market_2';
}

type Department = { dept_id?: unknown; parent_id?: unknown; code?: unknown; name?: unknown; status?: unknown };

/** Only an active team beneath MKT1/MKT2 establishes a market affiliation. */
export function marketForDepartment(departmentId: unknown, rows: Department[], teamCode: 'ADMIN' | 'GUARD'): HandoverMarket | null {
  const byId = new Map(rows.filter(row => row.status === undefined || row.status === 'active')
    .map(row => [String(row.dept_id || ''), row]));
  const team = byId.get(String(departmentId || ''));
  if (!team || !String(team.code || '').endsWith(`-${teamCode}`)) return null;
  const root = byId.get(String(team.parent_id || ''));
  if (root?.code === 'MKT1') return 'market_1';
  if (root?.code === 'MKT2') return 'market_2';
  return null;
}
