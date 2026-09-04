import assert from 'node:assert/strict';
import test from 'node:test';
import { marketMovementPresentation } from './market-movement.ts';

test('正值使用臺灣市場紅漲語意', () => {
  assert.deepEqual(marketMovementPresentation(12.34), {
    tone: 'rise', symbol: '▲', label: '上漲', percentText: '12.3%', text: '▲ 上漲 12.3%', ariaLabel: '上漲 12.3%',
  });
});

test('負值使用臺灣市場綠跌語意', () => {
  assert.deepEqual(marketMovementPresentation(-4.56), {
    tone: 'fall', symbol: '▼', label: '下跌', percentText: '4.6%', text: '▼ 下跌 4.6%', ariaLabel: '下跌 4.6%',
  });
});

test('極小差異視為持平，缺值不偽裝為零', () => {
  assert.equal(marketMovementPresentation(.049).text, '— 持平 0.0%');
  assert.equal(marketMovementPresentation(0).tone, 'steady');
  assert.equal(marketMovementPresentation(null).text, '無比較基準');
  assert.equal(marketMovementPresentation(Number.POSITIVE_INFINITY).tone, 'neutral');
});
