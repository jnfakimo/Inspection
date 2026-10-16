// 非同步載入防呆。源自 Codex 2026-10-10 的同名測試；本次只帶入設備頁與共用函式，
// 戰情、會議室、公文、駐警打卡、維修分析、後台告警／通知／權限、AuthGate 的同類修正尚未整合（見 PROJECT_PLAN §22）。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { firstQueryError } from './async-load-safety.ts';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const equipment = source('../app/systems/[system]/[module]/equipment-workspace.tsx');

test('firstQueryError 回傳第一個失敗的查詢，全部成功時回傳 null', () => {
  const failure = { message: 'permission denied' };
  assert.equal(firstQueryError({ error: null }, { error: failure }, { error: { message: 'later' } }), failure);
  assert.equal(firstQueryError({ error: null }, null, undefined, {}), null);
});

test('equipment list loading settles, rejects stale results, and does not show empty on errors', () => {
  assert.match(equipment, /loadSequence\.current\.begin\(\)/);
  assert.match(equipment, /if \(!loadSequence\.current\.isCurrent\(sequence\)\) return false/);
  assert.match(equipment, /finally \{\s*if \(loadSequence\.current\.isCurrent\(sequence\)\) setBusy\(false\)/);
  assert.match(equipment, /!busy && !note && paged\.length === 0/);
  assert.match(equipment, /return \(\) => loadSequence\.current\.invalidate\(\)/);
  assert.match(equipment, /firstQueryError\(main, eq, cat\)/);
  assert.match(equipment, /if \(queryError\) \{[\s\S]*?setRows\(\[\]\); setEquipment\(\[\]\); setCategories\(\[\]\)/);
});

test('儲存或確認事件後清單重新載入失敗時，不顯示「已完成」而提示重新載入', () => {
  assert.match(equipment, /const refreshed = await load\(\);\s*setNote\(refreshed \? \(id \? '資料已更新' : '資料已新增'\) : '資料已儲存，但清單更新失敗，請重新載入'\)/);
  assert.match(equipment, /setNote\(refreshed \? '事件已確認' : '事件已確認，但清單更新失敗，請重新載入'\)/);
});
