'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { installSecurityAudit, recordPageView } from '@/lib/security-audit';

/** 在 RootLayout 掛載一次，涵蓋所有 V2 靜態輸出路由。 */
export function SecurityAuditMount() {
  const pathname = usePathname();

  useEffect(() => { installSecurityAudit(); }, []);
  useEffect(() => { recordPageView('進入系統頁面'); }, [pathname]);
  return null;
}
