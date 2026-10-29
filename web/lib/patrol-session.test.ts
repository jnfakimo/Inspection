import assert from 'node:assert/strict';
import test from 'node:test';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  ensurePatrolQrSession,
  isPatrolQrDestination,
  PATROL_IDLE_TIMEOUT_MS,
  patrolSessionState,
  markPatrolSessionExpired,
  PATROL_SESSION_STORAGE_KEY,
  startPatrolSession,
  touchPatrolSession,
} from './patrol-session.ts';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const session = (id = 'auth-user-1', token = 'access-1') => ({
  access_token: token,
  refresh_token: `refresh-${token}`,
  user: { id },
}) as Session;

test('只有帶巡邏點的 V2 打卡網址使用十分鐘巡檢登入', () => {
  assert.equal(isPatrolQrDestination('/Inspection/v2/systems/guardpatrol/checkins/?marker=abc&source=qr'), true);
  assert.equal(isPatrolQrDestination('/Inspection/v2/systems/guardpatrol/checkins/'), false);
  assert.equal(isPatrolQrDestination('/Inspection/v2/systems/guardpatrol/points/?marker=abc'), false);
});

test('每次掃碼或操作都把閒置期限往後延長十分鐘', () => {
  const storage = new MemoryStorage();
  const startedAt = 1_000_000;
  assert.equal(startPatrolSession(session(), startedAt, storage), true);
  const initial = patrolSessionState(startedAt, storage);
  assert.equal(initial.status, 'valid');
  if (initial.status === 'valid') assert.equal(initial.value.valid_until, startedAt + PATROL_IDLE_TIMEOUT_MS);

  const activityAt = startedAt + 5 * 60 * 1000;
  assert.equal(touchPatrolSession(session('auth-user-1', 'access-2'), activityAt, storage), true);
  const touched = patrolSessionState(activityAt, storage);
  assert.equal(touched.status, 'valid');
  if (touched.status === 'valid') {
    assert.equal(touched.value.valid_until, activityAt + PATROL_IDLE_TIMEOUT_MS);
    assert.equal(storage.getItem(PATROL_SESSION_STORAGE_KEY)?.includes('access-2'), false);
  }
  assert.equal(patrolSessionState(activityAt + PATROL_IDLE_TIMEOUT_MS + 1, storage).status, 'expired');
});

test('有效瀏覽器 session 可恢復巡檢狀態，過期後舊分頁也必須重登', async () => {
  const storage = new MemoryStorage();
  const now = 2_000_000;
  startPatrolSession(session(), now, storage);
  let restored = 0;
  const client = {
    auth: {
      getSession: async () => ({data:{session:session()},error:null}),
      setSession: async () => { restored += 1; return { data: { session: session('auth-user-1', 'restored') }, error: null }; },
    },
  } as unknown as SupabaseClient;

  const result = await ensurePatrolQrSession(client, null, now + 1000, storage);
  assert.equal(result?.user.id, 'auth-user-1');
  assert.equal(restored, 1);

  const expired = await ensurePatrolQrSession(client, session(), now + PATROL_IDLE_TIMEOUT_MS + 2000, storage);
  assert.equal(expired, null);
});

test('已登入使用者第一次掃 QR 時建立受控的十分鐘工作階段', async () => {
  const storage = new MemoryStorage();
  const client = { auth: {} } as unknown as SupabaseClient;
  const current = session();
  assert.equal(await ensurePatrolQrSession(client, current, 3_000_000, storage), current);
  assert.equal(patrolSessionState(3_000_001, storage).status, 'valid');
});

test('閒置或登出後立即清除跨分頁權杖，但保留過期狀態阻止舊分頁繞過', async () => {
  const storage = new MemoryStorage();
  const now = 4_000_000;
  startPatrolSession(session(), now, storage);
  markPatrolSessionExpired(storage);
  const raw = storage.getItem(PATROL_SESSION_STORAGE_KEY) || '';
  assert.equal(raw.includes('access-1'), false);
  assert.equal(raw.includes('refresh-access-1'), false);
  assert.equal(patrolSessionState(now, storage).status, 'expired');
  const client = { auth: {} } as unknown as SupabaseClient;
  assert.equal(await ensurePatrolQrSession(client, session(), now, storage), null);
});

test('瀏覽器封鎖本機儲存時不會阻斷原本的登入流程', () => {
  const blocked = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  } as unknown as Storage;
  assert.equal(startPatrolSession(session(), 5_000_000, blocked), false);
  assert.equal(patrolSessionState(5_000_000, blocked).status, 'missing');
  assert.doesNotThrow(() => markPatrolSessionExpired(blocked));
});

test('舊 V2 巡檢紀錄讀取時只保留身分與期限，永久權杖立即移除',()=>{
 const storage=new MemoryStorage();const now=6_000_000;
 storage.setItem(PATROL_SESSION_STORAGE_KEY,JSON.stringify({version:2,user_id:'auth-user-1',access_token:'legacy-secret',refresh_token:'legacy-refresh',last_activity_at:now,valid_until:now+10000}));
 assert.equal(patrolSessionState(now,storage).status,'valid');
 const raw=storage.getItem(PATROL_SESSION_STORAGE_KEY)||'';
 assert.equal(raw.includes('legacy-secret'),false);assert.equal(raw.includes('access_token'),false);
});

test('工作階段恢復期間登出，晚到的 Auth 回應不得重新啟用巡檢',async()=>{
 const storage=new MemoryStorage();const now=7_000_000;startPatrolSession(session(),now,storage);
 let signedOut=0;
 const client={auth:{getSession:async()=>({data:{session:session()},error:null}),setSession:async()=>{markPatrolSessionExpired(storage);return {data:{session:session()},error:null};},signOut:async()=>{signedOut++;return {error:null};}}} as unknown as SupabaseClient;
 assert.equal(await ensurePatrolQrSession(client,null,now,storage),null);
 assert.equal(patrolSessionState(now,storage).status,'expired');
 assert.equal(signedOut,1);
});
