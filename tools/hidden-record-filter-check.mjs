// 統計類頁面不得把 hidden = true 的報修案件／維修工單（正式資料中的測試資料）算進去。
// 隱藏方式見 docs/runbooks/hide-test-records.sql；hidden 為 NULL 的舊資料視同未隱藏，
// 所以必須用 or('hidden.is.null,hidden.eq.false')，不能用 eq('hidden', false)。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FILTER = ".or('hidden.is.null,hidden.eq.false')";

// 取出 client.from('<table>') 之後、到下一個 client.from( 或 ]) 之前的那一段查詢鏈。
function queryChain(source, table) {
  const marker = `client.from('${table}')`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const rest = source.slice(start + marker.length);
  const next = rest.search(/client\.from\(|\]\);/);
  return next < 0 ? rest : rest.slice(0, next);
}

function requireFilter(file, table) {
  const source = readFileSync(file, 'utf8');
  const chain = queryChain(source, table);
  assert.ok(chain !== null, `${file} 找不到 ${table} 查詢`);
  assert.ok(chain.includes(FILTER), `${file} 的 ${table} 查詢必須排除 hidden = true（${FILTER}）`);
  assert.ok(!chain.includes(".eq('hidden', false)"), `${file} 的 ${table} 不可用 eq('hidden', false)，會漏掉 hidden 為 NULL 的舊資料`);
}

requireFilter('web/app/systems/[system]/[module]/workorder-extras.tsx', 'repair_requests');
requireFilter('web/app/systems/[system]/[module]/workorder-extras.tsx', 'maintenance_orders');
requireFilter('web/components/admin/LocationAnalysisAdmin.tsx', 'repair_requests');

// 反例：沒有過濾的查詢鏈必須被判定為不合格，證明上面的斷言不是永遠通過。
const unfiltered = "client.from('repair_requests').select('a').gte('created_at', x).limit(1)";
assert.equal(queryChain(unfiltered, 'repair_requests').includes(FILTER), false);
const eqVariant = "client.from('repair_requests').select('a').eq('hidden', false).limit(1)";
assert.equal(queryChain(eqVariant, 'repair_requests').includes(".eq('hidden', false)"), true);

console.log('隱藏測試資料過濾檢查通過：維修分析與位置分析不計入 hidden = true 的列。');
