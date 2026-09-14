import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationUrl = new URL('../supabase/migrations/20260914170000_patrol_shift_bulk_reset.sql', import.meta.url);
const applyAllMigrationUrl = new URL('../supabase/migrations/20260914171000_patrol_shift_apply_all_templates.sql', import.meta.url);
const dayStatusMigrationUrl = new URL('../supabase/migrations/20260914172000_patrol_shift_day_status.sql', import.meta.url);
const actorAuth = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const actorUser = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select '${actorAuth}'::uuid $$;
    create table public.users(user_id uuid primary key, auth_id uuid, status text);
    insert into public.users values ('${actorUser}', '${actorAuth}', 'active');
    create function public.is_admin() returns boolean language sql stable as $$ select true $$;
    create function public.active_user_id() returns uuid language sql stable as $$ select '${actorUser}'::uuid $$;
    create function public.reject_physical_data_removal() returns trigger language plpgsql as $$
    begin raise exception 'physical removal disabled'; end $$;
    create table public.patrol_shifts(
      shift_id uuid primary key,
      shift_date date not null,
      name text not null,
      assigned_user_ids uuid[] not null default '{}'
    );
    create unique index idx_patrol_shifts_date_name on public.patrol_shifts(shift_date,name);
    create table public.audit_logs(
      table_name text, record_id text, action text, changes jsonb,
      operator_id uuid, source text
    );
    create table public.patrol_shift_template(
      template_id uuid primary key, name text, status text, sort_order integer
    );
    create table public.apply_calls(template_id uuid, from_date date, to_date date);
    create function public.apply_patrol_shift_template_range(p_template_id uuid, p_from date, p_to date)
    returns integer language plpgsql as $$
    begin
      insert into public.apply_calls values(p_template_id,p_from,p_to);
      return p_to-p_from+1;
    end $$;
  `);
  await db.exec(await readFile(migrationUrl, 'utf8'));
  await db.exec(await readFile(applyAllMigrationUrl, 'utf8'));
  await db.exec(await readFile(dayStatusMigrationUrl, 'utf8'));
  return db;
}

test('交易式清除保留跨日界線前一夜班，並為每筆異動留下稽核', async () => {
  const db = await database();
  await db.exec(`
    insert into patrol_shifts values
      ('00000000-0000-0000-0000-000000000001','2099-01-02','夜班','{}'),
      ('00000000-0000-0000-0000-000000000002','2099-01-02','早班','{}'),
      ('00000000-0000-0000-0000-000000000003','2099-01-03','夜班','{}'),
      ('00000000-0000-0000-0000-000000000004','2099-01-04','中班','{}'),
      ('00000000-0000-0000-0000-000000000005','2099-01-04','[已刪除] 晚班 abc','{}');
  `);
  const result = await db.query(`select soft_delete_patrol_shifts_from_date('2099-01-02','{}'::uuid[]) as count`);
  assert.equal(result.rows[0].count, 3);
  const rows = await db.query('select shift_id,name from patrol_shifts order by shift_id');
  assert.equal(rows.rows[0].name, '夜班', '界線日夜班屬前一值班日，必須保留');
  assert.match(rows.rows[1].name, /^\[已刪除\] 早班/);
  assert.match(rows.rows[2].name, /^\[已刪除\] 夜班/);
  assert.match(rows.rows[3].name, /^\[已刪除\] 中班/);
  assert.equal(rows.rows[4].name, '[已刪除] 晚班 abc');
  const audit = await db.query("select count(*)::int as count from audit_logs where source='v2-patrol-bulk-reset'");
  assert.equal(audit.rows[0].count, 3);
  await db.close();
});

test('稽核寫入失敗時班別清除會整批回復', async () => {
  const db = await database();
  await db.exec(`
    insert into patrol_shifts values
      ('00000000-0000-0000-0000-000000000011','2099-02-02','早班','{}'),
      ('00000000-0000-0000-0000-000000000012','2099-02-02','中班','{}');
    create function reject_audit() returns trigger language plpgsql as $$
    begin raise exception 'audit unavailable'; end $$;
    create trigger reject_audit before insert on audit_logs for each row execute function reject_audit();
  `);
  await assert.rejects(
    db.query("select soft_delete_patrol_shifts_from_date('2099-02-01','{}'::uuid[])")
  );
  const rows = await db.query('select name from patrol_shifts order by shift_id');
  assert.deepEqual(rows.rows.map(row => row.name), ['早班', '中班']);
  await db.close();
});

test('全部範本在同一交易套用並恢復值班日，停用範本不會重新建立', async () => {
  const db = await database();
  await db.exec(`
    insert into patrol_shift_template values
      ('10000000-0000-0000-0000-000000000001','早班','active',1),
      ('10000000-0000-0000-0000-000000000002','中班','active',2),
      ('10000000-0000-0000-0000-000000000003','舊班','inactive',3);
  `);
  await db.query("select set_patrol_shift_day_status('2099-03-01',true,'休場')");
  const result = await db.query("select apply_all_patrol_shift_templates_and_activate('2099-03-01','2099-03-02') as result");
  assert.deepEqual(result.rows[0].result, { templates: 2, days: 2, rows: 4 });
  const calls = await db.query('select template_id::text as template_id from apply_calls order by template_id');
  assert.deepEqual(calls.rows.map(row => row.template_id), [
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
  ]);
  const audit = await db.query("select count(*)::int as count from audit_logs where source='v2-patrol-apply-all'");
  assert.equal(audit.rows[0].count, 1);
  const statuses = await db.query('select duty_date::text as duty_date,status from patrol_shift_day_status order by duty_date');
  assert.deepEqual(statuses.rows, [
    { duty_date: '2099-03-01', status: 'active' },
    { duty_date: '2099-03-02', status: 'active' },
  ]);
  await db.close();
});

test('批次清除會停用有排班的值班日期範圍，重新套用前不由範本遞補', async () => {
  const db = await database();
  await db.exec(`
    insert into patrol_shifts values
      ('20000000-0000-0000-0000-000000000001','2099-04-01','早班','{}'),
      ('20000000-0000-0000-0000-000000000002','2099-04-03','中班','{}'),
      ('20000000-0000-0000-0000-000000000003','2099-04-04','夜班','{}');
  `);
  const result = await db.query("select reset_patrol_shifts_from_date('2099-04-01','{}'::uuid[]) as result");
  assert.deepEqual(result.rows[0].result, { count: 3, from_date: '2099-04-01', to_date: '2099-04-03', suspended_days: 3 });
  const statuses = await db.query('select duty_date::text as duty_date,status from patrol_shift_day_status order by duty_date');
  assert.deepEqual(statuses.rows, [
    { duty_date: '2099-04-01', status: 'suspended' },
    { duty_date: '2099-04-02', status: 'suspended' },
    { duty_date: '2099-04-03', status: 'suspended' },
  ]);
  await db.close();
});
