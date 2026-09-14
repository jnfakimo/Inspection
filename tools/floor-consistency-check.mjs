import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedPath = path.join(root, 'supabase/functions/_shared/floor.ts');
const source = fs.readFileSync(sharedPath, 'utf8')
  .replaceAll('export function ', 'function ')
  .replace(/: unknown/g, '')
  .replace(/: string(?=\s*\{)/g, '')
  .replace(/: number(?=\s*\{)/g, '');
const { canonicalFloor, floorOrder } = Function(`${source}\nreturn { canonicalFloor, floorOrder };`)();

const groups = [
  [['B1', 'B1F', '地下1樓', '地下1層', ' b1 f '], 'B1'],
  [['B2', 'B2F'], 'B2'],
  [['1', '1F', '1樓', '01F'], '1F'],
  [['RF', 'R', 'PH', 'ROOF', '頂樓', '屋頂', 'RF頂'], 'RF'],
];
for (const [values, expected] of groups) {
  for (const value of values) {
    const actual = canonicalFloor(value);
    if (actual !== expected) throw new Error(`樓層正規化失敗：${JSON.stringify(value)} → ${actual}（應為 ${expected}）`);
  }
}
if (!(floorOrder('B2') < floorOrder('B1') && floorOrder('B1') < floorOrder('1F') && floorOrder('1F') < floorOrder('RF'))) {
  throw new Error('樓層排序順序不符合 B2 → B1 → 1F → RF');
}

const requiredSources = [
  'web/lib/floor.ts',
  'system/theme.js',
  'system/floor-utils.js',
  'supabase/functions/app-api/index.ts',
  'supabase/functions/admin-api/index.ts',
  'supabase/functions/patrol-checkin/index.ts',
  'web/app/systems/[system]/[module]/floor-stack-3d.tsx',
];
for (const relative of requiredSources) {
  const file = fs.readFileSync(path.join(root, relative), 'utf8');
  if (!file.includes('canonicalFloor')) throw new Error(`${relative} 未接入共用樓層正規化規則`);
}

// 檢視頁一律使用同一份 GLB manifest；PNG 只留在建模／標記編修流程。
const glbReaders = [
  'web/app/systems/[system]/[module]/structuremap-viewers.tsx',
  'web/app/systems/[system]/[module]/structuremap-floor3d.tsx',
  'web/app/systems/[system]/[module]/patrol-map3d.tsx',
  'web/app/systems/[system]/[module]/repair-map3d.tsx',
];
for (const relative of glbReaders) {
  const file = fs.readFileSync(path.join(root, relative), 'utf8');
  if (!file.includes('loadMarketBimModels')) throw new Error(`${relative} 未讀取共用 GLB manifest`);
  if (!file.includes('FloorStack3D')) throw new Error(`${relative} 未使用共用 GLB 算繪元件`);
  if (/signFloorplanPaths|signFloorPlanVariants/.test(file)) throw new Error(`${relative} 不得回退載入 PNG`);
}

const glbHelper = fs.readFileSync(path.join(root, 'web/lib/market-bim-models.ts'), 'utf8');
for (const token of ['MARKET_BIM_MANIFEST_URL', '/Inspection/v2/models/market-bim/manifest.json', 'glb_bounds']) {
  if (!glbHelper.includes(token)) throw new Error(`market-bim-models.ts 缺少 GLB 共用設定：${token}`);
}

// 報修與巡檢 3D 共用 FloorStack3D 的即時點位縮放，不可只在其中一張圖提供控制。
const stack3d = fs.readFileSync(path.join(root, 'web/app/systems/[system]/[module]/floor-stack-3d.tsx'), 'utf8');
if (!stack3d.includes('markerScale') || !stack3d.includes('dotsRef')) {
  throw new Error('FloorStack3D 缺少不重建場景的點位縮放介面');
}
if (!stack3d.includes('GLTFLoader') || stack3d.includes('TextureLoader') || stack3d.includes('addLegacyPlane')) {
  throw new Error('FloorStack3D 必須只載入 GLB，不得保留 PNG 貼圖或失敗備援');
}
const floor2d = fs.readFileSync(path.join(root, 'web/app/systems/[system]/[module]/structuremap-viewers.tsx'), 'utf8');
if (!floor2d.includes('planMode') || !floor2d.includes('onPlanClick')) {
  throw new Error('平面圖未使用 GLB 正交俯視與控制點定位介面');
}
for (const relative of [
  'web/app/systems/[system]/[module]/patrol-map3d.tsx',
  'web/app/systems/[system]/[module]/repair-map3d.tsx',
]) {
  const file = fs.readFileSync(path.join(root, relative), 'utf8');
  if (!file.includes('markerScale=') || !/type="range"/.test(file)) {
    throw new Error(`${relative} 未提供 3D 圖面點位大小拉桿`);
  }
}

// 樓層圖的選圖規則（成品圖與尺寸）只能有一份：四個檢視器都必須走 web/lib/floorplan-storage.ts
// 的 signFloorPlanVariants，不可以各自組 light/、tech/、mobile/ 的路徑字串。
const variantHelper = fs.readFileSync(path.join(root, 'web/lib/floorplan-storage.ts'), 'utf8');
for (const token of ['export async function signFloorPlanVariants', "`light/${sizeDir}${path}`", "`tech/${sizeDir}${path}`"]) {
  if (!variantHelper.includes(token)) throw new Error(`floorplan-storage.ts 缺少成品圖選圖邏輯：${token}`);
}

const modeler = fs.readFileSync(path.join(root, 'web/app/systems/structuremap/modeler/modeler-client.tsx'), 'utf8');
for (const token of ["storage.from('floorplans')", "invokeAppApi('save_floor_model'", 'image_path: path']) {
  if (!modeler.includes(token)) throw new Error(`3D 建模系統未完整寫入共用圖資：缺少 ${token}`);
}

const v2NavigationSources = [
  'web/app/systems/[system]/[module]/structuremap-modelhub.tsx',
  'web/app/systems/[system]/[module]/structuremap-markerboard.tsx',
  'web/app/systems/[system]/[module]/structuremap-arealist.tsx',
  'web/app/systems/[system]/[module]/patrol-pointlist.tsx',
];
const forbiddenLegacyDestinations = [
  'modeler.html', 'arealist.html', 'b1_integrated_marker_system.html',
  'floor3d.html', 'patrollist.html', 'guardpatrol.html', 'admin.html',
];
for (const relative of v2NavigationSources) {
  const file = fs.readFileSync(path.join(root, relative), 'utf8');
  for (const legacy of forbiddenLegacyDestinations) {
    if (file.includes('${LEGACY_BASE}/' + legacy)) {
      throw new Error(`${relative} 仍導向 V1 圖資功能：${legacy}`);
    }
  }
}

console.log('樓層與圖資一致性檢查通過：V2 平面圖／3D 圖／巡檢雲臺共用 GLB manifest，沒有 PNG 回退。');
