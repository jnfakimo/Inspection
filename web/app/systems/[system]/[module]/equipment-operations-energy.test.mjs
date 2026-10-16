import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const here = fileURLToPath(new URL('.', import.meta.url));
const componentPath = `${here}equipment-operations-energy.tsx`;
const source = await readFile(componentPath, 'utf8');
const css = await readFile(`${here}equipment-operations-energy.module.css`, 'utf8');
const workspaceSource = await readFile(`${here}equipment-workspace.tsx`, 'utf8');
// 2026-10-15 起全站色彩 token 唯一正本為 tokens.css（科技版 :root、一般版 :root[data-theme="light"]）。
const tokensCss = await readFile(new URL('../../../tokens.css', import.meta.url), 'utf8');
const globalCss = await readFile(new URL('../../../globals.css', import.meta.url), 'utf8');
const rootLayout = await readFile(new URL('../../../layout.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: componentPath,
  reportDiagnostics: true,
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
});
const errors = (compiled.diagnostics || []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error);
assert.equal(errors.length, 0, errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));

// 編譯結果寫到已被 git 與 Semgrep 忽略的 web/.next/ 下再以 require 載入，不使用動態 Function。
// 同目錄放一個同名的 .module.css 替身（CommonJS 會把未知副檔名當 JS 載入），讓 class 名稱等於 key；
// react 由上層目錄的 node_modules 正常解析。
const buildDir = fileURLToPath(new URL('../../../../.next/test-build/equipment-operations-energy/', import.meta.url));
mkdirSync(buildDir, { recursive: true });
writeFileSync(`${buildDir}equipment-operations-energy.module.css`, "module.exports = { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };\n");
const builtComponent = `${buildDir}equipment-operations-energy.cjs`;
writeFileSync(builtComponent, compiled.outputText);
delete require.cache[builtComponent];
const { EquipmentOperationsEnergy, deriveEquipmentPage, EQUIPMENT_PAGE_SIZE, openEquipmentWorkOrder } = require(builtComponent);

function asset(id, operationalState) {
  return {
    equipmentId: id,
    assetCode: `TEST-${id}`,
    name: `測試設備 ${id}`,
    siteId: 'site-test', siteName: '測試場域',
    floorId: 'floor-test', floorName: '測試樓層',
    systemId: 'system-test', systemName: '測試系統',
    location: '測試位置',
    operationalState,
    sourceName: '測試資料源',
    sourceObservedAt: '2026-10-07T04:00:00Z',
    receivedAt: '2026-10-07T04:00:02Z',
    trace: {
      alarms: { state: 'none', items: [] },
      workOrders: { state: 'none', items: [] },
      inspections: { state: 'pending', items: [] },
      closureEvidence: { state: 'pending', items: [] },
    },
  };
}

function render(props) {
  return renderToStaticMarkup(React.createElement(EquipmentOperationsEnergy, props));
}

test('renders all six supplied operational states without deriving status from the equipment master', () => {
  const markup = render({ equipmentFeed: 'ready', equipment: [asset('a', 'healthy'), asset('b', 'anomalous')] });
  for (const label of ['正常', '異常', '停機', '維護中', '離線', '未知']) assert.ok(markup.includes(label), `missing status ${label}`);
  assert.match(markup, /statusHealthy[^>]*>[\s\S]*?<strong>1<\/strong>/);
  assert.match(markup, /statusAnomalous[^>]*>[\s\S]*?<strong>1<\/strong>/);
  assert.match(markup, /statusStopped[^>]*>[\s\S]*?<strong>0<\/strong>/);
});

test('shows em dashes and pending labels for energy metrics with no adapter values', () => {
  const markup = render({ equipmentFeed: 'pending', equipment: [], energy: { dailyElectricity: { state: 'available', value: null } } });
  for (const label of ['今日用電量', '即時功率', '最大需量', '今日用水量']) assert.ok(markup.includes(label));
  assert.ok(markup.includes('資料來源待介接'));
  assert.ok(markup.includes('待介接'));
  assert.ok(markup.includes('尚無讀值'));
  assert.ok(!markup.includes('1280'));
  assert.ok(!markup.includes('1,280'));
});

test('keeps source observation time separate from system receipt time', () => {
  const markup = render({ equipmentFeed: 'ready', equipment: [asset('a', 'unknown')] });
  assert.ok(markup.includes('來源資料時間'));
  assert.ok(markup.includes('系統接收時間'));
  assert.ok(markup.includes('來源時間'));
  assert.ok(markup.includes('接收時間'));
});

test('passes canonical request and order IDs to the work order route adapter', () => {
  const workOrder = {
    requestId: 'request-id', requestNo: 'request-no',
    orderId: 'order-id', orderNo: 'order-no', statusLabel: '處理中', updatedAt: null,
  };
  let received;
  assert.equal(openEquipmentWorkOrder(workOrder, value => { received = value; }), true);
  assert.equal(received, workOrder);
  assert.equal(openEquipmentWorkOrder(workOrder, undefined), false);
  assert.equal(openEquipmentWorkOrder({ ...workOrder, orderId: null }, () => assert.fail('must not navigate without an order ID')), false);
});

