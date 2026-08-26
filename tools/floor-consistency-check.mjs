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

// 3D 建模系統是 V2 圖資的唯一來源。這些檢查防止新頁面改回靜態圖、
// 公開網址或 V1 頁面，導致同一樓層在整合標記、平面圖與 3D 圖不同步。
const projectReaders = [
  'web/app/systems/[system]/[module]/structuremap-markerboard.tsx',
  'web/app/systems/[system]/[module]/structuremap-viewers.tsx',
  'web/app/systems/[system]/[module]/structuremap-floor3d.tsx',
  'web/app/systems/[system]/[module]/patrol-map3d.tsx',
];
for (const relative of projectReaders) {
  const file = fs.readFileSync(path.join(root, relative), 'utf8');
  if (!file.includes("from('floor_models')")) throw new Error(`${relative} 未直接讀取 3D 建模專案`);
  if (!file.includes('signFloorplanPaths')) throw new Error(`${relative} 未使用私有圖資的短效連結`);
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

console.log('樓層與圖資一致性檢查通過：代碼轉換統一，V2 標記／平面圖／3D 圖／巡檢雲臺共用 3D 建模專案。');
