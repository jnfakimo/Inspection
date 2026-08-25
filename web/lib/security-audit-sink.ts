'use client';

/**
 * API wrapper 與全站稽核器之間的單向事件橋接。獨立成零相依檔案，避免
 * supabase.ts 與 security-audit.ts 互相 import；事件只帶繁中功能名稱，
 * 不傳 API action code、查詢條件或表單內容。
 */
export function emitSecurityDataRead(feature: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('inspection:security-data-read', {
    detail: { feature: String(feature || '讀取系統資料').slice(0, 120) },
  }));
}
