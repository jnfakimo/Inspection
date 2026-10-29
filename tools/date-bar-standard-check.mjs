import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// 日期導覽列（前一天／日期框／後一天／今天）的尺寸規格：桌機一律 --date-bar-control-height（tokens.css，32px，與緊湊按鈕同高）。
// 規則見 AGENTS.md §6「日期導覽列」；新增日期導覽列必須用這個 token，不得另寫固定高度。
const read = file => readFileSync(file, 'utf8');
const moduleDir = 'web/app/systems/[system]/[module]';

const tokens = read('web/app/tokens.css');
assert.match(
  tokens,
  /@media screen and \(min-width:\s*801px\)\s*\{\s*:root\s*\{\s*--date-bar-control-height:\s*32px;\s*\}\s*\}/,
  'tokens.css 必須在桌機（≥801px）定義 --date-bar-control-height: 32px',
);

// token 只能在 tokens.css 定義，其他樣式檔只能引用。
const cssFiles = [];
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (name === 'node_modules' || name === '.next' || name === 'out') continue;
    if (statSync(file).isDirectory()) walk(file);
    else if (name.endsWith('.css')) cssFiles.push(file.replaceAll('\\', '/'));
  }
};
walk('web/app');
walk('web/components');
for (const file of cssFiles) {
  if (file === 'web/app/tokens.css') continue;
  assert.doesNotMatch(read(file), /--date-bar-control-height\s*:/, `${file} 不得自行定義 --date-bar-control-height，只能在 tokens.css`);
}

// 交接簿共用日期列：桌機區塊必須涵蓋六個元件，且全部引用 token。
const sheet = read(`${moduleDir}/handover-sheet.css`);
const block = sheet.match(/@media screen and \(min-width:801px\)\{([\s\S]*?)\n\}/g)?.find(text => text.includes('.hs-date-nav')) ?? '';
assert.ok(block, 'handover-sheet.css 缺少桌機版日期列區塊');
for (const selector of [
  '.hs-date-nav>.hs-date-label',
  '.hs-date-nav>.localized-date-input{',
  '.hs-date-nav>.localized-date-input>input.hs-date-input',
  '.hs-date-nav>.hs-date-arrow{',
  '.hs-date-nav>.hs-date-arrow::before',
  '.hs-date-nav>.hs-date-today',
]) assert.ok(block.includes(selector), `handover-sheet.css 桌機日期列區塊缺少 ${selector}`);
const declarations = block.split('\n').slice(1).join('\n'); // 略過 @media 條件列本身的 min-width:801px
assert.ok(!/(?:height|min-height|width|flex-basis)\s*:\s*\d+px/.test(declarations),'handover-sheet.css 桌機日期列區塊不得寫固定 px 尺寸，請用 --date-bar-control-height');
assert.ok((block.match(/var\(--date-bar-control-height\)/g) ?? []).length >= 8, 'handover-sheet.css 桌機日期列區塊必須引用 --date-bar-control-height');

// 個別交接簿不得另外覆寫日期列高度（業管組曾自訂固定高度，已改回共用 token）。
for (const file of ['business-handover.css', 'guard-handover.css', 'mechanical-handover.css', 'produce-handover.css']) {
  const css = read(`${moduleDir}/${file}`);
  for (const rule of css.matchAll(/[^{}]*hs-date-(?:arrow|today|label|input)[^{}]*\{[^}]*\}/g)) {
    assert.doesNotMatch(rule[0], /(?:^|[;{\s])(?:min-)?height\s*:/, `${file} 不得覆寫日期列高度：${rule[0].trim().slice(0, 80)}`);
  }
  for (const rule of css.matchAll(/[^{}]*hs-date-nav>\.localized-date-input[^{}]*\{[^}]*\}/g)) {
    assert.doesNotMatch(rule[0], /(?:^|[;{\s])(?:min-)?height\s*:/, `${file} 不得覆寫日期框高度：${rule[0].trim().slice(0, 80)}`);
  }
}

// 巡邏班別工具列、營運頁日期列。
assert.match(
  read('web/app/admin-workspace.css'),
  /@media screen and \(min-width:801px\)\{\s*\.patrol-shift-toolbar \.admin-toolbar-date input\{height:var\(--date-bar-control-height\);min-height:var\(--date-bar-control-height\)\}/,
  'admin-workspace.css 缺少巡邏班別工具列的日期框高度規則',
);
assert.match(
  read('web/app/admin-workspace.css'),
  /\.patrol-shift-toolbar>\.secondary-btn\{min-height:var\(--date-bar-control-height\);padding-block:0\}/,
  'admin-workspace.css 缺少巡邏班別工具列導覽按鈕高度規則',
);
const operations = read(`${moduleDir}/operations.css`);
assert.match(operations, /@media screen and \(min-width:801px\)\{\s*\.operations-datebar>button\{min-height:var\(--date-bar-control-height\)\}/, 'operations.css 缺少營運頁日期列按鈕高度規則');
assert.match(operations, /\.operations-datebar \.localized-date-input input\{height:var\(--date-bar-control-height\);min-height:var\(--date-bar-control-height\)\}/, 'operations.css 缺少營運頁日期框高度規則');

assert.match(read('AGENTS.md'), /--date-bar-control-height: 32px/, 'AGENTS.md §6 必須記載日期導覽列尺寸規格');

console.log('日期導覽列尺寸規格檢查通過：交接簿、巡邏班別工具列、營運頁日期列桌機版一律使用 --date-bar-control-height（32px）。');
