'use client';

import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { installSessionResponder, requestSessionCredentials } from './patrol-session-transfer.ts';

export const PATROL_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const PATROL_SESSION_STORAGE_KEY = 'beinongPatrolTrustedSessionV2';
export const PATROL_IDLE_LOGOUT_MESSAGE_KEY = 'beinongPatrolIdleLogoutMessage';

type PatrolSessionRecord = {
  version: 2;
  user_id: string;
  last_activity_at: number;
  valid_until: number;
};

export type PatrolSessionState =
  | { status: 'missing' | 'invalid'; value: null }
  | { status: 'expired' | 'valid'; value: PatrolSessionRecord };

const browserStorage = () => {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage; } catch { return null; }
};

function parseRecord(raw: string | null): PatrolSessionRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PatrolSessionRecord>;
    if (value.version !== 2 || !value.user_id
      || !Number.isFinite(Number(value.last_activity_at)) || !Number.isFinite(Number(value.valid_until))) return null;
    return {
      version: 2,
      user_id: String(value.user_id),
      last_activity_at: Number(value.last_activity_at),
      valid_until: Number(value.valid_until),
    };
  } catch { return null; }
}

export function isPatrolQrDestination(value: string) {
  try {
    const url = new URL(value, 'https://inspection.invalid');
    const isCheckinPage = /\/Inspection\/v2\/systems\/guardpatrol\/checkins\/?$/i.test(url.pathname);
    return isCheckinPage && Boolean(url.searchParams.get('marker'));
  } catch { return false; }
}

export function patrolSessionState(now = Date.now(), storage: Storage | null = browserStorage()): PatrolSessionState {
  if (!storage) return { status: 'missing', value: null };
  let raw: string | null;
  try { raw = storage.getItem(PATROL_SESSION_STORAGE_KEY); } catch { return { status: 'missing', value: null }; }
  if (!raw) return { status: 'missing', value: null };
  const value = parseRecord(raw);
  if (!value) {
    try { storage.removeItem(PATROL_SESSION_STORAGE_KEY); } catch { /* ignore */ }
    return { status: 'invalid', value: null };
  }
  // Rewrite legacy records to a whitelist without persistent bearer credentials.
  if (raw.includes('access_token') || raw.includes('refresh_token')) {
    try { storage.setItem(PATROL_SESSION_STORAGE_KEY, JSON.stringify(value)); } catch {
      try { storage.removeItem(PATROL_SESSION_STORAGE_KEY); } catch { /* unavailable */ }
      return { status: 'invalid', value: null };
    }
  }
  if (value.valid_until <= now) return { status: 'expired', value };
  return { status: 'valid', value };
}

