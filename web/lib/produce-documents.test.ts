import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LINE_LIMIT,
  PRODUCE_DOC_STAGES,
  PRODUCE_DOC_STAGE_LABELS,
  SCRAP_FORM_NO,
  SLIP_COPIES,
  STOCK_COPIES,
  STOCK_FORM_NO,
  blankScrapLine,
  blankStockLine,
  compactLines,
  docGateReason,
  docProgressLabel,
  lineProblem,
  monthDay,
  nextDocStage,
  rocDateLabel,
  slipTimeLabel,
  sumLines,
  taipeiLocalToIso,
  taipeiNowLocal,
} from './produce-documents.ts';

const migration = readFileSync(new URL('../../supabase/migrations/20261022090000_produce_handover_documents.sql', import.meta.url), 'utf8');

test('簽核階段與資料庫 produce_document_stage_order 一致', () => {
  const sql = /produce_document_stage_order[\s\S]*?select case p_doc_type([^\n]+)/.exec(migration)?.[1] || '';
  for (const [type, stages] of Object.entries(PRODUCE_DOC_STAGES)) {
    const expected = `when '${type}' then array[${stages.map(stage => `'${stage}'`).join(',')}]`;
    assert.ok(sql.includes(expected), `${type}: ${expected}`);
  }
  assert.deepEqual(PRODUCE_DOC_STAGES.stock, ['small_leader', 'group_leader']);
  assert.deepEqual(PRODUCE_DOC_STAGES.scrap, ['small_leader', 'group_leader', 'director']);
  for (const [stage, label] of Object.entries(PRODUCE_DOC_STAGE_LABELS)) assert.ok(migration.includes(`'${label}'`), `migration 含標籤 ${stage}`);
});

test('明細上限與資料庫一致', () => {
  assert.equal(LINE_LIMIT, 60);
  assert.match(migration, /至多 60 列/);
});

test('合計列：件數加總、重量加總並四捨五入到小數 2 位，非數字視為 0', () => {
  assert.deepEqual(sumLines([{ pieces: '12', weight: '120' }, { pieces: 5, weight: 50.456 }, { pieces: '', weight: 'x' }]), { pieces: 17, weight: 170.46 });
  assert.deepEqual(sumLines([]), { pieces: 0, weight: 0 });
  assert.deepEqual(sumLines([{ pieces: '3.9', weight: '0.1' }, { weight: '0.2' }]), { pieces: 3, weight: 0.3 }, '浮點數誤差不外露');
});

test('空白列略過：預設日期不算有填；有品名或件數的列保留', () => {
  const lines = [blankScrapLine('2026-10-15'), { ...blankScrapLine('2026-10-15'), product_name: '蘋果', pieces: '12' }, { ...blankScrapLine('2026-10-15'), pieces: '0' }];
  assert.equal(compactLines(lines).length, 1);
  assert.equal(compactLines([blankStockLine(), { ...blankStockLine(), weight: '5' }]).length, 1);
  assert.equal(lineProblem([blankStockLine()]), '', '全空白列不算問題');
  assert.equal(lineProblem([{ ...blankStockLine(), pieces: '3' }]), '每一列都必須填寫品名');
  assert.equal(lineProblem([{ ...blankStockLine(), product_name: '蘋果', pieces: '1.5' }]), '件數必須是整數');
  assert.equal(lineProblem([{ ...blankStockLine(), product_name: '蘋果', weight: '-2' }]), '件數與重量必須是不小於 0 的數字');
  assert.equal(lineProblem([{ ...blankStockLine(), product_name: '蘋果', weight: 'abc' }]), '件數與重量必須是不小於 0 的數字');
  assert.equal(lineProblem([{ ...blankStockLine(), product_name: '蘋果', pieces: '12', weight: '120.5' }]), '');
  assert.match(lineProblem(Array.from({ length: LINE_LIMIT + 1 }, () => ({ ...blankStockLine(), product_name: 'x' }))), /至多 60 列/);
});

test('後一階須在前一階之後；只有送出的單據可簽', () => {
  assert.equal(docGateReason('stock', 'small_leader', [], 'submitted'), '');
  assert.equal(docGateReason('stock', 'group_leader', [], 'submitted'), '請先由小組長簽核，組(副)長才能簽核。');
  assert.equal(docGateReason('stock', 'group_leader', ['small_leader'], 'submitted'), '');
  assert.equal(docGateReason('scrap', 'director', ['small_leader'], 'submitted'), '請先由組(副)長簽核，主(副)任才能簽核。');
  assert.equal(docGateReason('scrap', 'director', ['small_leader', 'group_leader'], 'submitted'), '');
  assert.equal(docGateReason('scrap', 'small_leader', [], 'draft'), '單據尚未送出');
  assert.equal(docGateReason('scrap', 'small_leader', [], 'void'), '單據已作廢');
  assert.match(migration, /raise exception '請先由%簽核，%才能簽核'/);
});

test('下一個待簽階段與進度文字', () => {
  assert.equal(nextDocStage('stock', []), 'small_leader');
  assert.equal(nextDocStage('stock', ['small_leader']), 'group_leader');
  assert.equal(nextDocStage('stock', ['small_leader', 'group_leader']), null);
  assert.equal(nextDocStage('scrap', ['small_leader', 'group_leader']), 'director');
  assert.equal(docProgressLabel('stock', 'draft', []), '草稿');
  assert.equal(docProgressLabel('scrap', 'void', []), '已作廢');
  assert.equal(docProgressLabel('scrap', 'submitted', ['small_leader']), '簽核 1/3');
  assert.equal(docProgressLabel('stock', 'submitted', ['small_leader', 'group_leader']), '簽核完成');
});

test('聯別與表號沿用紙本', () => {
  assert.equal(STOCK_FORM_NO, 'HOL-2-09');
  assert.equal(SCRAP_FORM_NO, 'HEM-2-11');
  assert.deepEqual(STOCK_COPIES.map(copy => copy.name), ['自存或列入交代（移交）', '送核算小組', '呈閱後送業務部']);
  assert.deepEqual(SLIP_COPIES.map(copy => copy.name), ['存根（白）', '拍賣員完帳（黃）', '供應人存查（藍）']);
});

test('日期與時間顯示：月/日、民國年、台灣時間', () => {
  assert.equal(monthDay('2026-10-05'), '10/5');
  assert.equal(monthDay(''), '');
  assert.equal(monthDay('abc'), '');
  assert.equal(rocDateLabel('2026-10-15'), '115 年 10 月 15 日');
  assert.equal(rocDateLabel(null), '');
  assert.equal(taipeiLocalToIso('2026-10-15T10:30'), '2026-10-15T10:30:00+08:00');
  assert.equal(taipeiLocalToIso('2026-10-15'), '');
  assert.equal(taipeiNowLocal(new Date('2026-10-15T02:30:00Z')), '2026-10-15T10:30');
  assert.equal(taipeiNowLocal(new Date('2026-10-15T16:30:00Z')), '2026-10-16T00:30', '跨日以台灣時間為準');
  assert.equal(slipTimeLabel('2026-10-15T02:30:00Z'), '115 年 10 月 15 日 10:30');
  assert.equal(slipTimeLabel(''), '');
  assert.equal(slipTimeLabel('not-a-date'), '');
});
