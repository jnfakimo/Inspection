import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync('web/app/systems/[system]/[module]/market-analytics-workspace.tsx', 'utf8');
const css = readFileSync('web/app/systems/[system]/[module]/market-analytics.css', 'utf8');

assert.match(workspace, /const guideId = useId\(\);[\s\S]*?<figure className="market-bar-chart" aria-labelledby=\{guideId\}[\s\S]*?<figcaption className="market-bar-guide">/,
  '比較長條圖必須用 figure／figcaption 提供可見的讀圖說明');
assert.match(workspace, /本期（上方長條）[\s\S]*?比較期（下方長條）/,
  '圖例必須同時用期別與上下位置辨識兩組資料，不能只靠顏色');
assert.match(workspace, /X 軸（橫向）[\s\S]*?Y 軸（縱向）/,
  '初學者說明必須明示 X 軸與 Y 軸代表的動態欄位');
assert.match(workspace, /兩種顏色代表比較期間，不代表第一／第二市場/,
  '必須避免把期間配色誤讀為第一、第二市場');
assert.match(workspace, /顯示前 \$\{rows\.length\} 組，共 \$\{analysis\.rows\.length\} 組/,
  '圖表截取排行時必須揭露顯示筆數與完整筆數');
assert.match(workspace, /row\.current === null \? '—'/,
  '本期缺值必須顯示無資料符號，不能偽裝為零');
assert.match(workspace, /row\.compare === null \? '—'/,
  '比較期缺值必須顯示無資料符號，不能偽裝為零');
assert.match(workspace, /<details className="market-chart-summary market-bar-summary">[\s\S]*?<th scope="row">/,
  '圖表必須提供可讀、可鍵盤操作的完整數值表格');

assert.match(css, /\.market-bar-guide\{[^}]*border:/,
  '讀圖說明必須有清楚的視覺分區');
assert.match(css, /@media\(max-width:700px\)[\s\S]*?\.market-bar-row\{[^}]*min-height:44px/,
  '手機可下鑽列必須保留至少 44px 的觸控高度');
assert.match(css, /@media\(max-width:430px\)[\s\S]*?\.market-bar-scale span\.minor\{display:none\}/,
  '窄螢幕必須隱藏次要刻度，降低初學者判讀負擔');
assert.match(css, /\.market-bar-label\{[^}]*-webkit-line-clamp:2/,
  '手機品項名稱必須允許顯示兩行');

console.log('市場比較長條圖檢查通過：圖例、動態 X／Y 軸、期間語意、缺值、資料表與手機判讀規則完整。');
