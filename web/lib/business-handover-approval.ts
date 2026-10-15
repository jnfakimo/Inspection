export type BusinessApprovalStage = 'director' | 'deputy_manager' | 'manager';
export type BusinessApprovalAccess = 'checking' | 'allowed' | 'denied' | 'unavailable';

export function emptyBusinessApprovalAccess(state: BusinessApprovalAccess = 'checking') {
  return {
    director: state,
    deputy_manager: state,
    manager: state,
  } satisfies Record<BusinessApprovalStage, BusinessApprovalAccess>;
}

export function businessApprovalReadonlyReason(state: BusinessApprovalAccess) {
  if (state === 'checking') return '正在確認本階段簽核權限…';
  if (state === 'denied') return '依業管組現行角色、市場與組織層級規則，您目前僅能檢視此階段。';
  if (state === 'unavailable') return '目前無法確認本階段簽核權限，請重新載入；簽核功能已停用。';
  return '';
}

export function businessApprovalPresentation(isApproved: boolean, access: BusinessApprovalAccess) {
  return {
    isApproved,
    canEditDraft: !isApproved && access === 'allowed',
    canEditSaved: isApproved && access === 'allowed',
    canSubmit: !isApproved && access === 'allowed',
  };
}
