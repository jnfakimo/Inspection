'use client';

import Link from 'next/link';
import type { Profile } from '@/types/app';

type SidebarItem = {
  href: string;
  label: string;
  icon: string;
  system?: string;
  adminOnly?: boolean;
  activePaths?: string[];
};

const sidebarItems: SidebarItem[] = [
  { href: '/', label: '戰情儀表板', icon: '/Inspection/assets/system-icons/admin-icon.png' },
  { href: '/systems/admin/layouts/', label: '戰情版面設定', icon: '/Inspection/assets/system-icons/admin-icon.png', adminOnly: true },
  {
    href: '/systems/admin/settings/',
    label: '系統設定',
    icon: '/Inspection/assets/system-icons/settings-icon.png',
    adminOnly: true,
    activePaths: [
      '/systems/admin/settings/',
      '/systems/admin/permissions/',
      '/systems/admin/locations/',
      '/systems/admin/notices/',
    ],
  },
  { href: '/systems/admin/users/', label: '帳號管理', icon: '/Inspection/assets/system-icons/account-icon.png', adminOnly: true },
  { href: '/systems/equipment/', label: '設備建置管理', icon: '/Inspection/assets/system-icons/equipment-icon.png', system: 'equipment' },
  { href: '/systems/workorder/', label: '維修／派工／完工系統', icon: '/Inspection/assets/system-icons/maintenance-icon.png', system: 'workorder' },
  { href: '/systems/guardpatrol/', label: '駐衛警巡檢系統', icon: '/Inspection/assets/system-icons/guardpatrol-icon.png', system: 'guardpatrol' },
  { href: '/systems/handover/', label: '電子交接簿', icon: '/Inspection/assets/system-icons/handover-icon.png', system: 'handover' },
  { href: '/systems/structuremap/models/', label: '3D 雲臺建模', icon: '/Inspection/assets/system-icons/equipment-icon.png', system: 'structuremap' },
  { href: '/systems/structuremap/relations/', label: '專案關係地圖', icon: '/Inspection/assets/system-icons/settings-icon.png', system: 'structuremap' },
  { href: '/systems/equipment/costs/', label: '費用統計', icon: '/Inspection/assets/system-icons/audit-icon.png', system: 'equipment' },
  {
    href: '/systems/admin/audit/',
    label: '系統紀錄',
    icon: '/Inspection/assets/system-icons/audit-icon.png',
    adminOnly: true,
    activePaths: ['/systems/admin/audit/', '/systems/admin/alerts/'],
  },
];

function isAdministrator(profile: Profile) {
  return [profile.rbac_role, profile.role].some(role => role === 'sysadmin' || role === 'admin');
}

function matchingLength(pathname: string, item: SidebarItem) {
  if (item.href === '/') return pathname === '/' ? 1 : -1;
  const paths = item.activePaths ?? [item.href];
  return paths.reduce((length, path) => (
    pathname === path || pathname.startsWith(path) ? Math.max(length, path.length) : length
  ), -1);
}

export function AdminSidebar({
  profile,
  pathname,
  open,
  onClose,
  onChangePassword,
}: {
  profile: Profile;
  pathname: string;
  open: boolean;
  onClose: () => void;
  onChangePassword: () => void;
}) {
  const administrator = isAdministrator(profile);
  const permitted = (system?: string) => (
    !system || profile.allowed_systems.includes('*') || profile.allowed_systems.includes(system)
  );
  const items = sidebarItems.filter(item => (!item.adminOnly || administrator) && permitted(item.system));
  const activeItem = items
    .map(item => ({ href: item.href, length: matchingLength(pathname, item) }))
    .sort((left, right) => right.length - left.length)[0];
  const activeHref = activeItem && activeItem.length >= 0 ? activeItem.href : '';

  return <>
    <button
      type="button"
      className={`admin-sidebar-backdrop${open ? ' is-open' : ''}`}
      aria-label="關閉後台選單"
      tabIndex={open ? 0 : -1}
      onClick={onClose}
    />
    <aside id="admin-v2-sidebar" className={`admin-sidebar${open ? ' is-open' : ''}`} aria-label="後台管理側邊導覽">
      <div className="admin-sidebar-brand">
        <Link href="/systems/admin/" onClick={onClose}>
          <img src="/Inspection/assets/system-icons/admin-icon.png" alt="" />
          <strong>後台管理系統</strong>
        </Link>
        <button type="button" className="admin-sidebar-close" aria-label="關閉後台選單" onClick={onClose}>×</button>
      </div>
      <nav className="admin-sidebar-nav" aria-label="V2 後台功能切換">
        {items.map(item => {
          const current = item.href === activeHref;
          return <Link
            key={item.href}
            href={item.href}
            className={current ? 'is-current' : ''}
            aria-current={current ? 'page' : undefined}
            onClick={onClose}
          >
            <img src={item.icon} alt="" />
            <span>{item.label}</span>
          </Link>;
        })}
      </nav>
      <div className="admin-sidebar-profile">
        <span>{profile.name}［{administrator ? '系統管理員' : profile.role}］</span>
        <button type="button" onClick={() => { onClose(); onChangePassword(); }}>
          <img src="/Inspection/assets/system-icons/account-icon.png" alt="" />
          個人資料設定
        </button>
      </div>
    </aside>
  </>;
}
