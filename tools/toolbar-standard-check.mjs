import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// 工具列／篩選列控制項高度規格（AGENTS.md §6）：桌機一律 --toolbar-control-height（tokens.css，32px）。
// 容器清單與規則只在 web/app/toolbar-standard.css；本檢查確保 token、載入順序、規則、容器涵蓋與各頁不再自訂固定高度。
const read = file => readFileSync(file, 'utf8');
const moduleDir = 'web/app/systems/[system]/[module]';

// 刻意不納入統一高度的容器（class 結尾像工具列／篩選列，但不是「工具列內放控制項」）。新增例外一定要寫理由。
const EXEMPT = new Map([
  ['request-column-filters', '表格欄位標題列的篩選，已是緊湊版（padding 6px），屬表格內欄位，維持 42px 規格以外的表格規格'],
  ['users-batch-toolbar', '標題與說明文字的區塊，沒有直接放控制項'],
  ['name-filter', '單一搜尋框本身（不是容器），位於清單頁，維持 42px 欄位規格'],
  ['use-filter', '樓層標題列內的單一下拉（不是容器），屬表格標題，維持欄位規格'],
  ['mid-quick-filter', '市場看板的分段晶片按鈕（自訂 .active 樣式），不是一般工具列控制項'],
  ['market-command-item-filter', '品項篩選輸入框本身（不是容器），其容器 .market-command-slicers 已在清單內'],
]);

const tokens = read('web/app/tokens.css');
assert.match(
  tokens,
  /@media screen and \(min-width:\s*801px\)\s*\{\s*:root\s*\{\s*--toolbar-control-height:\s*32px;\s*\}\s*\}/,
  'tokens.css 必須在桌機（≥801px）定義 --toolbar-control-height: 32px',
);

// token 只能在 tokens.css 定義，其他樣式檔只能引用。
const cssFiles = [];
const tsxFiles = [];
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (name === 'node_modules' || name === '.next' || name === 'out') continue;
    if (statSync(file).isDirectory()) walk(file);
    else if (name.endsWith('.css')) cssFiles.push(file.replaceAll('\\', '/'));
    else if (name.endsWith('.tsx')) tsxFiles.push(file.replaceAll('\\', '/'));
  }
};
walk('web/app');
walk('web/components');
for (const file of cssFiles) {
  if (file === 'web/app/tokens.css') continue;
  assert.doesNotMatch(read(file), /--toolbar-control-height\s*:/, `${file} 不得自行定義 --toolbar-control-height，只能在 tokens.css`);
}

// 根版面必須載入共用樣式，且在 control-standard.css 之後。
const layout = read('web/app/layout.tsx');
const controlAt = layout.indexOf("import './control-standard.css';");
const toolbarAt = layout.indexOf("import './toolbar-standard.css';");
assert.ok(controlAt >= 0 && toolbarAt > controlAt, 'layout.tsx 必須在 control-standard.css 之後載入 toolbar-standard.css');

