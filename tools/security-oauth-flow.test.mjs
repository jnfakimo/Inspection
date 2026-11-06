import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
const states=[],connections=[];let actor='A',externalCalls=0;
function query(table){
 let op='select',values,filters=[];
 const q={select(){return q;},delete(){op='delete';return q;},insert(v){op='insert';values=v;return q;},upsert(v){op='upsert';values=v;return q;},
 eq(k,v){filters.push(r=>r[k]===v);return q;},gt(k,v){filters.push(r=>r[k]>v);return q;},lt(k,v){filters.push(r=>r[k]<v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},gte(k,v){filters.push(r=>r[k]>=v);return q;},
 maybeSingle(){return Promise.resolve(run(true));},then(resolve,reject){return Promise.resolve(run(false)).then(resolve,reject);}};
 function run(single){
  if(table==='users')return{data:{user_id:actor,status:'active',name:'synthetic'},error:null};
  const rows=table==='google_calendar_oauth_states'?states:table==='google_calendar_connections'?connections:[];
  if(op==='insert'||op==='upsert'){rows.push({...values});return{data:null,error:null};}
  const hits=rows.filter(r=>filters.every(f=>f(r)));
  if(op==='delete')for(const hit of hits)rows.splice(rows.indexOf(hit),1);
  return{data:single?hits[0]??null:hits,error:null};
 }
 return q;
}
const admin={from:query};
const auth={auth:{getUser:async()=>({data:{user:{id:actor}},error:null})},rpc:async()=>({data:true,error:null})};
async function handler(path){
 globalThis.securityTestCreateClient=(_url,key)=>key==='synthetic-service'?admin:auth;
 const env={SUPABASE_URL:'https://synthetic.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-anon',GOOGLE_CALENDAR_CLIENT_ID:'synthetic-client',GOOGLE_CALENDAR_CLIENT_SECRET:'synthetic-secret',GOOGLE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')};
 let result;
 globalThis.Deno={env:{get:key=>env[key]},serve:fn=>{result=fn;}};
 const output=await build({entryPoints:[path],bundle:true,write:false,platform:'neutral',format:'esm',plugins:[{name:'synthetic-client',setup(b){b.onResolve({filter:/^https:\/\/esm.sh\//},()=>({path:'client',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const createClient=(...args)=>globalThis.securityTestCreateClient(...args);'}));}}]});
 await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text+'\n//'+path).toString('base64'));
 return result;
}
const digest=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('base64url');
test('actual OAuth handlers require original account/browser, reject replay/expiry and keep callback non-mutating',async()=>{
 const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno;
 try{
 const api=await handler('supabase/functions/google-calendar/index.ts'),callback=await handler('supabase/functions/google-calendar-callback/index.ts');
 globalThis.fetch=async input=>{externalCalls++;const url=String(input);if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',scope:'calendar'});if(url==='https://openidconnect.googleapis.com/v1/userinfo')return Response.json({sub:'google-owner',email:'synthetic@example.test',email_verified:true});throw Error('Unexpected request');};
 const call=(action,payload={})=>api(new Request('https://synthetic.test/functions/v1/google-calendar',{method:'POST',headers:{authorization:'Bearer synthetic','content-type':'application/json','user-agent':'identical-UA'},body:JSON.stringify({action,...payload})}));
 const verifier='v'.repeat(43),hash=await digest(verifier);
 assert.equal((await call('oauth_start')).status,400);
 const response=await call('oauth_start',{browser_verifier_hash:hash,return_to:'https://jnfakimo.github.io/Inspection/v2/systems/meetingroom/bookings/'});
 assert.equal(response.status,200);const {data}=await response.json();const state=data.state;
 const redirected=await callback(new Request('https://synthetic.test/callback?'+new URLSearchParams({state,code:'synthetic-code'})));
 assert.equal(redirected.status,302);assert.equal(externalCalls,0);assert.equal(connections.length,0);assert.equal(states.length,1);
 const returnUrl=new URL(redirected.headers.get('location'));assert.equal(returnUrl.searchParams.get('code'),null);assert.equal(new URLSearchParams(returnUrl.hash.slice(1)).get('code'),'synthetic-code');
 const payload={state,code:'synthetic-code',browser_verifier:verifier};
 actor='B';assert.equal((await call('oauth_finish',payload)).status,400);assert.equal(states.length,1);
 actor='A';assert.equal((await call('oauth_finish',{...payload,browser_verifier:'w'.repeat(43)})).status,400);assert.equal(states.length,1);assert.equal(externalCalls,0);
 assert.equal((await call('oauth_finish',payload)).status,200);assert.equal(states.length,0);assert.equal(connections.length,1);assert.equal(connections[0].user_id,'A');assert.equal(externalCalls,2);
 assert.equal((await call('oauth_finish',payload)).status,400);assert.equal(externalCalls,2);
 const next=await(await call('oauth_start',{browser_verifier_hash:hash,return_to:'https://evil.test/'})).json();states[0].expires_at='2000-01-01T00:00:00.000Z';
 assert.equal((await call('oauth_finish',{...payload,state:next.data.state})).status,400);
 assert.equal(externalCalls,2);assert.equal(connections.length,1);
 }finally{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;delete globalThis.securityTestCreateClient;}
});