export function startPatrolSession(session: Session, now = Date.now(), storage: Storage | null = browserStorage()) {
  if (!storage || !session.access_token || !session.refresh_token || !session.user?.id) return false;
  const record: PatrolSessionRecord = {
    version: 2,
    user_id: session.user.id,
    last_activity_at: now,
    valid_until: now + PATROL_IDLE_TIMEOUT_MS,
  };
  try {
    storage.setItem(PATROL_SESSION_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch { return false; }
}

export function touchPatrolSession(session?: Session | null, now = Date.now(), storage: Storage | null = browserStorage()) {
  const current = patrolSessionState(now, storage);
  if (!storage || current.status !== 'valid') return false;
  if (session?.user?.id && session.user.id !== current.value.user_id) return false;
  const next: PatrolSessionRecord = {
    ...current.value,
    last_activity_at: now,
    valid_until: now + PATROL_IDLE_TIMEOUT_MS,
  };
  try {
    storage.setItem(PATROL_SESSION_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch { return false; }
}

export function markPatrolSessionExpired(storage: Storage | null = browserStorage()) {
  if (!storage) return;
  let current: PatrolSessionRecord | null;
  try { current = parseRecord(storage.getItem(PATROL_SESSION_STORAGE_KEY)); } catch { return; }
  if (!current) return;
  try {
    storage.setItem(PATROL_SESSION_STORAGE_KEY, JSON.stringify({
      ...current,
      // 過期墓碑保留使用者與期限，用來阻止仍開著的舊分頁繞過逾時；權杖立即清除。
      last_activity_at: Math.min(current.last_activity_at, Date.now() - PATROL_IDLE_TIMEOUT_MS),
      valid_until: 0,
    }));
  } catch { /* ignore */ }
}

export function clearPatrolSession(storage: Storage | null = browserStorage()) {
  try { storage?.removeItem(PATROL_SESSION_STORAGE_KEY); } catch { /* ignore */ }
}

export async function restorePatrolSession(client: SupabaseClient, now = Date.now(), storage: Storage | null = browserStorage()) {
  let attempted = false, accepted = false;
  const startedAt = Date.now();
  const moment = () => now + Math.max(0, Date.now() - startedAt);
  const current = patrolSessionState(now, storage);
  if (current.status !== 'valid') return null;
  try {
    const existing = await client.auth.getSession();
    if (existing.error || (existing.data.session && existing.data.session.user.id !== current.value.user_id)) return null;
    const credentials = existing.data.session || await requestSessionCredentials(current.value.user_id);
    const latest = patrolSessionState(moment(), storage);
    if (!credentials || latest.status !== 'valid' || latest.value.user_id !== current.value.user_id) return null;
    attempted = true;
    const result = await client.auth.setSession({access_token:credentials.access_token,refresh_token:credentials.refresh_token});
    const session = result.data.session;
    if (result.error || !session || session.user.id !== current.value.user_id) {
      markPatrolSessionExpired(storage);
      return null;
    }
    const after = patrolSessionState(moment(), storage);
    if (after.status !== 'valid' || after.value.user_id !== session.user.id) return null;
    touchPatrolSession(session, moment(), storage);
    accepted = true;
    return session;
  } catch {
    markPatrolSessionExpired(storage);
    return null;
  } finally {
    if (attempted && !accepted) {
      try { await client.auth.signOut({ scope: 'local' }); } catch { /* Auth cleanup is best effort. */ }
    }
  }
}

export async function ensurePatrolQrSession(client: SupabaseClient, session: Session | null, now = Date.now(), storage: Storage | null = browserStorage()) {
  const current = patrolSessionState(now, storage);
  if (session) {
    if (current.status === 'missing') {
      startPatrolSession(session, now, storage);
      return session;
    }
    if (current.status !== 'valid' || current.value.user_id !== session.user.id) return null;
    touchPatrolSession(session, now, storage);
    return session;
  }
  return current.status === 'valid' ? restorePatrolSession(client, now, storage) : null;
}

export function installPatrolIdleTimer(client: SupabaseClient, onExpired: () => void) {
  let timer: number | undefined;
  let lastTouch = 0;
  let stopped = false;

  const expire = async () => {
    if (stopped) return;
    const current = patrolSessionState();
    if (current.status === 'valid') { schedule(); return; }
    markPatrolSessionExpired();
    try { window.sessionStorage.setItem(PATROL_IDLE_LOGOUT_MESSAGE_KEY, '巡邏打卡已閒置 10 分鐘，請重新登入'); } catch { /* ignore */ }
    try { await client.auth.signOut({ scope: 'local' }); } catch { /* session may already be unavailable */ }
    if (!stopped) onExpired();
  };

  const schedule = () => {
    if (timer !== undefined) window.clearTimeout(timer);
    const current = patrolSessionState();
    if (current.status !== 'valid') { void expire(); return; }
    timer = window.setTimeout(() => void expire(), Math.max(0, current.value.valid_until - Date.now()) + 20);
  };

  const activity = () => {
    const now = Date.now();
    if (now - lastTouch < 1000) return;
    lastTouch = now;
    if (touchPatrolSession(null, now)) schedule();
  };

  const storageChanged = (event: StorageEvent) => {
    if (event.key === PATROL_SESSION_STORAGE_KEY) schedule();
  };
  const visibilityChanged = () => {
    if (document.visibilityState === 'visible') schedule();
  };

  window.addEventListener('pointerdown', activity, { passive: true });
  window.addEventListener('touchstart', activity, { passive: true });
  window.addEventListener('keydown', activity);
  window.addEventListener('storage', storageChanged);
  document.addEventListener('visibilitychange', visibilityChanged);
  schedule();

  return () => {
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
    window.removeEventListener('pointerdown', activity);
    window.removeEventListener('touchstart', activity);
    window.removeEventListener('keydown', activity);
    window.removeEventListener('storage', storageChanged);
    document.removeEventListener('visibilitychange', visibilityChanged);
  };
}

export function installPatrolSessionResponder(client: SupabaseClient) {
  return installSessionResponder(client, () => {
    const state = patrolSessionState();
    return state.status === 'valid' ? state.value : null;
  });
}
