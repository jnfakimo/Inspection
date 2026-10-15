import assert from 'node:assert/strict';
import test from 'node:test';
import {
  businessApprovalPresentation,
  businessApprovalReadonlyReason,
  emptyBusinessApprovalAccess,
  type BusinessApprovalStage,
} from './business-handover-approval.ts';

const stages: BusinessApprovalStage[] = ['director', 'deputy_manager', 'manager'];

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
    director: 'checking',
    deputy_manager: 'checking',
    manager: 'checking',
  });
  assert.deepEqual(emptyBusinessApprovalAccess('unavailable'), {
    director: 'unavailable',
    deputy_manager: 'unavailable',
    manager: 'unavailable',
  });
  assert.equal(businessApprovalReadonlyReason('allowed'), '');
});
