import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
const states=[],connections=[];let actor='A',externalCalls=0,googleSubject='victim-google-subject',denyUnique=false;
function query(table){
 let op='select',values,filters=[];
 const q={select(){return q},delete(){op='delete';return q},insert(v){op='insert';values=v;return q},upsert(v){op='upsert';values=v;return q},
 eq(k,v){filters.push(r=>r[k]===v);return q},gt(k,v){filters.push(r=>r[k]>v);return q},lt(k,v){filters.push(r=>r[k]<v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},gte(k,v){filters.push(r=>r[k]>=v);return q},
 maybeSingle(){return Promise.resolve(run(true))},then(resolve,reject){return Promise.resolve(run(false)).then(resolve,reject)}};
 function run(single){
  if(table==='users')return {data:{user_id:actor,status:'active',name:'synthetic'},error:null};
  const rows=table==='google_calendar_oauth_states'?states:table==='google_calendar_connections'?connections:[];
  if(op==='insert'||op==='upsert'){
   if(table==='google_calendar_connections'&&denyUnique)return {data:null,error:{code:'23505',message:'synthetic unique violation'}};
   rows.push({...values});return{data:null,error:null};
  }
  const hits=rows.filter(r=>filters.every(f=>f(r)));
  if(op==='delete')for(const row of hits)rows.splice(rows.indexOf(row),1);
  return {data:single?hits[0]??null:hits,error:null};
 }return q;
}
const admin={from:query},auth={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:async()=>({data:true,error:null})};
async function module(path){
 const output=await build({entryPoints:[path],bundle:true,write:false,platform:'neutral',format:'esm',plugins:[{name:'no-network-import',setup(b){b.onResolve({filter:/^https:\/\/esm.sh\//},()=>({path:'client',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=(...args)=>globalThis.reviewCreateClient(...args);'}));}}]});
 return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text+'\n//'+path).toString('base64'));
}
async function edge(path){
 globalThis.reviewCreateClient=(_url,key)=>key==='synthetic-service'?admin:auth;
 const env={SUPABASE_URL:'https://synthetic.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-anon',GOOGLE_CALENDAR_CLIENT_ID:'synthetic-client',GOOGLE_CALENDAR_CLIENT_SECRET:'synthetic-secret',GOOGLE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
 let fn;globalThis.Deno={env:{get:k=>env[k]},serve:x=>{fn=x}};await module(path);return fn;
}
const originalFetch=globalThis.fetch;
globalThis.fetch=async input=>{externalCalls++;const u=String(input);if(u==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',scope:'calendar'});if(u==='https://openidconnect.googleapis.com/v1/userinfo')return Response.json({sub:googleSubject,email:'synthetic@example.test',email_verified:true});throw Error('Unexpected external URL blocked');};
const signature=raw=>createHmac('sha256','synthetic-line-secret').update(raw).digest('base64');
const request=(raw,sig=signature(raw))=>new Request('https://synthetic.test/webhook',{method:'POST',headers:{'content-type':'application/json','x-line-signature':sig},body:raw});
const bot='U'+'b'.repeat(32),person='U'+'a'.repeat(32);
for(const version of ['original','current']){
 const {createVehicleLineWebhookHandler}=await module(version+'/supabase/functions/_shared/vehicle-line-webhook.ts');
 for(const kind of ['join','message','leave','multi-group','bad-signature','personal-LINK']){
  test(version+' signed LINE '+kind,async()=>{
   const writes=[],links=[],fetches=[];
   const store={ensureLinkSchema:async()=>{},loadChannelAccessToken:async()=> 'synthetic-token',saveGroupId:async g=>writes.push(g),consumeLinkIntent:async x=>{links.push(x);return{outcome:'ready',userId:'synthetic-user'}},completeAccountLink:async()=> 'linked'};
   const fetcher=async(input,init)=>{const url=String(input);fetches.push(url);if(url==='https://api.line.me/v2/bot/info')return Response.json({userId:bot});if(url==='https://api.line.me/v2/bot/user/'+person+'/linkToken')return Response.json({linkToken:'syntheticLinkToken000001'});if(url==='https://api.line.me/v2/bot/message/push')return new Response(null,{status:200});throw Error('External request blocked')};
   const handler=createVehicleLineWebhookHandler({channelSecret:()=> 'synthetic-line-secret',createStore:()=>store,fetcher});
   const group=type=>({type,source:{type:'group',groupId:'synthetic-unapproved-group'},message:{type:'text',text:'hello'}});
   const events=kind==='personal-LINK'?[{type:'message',source:{type:'user',userId:person},message:{type:'text',text:'LINK-'+'C'.repeat(32)}}]:kind==='multi-group'?[group('join'),{...group('message'),source:{type:'group',groupId:'synthetic-second-group'}}]:[group(kind==='bad-signature'?'message':kind)];
   const raw=JSON.stringify({destination:bot,events});
   const response=await handler(request(raw,kind==='bad-signature'?'invalid':signature(raw)));
   assert.equal(response.status,kind==='bad-signature'?401:200);
   if(kind==='bad-signature'){assert.equal(writes.length,0);assert.equal(fetches.length,0)}
   else if(kind==='personal-LINK'){assert.equal(links.length,1);assert.equal(writes.length,0);assert.equal(fetches.length,3)}
   else assert.equal(writes.length,version==='original'?(kind==='multi-group'?2:1):0);
  });
 }
}
const oldApi=await edge('original/supabase/functions/google-calendar/index.ts'),oldCallback=await edge('original/supabase/functions/google-calendar-callback/index.ts');
const newApi=await edge('current/supabase/functions/google-calendar/index.ts'),newCallback=await edge('current/supabase/functions/google-calendar-callback/index.ts');
const call=(fn,action,payload={})=>fn(new Request('https://synthetic.test/functions/v1/google-calendar',{method:'POST',headers:{authorization:'Bearer synthetic','content-type':'application/json','user-agent':'identical-UA'},body:JSON.stringify({action,...payload})}));
const hash=async v=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))).toString('base64url');
const reset=()=>{states.length=0;connections.length=0;actor='A';externalCalls=0;denyUnique=false};
const verifier='v'.repeat(43);
test('original callback binds consenting Google identity to initiating system user under assumed audience',async()=>{
 reset();const start=await(await call(oldApi,'oauth_start')).json();const state=new URL(start.data.url).searchParams.get('state');actor='B';
 const response=await oldCallback(new Request('https://synthetic.test/callback?'+new URLSearchParams({state,code:'synthetic-code'}),{headers:{'user-agent':'identical-UA'}}));
 assert.equal(response.status,302);assert.equal(new URL(response.headers.get('location')).searchParams.get('google_calendar'),'connected');
 assert.equal(connections.length,1);assert.equal(connections[0].user_id,'A');assert.equal(connections[0].google_subject,'victim-google-subject');assert.equal(externalCalls,2);
});
for(const kind of ['wrong-UA','expired']){
 test('original callback rejects '+kind,async()=>{
  reset();const start=await(await call(oldApi,'oauth_start')).json();const state=new URL(start.data.url).searchParams.get('state');
  if(kind==='expired')states[0].expires_at='2000-01-01T00:00:00.000Z';
  const response=await oldCallback(new Request('https://synthetic.test/callback?'+new URLSearchParams({state,code:'synthetic-code'}),{headers:{'user-agent':kind==='wrong-UA'?'other-UA':'identical-UA'}}));
  assert.equal(new URL(response.headers.get('location')).searchParams.get('google_calendar'),'oauth_failed');assert.equal(connections.length,0);assert.equal(externalCalls,0);
 });
}
test('fixed callback non-mutating; wrong actor/verifier denied; valid flow and concurrent replay',async()=>{
 reset();const start=await(await call(newApi,'oauth_start',{browser_verifier_hash:await hash(verifier)})).json();const state=start.data.state;
 const response=await newCallback(new Request('https://synthetic.test/callback?'+new URLSearchParams({state,code:'synthetic-code'})));
 assert.equal(response.status,302);assert.equal(connections.length,0);assert.equal(externalCalls,0);assert.equal(states.length,1);
 const payload={state,code:'synthetic-code',browser_verifier:verifier};
 actor='B';assert.equal((await call(newApi,'oauth_finish',payload)).status,400);assert.equal(states.length,1);
 actor='A';assert.equal((await call(newApi,'oauth_finish',{...payload,browser_verifier:'x'.repeat(43)})).status,400);assert.equal(externalCalls,0);
 const responses=await Promise.all([call(newApi,'oauth_finish',payload),call(newApi,'oauth_finish',payload)]);
 assert.deepEqual(responses.map(x=>x.status).sort(),[200,400]);assert.equal(connections.length,1);assert.equal(externalCalls,2);
});
test('fixed expiry and simulated unique-index error never create a connection',async()=>{
 reset();let start=await(await call(newApi,'oauth_start',{browser_verifier_hash:await hash(verifier)})).json();states[0].expires_at='2000-01-01T00:00:00.000Z';
 assert.equal((await call(newApi,'oauth_finish',{state:start.data.state,code:'synthetic-code',browser_verifier:verifier})).status,400);assert.equal(externalCalls,0);
 reset();start=await(await call(newApi,'oauth_start',{browser_verifier_hash:await hash(verifier)})).json();denyUnique=true;
 const response=await call(newApi,'oauth_finish',{state:start.data.state,code:'synthetic-code',browser_verifier:verifier});
 assert.ok(response.status>=400);assert.equal(connections.length,0);
});
