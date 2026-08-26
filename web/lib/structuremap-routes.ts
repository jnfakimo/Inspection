const V2_BASE = '/Inspection/v2';

// 圖資專案只允許一組 V2 入口。集中維護可避免整合標記、平面圖與 3D 圖臺
// 各自保留舊版連結，讓使用者誤以為它們讀取不同的專案。
export const STRUCTUREMAP_ROUTES = {
  project: `${V2_BASE}/systems/structuremap/models/`,
  modeler: `${V2_BASE}/systems/structuremap/modeler/`,
  areas: `${V2_BASE}/systems/structuremap/areas/`,
  markers: `${V2_BASE}/systems/structuremap/markers/`,
  floor2d: `${V2_BASE}/systems/structuremap/floor2d/`,
  floor3d: `${V2_BASE}/systems/structuremap/floor3d/`,
  patrolPoints: `${V2_BASE}/systems/guardpatrol/points/`,
  patrolMap3d: `${V2_BASE}/systems/guardpatrol/map3d/`,
  patrolHome: `${V2_BASE}/systems/guardpatrol/`,
} as const;
