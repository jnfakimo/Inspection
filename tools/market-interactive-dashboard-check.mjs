import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');

const modules = read('web/lib/modules.ts');
const router = read('web/app/systems/[system]/[module]/workspace-router.tsx');
const dashboard = read('web/app/systems/[system]/[module]/market-interactive-dashboard.tsx');
const css = read('web/app/systems/[system]/[module]/market-interactive-dashboard.css');

assert.match(
  modules,
  /m\(\s*['"]interactive-dashboard['"]\s*,\s*['"]市場分析互動儀表板['"]/,
  '市場營運分析系統必須註冊「市場分析互動儀表板」子系統',
);

assert.match(
  router,
  /dynamic[\s\S]*?import\(\s*['"]\.\/market-interactive-dashboard['"]\s*\)/,
  '互動儀表板必須以專屬 dynamic import 載入，不能落入既有分析工作台',
);
assert.match(
  router,
  /module\.key\s*===\s*['"]interactive-dashboard['"][\s\S]{0,500}?return\s*<[^>]*Interactive[^>]*Dashboard/i,
  'WorkspaceRouter 必須為 interactive-dashboard 提供專屬元件分派',
);

for (const action of ['market_catalog', 'market_dimension_catalog', 'market_analysis']) {
  assert.match(
    dashboard,
    new RegExp(`invoke(?:Cached)?AppApi(?:<[^;]+?>)?\\s*\\(\\s*['"]${action}['"]`),
    `互動儀表板必須透過 ${action} 讀取正式行情資料`,
  );
}

assert.match(dashboard, /invokeCachedAppApi/, '互動儀表板必須共用市場行情短效快取');
assert.match(dashboard, /requestSerial\.current\s*\+=\s*1/, '切換分析條件時必須立即使舊請求失效');
assert.match(dashboard, /loadAnalysis\(\s*true\s*\)/, '使用者按更新分析時必須強制重新取得行情');

for (const period of ['日', '週', '月', '季', '年']) {
  assert.match(dashboard, new RegExp(`['"]${period}['"]`), `互動儀表板缺少「${period}」期間切換`);
}
for (const market of ['第一市場', '第二市場']) {
  assert.ok(dashboard.includes(market), `互動儀表板缺少「${market}」選項`);
}
for (const category of ['蔬菜', '水果']) {
  assert.ok(dashboard.includes(category), `互動儀表板缺少「${category}」分類`);
}

assert.match(dashboard, /下鑽|drill/i, '互動儀表板必須提供市場 → 蔬果大類 → 品項下鑽');
assert.match(dashboard, /匯出\s*CSV|CSV\s*匯出/i, '互動儀表板必須提供 CSV 匯出操作');
assert.match(dashboard, /text\/csv|\.csv\b|URL\.createObjectURL/i, 'CSV 匯出必須建立可下載的 CSV 檔案');
assert.match(dashboard, /KPI|關鍵指標|market-[a-z0-9-]*kpi/i, '互動儀表板必須呈現 KPI 摘要');
assert.match(dashboard, /圖表|Chart|<Line|<Bar|<Pie|<Doughnut/i, '互動儀表板必須包含圖表分析');
assert.match(dashboard, /排行|排名/, '互動儀表板必須包含行情排行');
assert.match(dashboard, /明細/, '互動儀表板必須包含品項明細');

assert.doesNotMatch(dashboard, /(?:[A-Za-z]:[\\/]|file:\/\/)/i, '正式頁面不得引用 Windows 本機路徑或 file URL');
assert.doesNotMatch(dashboard, /\b(?:mock|simulated|simulation)\b|模擬資料|假資料/i, '正式頁面不得內建模擬／假資料');
assert.doesNotMatch(dashboard, /\bnew\s+Function\s*\(/, '正式頁面不得使用 new Function 動態執行程式碼');
assert.doesNotMatch(dashboard, /support\.js|\.dc\.html|text\/x-dc/i, '正式頁面不得帶入 Broadsheet 原型 runtime');

assert.match(css, /var\(--[a-z0-9-]+\)/i, '互動儀表板 CSS 必須沿用共用主題變數');
assert.match(css, /color-mix\(\s*in\s+srgb\s*,/i, '互動儀表板 CSS 的色彩混合必須使用 color-mix');
assert.match(css, /@media\s*\(\s*max-width\s*:\s*\d+px\s*\)/i, '互動儀表板 CSS 必須提供手機版斷點');

console.log('市場分析互動儀表板檢查通過：專屬路由、正式行情 API、期間／市場／分類、下鑽、CSV、KPI、圖表排行明細及響應式主題皆完整。');
