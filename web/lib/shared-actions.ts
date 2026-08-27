/**
 * 系統頁面中的內容層級切換清單。
 *
 * V2 一般內容頁頂列現在只顯示首頁、個人資料與登出；此清單保留給需要在
 * 內容或工具區提供系統切換的舊頁面，不由 AppShell 的一般頂列直接渲染。
 */
export type SharedAction = { href: string; label: string; icon: string; sysKey?: string };

export const SHARED_ACTIONS: SharedAction[] = [
  { href: '/systems/', label: '首頁', icon: '/Inspection/assets/system-icons/home-nav-icon.png' },
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
