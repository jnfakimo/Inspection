// 機密檔名與機密內容樣式的單一來源：Claude Code hook（guard-bash／guard-secrets）與 git hook（.githooks）共用。
// 確屬假資料時，在該行加上 `allow-secret-pattern` 註記即可放行。

export const ALLOW_MARK = 'allow-secret-pattern';

// 路徑可用正斜線或反斜線；`.env.example` 這類範本檔放行。
export const SECRET_FILE = /(^|[\\/])(\.env(\.(?!example|sample|template)[^\\/]*)?|auth\.json|(?![^\\/]*public)[^\\/]*\.(sqlite3?|db|pem|key|p12|pfx)|cookies?\.(txt|json)|[^\\/]*service[-_]?role[^\\/]*)$/i;

const PATTERNS = [
  // 後面接 `|` 是程式碼裡用 regex 剝除標頭（例如 patrol-timeout-check），不是真的私鑰。
  ['私鑰區塊', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----(?!\s*\|)/],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{16,}/],
  ['OpenAI／Anthropic 類 API key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key（含 Gemini）', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{20,}/],
];

const decodeJwtRole = (token) => {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).role;
  } catch {
    return null;
  }
};

// 回傳這一行命中的機密種類（可能多個）；標註 allow-secret-pattern 的行直接放行。
export const findSecretLabels = (line) => {
  if (line.includes(ALLOW_MARK)) return [];
  const labels = [];
  for (const [label, re] of PATTERNS) if (re.test(line)) labels.push(label);
  for (const m of line.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
    // anon／publishable key 本來就公開；只擋 service_role。
    if (decodeJwtRole(m[0]) === 'service_role') labels.push('Supabase service_role JWT');
  }
  return labels;
};
