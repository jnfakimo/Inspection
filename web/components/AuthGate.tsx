'use client';

import { useEffect, useState } from 'react';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import type { Profile } from '@/types/app';

export function AuthGate({ children }: { children: (profile: Profile) => React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState('正在驗證登入狀態…');

  useEffect(() => {
    let active = true;
    async function verify() {
      const { data } = await getSupabase().auth.getSession();
      if (!data.session) {
        const returnTo = `${location.pathname}${location.search}${location.hash}`;
        const query = returnTo.startsWith('/Inspection/v2/') && !returnTo.startsWith('/Inspection/v2/login')
          ? `?next=${encodeURIComponent(returnTo)}` : '';
        location.replace(`/Inspection/v2/login/${query}`);
        return;
      }
      try {
        const current = await invokeAppApi<Profile>('profile');
        if (active) setProfile(current);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : '登入驗證失敗');
      }
    }
    verify();
    return () => { active = false; };
  }, []);

  if (!profile) return <main className="center-state"><div className="loader" /><p>{message}</p></main>;
  return <>{children(profile)}</>;
}