// 共用規則：桌機螢幕、引用 token、用 !important、不寫固定 px。
const css = read('web/app/toolbar-standard.css');
assert.match(css, /@media screen and \(min-width:\s*801px\)\s*\{/, 'toolbar-standard.css 必須只在桌機螢幕輸出套用');
const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
assert.match(body, /height:\s*var\(--toolbar-control-height\)\s*!important/, 'toolbar-standard.css 必須以 token 設定 height（!important）');
assert.match(body, /min-height:\s*var\(--toolbar-control-height\)\s*!important/, 'toolbar-standard.css 必須以 token 設定 min-height（!important）');
assert.match(body, /padding-block:\s*0\s*!important/, 'toolbar-standard.css 必須把上下內距歸零，文字才不會被 32px 切掉');
assert.doesNotMatch(body.replace(/@media screen and \(min-width:\s*801px\)/, ''), /(?:height|width|flex-basis)\s*:\s*\d+px/, 'toolbar-standard.css 不得寫固定 px 尺寸，請用 --toolbar-control-height');

// 容器清單：取第一個 :is(...) 內的 class。
const listText = body.match(/:is\(([\s\S]*?)\)\s*:is\(/)?.[1] ?? '';
const containers = new Set([...listText.matchAll(/\.([\w-]+)/g)].map(match => match[1]));
assert.ok(containers.size >= 20, `toolbar-standard.css 容器清單不完整（只找到 ${containers.size} 個）`);
for (const required of ['admin-toolbar', 'hs-toolbar', 'operations-tool-row', 'operations-datebar', 'operations-filter-row']) {
  assert.ok(containers.has(required), `toolbar-standard.css 容器清單缺少 .${required}`);
}
for (const [name] of EXEMPT) assert.ok(!containers.has(name), `${name} 同時在容器清單與例外清單，請擇一`);

// 涵蓋：全站 TSX 出現的工具列／篩選列容器，必須在清單內，或在例外清單寫明理由。
const looksLikeBar = token => /(?:^|-)(?:toolbar|filters?|tool-row|filter-row|datebar)$/.test(token);
const uncovered = new Map();
for (const file of tsxFiles) {
  for (const match of read(file).matchAll(/className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g)) {
    const tokens = (match[1] ?? match[2] ?? match[3] ?? '').replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean);
    if (tokens.some(token => containers.has(token))) continue; // 同一元素已有清單內的容器 class
    for (const token of tokens) {
      if (looksLikeBar(token) && !EXEMPT.has(token)) uncovered.set(token, `${file}`);
    }
  }
}
assert.equal(
  uncovered.size,
  0,
  `下列工具列／篩選列容器未納入 toolbar-standard.css 清單，也不在例外清單：\n${[...uncovered].map(([token, file]) => `  .${token}（${file}）`).join('\n')}`,
);

// 交接簿日期列的特例留在 handover-sheet.css，必須引用 token、不寫固定 px；個別交接簿不得覆寫。
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
assert.ok(!/(?:height|min-height|width|flex-basis)\s*:\s*\d+px/.test(declarations), 'handover-sheet.css 桌機日期列區塊不得寫固定 px 尺寸，請用 --toolbar-control-height');
assert.ok((block.match(/var\(--toolbar-control-height\)/g) ?? []).length >= 8, 'handover-sheet.css 桌機日期列區塊必須引用 --toolbar-control-height');

for (const file of ['business-handover.css', 'guard-handover.css', 'mechanical-handover.css', 'produce-handover.css', 'operations.css']) {
  const text = read(`${moduleDir}/${file}`);
  for (const rule of text.matchAll(/[^{}]*(?:hs-date-(?:arrow|today|label|input)|hs-date-nav>\.localized-date-input|operations-datebar)[^{}]*\{[^}]*\}/g)) {
    // 只檢查桌機規則：手機版（max-width）區塊可保留原本的觸控尺寸。
    const before = text.slice(0, rule.index);
    const insideMobile = before.lastIndexOf('@media(max-width') > before.lastIndexOf('\n}') || before.lastIndexOf('@media (max-width') > before.lastIndexOf('\n}');
    if (insideMobile) continue;
    // 營運頁日期列原本的全寬度基底規則（手機也用）允許保留；桌機高度一律由 toolbar-standard.css 壓過。
    if (/^\s*\.operations-datebar button\{/.test(rule[0])) continue;
    assert.doesNotMatch(
      rule[0],
      /(?:^|[;{\s])(?:min-)?height\s*:\s*\d+px/,
      `${file} 不得覆寫日期列／工具列高度：${rule[0].trim().slice(0, 80)}`,
    );
  }
}

assert.match(read('AGENTS.md'), /--toolbar-control-height: 32px/, 'AGENTS.md §6 必須記載工具列／篩選列控制項尺寸規格');

console.log(`工具列／篩選列尺寸規格檢查通過：${containers.size} 個容器、${tsxFiles.length} 個 tsx 檔的工具列容器皆已納入或寫明例外，桌機一律 --toolbar-control-height（32px）。`);
