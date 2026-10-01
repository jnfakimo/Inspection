import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = readFileSync(new URL('../supabase/migrations/20261001173000_guard_form_drafts.sql', import.meta.url), 'utf8');
const first = '00000000-0000-0000-0000-000000000001';
const second = '00000000-0000-0000-0000-000000000002';
const otherMarket = '00000000-0000-0000-0000-000000000003';
const query = (sql, args = []) => db.query(sql, args);
const actor = user => query("select set_config('test.actor',$1,false)", [user]);
const insert = (owner, market = 'market_1', content = { duty_summary: '輸入到一半' }) =>
  query(`insert into public.guard_handover_form_drafts(owner_id,market_code,duty_date,shift_name,content)
    values($1,$2,'2026-10-01','早班',$3::jsonb)`, [owner, market, JSON.stringify(content)]);

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.users(user_id uuid primary key);
    create table public.guard_handover_logs(log_id uuid primary key);
    create table public.guard_handover_corrections(correction_id uuid primary key);
    create table public.guard_handover_daily_approvals(approval_id uuid primary key);
    grant select on public.guard_handover_logs,public.guard_handover_corrections,public.guard_handover_daily_approvals to authenticated;
    create function public.active_user_id() returns uuid language sql stable as
      $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function public.guard_market_allowed(p_market text) returns boolean language sql stable as
      $$select p_market=case when public.active_user_id()='${otherMarket}'::uuid then 'market_2' else 'market_1' end$$;
    create function public.has_handover_module_access(p_module text) returns boolean language sql stable as
      $$select p_module='guard' and public.active_user_id()<>'${second}'::uuid$$;
    insert into public.users values ('${first}'),('${second}'),('${otherMarket}');
  `);
  await db.exec(migration);
  await db.exec(migration);
  await db.exec('set role authenticated');
  await actor(first);
  await assert.rejects(query('select * from public.guard_handover_logs'), /permission denied/);
  await assert.rejects(query('select * from public.guard_handover_corrections'), /permission denied/);
  await assert.rejects(query('select * from public.guard_handover_daily_approvals'), /permission denied/);
  await insert(first);
  const replaced = await query(`insert into public.guard_handover_form_drafts(owner_id,market_code,duty_date,shift_name,content)
    values($1,'market_1','2026-10-01','早班',$2::jsonb)
    on conflict(owner_id,market_code,duty_date,shift_name) do update set content=excluded.content
    returning content`, [first, JSON.stringify({ duty_summary: '續填內容' })]);
  assert.equal(replaced.rows[0].content.duty_summary, '續填內容');
  let row = (await query('select content,updated_at,expires_at from public.guard_handover_form_drafts')).rows[0];
  assert.equal(row.content.duty_summary, '續填內容');
  assert.ok(Date.parse(row.expires_at) - Date.parse(row.updated_at) > 13 * 86400000);
  await assert.rejects(insert(first, 'market_2'), /row-level security/);
  await assert.rejects(insert(otherMarket), /row-level security/);
  await assert.rejects(query('update public.guard_handover_form_drafts set owner_id=$1', [otherMarket]), /不可變更/);
  await assert.rejects(query('update public.guard_handover_form_drafts set content=$1::jsonb', [JSON.stringify({ text: 'x'.repeat(263000) })]), /guard_form_draft_content/);
  await query("update public.guard_handover_form_drafts set content='{}'::jsonb,is_active=false");
  row = (await query('select content,is_active from public.guard_handover_form_drafts')).rows[0];
  assert.deepEqual(row.content, {});
  assert.equal(row.is_active, false);
  await assert.rejects(query('delete from public.guard_handover_form_drafts'), /permission denied/);
  await actor(otherMarket);
  assert.equal((await query('select count(*)::int n from public.guard_handover_form_drafts')).rows[0].n, 0);
  await insert(otherMarket, 'market_2');
  await actor(second);
  assert.equal((await query('select count(*)::int n from public.guard_handover_form_drafts')).rows[0].n, 0);
  await assert.rejects(insert(second), /row-level security/);
  console.log('駐警文字暫存 DB 通過：冪等 migration、本人權限、市場隔離、欄位與容量限制、停用及保留期限。');
} finally { await db.close(); }
