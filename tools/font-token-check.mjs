import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
// token 正本在 tokens.css；比對前移除冒號與逗號後的空白，讓格式化不影響斷言。
const globalsCss = (read('../web/app/globals.css') + '\n' + read('../web/app/tokens.css')).replace(/([:,])[ \t]+/g, '$1');
const handoverCss = read('../web/app/systems/[system]/[module]/handover-sheet.css');
const businessCss = read('../web/app/systems/[system]/[module]/business-handover.css');
const mechanicalCss = read('../web/app/systems/[system]/[module]/mechanical-handover.css');
const adminCss = read('../web/app/admin-workspace.css');
const settingsCss = read('../web/app/systems/admin/settings/settings.module.css');
const vehicleWorkspace = read('../web/app/systems/[system]/[module]/vehicle-workspace.tsx');
const layout = read('../web/app/layout.tsx');

assert.ok(globalsCss.includes("--font:'Noto Sans TC','Microsoft JhengHei UI','Microsoft JhengHei',sans-serif"), 'body token must prefer Noto Sans TC and keep local CJK fallbacks');
assert.ok(globalsCss.includes("--head:'Rajdhani','Noto Sans TC','Segoe UI','Microsoft JhengHei UI','Microsoft JhengHei',sans-serif"), 'heading token must prefer Rajdhani and keep local fallbacks');
assert.equal((globalsCss.match(/--font:/g) ?? []).length, 1, 'font token must have one effective declaration');
assert.equal((globalsCss.match(/--head:/g) ?? []).length, 1, 'heading token must have one effective declaration');
for (const [name, css] of [['handover', handoverCss], ['business handover', businessCss], ['mechanical handover', mechanicalCss]]) {
  assert.ok(!/font-family:\s*["']?Noto Sans TC["']?\s*,\s*sans-serif/.test(css), `${name} must use the shared font token`);
}
assert.ok(!/font:\s*[^;]*Rajdhani\s*,\s*sans-serif/.test(adminCss), 'admin workspace must use the shared heading token');
assert.ok(!settingsCss.includes('var(--font-rajdhani)'), 'settings must not depend on an undefined font token');
assert.ok(vehicleWorkspace.includes("font-family:'Noto Sans TC','Microsoft JhengHei UI','Microsoft JhengHei',sans-serif"), 'isolated print window must declare the same local fallback chain');
assert.ok(!layout.includes('next/font/'), 'the app must not claim to load an unconfigured Next font');
assert.ok(!/@font-face|fonts\.googleapis\.com/.test(globalsCss), 'global stylesheet must not reference unavailable webfont assets');

console.log('Font token check passed; fonts resolve through declared local/system fallbacks.');
