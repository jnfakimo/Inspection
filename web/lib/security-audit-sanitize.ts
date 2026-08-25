const REDACTED = '[已遮蔽]';
const SECRET_KEY = /password|passwd|token|secret|authorization|cookie|credential|captcha|api[_-]?key/i;
const SECRET_VALUE = /(?:Bearer\s+)?eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|(?:access_token|refresh_token|token|apikey|api_key|authorization)=([^&#\s]+)/gi;
// 偵測式不可使用 global flag；RegExp.test 搭配 /g 會保留 lastIndex，讓相同輸入忽真忽假。
const SECRET_VALUE_TEST = /(?:Bearer\s+)?eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|(?:access_token|refresh_token|token|apikey|api_key|authorization)=[^&#\s]+/i;
const SENSITIVE_PATH = /(?:^|[\\/])(?:\.\.|\.env(?:\.[^\\/]*)?|\.git|id_rsa(?:\.pub)?|service[_-]?role|private[_-]?key)(?:$|[\\/])/i;

export function auditSafeText(value: unknown, max = 240) {
  return String(value ?? '')
    .replace(SECRET_VALUE, REDACTED)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function auditSafeValue(value: unknown, depth = 0): unknown {
  if (depth > 3) return '[內容過深]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return auditSafeText(value, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map(item => auditSafeValue(item, depth + 1));
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [rawKey, item] of Object.entries(value).slice(0, 40)) {
      const key = auditSafeText(rawKey, 80);
      if (!key || SECRET_KEY.test(key)) continue;
      output[key] = auditSafeValue(item, depth + 1);
    }
    return output;
  }
  return auditSafeText(value, 500);
}

export function auditSafeHash(hash: string, max = 160) {
  if (!hash) return '';
  return SECRET_KEY.test(hash) || SECRET_VALUE_TEST.test(hash) ? '#[已遮蔽]' : auditSafeText(hash, max);
}

/** 只保留導覽目的地的 origin/path/hash，永遠不保留 query。 */
export function auditSafeDestination(href: string, baseHref: string, currentOrigin: string) {
  if (!href) return '';
  try {
    const url = new URL(href, baseHref);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const origin = url.origin === currentOrigin ? '' : url.origin;
    return `${origin}${url.pathname}${auditSafeHash(url.hash, 120)}`.slice(0, 400);
  } catch { return ''; }
}

export function auditIsSensitivePath(path: string) {
  return SENSITIVE_PATH.test(path);
}
