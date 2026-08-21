'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from '@/components/AdminSidebar';
import { ResponsiveTableLabels } from '@/components/ResponsiveTableLabels';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { invokeGoogleCalendar, type GoogleCalendarStatus } from '@/lib/google-calendar';
import type { Profile } from '@/types/app';
import { allowedActions } from '@/lib/shared-actions';


function taipeiClock() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date()).replace(',', '');
}

export function AppShell({ profile, title, children }: { profile: Profile; title: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [clock, setClock] = useState(taipeiClock);
  const [theme, setTheme] = useState('light');
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileDetails, setProfileDetails] = useState<Profile>(profile);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [calendarStatus, setCalendarStatus] = useState<GoogleCalendarStatus | null>(null);
  const [calendarMessage, setCalendarMessage] = useState('');
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const isAdminArea = pathname === '/systems/admin/' || pathname.startsWith('/systems/admin/');

  useEffect(() => {
    const savedTheme = localStorage.getItem('siteTheme') === 'tech' ? 'tech' : 'light';
    document.documentElement.dataset.theme = savedTheme;
    setTheme(savedTheme);
    const timer = window.setInterval(() => setClock(taipeiClock()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadPersonalProfile = useCallback(async () => {
    setProfileBusy(true);
    setProfileMessage('');
    try {
      const [details, google] = await Promise.all([
        invokeAppApi<Profile>('profile'),
        invokeGoogleCalendar<GoogleCalendarStatus>('status').catch(() => null),
      ]);
      setProfileDetails(details);
      setCalendarStatus(google);
    } catch {
      setProfileMessage('個人資料載入失敗，請稍後再試');
    } finally {
      setProfileBusy(false);
    }
  }, []);

  const openProfile = useCallback(() => {
    setPasswordMessage('');
    setCalendarMessage('');
    setProfileOpen(true);
    void loadPersonalProfile();
  }, [loadPersonalProfile]);

  useEffect(() => {
    const handleOpen = () => openProfile();
    window.addEventListener('open-personal-profile', handleOpen);
    const url = new URL(window.location.href);
    const result = url.searchParams.get('google_calendar');
    if (result) {
      openProfile();
      setCalendarMessage(result === 'connected' ? 'Google 個人行事曆已連結，預約將開始同步。' : 'Google 授權未完成，請重新連結。');
      url.searchParams.delete('google_calendar');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
    return () => window.removeEventListener('open-personal-profile', handleOpen);
  }, [openProfile]);

  useEffect(() => {
    if (!profileOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setProfileOpen(false); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', closeOnEscape); };
  }, [profileOpen]);

  useEffect(() => {
    if (!adminMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAdminMenuOpen(false);
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [adminMenuOpen]);

  const actions = allowedActions(profile.allowed_systems);
  async function logout() {
    try { await getSupabase().auth.signOut({ scope: 'local' }); }
    catch (error) { console.warn('logout failed:', error); }
    location.replace('/Inspection/v2/login/');
  }
  function toggleTheme() {
    const nextTheme = theme === 'light' ? 'tech' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem('siteTheme', nextTheme);
    setTheme(nextTheme);
  }
  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') || '');
    const confirm = String(form.get('confirm') || '');
    if (password.length < 8) return setPasswordMessage('密碼至少需要 8 個字元');
    if (password !== confirm) return setPasswordMessage('兩次輸入的密碼不一致');
    try {
      const { error } = await getSupabase().auth.updateUser({ password });
      if (error) return setPasswordMessage('密碼更新失敗，請確認密碼格式後再試');
      setPasswordMessage('密碼已更改');
      event.currentTarget.reset();
    } catch (error) { setPasswordMessage(error instanceof Error ? error.message : '密碼更新失敗，請檢查網路後重試'); }
  }
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setProfileBusy(true); setProfileMessage('');
    try {
      const updated = await invokeAppApi<Profile>('update_personal_profile', { name: form.get('name'), phone: form.get('phone') });
      setProfileDetails(updated); setProfileMessage('個人資料已更新');
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : '個人資料更新失敗');
    } finally { setProfileBusy(false); }
  }
  async function connectGoogle() {
    setProfileBusy(true); setCalendarMessage('');
    try {
      const result = await invokeGoogleCalendar<{ url: string }>('oauth_start', { return_to: window.location.href });
      window.location.assign(result.url);
    } catch (error) {
      setCalendarMessage(error instanceof Error ? error.message : 'Google 授權啟動失敗'); setProfileBusy(false);
    }
  }
  async function disconnectGoogle() {
    if (!window.confirm('確定解除 Google 個人行事曆連結？已建立的既有行程不會自動刪除。')) return;
    setProfileBusy(true); setCalendarMessage('');
    try {
      await invokeGoogleCalendar('disconnect');
      setCalendarStatus({ connected: false }); setCalendarMessage('已解除 Google 個人行事曆連結');
    } catch (error) {
      setCalendarMessage(error instanceof Error ? error.message : '解除連結失敗');
    } finally { setProfileBusy(false); }
  }

  return <div className="app-shell v1-shell">
    <ResponsiveTableLabels />
    <header className="v1-navbar">
      <div className="v1-brand"><b>■ TAIPEC-MKT-1</b><strong>{title}</strong><span>臺北農產公司／第一果菜市場</span></div>
      <nav className="v1-actions" aria-label="共用系統導覽">
        {actions.map(item => <Link key={item.href} href={item.href} className={pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href)) ? 'is-current' : ''}><img src={item.icon} alt="" /><span>{item.label}</span></Link>)}
      </nav>
      <div className="user-meta v1-meta">
        <span>{profileDetails.department || '未設定單位'}｜{profileDetails.name}</span>
        <i><em />系統連線中</i>
        <time>{clock}</time>
        <button onClick={toggleTheme}>{theme === 'light' ? '科技版' : '一般版'}</button>
        <button onClick={openProfile}>個人資料</button>
        <button onClick={logout}>登出</button>
      </div>
    </header>
    {isAdminArea ? <div className="admin-v2-frame">
      <AdminSidebar
        profile={profile}
        pathname={pathname}
        open={adminMenuOpen}
        onClose={() => setAdminMenuOpen(false)}
        onChangePassword={openProfile}
      />
      <div className="admin-v2-workspace">
        <button
          type="button"
          className="admin-sidebar-toggle"
          aria-expanded={adminMenuOpen}
          aria-controls="admin-v2-sidebar"
          onClick={() => setAdminMenuOpen(true)}
        >
          <img src="/Inspection/assets/system-icons/admin-icon.png" alt="" />
          後台選單
        </button>
        <main className="content v1-content admin-v2-content">{children}</main>
      </div>
    </div> : <main className="content v1-content">{children}</main>}
    {profileOpen && <div className="profile-modal-bg" role="dialog" aria-modal="true" aria-labelledby="personal-profile-title">
      <section className="profile-modal">
        <header><div><small>個人設定</small><h2 id="personal-profile-title">個人資料設定</h2><p>查詢與維護本人的聯絡資料、登入安全及個人行事曆。</p></div><button type="button" aria-label="關閉" onClick={() => setProfileOpen(false)}>×</button></header>
        <div className="profile-modal-body">
          <form className="profile-section" onSubmit={saveProfile}>
            <div className="profile-section-title"><span>01</span><div><b>基本資料</b><small>帳號、單位及權限由管理員維護</small></div></div>
            <div className="profile-form-grid">
              <label>登入帳號<input value={profileDetails.username || ''} readOnly /></label>
              <label>電子郵件<input value={profileDetails.email || ''} readOnly /></label>
              <label>姓名<input name="name" defaultValue={profileDetails.name} key={`name-${profileDetails.name}`} maxLength={100} required /></label>
              <label>聯絡電話<input name="phone" defaultValue={profileDetails.phone || ''} key={`phone-${profileDetails.phone || ''}`} maxLength={40} inputMode="tel" /></label>
              <label>所屬單位<input value={profileDetails.department || '未設定'} readOnly /></label>
              <label>帳號角色<input value={profileDetails.rbac_role || profileDetails.role || '未設定'} readOnly /></label>
            </div>
            {profileMessage && <p className="profile-message">{profileMessage}</p>}
            <div className="profile-actions"><button type="submit" className="primary-btn compact" disabled={profileBusy}>儲存個人資料</button></div>
          </form>

          <section className="profile-section google-calendar-section">
            <div className="profile-section-title"><span>02</span><div><b>Google 個人行事曆</b><small>只連結目前登入者自己的 Google 帳號</small></div></div>
            <div className={`google-connection-card${calendarStatus?.connected ? ' is-connected' : ''}`}>
              <div className="google-calendar-mark">G</div><div><b>{calendarStatus?.connected ? '已連結' : calendarStatus?.status === 'error' ? '需要重新連結' : '尚未連結'}</b><span>{calendarStatus?.connected ? calendarStatus.google_email : calendarStatus?.status === 'error' ? 'Google 授權已失效，請重新完成帳號授權' : '連結後可將本人會議室預約同步到個人行事曆'}</span>{calendarStatus?.last_sync_at && <small>最後同步：{Number.isNaN(new Date(calendarStatus.last_sync_at).getTime()) ? '—' : new Date(calendarStatus.last_sync_at).toLocaleString('zh-TW')}</small>}</div>
              {calendarStatus?.connected ? <button type="button" onClick={disconnectGoogle} disabled={profileBusy}>解除連結</button> : <button type="button" className="primary-btn compact" onClick={connectGoogle} disabled={profileBusy}>連結 Google 帳號</button>}
            </div>
            <p className="google-policy-links">連結即表示您已閱讀並同意 <a href="/Inspection/v2/privacy/" target="_blank" rel="noreferrer">隱私權政策</a> 與 <a href="/Inspection/v2/terms/" target="_blank" rel="noreferrer">服務條款</a>。</p>
            {calendarMessage && <p className="profile-message">{calendarMessage}</p>}
          </section>

          <form className="profile-section" onSubmit={changePassword}>
            <div className="profile-section-title"><span>03</span><div><b>登入安全</b><small>新密碼至少 8 個字元</small></div></div>
            <div className="profile-form-grid"><label>新密碼<input type="password" name="password" minLength={8} required autoComplete="new-password" /></label><label>確認新密碼<input type="password" name="confirm" minLength={8} required autoComplete="new-password" /></label></div>
            {passwordMessage && <p className="profile-message">{passwordMessage}</p>}
            <div className="profile-actions"><button className="primary-btn compact">更新密碼</button></div>
          </form>
        </div>
        <footer><button type="button" onClick={() => setProfileOpen(false)}>關閉</button></footer>
      </section>
    </div>}
  </div>;
}
