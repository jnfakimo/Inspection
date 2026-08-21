'use client';

import { useEffect } from 'react';
import { installErrorTracker } from '@/lib/error-tracker';
import { installAccessAudit } from '@/lib/access-audit';

/**
 * 在版面最外層掛載，讓錯誤監聽器在登入驗證完成之前就開始運作。
 * 事件會先進佇列，等 AuthGate 取得身分後才實際送出。
 */
export function ErrorTrackerMount() {
  useEffect(() => {
    installErrorTracker();
    // 讀取存取稽核也在這裡掛：它包住 window.fetch，必須早於任何查詢，
    // 否則進場那一批載入不會被記錄。
    installAccessAudit();
  }, []);
  return null;
}
