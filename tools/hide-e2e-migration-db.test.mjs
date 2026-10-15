// 驗證 20261016090000_hide_e2e_test_workorders.sql：
// 1. 重現根因：runbook 步驟 2 的 UPDATE 在沒有登入者時會被保護觸發器擋下。
// 2. migration 在同一交易內暫停觸發器、只隱藏指定 3 組，結束後觸發器恢復且仍會擋一般更新。
// 3. 重跑無副作用；空資料庫略過；資料不完整或負責人不符時整筆回滾。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261016090000_hide_e2e_test_workorders.sql', import.meta.url), 'utf8');

const ORDERS = ['8b152df7-0a27-4b84-9129-cd3f0edbbee7', '39b209fd-fee7-4077-98a8-461e6ba18102', 'ccab8940-54d5-46dd-82c8-99c5a0ceadd6'];
const REQUESTS = ['1fafba76-0224-41a0-b432-dd819ff7f44a', 'd0843f78-4d64-4872-978a-06dfa0ee31a5', '78b39f04-bb29-47b6-a7f5-083af0b8bc8b'];
const E2E_USER = '00000000-0000-0000-0000-0000000000e2';
const REAL_USER = '00000000-0000-0000-0000-0000000000aa';
const OTHER_ORDER = '00000000-0000-0000-0000-00000000000b';

// 正式環境的保護邏輯摘要：沒有登入者時 can_manage_workorder() 為 false、角色為 NULL，任何更新都會被拒絕。
const SCHEMA = `
  create table users(user_id uuid primary key, name text, status text);
  create table repair_requests(request_id uuid primary key, status text, hidden boolean default false);
  create table maintenance_orders(order_id uuid primary key, request_id uuid, assignee_id uuid, status text, hidden boolean default false);
  create function can_manage_workorder() returns boolean language sql as $$ select false $$;
  create function protect_technician_order_columns() returns trigger language plpgsql as $$
  begin
    if can_manage_workorder() then return new; end if;
    raise exception 'order update is not allowed for this role' using errcode = '42501';
  end $$;
  create trigger trg_protect_technician_order_columns before update on maintenance_orders
    for each row execute function protect_technician_order_columns();
  create function protect_repair_request_columns() returns trigger language plpgsql as $$
  begin
    if can_manage_workorder() then return new; end if;
    if (to_jsonb(new) - array['status','updated_at']) is distinct from (to_jsonb(old) - array['status','updated_at']) then
      raise exception 'repair request master fields are immutable for this role' using errcode = '42501';
    end if;
    return new;
  end $$;
  create trigger trg_protect_repair_request_columns before update on repair_requests
    for each row execute function protect_repair_request_columns();
  create function forbid_status_change() returns trigger language plpgsql as $$
  begin raise exception 'status must not change in this migration'; end $$;
  create trigger trg_maintenance_order_state_guard before update of status on maintenance_orders
    for each row execute function forbid_status_change();
`;

async function freshDb({ orders = 3, assignee = E2E_USER } = {}) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.query(`insert into users values ($1, 'PO E2E 維修測試', 'inactive'), ($2, '一般維修人員', 'active')`, [E2E_USER, REAL_USER]);
  for (let i = 0; i < orders; i += 1) {
    await db.query(`insert into repair_requests values ($1, 'closed', true)`, [REQUESTS[i]]);
    await db.query(`insert into maintenance_orders values ($1, $2, $3, 'closed', false)`, [ORDERS[i], REQUESTS[i], assignee]);
  }
  // 一筆不相干的正式工單，migration 不得碰它。
  await db.query(`insert into maintenance_orders values ($1, null, $2, 'closed', false)`, [OTHER_ORDER, REAL_USER]);
  return db;
}

const hiddenCount = async (db, table, key, ids) =>
  Number((await db.query(`select count(*)::int as n from ${table} where ${key} = any($1::uuid[]) and hidden`, [ids])).rows[0].n);
const triggerStates = async db =>
  (await db.query(`select tgname, tgenabled from pg_trigger where tgname like 'trg_protect_%' order by tgname`)).rows
    .map(row => `${row.tgname}:${row.tgenabled}`);
const ENABLED = ['trg_protect_repair_request_columns:O', 'trg_protect_technician_order_columns:O'];

// 1. 根因：runbook 步驟 2 的寫法會被擋。
{
  const db = await freshDb();
  await assert.rejects(
    db.exec(`update maintenance_orders set hidden = true where assignee_id = '${E2E_USER}' and coalesce(hidden, false) = false`),
    /order update is not allowed for this role/,
  );
  assert.equal(await hiddenCount(db, 'maintenance_orders', 'order_id', ORDERS), 0);
  await db.close();
}

// 2. 正式環境情境：工單未隱藏、報修案件已隱藏。
{
  const db = await freshDb();
  await db.exec(migration);
  assert.equal(await hiddenCount(db, 'maintenance_orders', 'order_id', ORDERS), 3);
  assert.equal(await hiddenCount(db, 'repair_requests', 'request_id', REQUESTS), 3);
  assert.equal(await hiddenCount(db, 'maintenance_orders', 'order_id', [OTHER_ORDER]), 0, '不相干的工單不得被隱藏');
  assert.deepEqual(await triggerStates(db), ENABLED, '保護觸發器必須重新啟用');
  await assert.rejects(
    db.exec(`update maintenance_orders set hidden = false where order_id = '${ORDERS[0]}'`),
    /order update is not allowed for this role/,
    'migration 之後一般更新仍要被保護觸發器擋下',
  );

  // 3. 重跑沒有副作用。
  await db.exec(migration);
  assert.equal(await hiddenCount(db, 'maintenance_orders', 'order_id', ORDERS), 3);
  assert.deepEqual(await triggerStates(db), ENABLED);
  await db.close();
}

// 4. 全新或其他環境：沒有目標資料就略過，不報錯。
{
  const db = await freshDb({ orders: 0 });
  await db.exec(migration);
  assert.equal(await hiddenCount(db, 'maintenance_orders', 'order_id', [OTHER_ORDER]), 0);
  assert.deepEqual(await triggerStates(db), ENABLED);
  await db.close();
}

// 5. 只找到部分：整筆回滾，什麼都不改，觸發器維持啟用。
{
  const db = await freshDb({ orders: 2 });
  await assert.rejects(db.exec(migration), /預期 3 筆 E2E 測試工單，實際符合 2 筆/);
  await db.exec('rollback');
  assert.equal(await hiddenCount(db, 'maintenance_orders', 'order_id', ORDERS), 0);
  assert.deepEqual(await triggerStates(db), ENABLED);
  await db.close();
}

// 6. 負責人不是 E2E 測試帳號：拒絕執行。
{
  const db = await freshDb({ assignee: REAL_USER });
  await assert.rejects(db.exec(migration), /實際符合 0 筆/);
  await db.exec('rollback');
  assert.equal(await hiddenCount(db, 'maintenance_orders', 'order_id', ORDERS), 0);
  assert.deepEqual(await triggerStates(db), ENABLED);
  await db.close();
}

console.log('hide_e2e_test_workorders migration 測試通過：根因重現、只隱藏 3 組、觸發器復原、重跑安全、異常回滾。');
