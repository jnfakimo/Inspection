import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const edge = readFileSync('supabase/functions/app-api/index.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260831130000_market_analysis_rollup.sql', 'utf8');
const baseSchema = readFileSync('system/sql/market_analytics.sql', 'utf8');
const carousel = readFileSync('web/app/dashboard-market-carousel.tsx', 'utf8');

const dashboardStart = edge.indexOf("if (action === 'dashboard_market_rotation')");
const catalogStart = edge.indexOf("if (action === 'market_catalog')", dashboardStart);
const analysisStart = edge.indexOf("if (action === 'market_analysis')", catalogStart);
const simulationStart = edge.indexOf("if (action === 'market_simulation_list')", analysisStart);
assert.ok(dashboardStart >= 0 && catalogStart > dashboardStart, '找不到戰情輪播 API 區段');
assert.ok(analysisStart >= 0 && simulationStart > analysisStart, '找不到市場分析 API 區段');

const dashboard = edge.slice(dashboardStart, catalogStart);
const analysis = edge.slice(analysisStart, simulationStart);
assert.match(dashboard, /rpc\('market_analysis_rollup'/, '戰情輪播必須使用資料庫彙總 RPC');
assert.match(dashboard, /current_group_daily/, '戰情輪播必須使用每日品項彙總');
assert.doesNotMatch(dashboard, /from\('market_data_points'\)/, '戰情輪播不得再逐頁搬運行情明細');
assert.match(analysis, /rpc\('market_analysis_rollup'/, '市場分析必須使用資料庫彙總 RPC');
assert.doesNotMatch(analysis, /from\('market_data_points'\)/, '市場分析不得再逐頁搬運行情明細');

for (const sql of [migration, baseSchema]) {
  assert.match(sql, /create or replace function public\.market_analysis_rollup/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /grant execute on function public\.market_analysis_rollup[\s\S]*?to service_role/);
  assert.match(sql, /revoke all on function public\.market_analysis_rollup[\s\S]*?from public,anon,authenticated/);
}

assert.match(carousel, /MINIMUM_REFRESH_SECONDS\s*=\s*300/);
assert.match(carousel, /invokeCachedAppApi/);
assert.match(carousel, /document\.hidden/);

console.log('市場行情效能檢查通過：資料庫端彙總、每日品項趨勢、權限限制、前端快取與背景降頻皆完整。');
