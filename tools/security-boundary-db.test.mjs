import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const fix=read('20261106050736_codex_security_boundary_fixes.sql');
const reconciliation=read('20260914220000_access_control_schema_reconciliation.sql');
const original=read('20260808090000_non_admin_bulk_read_cutoff.sql');
const user='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002';
test('SQL helper and restrictive RLS enforce system/module/active/owner with legitimate controls',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`
 create role anon;create role authenticated;create role service_role;
 create table user_system_access(user_id uuid,system_key text,mode text);
 create table user_module_access(user_id uuid,system_key text,module_key text,mode text);
 create table role_module_access(role_id text,system_key text,module_key text,mode text);
 create table role_permissions(role_id text,perm text,allowed boolean);
 insert into role_permissions values('reporter','sys_handover',true),('reporter','sys_meetingroom',true);
 create function active_user_id() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function active_rbac_role() returns text language sql stable as $$select case when public.active_user_id() is not null then coalesce(nullif(current_setting('test.role',true),''),'reporter') end$$;
 create function is_admin() returns boolean language sql stable as $$select public.active_rbac_role()='sysadmin'$$;
 create function handover_staff_markets(uuid,text) returns jsonb language sql stable as $$select '["market_1"]'::jsonb$$;
 create table meeting_bookings(booking_id int primary key,user_id uuid,note text);
 alter table meeting_bookings enable row level security;
 grant select,insert,update on meeting_bookings to authenticated;
 insert into meeting_bookings values(1,'${user}','own'),(2,'${other}','other');
 create table google_calendar_oauth_states(state_hash text);
 `);
 for(const name of ['has_system_access','has_module_access','has_handover_module_access']){
  const at=reconciliation.indexOf('create or replace function public.'+name+'('),end=reconciliation.indexOf('$$;',at)+3;
  assert.ok(at>=0&&end>at);await db.exec(reconciliation.slice(at,end));
 }
 const at=original.indexOf('    create policy meeting_bookings_authenticated_read'),end=original.indexOf('  end if;',at);
 await db.exec(original.slice(at,end));await db.exec(fix);await db.exec(fix);
 await db.exec(`create table business_probe(market_code text,note text);alter table business_probe enable row level security;
 create policy business_probe_policy on business_probe for all to authenticated using(public.business_market_allowed(market_code)) with check(public.business_market_allowed(market_code));
 grant select,insert,update on business_probe to authenticated;insert into business_probe values('market_1','one'),('market_2','two');
 set role authenticated;select set_config('test.actor','${user}',false);`);
 const visible=async table=>(await db.query('select * from '+table)).rows;
 assert.equal((await visible('meeting_bookings')).length,2);assert.equal((await visible('business_probe')).length,1);
 await db.exec(`insert into meeting_bookings values(3,'${user}','new');update meeting_bookings set note='edited' where booking_id=1;`);
 assert.equal((await db.query(`update meeting_bookings set note='bad' where booking_id=2 returning *`)).rows.length,0);
 await assert.rejects(db.exec(`insert into meeting_bookings values(4,'${other}','bad')`),/row-level security/);
 await db.exec(`reset role;insert into user_module_access values('${user}','meetingroom','bookings','deny'),('${user}','handover','business','deny');set role authenticated;`);
 assert.equal((await visible('meeting_bookings')).length,0);assert.equal((await visible('business_probe')).length,0);
 assert.equal((await db.query(`select business_market_allowed('market_1') allowed`)).rows[0].allowed,false);
 await assert.rejects(db.exec(`insert into meeting_bookings values(4,'${user}','denied')`),/row-level security/);
 await assert.rejects(db.exec(`insert into business_probe values('market_1','denied')`),/row-level security/);
 await db.exec(`reset role;update user_module_access set mode='allow';insert into user_system_access values('${user}','meetingroom','deny'),('${user}','handover','deny');set role authenticated;`);
 assert.equal((await visible('meeting_bookings')).length,0);assert.equal((await visible('business_probe')).length,0);
 await db.exec(`reset role;delete from user_system_access;set role authenticated;`);
 assert.equal((await visible('meeting_bookings')).length,3);assert.equal((await visible('business_probe')).length,1);
 await db.exec(`select set_config('test.actor','',false);`);
 assert.equal((await visible('meeting_bookings')).length,0);assert.equal((await visible('business_probe')).length,0);
 await db.exec(`select set_config('test.actor','${user}',false);select set_config('test.role','sysadmin',false);`);
 assert.equal((await visible('business_probe')).length,2);
 assert.equal((await db.query(`update meeting_bookings set note='admin' where booking_id=2 returning *`)).rows.length,1);
 await db.exec('reset role;set role anon;');
 await assert.rejects(db.query(`select business_market_allowed('market_1')`),/permission denied/);
 }finally{await db.close();}
});
