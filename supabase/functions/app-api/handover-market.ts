export type HandoverMarket = 'market_1' | 'market_2';
export type HandoverTeam = 'business' | 'guard' | 'mechanical';

type Department = { dept_id?: unknown; parent_id?: unknown; code?: unknown; status?: unknown };

export function handoverMarket(value: unknown): HandoverMarket | null {
  return value === 'market_1' || value === 'market_2' ? value : null;
}

/** Department IDs are authoritative; the cached free-text users.department is never used for authorization. */
export function staffMarketFromOrganization(departmentId: unknown, departments: Department[], team: Exclude<HandoverTeam, 'mechanical'>): HandoverMarket | null {
  const byId = new Map(departments.filter(row => row.status === undefined || row.status === 'active')
    .map(row => [String(row.dept_id || ''), row]));
  const leaf = byId.get(String(departmentId || ''));
  if (!leaf || !String(leaf.code || '').endsWith(team === 'business' ? '-ADMIN' : '-GUARD')) return null;
  const root = byId.get(String(leaf.parent_id || ''));
  return root?.code === 'MKT1' ? 'market_1' : root?.code === 'MKT2' ? 'market_2' : null;
}

export function canUseHandoverMarket(requested: unknown, assigned: HandoverMarket | null, sysadmin: boolean): requested is HandoverMarket {
  const market = handoverMarket(requested);
  return market !== null && (sysadmin || market === assigned);
}

type MarketRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

/** Every market-aware read/write calls this server-side; a UI choice is never authority. */
export async function authorizeHandoverMarket(
  client: MarketRpcClient,
  actorId: string,
  team: HandoverTeam,
  requested: unknown,
  sysadmin: boolean,
): Promise<HandoverMarket | null> {
  const market = handoverMarket(requested);
  if (!market) return null;
  if (sysadmin) return market;
  const { data, error } = await client.rpc('handover_staff_markets', { p_user: actorId, p_team: team });
  if (error) throw error;
  return Array.isArray(data) && data.includes(market) ? market : null;
}
