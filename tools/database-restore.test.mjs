import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { buildStatementFromLines, buildStatement, buildSequenceSyncStatement } from './database-restore.mjs';

test('還原略過衍生欄位並保留 identity，衍生值由資料庫重算', async () => {
  const db = new PGlite();
  try {
    await db.exec('create table public.generated_restore (id bigint generated always as identity primary key, start_mileage numeric, end_mileage numeric, total_mileage numeric generated always as (end_mileage-start_mileage) stored)');
    const row = { id: 15, start_mileage: 100, end_mileage: 140, total_mileage: 999 };
    const cols = ['id','start_mileage','end_mileage'];
    await db.exec(buildStatement('generated_restore', [row], ['id'], cols, 'upsert'));
    await db.exec(buildStatement('generated_restore', [{ ...row, end_mileage: 150 }], ['id'], cols, 'upsert'));
    assert.deepEqual((await db.query('select id::text,total_mileage::text from generated_restore')).rows, [{ id:'15', total_mileage:'50' }]);
    const sync = buildSequenceSyncStatement('generated_restore','id','public.generated_restore_id_seq');
    await db.exec(sync);
    assert.equal((await db.query('insert into generated_restore(start_mileage,end_mileage) values(1,2) returning id')).rows[0].id,16);
    await db.exec("select setval('generated_restore_id_seq',100,true)");
    await db.exec(sync);
    assert.equal((await db.query('insert into generated_restore(start_mileage,end_mileage) values(1,2) returning id')).rows[0].id,101);
  } finally { await db.close(); }
});

test('PostgreSQL 還原保留 bigint、numeric、特殊字元與冪等行為', async () => {
  const db = new PGlite();
  try {
    await db.exec('create table public.restore_check (id bigint primary key, amount numeric, label text, details jsonb)');
    const raw = '{"id":9007199254740993,"amount":12345678901234567890.123456789,"label":"O\'Brien\\\\path","details":{"value":9007199254740995}}';
    const cols = ['id', 'amount', 'label', 'details'];
    const statement = buildStatementFromLines('restore_check', [raw], ['id'], cols, 'upsert');
    // The explicit E literal remains correct for both PostgreSQL string modes.
    for (const setting of ['on', 'off']) {
      await db.exec(`set standard_conforming_strings = ${setting}`);
      await db.exec(statement);
      await db.exec(statement);
      const { rows } = await db.query('select id::text, amount::text, label, details->>\'value\' as nested from restore_check');
      assert.deepEqual(rows, [{ id: '9007199254740993', amount: '12345678901234567890.123456789', label: "O'Brien\\path", nested: '9007199254740995' }]);
    }
    const changed = raw.replace("O'Brien", 'changed');
    await db.exec(buildStatementFromLines('restore_check', [changed], ['id'], cols, 'insert-missing'));
    assert.equal((await db.query('select label from restore_check')).rows[0].label, "O'Brien\\path");
    await db.exec(buildStatementFromLines('restore_check', [changed], ['id'], cols, 'upsert'));
    assert.equal((await db.query('select label from restore_check')).rows[0].label, 'changed\\path');
  } finally { await db.close(); }
});

test('PostgreSQL 複合主鍵更新，無主鍵與無效 JSON 在 SQL 執行前拒絕', async () => {
  const db = new PGlite();
  try {
    await db.exec('create table public.compound_restore (day date, code text, note text, primary key(day, code))');
    const cols = ['day', 'code', 'note'];
    await db.exec(buildStatement('compound_restore', [{ day: '2026-09-06', code: 'a', note: 'first' }], ['day','code'], cols, 'upsert'));
    await db.exec(buildStatement('compound_restore', [{ day: '2026-09-06', code: 'a', note: 'second' }], ['day','code'], cols, 'upsert'));
    assert.deepEqual((await db.query('select note from compound_restore')).rows, [{ note: 'second' }]);
    assert.throws(() => buildStatement('compound_restore', [], [], cols, 'upsert'), /沒有主鍵/);
    for (const bad of ['[]', 'null', '42', '"secret"', '{bad']) {
      assert.throws(() => buildStatementFromLines('compound_restore', [bad], ['day','code'], cols, 'upsert'), /JSON/);
    }
  } finally { await db.close(); }
});
