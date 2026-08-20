'use client';

import { useEffect, useState } from 'react';
import { getSupabase, invokeAppApi } from '@/lib/supabase';
import { setErrorTrackerUser } from '@/lib/error-tracker';
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
        // 身分確定後才送得出錯誤紀錄：client_error_logs 的 insert 政策要求
        // user_id 為 null 或本人，在此之前發生的事件會留在佇列裡等這一刻。
        setErrorTrackerUser(current?.user_id ? String(current.user_id) : null);
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
