import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  BUSINESS_APPROVAL_STAGE_ORDER,
  BUSINESS_DEPUTY_DIRECTOR_EFFECTIVE_DATES,
  businessApprovalGateReason,
  businessApprovalPresentation,
  businessApprovalReadonlyReason,
  businessApprovalStagesFor,
  businessDeputyDirectorApplies,
  emptyBusinessApprovalAccess,
  type BusinessApprovalStage,
} from './business-handover-approval.ts';

const stages: BusinessApprovalStage[] = ['deputy_director', 'director', 'deputy_manager', 'manager'];

test('each stage fails closed while its permission is checking, denied, or unavailable', () => {
  for (const stage of stages) {
    for (const access of ['checking', 'denied', 'unavailable'] as const) {
      const view = businessApprovalPresentation(false, access);
      assert.equal(view.canSubmit, false, `${stage}:${access}`);
      assert.equal(view.canEditDraft, false, `${stage}:${access}`);
      assert.match(businessApprovalReadonlyReason(access), /權限|僅能檢視|停用/);
    }
  }
});

test('each explicitly allowed stage can sign independently', () => {
  for (const stage of stages) {
    const view = businessApprovalPresentation(false, 'allowed');
    assert.equal(view.canSubmit, true, stage);
    assert.equal(view.canEditDraft, true, stage);
    assert.equal(view.canEditSaved, false, stage);
  }
});

test('saved approvals keep their note visible and only an authorized stage can update it', () => {
  for (const access of ['checking', 'denied', 'unavailable'] as const) {
    const view = businessApprovalPresentation(true, access);
    assert.equal(view.isApproved, true);
    assert.equal(view.canSubmit, false);
    assert.equal(view.canEditDraft, false);
    assert.equal(view.canEditSaved, false);
  }
  assert.equal(businessApprovalPresentation(true, 'allowed').canEditSaved, true);
});

test('permission state initializes every stage and preserves independent access results', () => {
  assert.deepEqual(emptyBusinessApprovalAccess(), {
    deputy_director: 'checking',
    director: 'checking',
    deputy_manager: 'checking',
    manager: 'checking',
  });
  assert.deepEqual(emptyBusinessApprovalAccess('unavailable'), {
    deputy_director: 'unavailable',
    director: 'unavailable',
    deputy_manager: 'unavailable',
    manager: 'unavailable',
  });
  assert.equal(businessApprovalReadonlyReason('allowed'), '');
});

test('market 1 runs four stages: deputy director → director → deputy manager → manager', () => {
  assert.deepEqual([...BUSINESS_APPROVAL_STAGE_ORDER], stages);
  assert.deepEqual(businessApprovalStagesFor('market_1', '2026-10-21'), stages);
  assert.deepEqual(businessApprovalStagesFor('market_1', '2027-01-01'), stages);
});

test('market 2 stays on three stages until its deputy director is enabled', () => {
  assert.equal(BUSINESS_DEPUTY_DIRECTOR_EFFECTIVE_DATES.market_2, null);
  assert.deepEqual(businessApprovalStagesFor('market_2', '2026-10-21'), ['director', 'deputy_manager', 'manager']);
  assert.deepEqual(businessApprovalStagesFor('market_2', '2027-06-01'), ['director', 'deputy_manager', 'manager']);
  assert.equal(businessDeputyDirectorApplies('market_2', '2027-06-01'), false);
  assert.equal(businessApprovalGateReason('director', '2027-06-01', [], 'market_2'), '', '二市場主任不受副主任關卡限制');
});

test('historical dates before the effective date keep three stages unless a deputy-director approval already exists', () => {
  assert.deepEqual(businessApprovalStagesFor('market_1', '2026-10-20'), ['director', 'deputy_manager', 'manager']);
  assert.equal(businessDeputyDirectorApplies('market_1', '2026-10-20'), false);
  assert.equal(businessDeputyDirectorApplies('market_1', '2026-10-20', ['director']), false);
  assert.deepEqual(businessApprovalStagesFor('market_1', '2026-10-20', ['deputy_director']), stages);
});

