import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeMarketSheet, combineMarketFiles } from './market-file-import.ts';

const heading = ['品名代號', '品名', '品種', '平均價\n(元/公斤)', '成交量(公斤)', '上價', '中價', '下價'];
const report = (rows: unknown[][], metadata = '第一市場 蔬菜', date = '115/09/01') => [
  ['臺北農產運銷股份有限公司 交易行情查詢'], ['', '', '', '', '', `查詢日期：${date}(全場交易行情)`],
  heading, ['', '', '', '', '', metadata], ...rows,
];
const records = [['FB1', '花椰菜', '青梗', 10, 2, 12, 10, 8], ['FB9', '花椰菜', '進口', 20, 3, 24, 20, 16]];

test('official report converts ROC date, reads market from contents, and matches historical weighted aggregation', () => {
  const parsed = normalizeMarketSheet(report(records), '交易行情查詢_115_09_01_蔬菜 (1).xls');
  assert.deepEqual(parsed.rows[0].slice(0, 11), ['2026-09-01', '第一市場', '蔬菜', '花椰菜', 'FB1|FB9', '5', '80', '16', '24', '16', '8']);
  assert.equal(parsed.report?.details, 2);
  assert.equal(parsed.report?.items, 1);
  assert.equal(parsed.report?.quantity, 5);
});
test('empty exports do not invent market or create zero-value rows', () => {
  const parsed = normalizeMarketSheet(report([[], []], '(單位：元/公斤)', ''), '交易行情查詢_115_08_31_蔬菜 (1).xls');
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.report?.date, '2026-08-31');
  assert.equal(parsed.report?.market, '');
  assert.match(parsed.report!.note, /無交易明細/);
});
test('same detail or same downloaded file is not counted twice', () => {
  const one = normalizeMarketSheet(report([...records, records[0]]), 'one.xls');
  const two = normalizeMarketSheet(report(records), 'two.xls');
  const joined = combineMarketFiles([one, two]);
  assert.equal(one.report?.quantity, 5);
  assert.equal(joined.rows.length, 1);
  assert.equal(joined.reports[1].items, 0);
  assert.match(joined.reports[1].note, /重複/);
});
test('conflicting exports of the same date and market stop before importing', () => {
  assert.throws(() => combineMarketFiles([
    normalizeMarketSheet(report(records), 'one.xls'),
    normalizeMarketSheet(report([records[0]]), 'two.xls'),
  ]), /不同版本/);
});
test('different markets and dates remain separate', () => {
  const joined = combineMarketFiles([
    normalizeMarketSheet(report(records), 'one.xls'),
    normalizeMarketSheet(report(records, '第二市場 蔬菜'), 'two.xls'),
    normalizeMarketSheet(report(records, '第一市場 蔬菜', '115/09/02'), 'three.xls'),
  ]);
  assert.equal(joined.rows.length, 3);
});
test('missing metadata, invalid dates and invalid numbers cannot silently corrupt data', () => {
  assert.throws(() => normalizeMarketSheet(report(records, '蔬菜'), 'one.xls'), /缺少/);
  assert.throws(() => normalizeMarketSheet(report(records, '第一市場 蔬菜', '115/02/30'), 'one.xls'), /日期無效/);
  assert.throws(() => normalizeMarketSheet(report([['FB1', '花椰菜', '', 10, 'oops']]), 'one.xls'), /成交量/);
  assert.throws(() => normalizeMarketSheet(report([records[0], ['FB1', '花椰菜', '青梗', 10, 5]]), 'one.xls'), /重複但數值不同/);
});
test('price-range zero sentinel stays missing instead of lowering minimum prices to zero', () => {
  const parsed = normalizeMarketSheet(report([['FB1', '花椰菜', '', 10, 2, 0, 0, 0]]), 'one.xls');
  assert.deepEqual(parsed.rows[0].slice(8, 11), ['', '', '']);
  assert.match(parsed.rows[0][12], /價格區間為零/);
});
test('ordinary first-row worksheets remain supported, including dates and blank columns', () => {
  const parsed = normalizeMarketSheet([['日期', '品名', ''], [new Date('2026-09-01T00:00:00Z'), '青菜', 0]], 'simple.xlsx');
  assert.deepEqual(parsed, { headers: ['日期', '品名', '欄位3'], rows: [['2026-09-01', '青菜', '0']] });
});
