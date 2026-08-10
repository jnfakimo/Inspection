'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { getSupabase } from '@/lib/supabase';
import type { Profile } from '@/types/app';

const sharedActions = [
  { href: '/systems/', label: '首頁', icon: '/word-cloud/assets/system-icons/home-icon.svg' },
  { href: '/', label: '戰情儀表板', icon: '/word-cloud/assets/system-icons/admin-icon.png' },
  { href: '/systems/workorder/', label: '維修／派完工', icon: '/word-cloud/assets/system-icons/maintenance-icon.png', sysKey: 'workorder' },
  { href: '/systems/guardpatrol/', label: '駐衛警巡檢', icon: '/word-cloud/assets/system-icons/guardpatrol-icon.png', sysKey: 'guardpatrol' },
  { href: '/systems/handover/', label: '電子交接簿', icon: '/word-cloud/assets/system-icons/handover-icon.png', sysKey: 'handover' },
  { href: '/systems/admin/', label: '後台', icon: '/word-cloud/assets/system-icons/admin-icon.png', sysKey: 'admin' },
];

function taipeiClock() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date()).replace(',', '');
}

export function AppShell({ profile, title, children }: { profile: Profile; title: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [clock, setClock] = useState(taipeiClock);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');

  useEffect(() => {
    document.documentElement.dataset.theme = localStorage.getItem('siteTheme') || 'tech';
    const timer = window.setInterval(() => setClock(taipeiClock()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const actions = sharedActions.filter(item => !item.sysKey || profile.allowed_systems.includes('*') || profile.allowed_systems.includes(item.sysKey));
  async function logout() {
    await getSupabase().auth.signOut({ scope: 'local' });
    location.replace('/word-cloud/v2/login/');
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    const confirm = String(form.get('confirm') || '');
    if (password.length < 8) return setPasswordMessage('密碼至少需要 8 個字元');
    if (password !== confirm) return setPasswordMessage('兩次輸入的密碼不一致');
    const { error } = await getSupabase().auth.updateUser({ password });
    if (error) return setPasswordMessage(error.message || '密碼更新失敗');
    setPasswordMessage('密碼已更改');
    window.setTimeout(() => setPasswordOpen(false), 900);
  }

  return <div className="app-shell v1-shell">
    <header className="v1-navbar">
      <div className="v1-brand"><b>■ TAIPEC-MKT-1</b><strong>{title}</strong><span>臺北農產公司／第一果菜市場</span></div>
      <nav className="v1-actions" aria-label="共用系統導覽">
        {actions.map(item => <Link key={item.href} href={item.href} className={pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href)) ? 'is-current' : ''}><img src={item.icon} alt="" /><span>{item.label}</span></Link>)}
      </nav>
      <div className="user-meta v1-meta">
        <span>{profile.department || '未設定單位'}｜{profile.name}</span>
        <i><em />系統連線中</i>
        <time>{clock}</time>
        <button onClick={() => { setPasswordMessage(''); setPasswordOpen(true); }}>更改密碼</button>
        <button onClick={logout}>登出</button>
      </div>
    </header>
    <main className="content v1-content">{children}</main>
    {passwordOpen && <div className="password-modal" role="dialog" aria-modal="true" aria-label="更改密碼"><form onSubmit={changePassword}><h2>更改密碼</h2><label>新密碼<input type="password" name="password" minLength={8} required autoComplete="new-password" /></label><label>確認新密碼<input type="password" name="confirm" minLength={8} required autoComplete="new-password" /></label>{passwordMessage && <p>{passwordMessage}</p>}<div><button type="button" onClick={() => setPasswordOpen(false)}>取消</button><button className="primary-btn compact">確認更改</button></div></form></div>}
  </div>;
}
