import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DASHBOARD_CATEGORIES,
  DASHBOARD_MARKETS,
  dashboardRotationItemsForGroup,
  normalizeDashboardMarketRotation,
  serializeDashboardMarketRotation,
} from './dashboard-market-rotation.ts';

test('戰情輪播固定支援兩市場與蔬菜水果', () => {
  assert.deepEqual(DASHBOARD_MARKETS, ['第一市場', '第二市場']);
  assert.deepEqual(DASHBOARD_CATEGORIES, ['蔬菜', '水果']);
});

test('輪播設定會去除錯誤群組、重複品項並限制播放參數', () => {
  const config = normalizeDashboardMarketRotation({ market_rotation: {
    source_id: 'source-1', auto_step_seconds: 1, cards_per_group: 99,
    items: [
      { market: '第二市場', category: '水果', item: '香蕉', sort_order: 20 },
      { market: '第二市場', category: '水果', item: '香蕉', sort_order: 10 },
      { market: '第一市場', category: '蔬菜', item: '高麗菜', sort_order: 5 },
      { market: '第三市場', category: '蔬菜', item: '錯誤資料' },
    ],
  } });
  assert.equal(config.autoStepSeconds, 2);
  assert.equal(config.cardsPerGroup, 24);
  assert.deepEqual(config.items.map(item => item.item), ['高麗菜', '香蕉']);
  assert.deepEqual(dashboardRotationItemsForGroup(config, '第二市場', '水果').map(item => item.item), ['香蕉']);
});

test('序列化後可再次正規化且維持順序', () => {
  const initial = normalizeDashboardMarketRotation({ items: [
    { market: '第一市場', category: '水果', item: '木瓜', enabled: true, sort_order: 30 },
    { market: '第一市場', category: '水果', item: '鳳梨', enabled: true, sort_order: 10 },
  ] });
  const restored = normalizeDashboardMarketRotation(serializeDashboardMarketRotation(initial));
  assert.deepEqual(restored.items.map(item => item.item), ['鳳梨', '木瓜']);
});

test('重複設定採用最後一筆，停用後重新加入可以恢復輪播', () => {
  const config = normalizeDashboardMarketRotation({ market_rotation: { items: [
    { market: '第一市場', category: '水果', item: '香蕉', enabled: false, sort_order: 10 },
    { market: '第一市場', category: '水果', item: '香蕉', enabled: true, sort_order: 20 },
  ] } });
  assert.deepEqual(dashboardRotationItemsForGroup(config, '第一市場', '水果').map(item => item.item), ['香蕉']);
});

test('首頁戰情輪播最低五分鐘更新且背景頁籤暫停', () => {
  const component = readFileSync('web/app/dashboard-market-carousel.tsx', 'utf8');
  assert.match(component, /MINIMUM_REFRESH_SECONDS\s*=\s*300/);
  assert.match(component, /invokeCachedAppApi/);
  assert.match(component, /document\.hidden/);
  assert.match(component, /visibilitychange/);
});
