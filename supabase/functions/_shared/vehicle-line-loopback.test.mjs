import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { createVehicleDispatchLineWorkerHandler } from './vehicle-dispatch-line-worker.ts';
import { sendLineTextMessage } from './line-message.ts';

const driver = '10000000-0000-4000-8000-000000000001';
const request = '20000000-0000-4000-8000-000000000001';
const vehicle = '30000000-0000-4000-8000-000000000001';
const start = '2026-10-29T00:00:00.000Z';

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table users(user_id uuid primary key,status text not null,username text not null,name text not null);
    create table vehicle_dispatch_drivers(user_id uuid primary key references users(user_id),active boolean not null);
    create table vehicle_dispatch_requests(request_id uuid primary key,status text not null,driver_id uuid references users(user_id),vehicle_id uuid,dispatch_note text);
    insert into users values('${driver}','active','synthetic','Synthetic Driver');
    insert into vehicle_dispatch_drivers values('${driver}',true);`);
  for (const file of ['20261008070454_vehicle_driver_line_notifications.sql', '20261008071250_vehicle_dispatch_line_outbox.sql',
    '20261008072136_vehicle_driver_line_link_start.sql', '20261008073738_vehicle_dispatch_line_worker_leases.sql', '20261008081918_vehicle_personal_line_notifications.sql']) {
    await db.exec(await readFile(new URL('../../migrations/' + file, import.meta.url), 'utf8'));
  }
  await db.query('select save_vehicle_line_notification_settings(true,true,true,false,null,$1)', [driver]);
  await db.exec(`insert into vehicle_driver_line_bindings(user_id,line_user_id,state,consented_at,linked_at)
    values('${driver}','Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','linked',now(),now());
    insert into vehicle_dispatch_requests(request_id,status) values('${request}','approved');
    update vehicle_dispatch_requests set status='assigned',driver_id='${driver}',vehicle_id='${vehicle}' where request_id='${request}';`);
  await db.query('update vehicle_dispatch_notification_outbox set next_attempt_at=$1', [start]);
  return db;
}

function storeFor(db) {
  const rows = async (sql, args) => (await db.query(sql, args)).rows;
  const forbidden = async () => { throw new Error('test-mode RPC not expected'); };
  return {
    loadChannelAccessToken: async () => 'synthetic-token',
    claim: ({limit,leaseSeconds,now}) => rows('select * from claim_vehicle_dispatch_line_notifications($1,$2,$3)', [limit,leaseSeconds,now]),
    prepare: async ({outboxId,leaseToken,now}) => (await rows('select * from prepare_vehicle_dispatch_line_notification($1,$2,$3)', [outboxId,leaseToken,now]))[0],
    finish: async i => (await rows('select finish_vehicle_dispatch_line_notification($1,$2,$3,$4,$5,$6,$7,$8) as result',
      [i.outboxId,i.leaseToken,i.resolution,i.httpStatus,i.errorCode,i.nextAttemptAt,i.acceptedRequestId,i.now]))[0].result,
    claimTest: forbidden, prepareTest: forbidden, finishTest: forbidden,
  };
}

test('isolated SQL outbox → worker → loopback HTTP → durable retry outcomes', async t => {
  for (const scenario of [
    {name:'503 then duplicate acceptance', responses:[503,409], acceptedId:true, expected:'accepted'},
    {name:'connection loss then acceptance', responses:['reset',200], expected:'accepted'},
    {name:'timeout then acceptance', responses:['timeout',200], expected:'accepted'},
    {name:'429 is not automatically retried', responses:[429], expected:'dead_letter'},
    {name:'409 without provider acceptance ID stays uncertain', responses:[409], expected:'uncertain'},
  ]) await t.test(scenario.name, async () => {
    const db = await database(), requests = [];
    let clock = new Date(start);
    const server = createServer(async (req,res) => {
      const chunks=[]; for await (const chunk of req) chunks.push(chunk);
      requests.push({key:req.headers['x-line-retry-key'],body:Buffer.concat(chunks).toString()});
      const status=scenario.responses[requests.length-1];
      if(status==='reset') { req.socket.destroy(); return; }
      if(status==='timeout') return;
      res.writeHead(status, scenario.acceptedId ? {'x-line-accepted-request-id':'synthetic-accepted-id'} : {});
      res.end('synthetic private provider body');
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin=`http://127.0.0.1:${server.address().port}`;
    const handler=createVehicleDispatchLineWorkerHandler({cronSecret:()=>'synthetic-cron',createStore:()=>storeFor(db),now:()=>clock,random:()=>0,
      sendMessage:input=>sendLineTextMessage({...input,timeoutMs:500,fetcher:(url,init)=>{
        assert.equal(String(url),'https://api.line.me/v2/bot/message/push');
        return fetch(origin,{...init,redirect:'error'});
      }}),
    });
    const run=()=>handler(new Request(origin,{method:'POST',headers:{'x-cron-secret':'synthetic-cron'},body:'{}'}));
    const state=async()=>(await db.query('select state,attempts,next_attempt_at,retry_key from vehicle_dispatch_notification_outbox')).rows[0];
    try {
      assert.equal((await handler(new Request(origin,{method:'POST'}))).status,401);
      assert.equal(requests.length,0);
      assert.equal((await run()).status,200);
      if(scenario.responses.length===2) {
        const waiting=await state(); assert.equal(waiting.state,'retry_wait'); assert.equal(waiting.attempts,1);
        await run(); assert.equal(requests.length,1); // Not yet due.
        clock=new Date(new Date(waiting.next_attempt_at).getTime()+1);
        await run(); assert.equal(requests.length,2);
        assert.deepEqual(requests[0],requests[1]); // Same retry key, recipient and body.
      }
      const finished=await state(); assert.equal(finished.state,scenario.expected);
      assert.equal(finished.attempts,scenario.responses.length);
      await run(); assert.equal(requests.length,scenario.responses.length);
    } finally {
      server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await db.close();
    }
  });
});
