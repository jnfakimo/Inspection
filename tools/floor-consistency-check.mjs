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
console.log('樓層代碼一致性檢查通過：B1/B1F、數字樓層與 RF/頂樓均使用同一規則。');
