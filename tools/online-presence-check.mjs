import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = file => fs.readFileSync(file, 'utf8');
const migration = read('supabase/migrations/20261028120000_online_presence.sql');
const appShell = read('web/components/AppShell.tsx');
const hook = read('web/lib/use-online-count.ts');
const css = read('web/app/topbar.css');

// 資料庫：最小揭露。表不開放直接讀寫（RLS 啟用、不設政策、撤銷權限），只能經 security definer 函式，且不實體刪除。
assert.match(migration, /alter table public\.user_presence enable row level security;/, 'user_presence 必須啟用 RLS');
assert.match(migration, /revoke all on public\.user_presence from public, anon, authenticated;/, 'user_presence 不得開放直接存取');
assert.doesNotMatch(migration, /create policy[^;]*user_presence/i, 'user_presence 不得建立任何政策（預設拒絕）');
// 與 apply-database-migration.yml 的防刪除檢查同一組規則（先移除註解再掃描）；
// 例如 `truncate` 後面換行再接 `on` 會被誤判，所以 trigger 必須寫在同一行。
const sqlWithoutComments = migration.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\r\n]*/g, '');
assert.doesNotMatch(sqlWithoutComments, /\bdrop\s+table\b/i, 'migration 不得 drop table');
assert.doesNotMatch(sqlWithoutComments, /\bdelete\s+from\b/i, 'migration 不得 delete from');
assert.doesNotMatch(sqlWithoutComments, /\btruncate\s+(?!on\b)/i, 'migration 不得 truncate（trigger 的 truncate on 必須寫在同一行）');
assert.match(migration, /trg_prevent_removal[\s\S]*user_presence/, 'user_presence 必須掛上禁止實體刪除的 trigger');
assert.match(migration, /function public\.presence_heartbeat\(\)[\s\S]*security definer/, '心跳必須是 security definer');
assert.match(migration, /interval '3 minutes'/, '在線視窗為最近 3 分鐘');
assert.match(migration, /u\.status = 'active'/, '停用帳號不得計入在線');
assert.match(migration, /revoke all on function public\.presence_heartbeat\(\) from public, anon;[\s\S]*grant execute on function public\.presence_heartbeat\(\) to authenticated;/, '只有登入使用者可回報心跳');
assert.match(migration, /^begin;/m);
assert.match(migration, /^commit;/m);

// 前端：只透過 RPC 取得「人數」，不直接查 presence 表；背景分頁不回報；失敗不影響畫面。
assert.match(hook, /rpc\('presence_heartbeat'\)/, '必須呼叫 presence_heartbeat');
assert.match(hook, /visibilityState !== 'visible'/, '頁籤在背景時不得回報心跳');
assert.match(hook, /typeof data !== 'number'/, '只接受數字人數');
function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', '.next', 'out'].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}
for (const file of [...listFiles('web'), ...listFiles('supabase/functions')].filter(f => /\.(ts|tsx)$/.test(f))) {
  assert.doesNotMatch(read(file), /from\(['"]user_presence['"]\)/, `${file} 不得直接讀寫 user_presence，必須走 RPC 以免洩漏誰在線`);
}

// 工作列：徽章只顯示人數；登出時告知離線。
assert.match(appShell, /useOnlineCount\(\)/, 'AppShell 必須使用 useOnlineCount');
assert.match(appShell, /onlineCount !== null && <strong className="v1-online"/, '工作列必須顯示在線人數徽章');
assert.match(appShell, /\{onlineCount\} 人在線/, '徽章文字為「N 人在線」');
assert.match(appShell, /rpc\('presence_leave'\)/, '登出時必須告知離線');
assert.match(appShell, /系統連線中<\/i>[\s\S]*v1-online[\s\S]*<time>\{clock\}<\/time>/, '工作列順序：連線狀態、在線人數、時鐘');
assert.match(css, /\.v1-online\{[^}]*var\(--live-solid\)[^}]*var\(--on-solid\)/, '徽章只用語意 token');

console.log('在線人數檢查通過');
