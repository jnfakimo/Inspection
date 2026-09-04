'use client';

import { useEffect, useState } from 'react';
import { localAuth } from '@/lib/local-auth';
import { setErrorTrackerUser } from '@/lib/error-tracker';
import { setSecurityAuditProfile } from '@/lib/security-audit';
import { clearProfile, saveProfile } from '@/lib/profile-cache';
import type { Profile } from '@/types/app';

const AUTO_RETRY_LIMIT = 2;

const isTransientAuthError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /安全限流服務暫時無法使用|系統服務回應逾時|Failed to fetch|Failed to send|NetworkError|network\s+error|timed out|timeout/i.test(message);
};

export function AuthGate({ children }: { children: (profile: Profile) => React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState('正在驗證登入狀態…');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    let retryTimer: number | undefined;
    async function verify() {
      try {
        const current = await localAuth.me<Profile>();
        if (!active) return;
        saveProfile(current);
        // 身分確定後才送得出錯誤紀錄：client_error_logs 的 insert 政策要求
        // user_id 為 null 或本人，在此之前發生的事件會留在佇列裡等這一刻。
        setErrorTrackerUser(current?.user_id ? String(current.user_id) : null, current.auth_id || current.user_id);
        // 安全稽核必須等 session 與正式 profile 都驗證完成；此前事件只在記憶體排隊。
        setSecurityAuditProfile(current?.user_id ? current : null, current.auth_id || current.user_id);
        if (active) setProfile(current);
      } catch (error) {
        clearProfile();
        setErrorTrackerUser(null);
        setSecurityAuditProfile(null);
        if (error instanceof Error && /尚未登入|登入已失效/.test(error.message)) {
          const returnTo = `${location.pathname}${location.search}${location.hash}`;
          const query = returnTo.startsWith('/Inspection/v2/') && !returnTo.startsWith('/Inspection/v2/login')
            ? `?next=${encodeURIComponent(returnTo)}` : '';
          location.replace(`/Inspection/v2/login/${query}`);
        } else if (active && retry < AUTO_RETRY_LIMIT && isTransientAuthError(error)) {
          const nextRetry = retry + 1;
          setMessage(`連線服務暫時忙碌，正在重試（${nextRetry}/${AUTO_RETRY_LIMIT}）…`);
          retryTimer = window.setTimeout(() => {
            if (active) setRetry(nextRetry);
          }, 500 * nextRetry);
        } else if (active) {
          setMessage(error instanceof Error ? `${error.message}（請檢查網路後重試）` : '登入驗證失敗，請檢查網路後重試');
        }
      }
    }
    verify();
    return () => {
      active = false;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      setErrorTrackerUser(null);
      setSecurityAuditProfile(null);
    };
  }, [retry]);

  if (!profile) return <main className="center-state"><div className="loader" /><p>{message}</p><button className="secondary-btn" onClick={() => { setMessage('正在驗證登入狀態…'); setRetry(count => count + 1); }}>重試</button></main>;
  return <>{children(profile)}</>;
}
