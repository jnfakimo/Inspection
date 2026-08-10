'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import { LEGACY_BASE } from '@/lib/config';
import type { Profile } from '@/types/app';

const primary = [
  { href: '/', label: '戰情儀表板', icon: '/word-cloud/assets/system-icons/admin-icon.png' },
  { href: '/inspections/', label: '巡檢作業', icon: '/word-cloud/assets/system-icons/guardpatrol-icon.png' },
  { href: '/equipment-map/', label: '設備圖臺', icon: '/word-cloud/assets/system-icons/equipment-icon.png' },
  { href: '/mobile/', label: '手機操作', icon: '/word-cloud/assets/system-icons/account-icon.png' },
];

const legacy = [
  { href: `${LEGACY_BASE}/index.html`, label: '首頁', icon: '/word-cloud/assets/system-icons/home-icon.svg' },
  { href: `${LEGACY_BASE}/admin.html?v=8f9d41c#repairs`, label: '維修／派完工', icon: '/word-cloud/assets/system-icons/maintenance-icon.png' },
  { href: `${LEGACY_BASE}/guardpatrol-index.html`, label: '駐衛警巡檢', icon: '/word-cloud/assets/system-icons/guardpatrol-icon.png' },
  { href: `${LEGACY_BASE}/handover.html`, label: '電子交接簿', icon: '/word-cloud/assets/system-icons/handover-icon.png' },
  { href: `${LEGACY_BASE}/admin.html`, label: '後台', icon: '/word-cloud/assets/system-icons/admin-icon.png' },
];

export function AppShell({ profile, title, children }: { profile: Profile; title: string; children: React.ReactNode }) {
  const pathname = usePathname();
  async function logout() {
    await getSupabase().auth.signOut({ scope: 'local' });
    location.replace('/word-cloud/v2/login/');
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span>■ TAIPEC-MKT-1</span><strong>北農智慧巡檢</strong><small>第一果菜市場</small></div>
        <nav className="main-nav" aria-label="新版系統導覽">
          {primary.map(item => (
            <Link key={item.href} href={item.href} className={pathname === item.href ? 'active' : ''}>
              <img src={item.icon} alt="" /><span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="legacy-links"><span>既有系統</span>{legacy.map(item => <a key={item.href} href={item.href}><img src={item.icon} alt="" />{item.label}</a>)}</div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div><p className="eyebrow">TAPMC OPERATIONS PLATFORM</p><h1>{title}</h1></div>
          <div className="user-meta"><span>{profile.department || '未設定單位'}｜{profile.name}</span><i>● 系統連線中</i><button onClick={logout}>登出</button></div>
        </header>
        <main className="content">{children}</main>
      </section>
    </div>
  );
}
