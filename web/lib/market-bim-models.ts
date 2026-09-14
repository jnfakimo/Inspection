import { canonicalFloor, floorOrder } from '@/lib/floor';

export const MARKET_BIM_MANIFEST_URL = '/Inspection/v2/models/market-bim/manifest.json';

export type MarketBimBounds = {
  min: [number, number];
  max: [number, number];
};

export type MarketBimModel = {
  floor_id: string;
  name: string;
  level: number;
  glb_url: string;
  glb_bounds: MarketBimBounds;
};

type MarketBimManifest = {
  floors?: Array<{
    id?: unknown;
    name?: unknown;
    model?: unknown;
    bounds?: { min?: unknown; max?: unknown };
  }>;
};

function isPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(item => Number.isFinite(Number(item)));
}

/** 3D 頁面的唯一模型來源。PNG 平面圖不在此處載入，也不作為失敗備援。 */
export async function loadMarketBimModels(): Promise<MarketBimModel[]> {
  const response = await fetch(MARKET_BIM_MANIFEST_URL, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`GLB manifest HTTP ${response.status}`);

  const manifest = await response.json() as MarketBimManifest;
  const baseUrl = new URL(MARKET_BIM_MANIFEST_URL, window.location.origin);
  const models = (manifest.floors || []).flatMap(row => {
    const floorId = canonicalFloor(row.id);
    const min = row.bounds?.min;
    const max = row.bounds?.max;
    if (!floorId || typeof row.model !== 'string' || !row.model || !isPair(min) || !isPair(max)) return [];
    return [{
      floor_id: floorId,
      name: typeof row.name === 'string' && row.name ? row.name : floorId,
      // 交由 FloorStack3D 依陣列順序 × gap 堆疊，樓層間距滑桿才會即時生效。
      level: 0,
      glb_url: new URL(row.model, baseUrl).href,
      glb_bounds: {
        min: [Number(min[0]), Number(min[1])] as [number, number],
        max: [Number(max[0]), Number(max[1])] as [number, number],
      },
    }];
  }).sort((a, b) => floorOrder(a.floor_id) - floorOrder(b.floor_id));

  if (!models.length) throw new Error('GLB manifest 沒有可用的樓層模型');
  return models;
}
