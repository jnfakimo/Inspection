'use client';

import { useEffect, useState } from 'react';

/**
 * 手機版開放範圍。
 *
 * 只有公務車派車與公文傳送兩個系統在手機上開放：這兩個是現場人員真的會用手機操作的
 * 流程（申請、收文、簽核），其餘系統以表格、圖臺與後台維護為主，在手機上不堪用。
 *
 * 判斷條件與 V2 手機版版型規範的 800px 斷點一致（見 AGENTS.md），並沿用
 * vehicle-workspace 既有的 `(pointer: coarse)` 判定，讓觸控裝置也算手機版。
 */
export const MOBILE_SYSTEM_KEYS: readonly string[] = ['vehicle', 'officialdocs'];
export const MOBILE_MEDIA_QUERY = '(max-width: 800px), (pointer: coarse)';

export function isMobileAllowedSystem(systemKey: unknown) {
  return MOBILE_SYSTEM_KEYS.includes(String(systemKey || ''));
}

/**
 * 是否為手機版。初始值直接讀 matchMedia，避免先畫出桌機版再閃一下；
 * 使用這個 hook 的頁面都在 AuthGate 之後才渲染（AuthGate 要等 profile 回來），
 * 所以不會發生 SSR／hydration 不一致。
 */
export function useIsMobile() {
  const [mobile, setMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(MOBILE_MEDIA_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_MEDIA_QUERY);
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  return mobile;
}
