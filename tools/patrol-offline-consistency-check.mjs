import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const offlineSource = read('system/patrol-offline.js');
const checkinPage = read('system/patrolcheckin.html');
const checkinApp = read('system/patrolcheckin-app.js');
const serviceWorker = read('system/patrol-service-worker.js');
const edgeCheckin = read('supabase/functions/patrol-checkin/index.ts');
const checkinSchema = read('supabase/migrations/20260820100000_audit_scan_fixes.sql');

assert.match(checkinApp, /if\(!navigator\.onLine\)/, '離線時必須停止 QR 簽到');
assert.doesNotMatch(checkinApp, /from\(['"]checkin_logs['"]\)\.insert/, '瀏覽器不可直接寫入 checkin_logs');
assert.match(checkinPage, /patrol-offline\.js\?v=/, '巡檢頁必須載入離線遺留佇列隔離器');
assert.match(checkinPage, /PatrolOffline\?\.sync/, '巡檢頁必須在開啟時隔離遺留佇列');
assert.match(checkinPage, /getRegistrations\(\)/, '巡檢頁必須解除舊 Service Worker');
assert.match(checkinPage, /caches\.keys\(\)/, '巡檢頁必須清理舊離線快取');
assert.doesNotMatch(serviceWorker, /checkin_logs|addEventListener\(['"]sync['"]/, 'Service Worker 不可代送巡檢寫入');
assert.match(edgeCheckin, /\.eq\("checkin_id", checkinId\)/, 'Edge Function 必須以 checkin_id 去重');
assert.match(edgeCheckin, /duplicate_recent/, 'Edge Function 必須防止五分鐘內重複簽到');
assert.match(checkinSchema, /uq_checkin_dedup/, '資料庫必須保留併發重送的唯一性兜底');

const storage = new Map();
const events = [];
const context = {
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
  window: {
    dispatchEvent: event => events.push(event),
  },
  navigator: { onLine: true },
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  },
};
vm.runInNewContext(offlineSource, context, { filename: 'system/patrol-offline.js' });
const api = context.window.PatrolOffline;
assert.ok(api, '離線相容 API 必須存在');
const base = {
  checkin_id: '11111111-1111-4111-8111-111111111111', target_type: 'marker',
  target_id: '22222222-2222-4222-8222-222222222222', floor_id: '1F', label: '巡邏點 A',
  user_id: '33333333-3333-4333-8333-333333333333', user_name: '測試人員',
  checkin_at: '2026-08-25T12:00:00.000Z',
};
assert.equal(api.enqueue(base), 1, '首次事件應加入待處理佇列');
assert.equal(api.enqueue({ ...base }), 1, '相同 checkin_id 與內容應去重');
assert.equal(api.enqueue({ ...base, target_id: '44444444-4444-4444-8444-444444444444' }), 0, '同 checkin_id 不同內容不可覆寫原事件');
assert.equal(api.quarantineCount(), 2, '衝突事件應雙方隔離保存');
assert.equal(api.enqueue({ ...base, checkin_id: '55555555-5555-4555-8555-555555555555' }), 1, '不同 checkin_id 的事件應獨立保留');
const result = await api.sync({});
assert.equal(result.synced, 0, '安全版不可自動重送舊版事件');
assert.equal(result.quarantined, 1, '待處理事件應隔離而非清除');
assert.equal(api.pendingCount(), 0, '同步後不應留下會被重送的舊事件');
assert.equal(api.quarantineCount(), 3, '隔離區應保留衝突與遺留事件');
assert.ok(events.some(event => event.detail?.quarantined), '隔離結果應通知頁面');

console.log('行動巡檢離線／重送衝突檢查通過：離線不寫入、重複去重、衝突隔離、伺服器與資料庫雙重防重複。');
