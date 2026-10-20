import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  PRODUCE_APPROVAL_STAGE_ORDER,
  PRODUCE_ENABLED_MARKETS,
  PRODUCE_SHIFTS,
  produceApprovalAccessFrom,
  produceApprovalGateReason,
  produceApprovalReadonlyReason,
  produceApprovalStages,
  produceCurrentShift,
  produceGroupEnabled,
  produceShiftName,
  type ProduceGroup,
  type ProduceMarket,
} from './produce-handover.ts';

const migration = readFileSync(new URL('../../supabase/migrations/20261021090000_produce_handover_fruit.sql', import.meta.url), 'utf8');

test('前端啟用清單與資料庫 produce_group_enabled 一致', () => {
  const body = /create or replace function public\.produce_group_enabled[\s\S]*?\$\$\s*select ([^\n]+)\n/.exec(migration)?.[1] || '';
  const groups: ProduceGroup[] = ['fruit', 'vegetable'];
  const markets: ProduceMarket[] = ['market_1', 'market_2'];
  for (const group of groups) for (const market of markets) {
    const sqlAllows = body.includes(`p_group='${group}'`) && body.includes(`p_market='${market}'`);
    assert.equal(produceGroupEnabled(group, market), sqlAllows, `${group}/${market}`);
  }
  assert.deepEqual(PRODUCE_ENABLED_MARKETS.fruit, ['market_1']);
});

test('三班沿用業管組的班別時段', () => {
  assert.deepEqual(PRODUCE_SHIFTS.map(shift => shift.code), ['01-09', '09-17', '17-01']);
  assert.equal(produceShiftName('17-01'), '晚班');
  assert.equal(produceShiftName('xx'), 'xx');
  for (const code of PRODUCE_SHIFTS.map(shift => shift.code)) assert.ok(migration.includes(`'${code}'`), `migration 含班別 ${code}`);
});

test('批核三階依序：組(副)長、副主任、主任，標籤帶入市場', () => {
  assert.deepEqual(PRODUCE_APPROVAL_STAGE_ORDER, ['group_leader', 'deputy_director', 'director']);
  const stages = produceApprovalStages('fruit', 'market_1');
  assert.deepEqual(stages.map(item => item.stage), [...PRODUCE_APPROVAL_STAGE_ORDER]);
  assert.deepEqual(stages.map(item => item.label), ['組(副)長', '一市場副主任', '一市場主任']);
  assert.equal(produceApprovalStages('fruit', 'market_2')[1].label, '二市場副主任');
  // 資料庫寫入的 stage 與標籤要和畫面一致，報表才不會與紀錄分岔。
  for (const stage of PRODUCE_APPROVAL_STAGE_ORDER) assert.ok(migration.includes(`'${stage}'`), `migration 含階段 ${stage}`);
  assert.ok(migration.includes("'組(副)長'") && migration.includes("market_name||'副主任'") && migration.includes("market_name||'主任'"));
});

test('後一階須在前一階批核之後，與資料庫關卡一致', () => {
  assert.equal(produceApprovalGateReason('group_leader', [], 'fruit', 'market_1'), '');
  assert.equal(produceApprovalGateReason('deputy_director', [], 'fruit', 'market_1'), '請先由組(副)長批核，一市場副主任才能批核。');
  assert.equal(produceApprovalGateReason('deputy_director', ['group_leader'], 'fruit', 'market_1'), '');
  assert.equal(produceApprovalGateReason('director', ['group_leader'], 'fruit', 'market_1'), '請先由一市場副主任批核，一市場主任才能批核。');
  assert.equal(produceApprovalGateReason('director', ['group_leader', 'deputy_director'], 'fruit', 'market_1'), '');
  assert.match(migration, /raise exception '請先由%批核，%才能批核'/);
});

test('produce_day 的 can 欄位轉成各階權限；缺值一律視為不可批核', () => {
  assert.deepEqual(produceApprovalAccessFrom({ group_leader: true, deputy_director: false, director: true }),
    { group_leader: 'allowed', deputy_director: 'denied', director: 'allowed' });
  assert.deepEqual(produceApprovalAccessFrom(null), { group_leader: 'denied', deputy_director: 'denied', director: 'denied' });
  assert.deepEqual(produceApprovalAccessFrom({ group_leader: 'true' }), { group_leader: 'denied', deputy_director: 'denied', director: 'denied' });
  assert.equal(produceApprovalReadonlyReason('allowed'), '');
  assert.notEqual(produceApprovalReadonlyReason('denied'), '');
  assert.match(produceApprovalReadonlyReason('unavailable'), /已停用/);
});

test('當班判斷：凌晨 1 點前仍屬前一天的晚班', () => {
  const at = (today: string, hour: number) => ({ today, hour });
  assert.equal(produceCurrentShift(at('2026-10-21', 0), '2026-10-20')?.code, '17-01');
  assert.equal(produceCurrentShift(at('2026-10-21', 0), '2026-10-21'), null);
  assert.equal(produceCurrentShift(at('2026-10-21', 1), '2026-10-21')?.code, '01-09');
  assert.equal(produceCurrentShift(at('2026-10-21', 8), '2026-10-21')?.code, '01-09');
  assert.equal(produceCurrentShift(at('2026-10-21', 9), '2026-10-21')?.code, '09-17');
  assert.equal(produceCurrentShift(at('2026-10-21', 16), '2026-10-21')?.code, '09-17');
  assert.equal(produceCurrentShift(at('2026-10-21', 17), '2026-10-21')?.code, '17-01');
  assert.equal(produceCurrentShift(at('2026-10-21', 23), '2026-10-21')?.code, '17-01');
  assert.equal(produceCurrentShift(at('2026-10-21', 12), '2026-10-20'), null);
});