test('paginates empty, one-row, and exactly ten-row equipment lists', () => {
  assert.equal(EQUIPMENT_PAGE_SIZE, 10);
  const empty = deriveEquipmentPage([], {}, 1);
  assert.equal(empty.totalCount, 0);
  assert.equal(empty.page, 1);
  assert.equal(empty.pageCount, 1);
  assert.deepEqual(empty.pageAssets, []);

  const one = deriveEquipmentPage([asset('1', 'unknown')], {}, 1);
  assert.equal(one.totalCount, 1);
  assert.equal(one.pageCount, 1);
  assert.equal(one.pageAssets.length, 1);

  const ten = deriveEquipmentPage(Array.from({ length: 10 }, (_, index) => asset(String(index + 1), 'unknown')), {}, 1);
  assert.equal(ten.totalCount, 10);
  assert.equal(ten.pageCount, 1);
  assert.equal(ten.pageAssets.length, 10);
});

test('shows eleven rows on two pages and clamps requests to the last page', () => {
  const rows = Array.from({ length: 11 }, (_, index) => asset(String(index + 1), 'unknown'));
  const first = deriveEquipmentPage(rows, {}, 1);
  const second = deriveEquipmentPage(rows, {}, 2);
  const last = deriveEquipmentPage(rows, {}, 99);
  assert.equal(first.pageCount, 2);
  assert.equal(first.pageAssets.length, 10);
  assert.equal(second.page, 2);
  assert.equal(second.pageAssets.length, 1);
  assert.equal(last.page, 2);
  assert.deepEqual(last.pageAssets.map(row => row.equipmentId), second.pageAssets.map(row => row.equipmentId));
});

test('filters and sorts before slicing, then clamps the page when filters or data change', () => {
  const rows = [
    { ...asset('2', 'unknown'), assetCode: 'EQ-2', siteId: 'north', floorId: '1F', systemId: 'hvac' },
    { ...asset('11', 'unknown'), assetCode: 'EQ-11', siteId: 'south', floorId: '2F', systemId: 'pump' },
    { ...asset('1', 'unknown'), assetCode: 'EQ-1', siteId: 'north', floorId: '1F', systemId: 'hvac' },
  ];
  const filtered = deriveEquipmentPage(rows, { siteId: 'north', floorId: '1F', systemId: 'hvac' }, 4);
  assert.deepEqual(filtered.filteredAssets.map(row => row.assetCode), ['EQ-1', 'EQ-2']);
  assert.deepEqual(filtered.pageAssets.map(row => row.equipmentId), ['1', '2']);
  assert.equal(filtered.page, 1);

  const eleven = deriveEquipmentPage(Array.from({ length: 11 }, (_, index) => asset(String(index + 1), 'unknown')), {}, 2);
  const shortened = deriveEquipmentPage(eleven.filteredAssets.slice(0, 10), {}, eleven.page);
  assert.equal(shortened.page, 1);
  assert.equal(shortened.pageAssets.length, 10);
  for (const setter of ['setSiteFilter', 'setFloorFilter', 'setSystemFilter']) {
    assert.match(source, new RegExp(`${setter}\\(event\\.target\\.value\\);\\s*setPage\\(1\\)`));
  }
});

test('renders accessible pager controls and keeps the capped source count explicitly incomplete', () => {
  const emptyMarkup = render({ equipmentFeed: 'empty', equipment: [] });
  assert.match(emptyMarkup, /aria-label="設備清單分頁"/);
  assert.match(emptyMarkup, /顯示 0–0 \/ 0 筆/);
  const pagerMarkup = emptyMarkup.match(/<nav[^>]*aria-label="設備清單分頁"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.equal((pagerMarkup.match(/disabled=""/g) || []).length, 2);

  const cappedMarkup = render({ equipmentFeed: 'truncated', equipment: [asset('1', 'unknown')] });
  assert.ok(cappedMarkup.includes('來源已達載入上限'));
  assert.ok(cappedMarkup.includes('目前已載入，總數可能更多'));
  assert.ok(cappedMarkup.includes('未知'));
  assert.match(workspaceSource, /capped \? 'truncated' as const/);
});

test('keeps equipment state colors aligned with the concept and stacks panels before their minimum widths collide', () => {
  for (const selector of ['.statusStopped{--tone:var(--dim)}', '.statusMaintenance{--tone:var(--blue,var(--primary))}', '.statusOffline{--tone:var(--amber)}', '.statusUnknown{--tone:var(--dim)}']) {
    assert.ok(css.includes(selector), `missing summary color rule ${selector}`);
  }
  for (const selector of ['.stateBadge.statusStopped{--tone:var(--dim)}', '.stateBadge.statusMaintenance{--tone:var(--blue,var(--primary))}', '.stateBadge.statusOffline{--tone:var(--amber)}', '.stateBadge.statusUnknown{--tone:var(--dim)}']) {
    assert.ok(css.includes(selector), `missing row badge color rule ${selector}`);
  }
  assert.match(css, /@media\(max-width:1400px\)\{\s*\.statusGrid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}\s*\.mainGrid\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.doesNotMatch(css, /@media\(max-width:1120px\)/);
  assert.match(css, /\.issueTable\{width:100%;min-width:760px/);
  assert.match(css, /\.pagination button\{[^}]*min-width:44px;min-height:44px/);
  assert.match(css, /\.tableScroll\{width:100%;min-width:0;max-width:100%;overflow:auto/);
  assert.match(rootLayout, /import '\.\/globals\.css'/);
  assert.match(globalCss, /@import '\.\/tokens\.css'/);
  assert.match(tokensCss, /:root \{[^}]*--blue:\s*#[\da-fA-F]{3,8}/);
  assert.match(tokensCss, /:root\[data-theme="light"\] \{[^}]*--blue:\s*#[\da-fA-F]{3,8}/);
  assert.ok(css.includes('var(--blue,var(--primary))'), '維修中藍色必須取自全站 --blue token，缺少時退回主色，不寫死色碼');
});
