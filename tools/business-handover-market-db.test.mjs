import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const packageUrl = process.env.HANDOVER_TEST_PGLITE_PATH
  ? pathToFileURL(process.env.HANDOVER_TEST_PGLITE_PATH).href : '@electric-sql/pglite';
const { PGlite } = await import(packageUrl);
const migration = readFileSync(new URL('../supabase/migrations/20260916132000_business_handover_market.sql', import.meta.url), 'utf8');
const policyGrants = readFileSync(new URL('../supabase/migrations/20260916170000_business_handover_market_policy_grants.sql', import.meta.url), 'utf8');
const db = new PGlite();
const one = '00000000-0000-0000-0000-000000000001';
const two = '00000000-0000-0000-0000-000000000002';
const query = (sql, args = []) => db.query(sql, args);
const actor = who => query(`select set_config('test.actor',$1,false)`, [who]);

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table users(user_id uuid primary key,name text,status text,username text,email text,department text,dept_id uuid,
      rbac_role text,role text,supervisor_id uuid);
    create table business_handover_entries(entry_id uuid primary key default gen_random_uuid(),market_code text not null,
      handover_date date not null,shift_code text not null,category text,description text not null,expected_attendance int default 0,
      absent_attendance int default 0,created_by uuid,updated_by uuid,created_at timestamptz default now(),updated_at timestamptz default now(),
      deleted_by uuid,deleted_at timestamptz,is_deleted boolean default false);
    create table business_handover_completions(entry_id uuid primary key,completed_date date,completed_shift text,
      completed_by uuid,completed_name text,completed_at timestamptz default now());
    create table business_handover_transfers(transfer_id uuid primary key default gen_random_uuid(),market_code text not null,
      handover_date date,shift_code text,next_date date,next_shift text,items jsonb,revision text,handed_by uuid,handed_name text,
      handed_at timestamptz default now(),receiver_id uuid,receiver_name text,received_by uuid,received_name text,received_at timestamptz,
      unique(handover_date,shift_code),unique(next_date,next_shift));
    create table business_handover_approvals(approval_id uuid primary key default gen_random_uuid(),market_code text not null,
      handover_date date,stage text,stage_label text,approver_id uuid,approved_at timestamptz default now(),note text,
      created_at timestamptz default now(),updated_at timestamptz default now(),constraint uq_business_handover_approval_stage unique(handover_date,stage));
    create function active_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function active_rbac_role() returns text language sql stable as $$select coalesce((select rbac_role from public.users where user_id=public.active_user_id()),'reporter')$$;
    create function has_handover_module_access(text) returns boolean language sql stable as $$select true$$;
    create function handover_staff_market(uuid,text) returns text language sql stable as
      $$select case $1 when '${one}'::uuid then 'market_1' when '${two}'::uuid then 'market_2' end$$;
    create function handover_staff_markets(uuid,text) returns jsonb language sql stable as
      $$select jsonb_build_array(public.handover_staff_market($1,$2))$$;
    create function business_receiver_allowed(uuid) returns boolean language sql stable as
      $$select exists(select 1 from public.users where user_id=$1 and status='active' and username not like 'deidentified-%')$$;
    create function business_shift_start(date,text) returns timestamptz language sql immutable as
      $$select ($1+case $2 when '01-09' then time '01:00' when '09-17' then time '09:00' else time '17:00' end) at time zone 'Asia/Taipei'$$;
    insert into users values
      ('${one}','一市業管','active','one','one@example.test','業管組',null,'reporter','inspector',null),
      ('${two}','二市業管','active','two','two@example.test','業管組',null,'reporter','inspector',null);
  `);
  await db.exec(migration);
  await db.exec(migration);
  await db.exec(policyGrants);
  await db.exec(policyGrants);
  await actor(one);
  await query(`insert into business_handover_entries(market_code,handover_date,shift_code,description,created_by,updated_by)
    values('market_1','2020-01-01','01-09','一市事項',$1,$1)`, [one]);
  await actor(two);
  await query(`insert into business_handover_entries(market_code,handover_date,shift_code,description,created_by,updated_by)
    values('market_2','2020-01-01','01-09','二市事項',$1,$1)`, [two]);
  const marketTwo = (await query(`select business_market_day('market_2','2020-01-01') data`)).rows[0].data;
  assert.equal(marketTwo[0].items.length, 1);
  assert.equal(marketTwo[0].items[0].market_code, 'market_2');
  await assert.rejects(query(`select business_market_day('market_1','2020-01-01')`), /所選市場/);
  await query(`insert into business_handover_transfers(market_code,handover_date,shift_code,next_date,next_shift,items,revision,handed_by,handed_name,receiver_id,receiver_name)
    values('market_1','2020-01-01','01-09','2020-01-01','09-17','[]','a',$1,'一市','${two}','二市'),
          ('market_2','2020-01-01','01-09','2020-01-01','09-17','[]','b',$2,'二市','${one}','一市')`, [one,two]);
  await query(`insert into business_handover_approvals(market_code,handover_date,stage,stage_label,approver_id)
    values('market_1','2020-01-01','director','一市場主任',$1),('market_2','2020-01-01','director','二市場主任',$2)`, [one,two]);
  // 以一般登入使用者身分直接讀寫資料表（與頁面相同）：RLS 規則呼叫的函式必須授權給 authenticated，
  // 否則正式環境一律回 permission denied for function。上面以超級使用者執行的測試抓不到這類授權缺漏。
  const tables = 'business_handover_entries,business_handover_completions,business_handover_transfers,business_handover_approvals';
  await db.exec(`
    grant usage on schema public to authenticated;
    grant select, insert, update on ${tables} to authenticated;
    alter table business_handover_entries enable row level security;
    alter table business_handover_completions enable row level security;
    alter table business_handover_transfers enable row level security;
    alter table business_handover_approvals enable row level security;
  `);
  await actor(one);
  await query('set role authenticated');
  try {
    const entries = await query(`select market_code from business_handover_entries where handover_date='2020-01-01'`);
    assert.deepEqual(entries.rows.map(row => row.market_code), ['market_1'], '一般使用者只能讀到自己市場的交接紀錄');
    const approvals = await query(`select market_code from business_handover_approvals where handover_date='2020-01-01'`);
    assert.deepEqual(approvals.rows.map(row => row.market_code), ['market_1'], '一般使用者只能讀到自己市場的批核');
    const transfers = await query(`select market_code from business_handover_transfers where handover_date='2020-01-01'`);
    assert.deepEqual(transfers.rows.map(row => row.market_code), ['market_1'], '一般使用者只能讀到自己市場的交班');
    await query(`select count(*) from business_handover_completions`);
    await assert.rejects(query(`select public.business_market_approval_allowed('${two}','market_2','director')`), /permission denied/,
      '可查任意使用者簽核權的函式不得開放給一般使用者');
  } finally {
    await query('reset role');
  }
  console.log('業管組交接市場隔離：重跑冪等、資料／交班／批核複合鍵、跨市場拒絕與一般登入身分讀取均通過。');
} finally { await db.close(); }
