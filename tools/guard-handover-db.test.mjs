import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const packageUrl = process.env.HANDOVER_TEST_PGLITE_PATH
  ? pathToFileURL(process.env.HANDOVER_TEST_PGLITE_PATH).href : '@electric-sql/pglite';
const { PGlite } = await import(packageUrl);

const db = new PGlite();
const handover = '00000000-0000-0000-0000-000000000001';
const receiver = '00000000-0000-0000-0000-000000000002';
const other = '00000000-0000-0000-0000-000000000003';
const dept = '10000000-0000-0000-0000-000000000001';
const migration = readFileSync(new URL('../supabase/migrations/20260916110000_guard_handover_designated_receiver.sql', import.meta.url), 'utf8');
const query = (sql, args = []) => db.query(sql, args);
const actor = who => query(`select set_config('test.actor',$1,false)`, [who]);

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table departments(dept_id uuid primary key,name text,status text);
    create table users(user_id uuid primary key,name text,status text,username text,email text,department text,dept_id uuid,rbac_role text default 'reporter',role text default 'inspector');
    create table user_system_access(user_id uuid,system_key text,mode text);
    create table role_permissions(role_id text,perm text,allowed boolean);
    create table user_module_access(user_id uuid,system_key text,module_key text,mode text);
    create table role_module_access(role_id text,system_key text,module_key text,mode text);
    create function active_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function has_handover_module_access(text) returns boolean language sql stable as $$select true$$;
    create function reject_physical_data_removal() returns trigger language plpgsql as $$begin raise exception 'no delete'; end$$;
    create table guard_handover_daily_approvals(approval_id uuid primary key default gen_random_uuid(),duty_date date);
    create table guard_handover_logs(
      log_id uuid primary key default gen_random_uuid(), duty_date date not null, shift_name text not null,
      shift_order int default 0, shift_start time not null, shift_end time not null, patrol_start time not null, patrol_end time not null,
      scheduled_user_ids uuid[] default '{}', actual_user_ids uuid[] default '{}', substitute_note text default '', duty_summary text default '', important_notes text default '',
      incidents jsonb default '[]', items jsonb default '[]', patrol_snapshot jsonb, status text default 'draft',
      handover_by uuid, handover_at timestamptz, takeover_by uuid, takeover_at timestamptz,
      created_by uuid not null, created_at timestamptz default now(), updated_by uuid not null, updated_at timestamptz default now()
    );
    create function protect_guard_handover_log() returns trigger language plpgsql as $$begin return new; end$$;
    create trigger trg_protect_guard_handover_log before insert or update on guard_handover_logs for each row execute function protect_guard_handover_log();
    insert into departments values('${dept}','駐警隊','active');
    insert into role_permissions values('reporter','sys_handover',true);
    insert into guard_handover_logs(duty_date,shift_name,shift_start,shift_end,patrol_start,patrol_end,
      status,handover_by,handover_at,created_by,updated_by)
      values('2026-09-15','舊版待接','03:00','11:00','04:00','05:00','submitted','${handover}',now(),'${handover}','${handover}');
    insert into guard_handover_logs(duty_date,shift_name,shift_start,shift_end,patrol_start,patrol_end,
      status,handover_by,handover_at,takeover_by,takeover_at,created_by,updated_by)
      values('2026-09-14','舊版已接','03:00','11:00','04:00','05:00','received','${handover}',now(),'${receiver}',now(),'${handover}','${receiver}');
  `);
  await db.exec(migration);
  await db.exec(migration);
  await query(`insert into users(user_id,name,status,username,email,department,dept_id) values
    ($1,'交班人','active','handover','handover@example.test','駐警隊',$4),
    ($2,'接班人','active','receiver','receiver@example.test','駐警隊',$4),
    ($3,'其他人員','active','other','other@example.test','駐警隊',$4)`, [handover, receiver, other, dept]);
  await actor(handover);
  assert.equal((await query(`select guard_handover_receivers() as data`)).rows[0].data.length, 2);
  assert.equal((await query(`select receiver_id from guard_handover_logs where shift_name='舊版已接'`)).rows[0].receiver_id, null, '既有完成簽認不回寫');
  await assert.rejects(query(`update guard_handover_logs set status='received',takeover_by=$1,updated_by=$1 where shift_name='舊版待接'`, [receiver]), /指定|designated/);
  await query(`update guard_handover_logs set status='draft',handover_by=null,handover_at=null,updated_by=$1 where shift_name='舊版待接'`, [handover]);
  assert.equal((await query(`select status,receiver_id from guard_handover_logs where shift_name='舊版待接'`)).rows[0].status, 'draft');
  await query(`insert into user_module_access values($1,'handover','guard','deny')`, [receiver]);
  assert.equal((await query(`select guard_receiver_allowed($1) as allowed`, [receiver])).rows[0].allowed, false, '個人子系統拒絕必須排除接班資格');
  await query(`update user_module_access set mode='allow' where user_id=$1`, [receiver]);
  assert.equal((await query(`select guard_receiver_allowed($1) as allowed`, [receiver])).rows[0].allowed, true);
  const row = (await query(`insert into guard_handover_logs(duty_date,shift_name,shift_start,shift_end,patrol_start,patrol_end,actual_user_ids,duty_summary,created_by,updated_by)
    values('2026-09-16','早班','03:00','11:00','04:00','05:00',$1,'本班勤務正常',$2,$2) returning log_id`, [[handover], handover])).rows[0];
  await assert.rejects(query(`update guard_handover_logs set status='submitted',handover_by=$1,updated_by=$1 where log_id=$2`, [handover, row.log_id]), /指定|designated/);
  await query(`update guard_handover_logs set status='submitted',handover_by=$1,receiver_id=$2,updated_by=$1 where log_id=$3`, [handover, receiver, row.log_id]);
  const submitted = (await query(`select status,handover_by,receiver_id,handover_at from guard_handover_logs where log_id=$1`, [row.log_id])).rows[0];
  assert.equal(submitted.status, 'submitted'); assert.equal(submitted.receiver_id, receiver); assert.ok(submitted.handover_at);
  await assert.rejects(query(`update guard_handover_logs set status='received',takeover_by=$1,updated_by=$1 where log_id=$2`, [other, row.log_id]), /指定|designated/);
  await query(`update guard_handover_logs set status='received',takeover_by=$1,updated_by=$1 where log_id=$2`, [receiver, row.log_id]);
  const received = (await query(`select status,receiver_id,takeover_by,takeover_at from guard_handover_logs where log_id=$1`, [row.log_id])).rows[0];
  assert.equal(received.status, 'received'); assert.equal(received.receiver_id, receiver); assert.equal(received.takeover_by, receiver); assert.ok(received.takeover_at);
  await assert.rejects(query(`update guard_handover_logs set duty_summary='竄改' where log_id=$1`, [row.log_id]), /immutable/);
  console.log('駐警隊交接 DB 通過：指定接班人、雙方本人簽認、簽認時間、非指定人拒絕、權限拒絕、舊紀錄保留與撤回、完成後鎖定及冪等移轉。');
} finally {
  await db.close();
}
