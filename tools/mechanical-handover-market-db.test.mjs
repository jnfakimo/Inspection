import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const packageUrl = process.env.HANDOVER_TEST_PGLITE_PATH
  ? pathToFileURL(process.env.HANDOVER_TEST_PGLITE_PATH).href : '@electric-sql/pglite';
const { PGlite } = await import(packageUrl);
const migration = readFileSync(new URL('../supabase/migrations/20260916131000_mechanical_handover_market.sql', import.meta.url), 'utf8');
const db = new PGlite();
const one = '00000000-0000-0000-0000-000000000001';
const two = '00000000-0000-0000-0000-000000000002';
const query = (sql, args = []) => db.query(sql, args);
const actor = who => query(`select set_config('test.actor',$1,false)`, [who]);

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table users(user_id uuid primary key,name text,status text,username text,email text,department text,dept_id uuid,rbac_role text,role text);
    create table departments(dept_id uuid primary key,name text,level int,status text);
    create table user_system_access(user_id uuid,system_key text,mode text);
    create table role_permissions(role_id text,perm text,allowed boolean);
    create table user_module_access(user_id uuid,system_key text,module_key text,mode text);
    create table role_module_access(role_id text,system_key text,module_key text,mode text);
    create table mechanical_staff_market_scopes(user_id uuid primary key,market_code text,is_active boolean);
    create table mechanical_handover_entries(entry_id uuid primary key default gen_random_uuid(),market_code text not null,
      work_date date not null,shift_code text not null,category text,work_item text,details text,technician_ids uuid[] default '{}',
      result text not null,notes text,sort_order int default 0,created_by uuid,updated_by uuid,created_at timestamptz default now(),
      updated_at timestamptz default now(),carry_source_id uuid,is_deleted boolean default false);
    create table mechanical_handover_signatures(signature_id uuid primary key default gen_random_uuid(),market_code text not null,
      work_date date,shift_code text,signer_id uuid,signed_at timestamptz,updated_by uuid,updated_at timestamptz default now(),
      unique(work_date,shift_code));
    create table mechanical_handover_daily_approvals(approval_id uuid primary key default gen_random_uuid(),market_code text not null,
      work_date date unique,approver_id uuid,approved_at timestamptz default now(),note text,created_at timestamptz default now());
    create table mechanical_handover_transfers(transfer_id uuid primary key default gen_random_uuid(),market_code text not null,
      handover_date date,shift_code text,next_date date,next_shift text,items jsonb,revision text,handed_by uuid,handed_name text,
      handed_at timestamptz default now(),receiver_id uuid,receiver_name text,received_by uuid,received_name text,received_at timestamptz,
      unique(handover_date,shift_code),unique(next_date,next_shift));
    create function active_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function active_rbac_role() returns text language sql stable as $$select coalesce(current_setting('test.role',true),'reporter')$$;
    create function has_handover_module_access(text) returns boolean language sql stable as $$select true$$;
    create function handover_staff_market(uuid,text) returns text language sql stable as
      $$select market_code from public.mechanical_staff_market_scopes where user_id=$1 and is_active$$;
    create function handover_staff_markets(uuid,text) returns jsonb language sql stable as
      $$select coalesce(jsonb_agg(market_code),'[]'::jsonb) from public.mechanical_staff_market_scopes where user_id=$1 and is_active$$;
    create function mechanical_receiver_allowed(uuid) returns boolean language sql stable as
      $$select exists(select 1 from public.users where user_id=$1 and status='active' and username not like 'deidentified-%')$$;
    create function mechanical_shift_start(date,text) returns timestamptz language sql immutable as
      $$select ($1+case $2 when '01-09' then time '01:00' when '09-17' then time '09:00' else time '17:00' end) at time zone 'Asia/Taipei'$$;
    create function can_approve_mechanical_handover() returns boolean language sql stable as $$select true$$;
    insert into departments values('10000000-0000-0000-0000-000000000001','機電課',2,'active');
    insert into role_permissions values('reporter','sys_handover',true);
    insert into users values
      ('${one}','一市機電','active','one','one@example.test','機電課','10000000-0000-0000-0000-000000000001','reporter','inspector'),
      ('${two}','二市機電','active','two','two@example.test','機電課','10000000-0000-0000-0000-000000000001','reporter','inspector');
    insert into mechanical_staff_market_scopes values('${one}','market_1',true),('${two}','market_2',true);
  `);
  await db.exec(migration);
  await db.exec(migration);
  await actor(two);
  await query(`insert into mechanical_handover_entries(market_code,work_date,shift_code,result,created_by,updated_by)
    values('market_2','2020-01-01','01-09','待料',$1,$1)`, [two]);
  await actor(one);
  await query(`insert into mechanical_handover_entries(market_code,work_date,shift_code,result,created_by,updated_by)
    values('market_1','2020-01-01','01-09','正常',$1,$1)`, [one]);
  const marketOne = (await query(`select mechanical_market_day('market_1','2020-01-01') data`)).rows[0].data;
  assert.equal(marketOne[0].items.length, 1);
  assert.equal(marketOne[0].items[0].market_code, 'market_1');
  await assert.rejects(query(`select mechanical_market_day('market_2','2020-01-01')`), /本市場/);
  await actor(two);
  const marketTwo = (await query(`select mechanical_market_day('market_2','2020-01-01') data`)).rows[0].data;
  assert.equal(marketTwo[0].items[0].market_code, 'market_2');
  await query(`insert into mechanical_handover_signatures(market_code,work_date,shift_code,updated_by)
    values('market_1','2020-01-01','01-09',$1),('market_2','2020-01-01','01-09',$2)`, [one,two]);
  console.log('機電交接市場隔離：重跑冪等、同日同班可分市場、跨市場拒絕與資料隔離均通過。');
} finally { await db.close(); }
