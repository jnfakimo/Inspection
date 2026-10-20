import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  appVisitEntry,
  pushVisit,
  readVisitStack,
  resolveAppBackHref,
  resolveBackTarget,
  writeVisitStack,
} from './app-navigation.ts';

test('市場行情分析的上頁固定回到市場分析系統入口', () => {
  assert.equal(resolveAppBackHref('/systems/marketanalytics/overview/'), '/systems/marketanalytics/');
  assert.equal(resolveAppBackHref('/systems/marketanalytics/interactive-dashboard/'), '/systems/marketanalytics/');
  assert.equal(
    resolveAppBackHref('/Inspection/v2/systems/marketanalytics/overview/?v=2ec94674b'),
    '/systems/marketanalytics/',
  );
});

test('沒有上一個動作時，系統入口、系統總入口與戰情首頁依應用程式階層返回', () => {
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

test('站內軌跡記錄值：保留路徑與一般查詢字串，登入類頁面與憑證查詢字串不記錄', () => {
  assert.equal(appVisitEntry('/Inspection/v2/systems/handover/fruit', ''), '/systems/handover/fruit/');
  assert.equal(appVisitEntry('/systems/guardpatrol/checkins/', '?marker=abc&source=qr'), '/systems/guardpatrol/checkins/?marker=abc&source=qr');
  assert.equal(appVisitEntry('/', ''), '/');
  assert.equal(appVisitEntry('/login/', ''), '');
  assert.equal(appVisitEntry('/Inspection/v2/oauth/callback/', '?code=1'), '');
  assert.equal(appVisitEntry('/systems/admin/users/', '?access_token=abc'), '/systems/admin/users/', '含憑證字樣的查詢字串捨棄');
  assert.equal(appVisitEntry('/systems/x/', '?a=1#hash'), '/systems/x/', '含錨點的查詢字串不記錄');
});

test('軌跡更新：新動作加入、重載不重複、回到前一頁時移除目前頁', () => {
  let stack: string[] = [];
  stack = pushVisit(stack, '/systems/');
  stack = pushVisit(stack, '/systems/handover/');
  stack = pushVisit(stack, '/systems/handover/fruit/');
  assert.deepEqual(stack, ['/systems/', '/systems/handover/', '/systems/handover/fruit/']);
  assert.deepEqual(pushVisit(stack, '/systems/handover/fruit/'), stack, '重新載入同一頁不重複記錄');
  assert.deepEqual(pushVisit(stack, '/systems/handover/'), ['/systems/', '/systems/handover/'], '回到前一頁');
  assert.deepEqual(pushVisit(stack, ''), stack, '空記錄值不改變軌跡');
  const long = Array.from({ length: 60 }, (_, index) => `/systems/p${index}/`).reduce<string[]>((acc, entry) => pushVisit(acc, entry), []);
  assert.equal(long.length, 30);
  assert.equal(long[long.length - 1], '/systems/p59/');
});

test('上頁＝回到上一個動作；沒有上一個才依階層返回父層', () => {
  const stack = ['/systems/', '/systems/handover/', '/systems/handover/fruit/'];
  assert.equal(resolveBackTarget(stack, '/systems/handover/fruit/'), '/systems/handover/');
  assert.equal(resolveBackTarget(['/systems/', '/systems/guardpatrol/records/', '/systems/handover/'], '/systems/handover/'), '/systems/guardpatrol/records/', '不是階層父層，而是真正的上一步');
  assert.equal(resolveBackTarget(['/systems/handover/fruit/'], '/systems/handover/fruit/'), '/systems/handover/', '剛開啟時回父層');
  assert.equal(resolveBackTarget([], '/systems/'), '/', '空軌跡依階層');
  assert.equal(resolveBackTarget(['/systems/a/', '/systems/b/'], '/systems/c/'), '/systems/', '軌跡尾端不是目前頁時不採用');
  assert.equal(resolveBackTarget(['/systems/a/', '/login/'], '/login/'), '/', '登入頁不套用軌跡');
});

test('軌跡讀寫：壞資料、外部網址與儲存空間失敗都退回空軌跡', () => {
  const memory = new Map<string, string>();
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value); } };
  assert.deepEqual(readVisitStack(storage), []);
  writeVisitStack(storage, ['/systems/', '/systems/handover/']);
  assert.deepEqual(readVisitStack(storage), ['/systems/', '/systems/handover/']);
  memory.set('beinong-nav-visits', JSON.stringify(['/systems/', 'https://evil.example/', '//evil.example/x', '/ok\\bad', 42, '/systems/handover/']));
  assert.deepEqual(readVisitStack(storage), ['/systems/', '/systems/handover/'], '只保留站內相對路徑');
  memory.set('beinong-nav-visits', '{not json');
  assert.deepEqual(readVisitStack(storage), []);
  memory.set('beinong-nav-visits', '{"a":1}');
  assert.deepEqual(readVisitStack(storage), []);
  assert.deepEqual(readVisitStack(null), []);
  assert.doesNotThrow(() => writeVisitStack({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, ['/a/']));
  assert.doesNotThrow(() => writeVisitStack(undefined, ['/a/']));
});

test('共用頁首的上頁連結來自站內軌跡 hook，不使用瀏覽器歷史，也不會跳出站外', () => {
  const sources = [
    readFileSync(new URL('../components/AppShell.tsx', import.meta.url), 'utf8'),
    readFileSync(new URL('../app/systems/[system]/[module]/structuremap-topbar-actions.tsx', import.meta.url), 'utf8'),
  ];
  for (const source of sources) {
    assert.doesNotMatch(source, /(?:window\.)?history\.(?:back|go)\s*\(/);
    assert.match(source, /useAppBackHref\(pathname\)/);
    assert.match(source, /href=\{backHref\}/);
  }
  const hook = readFileSync(new URL('../components/useAppBackHref.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(hook, /history\.(?:back|go)\s*\(/);
  assert.match(hook, /sessionStorage/);
});
