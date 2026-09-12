import { findModule, findSystem, hasModuleAccess, hasSystemAccess } from './modules.ts';

type AccessProfile = {
  role?: string | null;
  rbac_role?: string | null;
  allowed_systems?: string[];
  allowed_modules?: string[];
  allowed_handover_modules?: string[];
};

export const DEFAULT_POST_LOGIN_PATH = '/Inspection/v2/systems/';

export function canOpenAdminModule(profile: AccessProfile, moduleKey: string) {
  if (moduleKey === 'notices') return true;
  return profile.rbac_role === 'sysadmin' || profile.role === 'admin';
}

function normalizeRequestedPath(requested: string | null | undefined) {
  const value = String(requested || '').trim();
  if (!value || value.includes('\\') || value.includes('\u0000')) return '';
  if (value.startsWith('/systems/')) return `/Inspection/v2${value}`;
  if (value.startsWith('/Inspection/v2/') || value.startsWith('/word-cloud/v2/')) return value;
  return '';
}

export function requestedPostLoginPath(search: string) {
  const params = new URLSearchParams(search);
  return normalizeRequestedPath(params.get('next') || params.get('redirect'));
}

export function resolvePostLoginDestination(requested: string | null | undefined, profile: AccessProfile) {
  const destination = normalizeRequestedPath(requested);
  if (!destination) return DEFAULT_POST_LOGIN_PATH;

  const parsed = new URL(destination, 'https://local.invalid');
  const appPath = parsed.pathname.replace(/^\/(?:Inspection|word-cloud)\/v2/, '') || '/';
  if (appPath === '/login' || appPath.startsWith('/login/')) return DEFAULT_POST_LOGIN_PATH;
  if (appPath === '/systems' || appPath === '/systems/' || appPath === '/') return destination;

  const route = appPath.match(/^\/systems\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!route) return DEFAULT_POST_LOGIN_PATH;
  const [, systemKey, moduleKey = ''] = route;

  if (systemKey === 'admin') {
    return canOpenAdminModule(profile, moduleKey) ? destination : DEFAULT_POST_LOGIN_PATH;
  }
  const allowedSystem = hasSystemAccess(profile, systemKey)
    || (systemKey === 'structuremap' && moduleKey === 'floor2d' && (hasSystemAccess(profile, 'guardpatrol') || hasSystemAccess(profile, 'workorder')));
  if (!findSystem(systemKey) || !allowedSystem) return DEFAULT_POST_LOGIN_PATH;
  if (moduleKey && (!findModule(systemKey, moduleKey) || !hasModuleAccess(profile, systemKey, moduleKey))) {
    return DEFAULT_POST_LOGIN_PATH;
  }
  return destination;
}
