// PostToolUse(Write|Edit|MultiEdit)：改完 web／supabase／system／backend 的程式或 SQL，當場做資安檢查。
// 1. 重用 tools/security-design-audit.mjs（單一來源）：有任何 [錯誤] 就擋；只回報「剛改的檔案」的 [警告]。
// 2. 補該腳本沒涵蓋的檢查（只看剛改的檔案，約幾毫秒）：
//    錯誤：web 端出現 service_role；NEXT_PUBLIC_ 變數名含 SECRET／SERVICE／PRIVATE／PASSWORD／TOKEN；
//          migration 的 create table 沒有同檔 enable row level security；security definer 函式沒有 set search_path
//    警告：.innerHTML／outerHTML 賦值、insertAdjacentHTML（清空用的 `= ''` 不報）
// 現有 187 個 migration 與 web 程式碼都已以這些規則掃過，基準為 0 筆誤報（見 PR）。
// 錯誤 exit 2（把訊息交回 Claude 當場修）；警告以 additionalContext 提醒；任何例外一律放行，不卡工作流程。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { allow, block, projectDir, readInput, toRelative } from './lib.mjs';

const input = readInput();
const root = projectDir();
const rel = toRelative(root, input.tool_input?.file_path);
if (!rel || !/^(web|supabase|system|backend)\/.+\.(tsx?|jsx?|mjs|cjs|js|sql)$/.test(rel)) allow();

const abs = path.join(root, rel);
let text = '';
try {
  text = fs.readFileSync(abs, 'utf8');
} catch {
  allow();
}

const errors = [];
const warnings = [];

// ---- 補充檢查 ----
const isTest = /\.test\.[a-z]+$/.test(rel) || /(^|\/)(test|tests|__tests__)\//.test(rel);
if (rel.startsWith('web/') && !isTest && /service[_-]?role/i.test(text)) {
  errors.push('web 前端程式碼出現 service_role：服務金鑰只能在 Edge Function／後端使用，不得進瀏覽器。');
}
if (!isTest && /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE|PRIVATE|PASSWORD|TOKEN)/.test(text)) {
  errors.push('NEXT_PUBLIC_ 開頭的變數會被打包進瀏覽器，名稱含 SECRET／SERVICE／PRIVATE／PASSWORD／TOKEN 的值不得這樣暴露。');
}
if (/\.(?:innerHTML|outerHTML)\s*=(?!=)(?!\s*(['"`])\1)/.test(text) || /insertAdjacentHTML\s*\(/.test(text)) {
  warnings.push('使用 innerHTML／outerHTML／insertAdjacentHTML：確認內容已固定或逐欄跳脫（優先改用 React 渲染或 textContent）。');
}

if (rel.endsWith('.sql')) {
  const sql = text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?((?:public\.)?"?\w+"?)/gi)) {
    const name = m[1].replace(/^public\./i, '').replaceAll('"', '');
    const rls = new RegExp(`alter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?(?:public\\.)?"?${name}"?\\s+(?:enable|force)\\s+row\\s+level\\s+security`, 'i');
    if (!rls.test(sql)) errors.push(`資料表 ${name} 建立後沒有在同一個 migration 啟用 RLS（alter table ${name} enable row level security）。`);
  }
  if (rel.startsWith('supabase/migrations/')) {
    // view 以擁有者權限執行（繞過 RLS），Supabase 又預設把新物件的全部權限授給 authenticated，
    // 等於任何登入帳號都能讀（可更新的 view 還能寫）。2026-10-29 已因此收斂 11 個管理報表 view。
    const statements = sql.split(';');
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?((?:public\.)?"?\w+"?)([\s\S]*?);/gi)) {
      const name = m[1].replace(/^public\./i, '').replaceAll('"', '');
      const invoker = /security_invoker\s*=\s*(?:true|on)/i.test(m[0]);
      const nameRe = new RegExp(`\\b${name}\\b`, 'i');
      const revoked = statements.some((s) => /^\s*revoke\b/i.test(s) && nameRe.test(s) && /\bauthenticated\b/i.test(s));
      if (!invoker && !revoked) {
        errors.push(`view ${name} 以擁有者權限執行會繞過 RLS，Supabase 預設又授給 authenticated 全部權限：請加 with (security_invoker = true)，或明確 revoke all on ${name} from anon, authenticated。`);
      }
    }
    // policy 寫成 using (true)／with check (true) 等於不設防：Supabase Auth 若開放自行註冊，任何人註冊後都能讀寫。
    // 2026-10-29 已因 patrol_checkins 的 allow_all_for_now 收斂。寫入類一律擋，唯讀類只提醒；to service_role 的不算。
    for (const m of sql.matchAll(/create\s+policy\s+("[^"]+"|\w+)\s+on\s+([\s\S]*?);/gi)) {
      if (!/\b(?:using|with\s+check)\s*\(\s*true\s*\)/i.test(m[2]) || /\bto\s+service_role\b/i.test(m[2])) continue;
      const cmd = (m[2].match(/\bfor\s+(select|insert|update|delete|all)\b/i)?.[1] ?? 'all').toLowerCase();
      const name = m[1].replaceAll('"', '');
      if (cmd === 'select') warnings.push(`policy ${name} 對所有人開放讀取（using (true)）：確認這張表本來就是公開資料，否則改成依角色限制。`);
      else errors.push(`policy ${name}（${cmd}）寫成 using (true)／with check (true)，所有登入者都能寫入：請改成依角色或擁有者限制。`);
    }
  }
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function[\s\S]*?(?=\bas\s+(?:\$[A-Za-z_]*\$|'))/gi)) {
    if (/security\s+definer/i.test(m[0]) && !/set\s+search_path/i.test(m[0])) {
      errors.push(`security definer 函式缺少 set search_path：${m[0].replace(/\s+/g, ' ').trim().slice(0, 70)}…`);
    }
  }
}

// ---- 重用 security-design-audit（整個 repo，約 5 秒）----
const auditScript = path.join(root, 'tools', 'security-design-audit.mjs');
if (fs.existsSync(auditScript)) {
  const run = spawnSync(process.execPath, [auditScript], { cwd: root, encoding: 'utf8', timeout: 60_000 });
  for (const line of String(run.stdout ?? '').split('\n')) {
    const m = line.match(/^\[(錯誤|警告)\] (\S+?)（(.+?)）(.*)$/);
    if (!m) continue;
    const [, level, file, rule, message] = m;
    if (level === '錯誤') errors.push(`${file}（${rule}）${message}`);
    else if (file === rel) warnings.push(`（${rule}）${message}`);
  }
}

if (errors.length) {
  block(`[security-check] ${rel} 有資安問題，請先修正：\n- ${[...new Set(errors)].join('\n- ')}${warnings.length ? `\n另有提醒：\n- ${[...new Set(warnings)].join('\n- ')}` : ''}`);
}
if (warnings.length) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: `[security-check] ${rel} 有資安提醒（不阻擋，請確認或在回報中說明）：\n- ${[...new Set(warnings)].join('\n- ')}`,
      },
    }),
  );
}
allow();
