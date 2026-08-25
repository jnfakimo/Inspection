import type { Profile } from '@/types/app';

/** V1 theme.js 與 V2 共用的 sessionStorage 人員資料契約。 */
export const PROFILE_STORAGE_KEY = 'inspectionSystemUserProfile';

const PROFILE_FIELDS = [
  'user_id', 'username', 'email', 'name', 'role', 'rbac_role', 'dept_id',
  'department', 'phone', 'status', 'auth_id', 'allowed_systems', 'permissions',
] as const;

type CacheProfile = Partial<Profile> & {
  dept_id?: string | null;
  status?: string | null;
  auth_id?: string | null;
};

const FIELD_TO_LEGACY_KEY: Record<string, string> = {
  user_id: 'user_id', username: 'user_username', email: 'user_email', name: 'user_name',
  role: 'user_role', rbac_role: 'user_rbac_role', dept_id: 'user_dept_id',
  department: 'user_department', phone: 'user_phone',
};

export function readProfile(): CacheProfile | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PROFILE_STORAGE_KEY);
    return raw ? JSON.parse(raw) as CacheProfile : null;
  } catch { return null; }
}

export function saveProfile(profile: CacheProfile | null | undefined) {
  if (typeof window === 'undefined' || !profile?.name) return;
  const clean: Record<string, unknown> = {};
  for (const field of PROFILE_FIELDS) {
    const value = profile[field];
    if (value !== undefined && value !== null && value !== '') clean[field] = value;
  }
  window.sessionStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(clean));
  for (const [field, key] of Object.entries(FIELD_TO_LEGACY_KEY)) {
    const value = clean[field];
    if (value !== undefined && value !== null && value !== '') window.sessionStorage.setItem(key, String(value));
    else window.sessionStorage.removeItem(key);
  }
  window.dispatchEvent(new CustomEvent('system-user-profile-updated'));
}

export function clearProfile() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(PROFILE_STORAGE_KEY);
  window.localStorage.removeItem(PROFILE_STORAGE_KEY);
  for (const key of Object.values(FIELD_TO_LEGACY_KEY)) window.sessionStorage.removeItem(key);
  window.dispatchEvent(new CustomEvent('system-user-profile-updated'));
}
