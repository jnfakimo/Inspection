export const DASHBOARD_MARKETS = ['第一市場', '第二市場'] as const;
export const DASHBOARD_CATEGORIES = ['蔬菜', '水果'] as const;

export type DashboardMarket = typeof DASHBOARD_MARKETS[number];
export type DashboardCategory = typeof DASHBOARD_CATEGORIES[number];

export type DashboardRotationItem = {
  market: DashboardMarket;
  category: DashboardCategory;
  item: string;
  enabled: boolean;
  sortOrder: number;
};

export type DashboardMarketRotationConfig = {
  sourceId: string;
  autoStepSeconds: number;
  cardsPerGroup: number;
  items: DashboardRotationItem[];
};

export const DEFAULT_DASHBOARD_MARKET_ROTATION: DashboardMarketRotationConfig = {
  sourceId: '',
  autoStepSeconds: 3.5,
  cardsPerGroup: 12,
  items: [],
};

const objectOf = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

const boundedNumber = (value: unknown, fallback: number, minimum: number, maximum: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
};

const isDashboardMarket = (value: string): value is DashboardMarket => (
  (DASHBOARD_MARKETS as readonly string[]).includes(value)
);

const isDashboardCategory = (value: string): value is DashboardCategory => (
  (DASHBOARD_CATEGORIES as readonly string[]).includes(value)
);

export function dashboardRotationGroupKey(market: string, category: string) {
  return `${market}::${category}`;
}

export function normalizeDashboardMarketRotation(value: unknown): DashboardMarketRotationConfig {
  const root = objectOf(value);
  const raw = Object.keys(objectOf(root.market_rotation)).length ? objectOf(root.market_rotation) : root;
  const seen = new Map<string, number>();
  const items: DashboardRotationItem[] = [];

  (Array.isArray(raw.items) ? raw.items : []).forEach((entry, index) => {
    const row = objectOf(entry);
    const market = String(row.market || '').trim();
    const category = String(row.category || '').trim();
    const item = String(row.item || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 160);
    if (!isDashboardMarket(market) || !isDashboardCategory(category) || !item) return;
    const key = `${dashboardRotationGroupKey(market, category)}::${item}`;
    const normalizedItem: DashboardRotationItem = {
      market,
      category,
      item,
      enabled: row.enabled !== false,
      sortOrder: Math.round(boundedNumber(row.sort_order ?? row.sortOrder, (index + 1) * 10, 0, 9999)),
    };
    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) { items[existingIndex] = normalizedItem; return; }
    if (items.length >= 96) return;
    seen.set(key, items.length);
    items.push(normalizedItem);
  });

  return {
    sourceId: String(raw.source_id || raw.sourceId || '').trim().slice(0, 80),
    autoStepSeconds: boundedNumber(raw.auto_step_seconds ?? raw.autoStepSeconds, 3.5, 2, 30),
    cardsPerGroup: Math.round(boundedNumber(raw.cards_per_group ?? raw.cardsPerGroup, 12, 4, 24)),
    items: items.sort((left, right) => left.sortOrder - right.sortOrder),
  };
}

export function serializeDashboardMarketRotation(config: DashboardMarketRotationConfig) {
  const normalized = normalizeDashboardMarketRotation(config);
  return {
    schema_version: 1,
    source_id: normalized.sourceId || undefined,
    selection_mode: 'configured_then_volume',
    auto_step_seconds: normalized.autoStepSeconds,
    cards_per_group: normalized.cardsPerGroup,
    items: normalized.items.map((item, index) => ({
      market: item.market,
      category: item.category,
      item: item.item,
      enabled: item.enabled,
      sort_order: (index + 1) * 10,
    })),
  };
}

export function dashboardRotationItemsForGroup(config: DashboardMarketRotationConfig, market: DashboardMarket, category: DashboardCategory) {
  return config.items.filter(item => item.enabled && item.market === market && item.category === category);
}