test('the director is gated on the deputy director only in an enabled market on or after the effective date', () => {
  const blocked = businessApprovalGateReason('director', '2026-10-21', ['deputy_manager'], 'market_1');
  assert.equal(blocked, '請先由一市場副主任批核，一市場主任才能批核。');
  assert.equal(businessApprovalGateReason('director', '2026-10-21', ['deputy_director'], 'market_1'), '');
  assert.equal(businessApprovalGateReason('director', '2026-10-20', [], 'market_1'), '', '歷史日期不受關卡限制');
  for (const stage of ['deputy_director', 'deputy_manager', 'manager'] as const) {
    assert.equal(businessApprovalGateReason(stage, '2026-10-22', [], 'market_1'), '', stage + ' 本身沒有前置關卡');
  }
});

test('the effective dates match the database migration, including the markets that are not enabled', () => {
  const migration = readFileSync(new URL('../../supabase/migrations/20261020090000_business_handover_deputy_director_stage.sql', import.meta.url), 'utf8');
  const body = /business_deputy_director_effective_date\(p_market text\)[\s\S]*?select case p_market([\s\S]*?)end\s*\$\$/i.exec(migration);
  assert.ok(body, '找不到 migration 內的啟用日函式');
  const enabled = [...body[1].matchAll(/when '(market_\d)' then date '(\d{4}-\d{2}-\d{2})'/g)].map(m => [m[1], m[2]]);
  const fromMigration = Object.fromEntries(enabled);
  const fromFrontend = Object.fromEntries(Object.entries(BUSINESS_DEPUTY_DIRECTOR_EFFECTIVE_DATES).filter(([, date]) => date));
  assert.deepEqual(fromFrontend, fromMigration);
  assert.match(body[1], /else 'infinity'::date/, '沒有列出的市場必須回傳 infinity（不啟用）');
});

// 畫面契約：點選批核先開報表預覽，在預覽中填說明並確認批核；階段標籤依市場與日期決定。
const page = readFileSync(new URL('../app/systems/[system]/[module]/business-handover.tsx', import.meta.url), 'utf8');

test('clicking a stage opens the report preview and the approval is confirmed inside it', () => {
  assert.match(page, /onClick=\{\(\) => openApprovalPreview\(stageItem\.stage\)\}/);
  assert.doesNotMatch(page, /onClick=\{\(\) => void handleApproveStage\(stageItem\.stage\)\}/, '階段卡片上的按鈕不可跳過預覽直接批核');
  assert.match(page, /\{\(previewOpen \|\| approvalPreviewStage\) && \(/);
  assert.match(page, /onClick=\{\(\) => void handleApproveStage\(approvalPreviewStage, previewApprovalNote\)\}/);
  assert.match(page, /<BusinessReportContent[\s\S]{0,500}previewPages/, '預覽與列印共用同一個報表元件');
  assert.match(page, /if \(e\.target === e\.currentTarget && !previewStageItem\) closePreview\(\)/, '批核中點擊空白處不可關閉預覽');
});

test('the gate and the stage list are enforced both on the cards and when confirming', () => {
  assert.match(page, /const gateReason = businessApprovalGateReason\(stage, date, approvals\.map\(approval => approval\.stage\), market\);/);
  assert.match(page, /businessApprovalGateReason\(stageItem\.stage, date, approvedStageKeys, market\)/);
  assert.match(page, /const approvalStages = approvalStageItems\(market \|\| 'market_1', date, approvals\);/);
  assert.match(page, /const stageItems = approvalStageItems\(market, date, approvals\);/, '列印報表與畫面使用同一份階段清單');
  assert.match(page, /label: name \+ '副主任'/);
  assert.match(page, /label: name \+ '主任'/);
});
