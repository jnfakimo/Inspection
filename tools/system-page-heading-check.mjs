import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { systems } from '../web/lib/modules.ts';

const moduleCount = systems.reduce((total, system) => total + system.modules.length, 0);
assert.equal(systems.length, 9, '系統標題稽核必須涵蓋 9 大系統');
assert.equal(moduleCount, 49, '系統標題稽核必須涵蓋 49 個子系統');

for (const system of systems) {
  const iconPath = `.${system.icon.replace('/Inspection', '')}`;
  assert.ok(existsSync(iconPath), `${system.key} 的正式 Logo 不存在：${iconPath}`);
}

const component = readFileSync('web/components/SystemPageHeader.tsx', 'utf8');
assert.match(component, /topbarGapPx:\s*22/);
assert.match(component, /titleFontSizePx:\s*26/);
assert.match(component, /titleColor:\s*'var\(--cyan\)'/);
assert.match(component, /logoSizePx:\s*42/);
assert.match(component, /src=\{system\.icon\}/);
assert.match(component, /data-system-page-heading="standard"/);
assert.match(component, /title \|\| system\.title/);
assert.match(component, /metaTitle \|\| module\.title/);
assert.match(component, /description \|\| module\.description/);

const shell = readFileSync('web/components/AppShell.tsx', 'utf8');
assert.match(shell, /<SystemPageHeader system=\{headingSystem\} module=\{headingModule\}/);
assert.match(shell, /admin-v2-content">\{pageHeading\}\{children\}/);
assert.match(shell, /v1-content">\{pageHeading\}\{children\}/);

const handover = readFileSync('web/app/systems/[system]/[module]/handover-workspace.tsx', 'utf8');
assert.match(handover, /heading=\{\{ system, module, title: module\.title, metaTitle: system\.title \}\}/,
  '交接紀錄首頁必須使用模組名稱作為大標題');

const systemHub = readFileSync('web/app/systems/[system]/system-hub-client.tsx', 'utf8');
assert.match(systemHub, /metaTitle: '系統入口', description: system\.description/,
  '駐衛警系統入口必須使用共用標題與系統說明');
const operationsCss = readFileSync('web/app/systems/[system]/[module]/operations.css', 'utf8');
assert.match(operationsCss, /\.operations-portal-grid\.patrol\{[\s\S]*?width:100%/,
  '駐衛警入口圖卡區必須維持桌面圖卡規格');
assert.match(operationsCss, /grid-template-columns:repeat\(4,269px\)/,
  '駐衛警入口桌面四張圖卡必須固定為 269px 欄寬');
assert.match(operationsCss, /\.operations-portal-grid\.patrol \.operations-portal-card\{[\s\S]*?width:269px;[\s\S]*?height:200px;[\s\S]*?min-height:200px;/,
  '駐衛警入口桌面圖卡必須固定為 269×200px');
assert.match(operationsCss, /@media \(max-width:1100px\)[\s\S]*?\.operations-portal-grid\.patrol\{width:100%;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/,
  '駐衛警入口必須隨瀏覽器縮放／視窗寬度恢復滿寬');

const css = readFileSync('web/app/v1-layout.css', 'utf8');
assert.match(css, /\.system-page-heading\{[^}]*padding:2px 0 16px/);
assert.match(css, /\.content\.v1-content:has\(>\.system-page-heading\)\{padding-top:20px\}/);
assert.match(css, /\.system-page-heading h1\{[^}]*color:var\(--cyan\)[^}]*font-size:26px/);
assert.match(css, /\.system-page-heading>img\{[^}]*width:42px;height:42px/);

const compactPages = [
  ['structuremap/floor2d', 'web/app/systems/[system]/[module]/structuremap-viewers.tsx'],
  ['structuremap/floor3d', 'web/app/systems/[system]/[module]/structuremap-floor3d.tsx'],
  ['guardpatrol/map3d', 'web/app/systems/[system]/[module]/patrol-map3d.tsx'],
];
for (const [route, file] of compactPages) {
  const source = readFileSync(file, 'utf8');
  assert.match(source, /data-system-page-heading="compact"/, `${route} 缺少全螢幕緊湊標題`);
  assert.match(source, /data-system-page-logo/, `${route} 缺少對應系統 Logo`);
}

console.log(`系統頁標題一致性檢查通過：${systems.length} 大系統、${moduleCount} 個子系統；46 個標準頁首、3 個全螢幕緊湊頁首。`);
