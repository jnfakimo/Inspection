import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveAppBackHref } from './app-navigation.ts';

test('市場行情分析的上頁固定回到市場分析系統入口', () => {
  assert.equal(resolveAppBackHref('/systems/marketanalytics/overview/'), '/systems/marketanalytics/');
  assert.equal(
    resolveAppBackHref('/Inspection/v2/systems/marketanalytics/overview/?v=2ec94674b'),
    '/systems/marketanalytics/',
  );
});

test('系統入口、系統總入口與戰情首頁依應用程式階層返回', () => {
  assert.equal(resolveAppBackHref('/systems/marketanalytics/'), '/systems/');
  assert.equal(resolveAppBackHref('/systems/admin/users/'), '/systems/admin/');
  assert.equal(resolveAppBackHref('/systems/structuremap/floor3d/'), '/systems/structuremap/');
  assert.equal(resolveAppBackHref('/systems/guardpatrol/map3d/'), '/systems/guardpatrol/');
  assert.equal(resolveAppBackHref('/systems/workorder/repairmap3d/'), '/systems/workorder/');
  assert.equal(resolveAppBackHref('/systems/'), '/');
  assert.equal(resolveAppBackHref('/'), '/systems/');
});

test('一般頁面與異常系統路徑不會導向瀏覽器歷史或外部位置', () => {
  assert.equal(resolveAppBackHref('/inspections/'), '/');
  assert.equal(resolveAppBackHref('/systems/../overview/'), '/systems/');
});

test('共用頁首皆接上固定父層連結，不再使用瀏覽器歷史返回', () => {
  const sources = [
    readFileSync(new URL('../components/AppShell.tsx', import.meta.url), 'utf8'),
    readFileSync(new URL('../app/systems/[system]/[module]/structuremap-topbar-actions.tsx', import.meta.url), 'utf8'),
  ];

  for (const source of sources) {
    assert.doesNotMatch(source, /(?:window\.)?history\.(?:back|go)\s*\(/);
    assert.match(source, /href=\{backHref\}/);
  }
});
