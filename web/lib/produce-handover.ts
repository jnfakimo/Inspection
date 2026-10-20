// 水果組／蔬菜組電子交接簿的共用判斷（SYS-04 子系統 fruit、日後的 vegetable）。
// 與 supabase/migrations/20261021090000_produce_handover_fruit.sql 對應；啟用清單有測試與資料庫函式逐項比對。
export type ProduceGroup = 'fruit' | 'vegetable';
export type ProduceMarket = 'market_1' | 'market_2';
export type ProduceApprovalStage = 'group_leader' | 'deputy_director' | 'director';
export type ProduceApprovalAccess = 'checking' | 'allowed' | 'denied' | 'unavailable';

export const PRODUCE_GROUPS: Record<ProduceGroup, { name: string; module: string }> = {
  fruit: { name: '水果組', module: 'fruit' },
  vegetable: { name: '蔬菜組', module: 'vegetable' },
};

export const PRODUCE_MARKET_NAMES: Record<ProduceMarket, { short: string; name: string }> = {
  market_1: { short: '一市場', name: '第一果菜批發市場' },
  market_2: { short: '二市場', name: '第二果菜批發市場' },
};

/** 三班沿用業管組。 */
export const PRODUCE_SHIFTS = [
  { code: '01-09', name: '早班', label: '01:00–09:00' },
  { code: '09-17', name: '中班', label: '09:00–17:00' },
  { code: '17-01', name: '晚班', label: '17:00–01:00' },
] as const;
export const produceShiftName = (code: string) => PRODUCE_SHIFTS.find(shift => shift.code === code)?.name || code;

/**
 * 各組別目前開放的市場；必須與資料庫 produce_group_enabled(p_group, p_market) 相同（有測試比對）。
 * 目前只開放一市場水果組；蔬菜組與二市場待人員與主管鏈定義後，同步更新資料庫與這裡。
 */
export const PRODUCE_ENABLED_MARKETS: Record<ProduceGroup, readonly ProduceMarket[]> = {
  fruit: ['market_1'],
  vegetable: [],
};
export const produceGroupEnabled = (group: ProduceGroup, market: ProduceMarket) => PRODUCE_ENABLED_MARKETS[group].includes(market);

/** 批核順序，也是畫面與報表的顯示順序。 */
export const PRODUCE_APPROVAL_STAGE_ORDER: readonly ProduceApprovalStage[] = ['group_leader', 'deputy_director', 'director'];

export function produceApprovalStages(group: ProduceGroup, market: ProduceMarket) {
  const marketName = PRODUCE_MARKET_NAMES[market].short;
  return [
    { stage: 'group_leader' as const, label: '組(副)長', title: '組(副)長批核', desc: `組(副)長核閱${PRODUCE_GROUPS[group].name}三班交接事項` },
    { stage: 'deputy_director' as const, label: `${marketName}副主任`, title: `${marketName}副主任批核`, desc: `${PRODUCE_MARKET_NAMES[market].name}副主任複核` },
    { stage: 'director' as const, label: `${marketName}主任`, title: `${marketName}主任批核`, desc: `${PRODUCE_MARKET_NAMES[market].name}主任決行` },
  ];
}

/** 這一階目前不能批核的原因（關卡）；可以批核時回傳空字串。後一階須在前一階批核之後。 */
export function produceApprovalGateReason(stage: ProduceApprovalStage, approvedStages: Iterable<string>, group: ProduceGroup, market: ProduceMarket) {
  const index = PRODUCE_APPROVAL_STAGE_ORDER.indexOf(stage);
  if (index <= 0) return '';
  const approved = new Set(approvedStages);
  const previous = PRODUCE_APPROVAL_STAGE_ORDER[index - 1];
  if (approved.has(previous)) return '';
  const stages = produceApprovalStages(group, market);
  const label = (key: ProduceApprovalStage) => stages.find(item => item.stage === key)?.label || key;
  return `請先由${label(previous)}批核，${label(stage)}才能批核。`;
}

export function emptyProduceApprovalAccess(state: ProduceApprovalAccess = 'checking') {
  return { group_leader: state, deputy_director: state, director: state } satisfies Record<ProduceApprovalStage, ProduceApprovalAccess>;
}

/** produce_day 回傳的 can 欄位轉成各階段權限狀態。 */
export function produceApprovalAccessFrom(can: unknown): Record<ProduceApprovalStage, ProduceApprovalAccess> {
  const value = (can && typeof can === 'object' ? can : {}) as Record<string, unknown>;
  return {
    group_leader: value.group_leader === true ? 'allowed' : 'denied',
    deputy_director: value.deputy_director === true ? 'allowed' : 'denied',
    director: value.director === true ? 'allowed' : 'denied',
  };
}

export function produceApprovalReadonlyReason(state: ProduceApprovalAccess) {
  if (state === 'checking') return '正在確認本階段簽核權限…';
  if (state === 'denied') return '依現行角色、市場與組織層級規則，您目前僅能檢視此階段。';
  if (state === 'unavailable') return '目前無法確認本階段簽核權限，請重新載入；簽核功能已停用。';
  return '';
}

/** 交接日（台灣時間）：凌晨 1 點前仍屬前一天的晚班。 */
export function produceCurrentShift(now: { today: string; hour: number }, date: string) {
  const previousDay = (value: string) => new Date(Date.parse(`${value}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  if (now.hour < 1) return date === previousDay(now.today) ? PRODUCE_SHIFTS[2] : null;
  if (date !== now.today) return null;
  if (now.hour >= 17) return PRODUCE_SHIFTS[2];
  return now.hour >= 9 ? PRODUCE_SHIFTS[1] : PRODUCE_SHIFTS[0];
}
