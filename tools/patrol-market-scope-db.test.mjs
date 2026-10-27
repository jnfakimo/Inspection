// 驗證 20261027090000_patrol_market_scope.sql：兩市同名範本互不覆蓋。
// 前置結構與 patrol_staff_config_apply／patrol_staff_uuid_array 取自 2026-10-26 正式庫的現行定義。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migrationUrl = new URL('../supabase/migrations/20261027090000_patrol_market_scope.sql', import.meta.url);
const actorAuth = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const actorUser = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const guardA = 'cccccccc-cccc-cccc-cccc-cccccccccc01';
const guardB = 'cccccccc-cccc-cccc-cccc-cccccccccc02';
const guardM2 = 'cccccccc-cccc-cccc-cccc-cccccccccc03';

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select '${actorAuth}'::uuid $$;
    create table public.users(user_id uuid primary key, auth_id uuid, status text);
    insert into public.users values ('${actorUser}', '${actorAuth}', 'active');
    create function public.is_admin() returns boolean language sql stable as $$ select true $$;
    create table public.audit_logs(table_name text, record_id text, action text, changes jsonb, operator_id uuid, source text);
    create table public.system_settings(key text primary key, value text, updated_at timestamptz);
    create table public.patrol_shift_template(
      template_id uuid primary key default gen_random_uuid(), name text, start_time time, end_time time, sort_order integer,
      assigned_user_ids uuid[] not null default '{}', status text not null default 'active',
      market_code text not null default 'market_1'
    );
    create table public.patrol_shifts(
      shift_id uuid primary key default gen_random_uuid(), shift_date date not null, name text not null,
      start_time time, end_time time, sort_order integer default 0, created_at timestamptz default now(),
      assigned_user_ids uuid[] not null default '{}', market_code text not null default 'market_1'
    );
    create unique index idx_patrol_shifts_date_name on public.patrol_shifts(shift_date, name);
    create table public.patrol_shift_day_status(
      duty_date date primary key, status text, reason text, updated_by uuid, updated_at timestamptz,
      market_code text not null default 'market_1'
    );

    create function public.patrol_staff_uuid_array(p_staff jsonb) returns uuid[] language sql immutable as $$
      select coalesce((select array_agg(value::uuid) from jsonb_array_elements_text(coalesce(p_staff, '[]'::jsonb)) as t(value)), '{}'::uuid[]);
    $$;
    create function public.patrol_staff_config_apply(p_scope text, p_date_key text, p_shift_name text, p_staff jsonb, p_work_start text, p_work_end text)
    returns void language plpgsql as $$
    declare v_cfg jsonb; v_work jsonb := jsonb_build_object('start', p_work_start, 'end', p_work_end);
    begin
      select coalesce(nullif(btrim(coalesce(value, '')), '')::jsonb, '{}'::jsonb) into v_cfg from public.system_settings where key = 'patrol_shift_staff' for update;
      v_cfg := coalesce(v_cfg, '{}'::jsonb);
      v_cfg := jsonb_set(v_cfg, '{templates}', coalesce(v_cfg->'templates', '{}'::jsonb), true);
      v_cfg := jsonb_set(v_cfg, '{dates}', coalesce(v_cfg->'dates', '{}'::jsonb), true);
      v_cfg := jsonb_set(v_cfg, '{workTimes}', coalesce(v_cfg->'workTimes', '{}'::jsonb), true);
      v_cfg := jsonb_set(v_cfg, '{workTimes,templates}', coalesce(v_cfg->'workTimes'->'templates', '{}'::jsonb), true);
      v_cfg := jsonb_set(v_cfg, '{workTimes,dates}', coalesce(v_cfg->'workTimes'->'dates', '{}'::jsonb), true);
      if p_scope = 'template' then
        v_cfg := jsonb_set(v_cfg, array['templates', p_shift_name], coalesce(p_staff, '[]'::jsonb), true);
        v_cfg := jsonb_set(v_cfg, array['workTimes','templates', p_shift_name], v_work, true);
      else
        v_cfg := jsonb_set(v_cfg, array['dates', p_date_key], coalesce(v_cfg->'dates'->p_date_key, '{}'::jsonb), true);
        v_cfg := jsonb_set(v_cfg, array['dates', p_date_key, p_shift_name], coalesce(p_staff, '[]'::jsonb), true);
        v_cfg := jsonb_set(v_cfg, array['workTimes','dates', p_date_key], coalesce(v_cfg->'workTimes'->'dates'->p_date_key, '{}'::jsonb), true);
        v_cfg := jsonb_set(v_cfg, array['workTimes','dates', p_date_key, p_shift_name], v_work, true);
      end if;
      insert into public.system_settings (key, value, updated_at) values ('patrol_shift_staff', v_cfg::text, now())
      on conflict (key) do update set value = excluded.value, updated_at = now();
    end $$;

    -- 正式庫現況：一市三班有人員，二市複製出同名、同時段、無人員的範本。
    -- template_id 讓二市排在一市之後，重現 apply_all 依 template_id 排序時的覆蓋順序。
    insert into public.patrol_shift_template(template_id, name, start_time, end_time, sort_order, assigned_user_ids, market_code) values
      ('10000000-0000-0000-0000-000000000001', '早班', '03:00', '11:00', 1, '{${guardA}}', 'market_1'),
      ('90000000-0000-0000-0000-000000000001', '早班', '03:00', '11:00', 1, '{}', 'market_2'),
      ('10000000-0000-0000-0000-000000000002', '晚班(隔夜)', '19:00', '03:00', 3, '{${guardB}}', 'market_1'),
      ('90000000-0000-0000-0000-000000000002', '晚班(隔夜)', '19:00', '03:00', 3, '{}', 'market_2');
    insert into public.system_settings values ('patrol_shift_staff',
      '{"templates":{"早班":["${guardA}"]},"dates":{},"workTimes":{"templates":{"早班":{"start":"04:00","end":"05:00"}},"dates":{}}}', now());
  `);
  await db.exec(await readFile(migrationUrl, 'utf8'));
  return db;
}

const rows = async (db, sql) => (await db.query(sql)).rows;
const staffConfig = async db => JSON.parse((await rows(db, `select value from system_settings where key = 'patrol_shift_staff'`))[0].value);

test('切換為市場複合唯一鍵，兩市可有同日同名班別', async () => {
  const db = await database();
  const indexes = (await rows(db, `select indexname from pg_indexes where tablename = 'patrol_shifts'`)).map(row => row.indexname);
  assert.ok(indexes.includes('idx_patrol_shifts_market_date_name'));
  assert.ok(!indexes.includes('idx_patrol_shifts_date_name'));
  await db.exec(`insert into patrol_shifts(shift_date, name, market_code) values ('2099-01-02','早班','market_1'), ('2099-01-02','早班','market_2')`);
  await assert.rejects(db.exec(`insert into patrol_shifts(shift_date, name, market_code) values ('2099-01-02','早班','market_1')`));
});

test('一市重新套用全部範本：保留一市人員，不碰二市範本', async () => {
  const db = await database();
  const result = (await rows(db, `select public.apply_all_patrol_shift_templates_and_activate('2099-01-02','2099-01-03') as r`))[0].r;
  assert.equal(result.market_code, 'market_1');
  assert.equal(result.templates, 2);
  const shifts = await rows(db, `select market_code, shift_date::text d, name, assigned_user_ids::text[] ids from patrol_shifts order by d, name`);
  assert.equal(shifts.length, 4);
  assert.ok(shifts.every(row => row.market_code === 'market_1'));
  assert.deepEqual(shifts.filter(row => row.name === '早班').map(row => row.ids), [[guardA], [guardA]]);
  assert.deepEqual(shifts.filter(row => row.name === '晚班(隔夜)').map(row => row.ids), [[guardB], [guardB]]);
  const config = await staffConfig(db);
  assert.deepEqual(config.dates['2099-01-02']['早班'], [guardA]);
  assert.deepEqual(config.workTimes.dates['2099-01-02']['早班'], { start: '04:00', end: '05:00' });
  assert.equal((await rows(db, `select count(*)::int n from patrol_shift_day_status where status = 'active'`))[0].n, 2);
});

test('二市套用全部範本：只寫二市班別，不改一市人員、排班設定與停班狀態', async () => {
  const db = await database();
  await rows(db, `select public.apply_all_patrol_shift_templates_and_activate('2099-01-02','2099-01-02')`);
  const before = await staffConfig(db);
  const result = (await rows(db, `select public.apply_all_patrol_shift_templates_and_activate('2099-01-02','2099-01-02','market_2') as r`))[0].r;
  assert.equal(result.market_code, 'market_2');
  assert.equal(result.day_status_updated, false);
  const m1 = await rows(db, `select name, assigned_user_ids::text[] ids from patrol_shifts where market_code = 'market_1' order by name`);
  assert.deepEqual(m1.map(row => row.ids), [[guardA], [guardB]]);
  const m2 = await rows(db, `select name, assigned_user_ids::text[] ids from patrol_shifts where market_code = 'market_2' order by name`);
  assert.equal(m2.length, 2);
  assert.ok(m2.every(row => row.ids.length === 0));
  assert.deepEqual(await staffConfig(db), before);
});

test('二市儲存單日班別與範本不寫入只屬一市的 patrol_shift_staff', async () => {
  const db = await database();
  const before = await staffConfig(db);
  await db.query(`select public.save_patrol_shift('2099-01-05','早班','03:00','11:00',1,$1::jsonb,'04:00','05:00','market_2')`, [JSON.stringify([guardM2])]);
  await db.query(`select public.save_patrol_shift_template('90000000-0000-0000-0000-000000000001','早班','03:00','11:00',1,$1::jsonb,'04:00','05:00','market_1')`, [JSON.stringify([guardM2])]);
  // 修改既有範本時沿用範本本身的市場，就算呼叫端帶錯市場也不會改到一市設定。
  assert.deepEqual(await staffConfig(db), before);
  assert.equal((await rows(db, `select market_code from patrol_shift_template where template_id = '90000000-0000-0000-0000-000000000001'`))[0].market_code, 'market_2');
  const saved = await rows(db, `select market_code, assigned_user_ids::text[] ids from patrol_shifts where shift_date = '2099-01-05'`);
  assert.deepEqual(saved, [{ market_code: 'market_2', ids: [guardM2] }]);

  // 一市照舊寫入；未帶市場的舊呼叫方式也視為一市。
  await db.query(`select public.save_patrol_shift('2099-01-05','早班','03:00','11:00',1,$1::jsonb,'04:00','05:00')`, [JSON.stringify([guardA])]);
  assert.deepEqual((await staffConfig(db)).dates['2099-01-05']['早班'], [guardA]);
  assert.equal((await rows(db, `select count(*)::int n from patrol_shifts where shift_date = '2099-01-05'`))[0].n, 2);
});

test('新增範本寫入指定市場', async () => {
  const db = await database();
  const id = (await rows(db, `select public.save_patrol_shift_template(null,'中班','11:00','19:00',2,'[]'::jsonb,null,null,'market_2') as id`))[0].id;
  assert.equal((await rows(db, `select market_code from patrol_shift_template where template_id = '${id}'`))[0].market_code, 'market_2');
  assert.equal((await staffConfig(db)).templates['中班'], undefined);
});

test('清除當日及未來班別只作用於指定市場；二市不改停班狀態', async () => {
  const db = await database();
  await rows(db, `select public.apply_all_patrol_shift_templates_range('2099-01-02','2099-01-03')`);
  await rows(db, `select public.apply_all_patrol_shift_templates_range('2099-01-02','2099-01-03','market_2')`);
  const result = (await rows(db, `select public.reset_patrol_shifts_from_date('2099-01-02','{}','market_2') as r`))[0].r;
  assert.equal(result.count, 4);
  assert.equal(result.suspended_days, 0);
  const live = await rows(db, `select market_code, count(*)::int n from patrol_shifts where name not like '[已刪除]%' group by 1 order by 1`);
  assert.deepEqual(live, [{ market_code: 'market_1', n: 4 }]);
  assert.equal((await rows(db, `select count(*)::int n from patrol_shift_day_status`))[0].n, 0);
});

test('市場代碼只接受 market_1、market_2', async () => {
  const db = await database();
  await assert.rejects(db.query(`select public.apply_all_patrol_shift_templates_range('2099-01-02','2099-01-02','market_3')`), /市場代碼無效/);
});
