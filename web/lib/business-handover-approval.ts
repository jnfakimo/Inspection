// 業管組交接簿主管批核：四階流程（市場副主任 → 市場主任 → 營業部副理 → 營業部經理）的共用判斷。
export type BusinessApprovalStage = 'deputy_director' | 'director' | 'deputy_manager' | 'manager';
export type BusinessApprovalAccess = 'checking' | 'allowed' | 'denied' | 'unavailable';
export type BusinessMarketCode = 'market_1' | 'market_2';

/** 批核順序，也是畫面與報表的顯示順序。 */
export const BUSINESS_APPROVAL_STAGE_ORDER: readonly BusinessApprovalStage[] = ['deputy_director', 'director', 'deputy_manager', 'manager'];

/**
 * 市場副主任這一關自此日起適用（含）；更早的歷史交接日維持原三階，不補批。
 * 必須與 supabase/migrations/20261020090000_business_handover_deputy_director_stage.sql 的
 * business_deputy_director_effective_date() 相同（有測試比對）。
 */
export const BUSINESS_DEPUTY_DIRECTOR_EFFECTIVE_DATE = '2026-10-21';

export function emptyBusinessApprovalAccess(state: BusinessApprovalAccess = 'checking') {
  return {
    deputy_director: state,
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

export function businessMarketName(market: BusinessMarketCode | null | undefined) {
  return market === 'market_2' ? '二市場' : '一市場';
}

/** 副主任這一關是否適用於該交接日（生效日之後；或該日已有副主任批核紀錄時仍要顯示）。 */
export function businessDeputyDirectorApplies(date: string, approvedStages: Iterable<string> = []) {
  if (date >= BUSINESS_DEPUTY_DIRECTOR_EFFECTIVE_DATE) return true;
  for (const stage of approvedStages) if (stage === 'deputy_director') return true;
  return false;
}

/** 該交接日要顯示的批核階段（依序）。 */
export function businessApprovalStagesFor(date: string, approvedStages: Iterable<string> = []): BusinessApprovalStage[] {
  const approved = [...approvedStages];
  return BUSINESS_APPROVAL_STAGE_ORDER.filter(stage => stage !== 'deputy_director' || businessDeputyDirectorApplies(date, approved));
}

/** 這一階目前不能批核的原因（關卡）；可以批核時回傳空字串。 */
export function businessApprovalGateReason(
  stage: BusinessApprovalStage,
  date: string,
  approvedStages: Iterable<string>,
  market: BusinessMarketCode | null | undefined,
) {
  if (stage !== 'director' || date < BUSINESS_DEPUTY_DIRECTOR_EFFECTIVE_DATE) return '';
  for (const approved of approvedStages) if (approved === 'deputy_director') return '';
  const name = businessMarketName(market);
  return `請先由${name}副主任批核，${name}主任才能批核。`;
}
