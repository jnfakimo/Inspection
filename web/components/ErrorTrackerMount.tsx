'use client';

import { useEffect } from 'react';
import { installErrorTracker } from '@/lib/error-tracker';

/**
 * 在版面最外層掛載，讓錯誤監聽器在登入驗證完成之前就開始運作。
 * 事件會先進佇列，等 AuthGate 取得身分後才實際送出。
 */
export function ErrorTrackerMount() {
  useEffect(() => { installErrorTracker(); }, []);
  return null;
}
