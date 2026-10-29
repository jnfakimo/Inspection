import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261029120000_lock_inspection_photos_bucket.sql', import.meta.url), 'utf8');

// 還原正式庫現況：公開桶、無限制，policy 名稱是 allow_public_read／allow_authenticated_upload；
// active_user_id() 以 test.active_user 設定模擬「是否為已啟用的系統帳號」。
const fixture = `
create role anon; create role authenticated;
create schema storage;
create table storage.buckets(id text primary key, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects(bucket_id text, name text);
alter table storage.objects enable row level security;
insert into storage.buckets values ('inspection-photos', true, null, null), ('floorplans', false, null, null);
insert into storage.objects values ('inspection-photos', 'seed.jpg'), ('floorplans', 'plan.png');
create function public.active_user_id() returns uuid language sql stable as $$ select nullif(current_setting('test.active_user', true), '')::uuid $$;
create policy allow_public_read on storage.objects for select to public using (bucket_id = 'inspection-photos');
create policy allow_authenticated_upload on storage.objects for insert to authenticated with check (bucket_id = 'inspection-photos');
create policy floorplans_read on storage.objects for select to authenticated using (bucket_id = 'floorplans' and public.active_user_id() is not null);
grant usage on schema storage to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select, insert on storage.objects to anon, authenticated;
`;

const db = new PGlite();
const asRole = async (role, activeUser, fn) => {
  await db.exec(`set role ${role}`);
  await db.exec(`select set_config('test.active_user', '${activeUser ?? ''}', false)`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};
const count = (bucket) => db.query(`select count(*)::int as n from storage.objects where bucket_id = $1`, [bucket]).then((r) => r.rows[0].n);

try {
  await db.exec(fixture);

  // 修正前：未登入可讀、剛註冊的帳號（沒有系統身分）可上傳（重現問題）。
  assert.equal(await asRole('anon', null, () => count('inspection-photos')), 1, '修正前 anon 應可讀（重現問題）');
  await asRole('authenticated', null, () => db.exec(`insert into storage.objects values ('inspection-photos', 'junk.html')`));

  await db.exec(migration);

  const bucket = (await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'inspection-photos'`)).rows[0];
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 10485760);
  assert.deepEqual(bucket.allowed_mime_types, ['image/jpeg', 'image/png', 'image/webp', 'image/heic']);

  const names = (await db.query(`select policyname from pg_policies where tablename = 'objects' order by 1`)).rows.map((r) => r.policyname);
  assert.deepEqual(names, ['floorplans_read', 'inspection_photos_authenticated_insert', 'inspection_photos_authenticated_read']);

  const active = '11111111-1111-4111-8111-111111111111';
  // 修正後：未登入讀不到；沒有系統身分的登入者讀不到、也不能上傳；已啟用帳號可讀可傳。
  assert.equal(await asRole('anon', null, () => count('inspection-photos')), 0);
  assert.equal(await asRole('authenticated', null, () => count('inspection-photos')), 0);
  await asRole('authenticated', null, () => assert.rejects(db.exec(`insert into storage.objects values ('inspection-photos', 'x.jpg')`), /row-level security/));
  await asRole('anon', null, () => assert.rejects(db.exec(`insert into storage.objects values ('inspection-photos', 'x.jpg')`), /row-level security|permission denied/));
  assert.ok((await asRole('authenticated', active, () => count('inspection-photos'))) >= 1);
  await asRole('authenticated', active, () => db.exec(`insert into storage.objects values ('inspection-photos', 'ok.jpg')`));

  // 不影響其他桶，也不刪任何物件。
  assert.equal(await asRole('authenticated', active, () => count('floorplans')), 1);
  assert.equal((await db.query(`select count(*)::int as n from storage.objects where bucket_id = 'inspection-photos'`)).rows[0].n >= 3, true);
} finally {
  await db.close();
}

console.log('inspection-photos 儲存桶收斂測試通過：修正前可重現公開讀取與任意上傳、修正後僅已啟用帳號可讀寫，其他桶不受影響。');
