// 權限判斷必須「失敗即拒絕」（ISO 27001 預設拒絕原則）。
//
// 2026-09-13 前，子系統權限表查詢失敗時 app-api 會沿用大系統權限把所有子系統放行，
// canModule 甚至回傳錯誤物件（真值）而非 boolean——那是四層授權導入時的過渡行為，
// 資料庫偶發錯誤就會讓使用者看到不該看到的子系統。這支檢查擋住這類降級邏輯再被加回來。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const api = read('supabase/functions/app-api/index.ts');
const context = read('supabase/functions/app-api/context.ts');

assert.doesNotMatch(api, /moduleAccessResult\.error\s*\|\|/,
  'canModule 不得在權限查詢失敗時回傳錯誤物件放行');
assert.doesNotMatch(api, /if \(systemKey !== 'handover'\) allowedModules\.add\(/,
  '子系統權限查詢失敗時不得把非交接簿子系統全部放行');
assert.match(api, /if \(roleModuleResult\.error\) return false;/,
  '角色子系統範本查詢失敗時必須拒絕');
assert.match(context, /canModule: \(systemKey: string, moduleKey: string\) => boolean;/,
  'AppApiContext.canModule 必須只回傳 boolean');

console.log('權限失敗即拒絕檢查通過：子系統權限與角色範本查詢失敗時一律不放行。');
