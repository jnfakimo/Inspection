'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from './supabase';

/** 回報心跳的間隔；資料庫以「最近 3 分鐘內有回報」計算在線，所以允許漏掉一兩次。 */
export const PRESENCE_HEARTBEAT_MS = 60_000;

/**
 * 上方工作列的「在線人數」。
 *
 * 登入後每分鐘呼叫一次 presence_heartbeat（回報自己仍在線並取回目前人數）；
 * 頁籤被切到背景時不回報，切回來或網路恢復時立刻補一次。
 * 只拿到人數，不會知道是誰在線；函式不存在或呼叫失敗時回傳 null，工作列就不顯示徽章，不影響其他功能。
 */
export function useOnlineCount(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const beat = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const { data, error } = await getSupabase().rpc('presence_heartbeat');
        if (!active) return;
        if (error || typeof data !== 'number' || !Number.isFinite(data)) return;
        setCount(Math.max(0, Math.floor(data)));
      } catch {
        // 取不到就維持上一次的數字，不顯示錯誤干擾操作。
      }
    };
    void beat();
    const timer = window.setInterval(() => void beat(), PRESENCE_HEARTBEAT_MS);
    const resume = () => void beat();
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
    };
  }, []);

  return count;
}
