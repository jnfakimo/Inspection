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

const shell = readFileSync('web/components/AppShell.tsx', 'utf8');
assert.match(shell, /<SystemPageHeader system=\{routeSystem\} module=\{routeModule\}/);
assert.match(shell, /admin-v2-content">\{pageHeading\}\{children\}/);
assert.match(shell, /v1-content">\{pageHeading\}\{children\}/);

const css = readFileSync('web/app/v1-layout.css', 'utf8');
assert.match(css, /\.system-page-heading\{[^}]*padding:2px 0 16px/);
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
