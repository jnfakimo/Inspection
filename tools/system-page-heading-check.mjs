import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { systems } from '../web/lib/modules.ts';

const moduleCount = systems.reduce((total, system) => total + system.modules.length, 0);
assert.equal(systems.length, 11, '系統標題稽核必須涵蓋 11 大系統');
assert.equal(moduleCount, 54, '系統標題稽核必須涵蓋 54 個子系統');

for (const system of systems) {
  const iconPath = `.${system.icon.replace('/Inspection', '')}`;
  assert.ok(existsSync(iconPath), `${system.key} 的正式 Logo 不存在：${iconPath}`);
  // 系統 Logo 最大顯示尺寸是入口圖卡的 88px，來源一律收在 320px 以內（見 AGENTS.md）。
  // 2026-08-28 曾有 1254px、1MB 以上的 PNG 直接上線，入口頁光圖示就要載 2.6MB。
  const bytes = statSync(iconPath).size;
  assert.ok(bytes <= 200 * 1024,
    `${system.key} 的 Logo 過大（${Math.round(bytes / 1024)} KB）：系統圖示請縮到 320px 以內再進版控`);
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
assert.match(operationsCss, /\.operations-portal-grid\.handover\{grid-template-columns:repeat\(3,269px\);justify-content:center\}/,
  '交接紀錄子系統桌面圖卡必須維持 269px 欄寬');
assert.match(operationsCss, /\.operations-portal-grid\.handover \.operations-portal-card\{width:269px;height:200px;min-height:200px/,
  '交接紀錄子系統桌面圖卡必須固定為 269×200px');

const css = readFileSync('web/app/v1-layout.css', 'utf8');
assert.match(css, /\.maintenance-hub-grid\{grid-template-columns:repeat\(3,269px\);justify-content:center\}/,
  '維修入口三張主圖卡必須以 269px 欄寬置中');
assert.match(css, /\.maintenance-card\{width:269px;height:200px;min-height:200px/,
  '維修入口三張主圖卡必須固定為 269×200px');
assert.match(css, /\.workorder-summary\{display:grid;grid-template-columns:repeat\(7,108px\);gap:10px;justify-content:center\}/,
  '維修入口七張統計小卡必須維持 108px 欄寬與 10px 間距');
assert.match(css, /\.workorder-summary article\{width:108px;height:52px/,
  '維修入口七張統計小卡必須固定為 108×52px');
assert.match(css, /\.system-page-heading\{[^}]*padding:2px 0 16px/);
assert.match(css, /\.content\.v1-content:has\(>\.system-page-heading\)\{padding-top:20px\}/);
assert.match(css, /\.system-page-heading h1\{[^}]*color:var\(--cyan\)[^}]*font-size:26px/);
assert.match(css, /\.system-page-heading>img\{[^}]*width:42px;height:42px/);

// 手機版頁首操作按鈕一律靠右（2026-08-28 全站規範）。這條規則放在 admin-workspace.css
// 的 800px 斷點，涵蓋所有使用 AdminHeader 的子系統；若被改回靠左或被逐頁規則取代，
// 這裡會擋下來。
const adminCss = readFileSync('web/app/admin-workspace.css', 'utf8');
assert.match(adminCss, /@media \(max-width:800px\)\{[^@]*\.admin-page-actions>div:last-child\{width:100%;justify-content:flex-end\}/,
  '手機版 AdminHeader 的操作按鈕必須靠右（.admin-page-actions>div:last-child）');
assert.doesNotMatch(adminCss, /\.admin-page-actions:has\(/,
  '頁首靠右已是全站規則，不要再為個別頁面加 :has() 的重複宣告');

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

console.log(`系統頁標題一致性檢查通過：${systems.length} 大系統、${moduleCount} 個子系統；50 個標準頁首、3 個全螢幕緊湊頁首。`);
