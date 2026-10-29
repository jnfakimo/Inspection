// PreToolUse(Write|Edit|MultiEdit)：寫入內容含機密樣式、或目標是機密檔時擋下。
// 規則：cookie、token、API key、service-role key、auth.json、SQLite 不得出現在 repo。
// 確屬假資料（測試樣本、說明文件）時，在該行加上 `allow-secret-pattern` 註記即可放行。
import { allow, block, projectDir, readInput, toRelative } from './lib.mjs';

const input = readInput();
const tool = input.tool_name;
if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) allow();

const ti = input.tool_input ?? {};
const root = projectDir();
const rel = toRelative(root, ti.file_path) ?? String(ti.file_path ?? '');

const SECRET_FILE = /(^|\/)(\.env(\.(?!example|sample|template)[^/]*)?|auth\.json|[^/]*\.(sqlite3?|db|pem|key|p12|pfx)|cookies?\.(txt|json))$/i;
if (SECRET_FILE.test(rel)) {
  block(`[guard-secrets] 不寫入疑似機密檔：${rel}。機密請放環境變數或密碼管理員，範本用 .env.example。`);
}

const chunks = [];
if (tool === 'Write') chunks.push(String(ti.content ?? ''));
if (tool === 'Edit') chunks.push(String(ti.new_string ?? ''));
if (tool === 'MultiEdit') for (const e of ti.edits ?? []) chunks.push(String(e?.new_string ?? ''));

const PATTERNS = [
  ['私鑰區塊', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{16,}/],
  ['OpenAI／Anthropic 類 API key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key（含 Gemini）', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{20,}/],
];

const decodeJwtRole = (token) => {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.role;
  } catch {
    return null;
  }
};

const hits = [];
for (const chunk of chunks) {
  for (const line of chunk.split(/\r?\n/)) {
    if (line.includes('allow-secret-pattern')) continue;
    for (const [label, re] of PATTERNS) if (re.test(line)) hits.push(label);
    for (const m of line.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
      // anon／publishable key 本來就公開；只擋 service_role。
      if (decodeJwtRole(m[0]) === 'service_role') hits.push('Supabase service_role JWT');
    }
  }
}

if (hits.length) {
  block(`[guard-secrets] 寫入內容疑似含機密（${[...new Set(hits)].join('、')}），已攔截 ${rel}。\n改用環境變數／GitHub Secrets；若確定是假資料，在該行加上 allow-secret-pattern 註記。`);
}
allow();
