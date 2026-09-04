'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { resolveAppBackHref } from '@/lib/app-navigation';
import { clearProfile } from '@/lib/profile-cache';
import { getSupabase } from '@/lib/supabase';

/** 共用於 3D／平面全螢幕圖資頁的帳號與圖面導覽。 */
export function StructuremapTopbarActions({ planeHref, label = '切換平面圖' }: { planeHref: string; label?: string }) {
  const pathname = usePathname();
  const backHref = resolveAppBackHref(pathname);

  async function logout() {
    try { await getSupabase().auth.signOut({ scope: 'local' }); }
    catch (error) { console.warn('logout failed:', error); }
    clearProfile();
    window.location.replace('/Inspection/v2/login/');
  }

  return <div className="f3-topbar-actions" aria-label="主要導覽">
    <a className="tb-back tb-tool-switch" href={planeHref}>{label}</a>
    <Link className="tb-back tb-action" href={backHref}>
      <span className="generated-nav-icon nav-back" aria-hidden="true" /><span>上頁</span>
    </Link>
    <a className="tb-back tb-action" href="/Inspection/v2/systems/">
      <span className="generated-nav-icon nav-home" aria-hidden="true" /><span>首頁</span>
    </a>
    <a className="tb-back tb-action" href="/Inspection/v2/systems/?profile=1">
      <span className="generated-nav-icon nav-profile" aria-hidden="true" /><span>個人資料</span>
    </a>
    <button type="button" className="tb-back tb-action" onClick={() => void logout()}>
      <span className="generated-nav-icon nav-logout" aria-hidden="true" /><span>登出</span>
    </button>
  </div>;
}
