/**
 * 全站共用的頂列動作組。
 *
 * AGENTS.md 明訂：每個應用頁面都要用同一組六個動作、同一個順序、同一組圖示，
 * 且未經明確要求不得更動。抽成單一定義是為了讓「同一組」在結構上成立——
 * 先前只存在於 AppShell 內部，全螢幕工具頁（3D 模型圖、整合標記系統）因為不套
 * AppShell，就只能自己另寫一份導覽，兩邊必然逐漸走鐘。
 */
export type SharedAction = { href: string; label: string; icon: string; sysKey?: string };

export const SHARED_ACTIONS: SharedAction[] = [
  { href: '/systems/', label: '首頁', icon: '/Inspection/assets/system-icons/home-icon.svg' },
  { href: '/', label: '戰情儀表板', icon: '/Inspection/assets/system-icons/admin-icon.png' },
  { href: '/systems/workorder/', label: '維修／派完工', icon: '/Inspection/assets/system-icons/maintenance-icon.png', sysKey: 'workorder' },
  { href: '/systems/guardpatrol/', label: '駐衛警巡檢', icon: '/Inspection/assets/system-icons/guardpatrol-icon.png', sysKey: 'guardpatrol' },
  { href: '/systems/handover/', label: '電子交接簿', icon: '/Inspection/assets/system-icons/handover-icon.png', sysKey: 'handover' },
  { href: '/systems/admin/', label: '後台', icon: '/Inspection/assets/system-icons/admin-icon.png', sysKey: 'admin' },
];

/** 依帳號可用的系統過濾；allowed_systems 含 '*' 代表全開。 */
export function allowedActions(allowedSystems: string[] | undefined) {
  const allowed = allowedSystems || [];
  return SHARED_ACTIONS.filter(item =>
    !item.sysKey || allowed.includes('*') || allowed.includes(item.sysKey));
}
