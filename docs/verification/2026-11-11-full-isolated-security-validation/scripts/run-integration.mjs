import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomInt,randomUUID,createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
const root=import.meta.dirname+'/..';const cfg=JSON.parse(fs.readFileSync(root+'/.local/config.json','utf8'));
assert.equal(cfg.API_URL,'http://127.0.0.1:55440');
const checks=[];let phase='setup';const tokens={};
const localFetch=globalThis.fetch;
globalThis.fetch=(input,options)=>{const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.origin,cfg.API_URL,'nonlocal HTTP blocked');return localFetch(input,options)};
const admin=createClient(cfg.API_URL,cfg.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
function sql(query){const r=spawnSync('wsl',['-d','Inspection-test','-u','root','--','docker','exec','-i','inspection_v111_db_v2','psql','-h','/tmp','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input:query,encoding:'utf8',maxBuffer:5e6});if(r.status!==0){fs.writeFileSync(root+'/.local/sql-last-error.txt',r.stderr);throw Error('SQL failed; private diagnostic saved')}return r.stdout.trim();}
const sq=v=>"'"+String(v).replaceAll("'","''")+"'";
async function req(path,{method='GET',body,token,service=false,binary=false,headers={}}={}){
 const key=service?cfg.SERVICE_ROLE_KEY:cfg.ANON_KEY;
 const r=await fetch(cfg.API_URL+path,{method,headers:{apikey:key,Authorization:'Bearer '+(token||key),...(body&&!binary?{'Content-Type':'application/json'}:{}),Prefer:'return=representation',...headers},body:body===undefined?undefined:binary?body:JSON.stringify(body)});
 const data=await r.text();let parsed;try{parsed=JSON.parse(data)}catch{parsed=data}
 return {status:r.status,data:parsed};
}
function check(name,condition,details){checks.push({phase,name,pass:!!condition,...(details?{details}: {})});if(!condition){fs.writeFileSync(root+'/.local/failed-check.json',JSON.stringify({name,details},null,2));throw Error(name)}}
const api=(token,body)=>req('/functions/v1/app-api',{method:'POST',token,body});
const oauth=(token,body)=>req('/functions/v1/google-calendar',{method:'POST',token,body});
const hash=v=>createHash('sha256').update(v).digest('base64url');
const fileHash=b=>createHash('sha256').update(b).digest('hex');
let accounts;
try{
 const existing=root+'/.local/accounts.json';
 if(fs.existsSync(existing))accounts=JSON.parse(fs.readFileSync(existing,'utf8'));
 else{
  accounts={};
  for(const name of ['A','B']){
   const email='isolated-v111-'+name.toLowerCase()+'@example.invalid',password=String(randomInt(10000000,100000000));
   const r=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{purpose:'v111-isolated-synthetic-test'}});
   check('actual Auth creates synthetic '+name,!r.error);accounts[name]={email,password,auth_id:r.data.user.id,user_id:randomUUID()};
   fs.writeFileSync(existing,JSON.stringify(accounts));
  }
 }
 for(const name of ['A','B']){
  const r=await req('/auth/v1/token?grant_type=password',{method:'POST',body:{email:accounts[name].email,password:accounts[name].password}});
  check('actual Auth password login '+name,r.status===200&&!!r.data.access_token);
  tokens[name]=r.data.access_token;const claims=JSON.parse(Buffer.from(tokens[name].split('.')[1],'base64url'));
  check('real Auth session stored '+name,sql("select exists(select 1 from auth.sessions where id="+sq(claims.session_id)+"::uuid and user_id="+sq(accounts[name].auth_id)+"::uuid)")==='t');
 }
 const A=accounts.A.user_id,B=accounts.B.user_id;
 const supervisor=sql("select user_id from users where rbac_role='sysadmin' and status='active' order by user_id limit 1" );
 const dept=sql("select dept_id from public.departments where code='MKT1-ADMIN' and status='active' limit 1");assert.ok(dept);
 for(const name of ['A','B']){
  const a=accounts[name];sql("insert into public.users(user_id,auth_id,username,email,name,role,rbac_role,status,dept_id,department,supervisor_id,permissions) values("+[a.user_id,a.auth_id,'isolated_v111_'+name.toLowerCase(),a.email,'隔離 V1.0.11 '+name,'inspector','reporter','active',dept,'隔離業管',supervisor,'{}'].map(sq).join(',')+") on conflict(user_id) do nothing");
  for(const sys of ['handover','meetingroom'])sql("insert into public.user_system_access(user_id,system_key,mode,granted_by) values("+sq(a.user_id)+","+sq(sys)+",'allow',"+sq(A)+") on conflict(user_id,system_key) do update set mode='allow'");
  for(const [sys,module]of [['handover','business'],['handover','guard'],['meetingroom','bookings']])sql("insert into public.user_module_access(user_id,system_key,module_key,mode,granted_by) values("+[a.user_id,sys,module,name==='A'?'allow':'deny',A].map(sq).join(',')+") on conflict(user_id,system_key,module_key) do update set mode=excluded.mode");
 }
 const fixtureFile=root+'/.local/fixture.json';let f;
 if(fs.existsSync(fixtureFile))f=JSON.parse(fs.readFileSync(fixtureFile));
 else{f={room:randomUUID(),bookingA:randomUUID(),bookingB:randomUUID(),entry:randomUUID(),date:sql("select (current_date+2)::text"),incident:randomUUID(),object:randomUUID()};fs.writeFileSync(fixtureFile,JSON.stringify(f))}
 sql("insert into meeting_rooms(room_id,name) values("+sq(f.room)+",'隔離 V111 會議室') on conflict(room_id) do nothing");
 sql("insert into meeting_bookings(booking_id,room_id,user_id,booking_date,start_time,end_time,purpose,contact_phone) values("+[f.bookingA,f.room,A,f.date,'09:00','09:30','隔離 V111 A','0900000000'].map(sq).join(',')+"),("+[f.bookingB,f.room,B,f.date,'10:00','10:30','隔離 V111 B','0900000000'].map(sq).join(',')+") on conflict(booking_id) do nothing");
 if(sql("select count(*) from business_handover_entries where entry_id="+sq(f.entry))==='0'){
  const seeded=await req('/rest/v1/business_handover_entries',{method:'POST',token:tokens.A,body:{entry_id:f.entry,market_code:'market_1',handover_date:f.date,shift_code:'01-09',category:'其他',description:'隔離 V111 業管',created_by:A,updated_by:A}});
  check('real authorized actor seeds business fixture',seeded.status===201,{status:seeded.status,code:seeded.data.code,message:seeded.data.message});
 }
 phase='full-schema-auth';
 for(const name of ['A','B']){
  let r=await req('/rest/v1/rpc/active_user_id',{method:'POST',body:{},token:tokens[name]});check('active_user_id maps actual JWT '+name,r.status===200&&r.data===accounts[name].user_id);
  check('same business market qualification '+name,sql("select handover_staff_markets("+sq(accounts[name].user_id)+",'business')::text").includes('market_1'));
  r=await req('/rest/v1/rpc/security_session_allowed',{method:'POST',body:{},token:tokens[name]});check('actual session gate allows '+name,r.status===200&&r.data===true);
 }
 let r=await req('/rest/v1/meeting_bookings?room_id=eq.'+f.room+'&select=booking_id,purpose',{token:tokens.A});check('allowed A reads real meeting table',r.status===200&&r.data.length===2);
 r=await req('/rest/v1/meeting_bookings?room_id=eq.'+f.room+'&select=booking_id,purpose',{token:tokens.B});check('denied B cannot read same meeting rows',r.status===200&&r.data.length===0);
 r=await req('/rest/v1/meeting_bookings?booking_id=eq.'+f.bookingB,{method:'PATCH',body:{purpose:'should-not-change'},token:tokens.B});check('denied B own booking update changes zero rows',r.status===200&&r.data.length===0);
 check('B booking retained after denial',sql("select purpose from meeting_bookings where booking_id="+sq(f.bookingB))==='隔離 V111 B');
 r=await req('/rest/v1/meeting_bookings?booking_id=eq.'+f.bookingA,{method:'PATCH',body:{purpose:'隔離 V111 A 正常更新'},token:tokens.A});check('allowed A updates own booking',r.status===200&&r.data.length===1);
 r=await req('/rest/v1/meeting_bookings?booking_id=eq.'+f.bookingB,{method:'PATCH',body:{purpose:'should-not-change'},token:tokens.A});check('allowed A cannot update B booking',r.status===200&&r.data.length===0);
 const newBooking={room_id:f.room,user_id:B,booking_date:f.date,start_time:'11:00',end_time:'11:30',purpose:'denied',contact_phone:'0900000000'};
 r=await req('/rest/v1/meeting_bookings',{method:'POST',body:newBooking,token:tokens.B});check('denied B cannot insert booking',r.status===403,{status:r.status,code:r.data.code});
 r=await req('/rest/v1/business_handover_entries?entry_id=eq.'+f.entry+'&select=entry_id,description',{token:tokens.A});check('allowed A reads full business table',r.status===200&&r.data.length===1);
 r=await req('/rest/v1/business_handover_entries?entry_id=eq.'+f.entry+'&select=entry_id,description',{token:tokens.B});check('qualified-market denied B cannot read business rows',r.status===200&&r.data.length===0);
 r=await req('/rest/v1/rpc/business_market_day',{method:'POST',body:{p_market:'market_1',p_date:f.date},token:tokens.B});check('real SECURITY DEFINER business day RPC rejects B',r.status>=400,{status:r.status,code:r.data.code});
 r=await req('/rest/v1/rpc/business_market_day',{method:'POST',body:{p_market:'market_1',p_date:f.date},token:tokens.A});check('real business day RPC accepts A',r.status===200);
 r=await req('/rest/v1/rpc/business_market_allowed',{method:'POST',body:{p_market:'market_2'},token:tokens.A});check('A cannot cross to unassigned market',r.status===200&&r.data===false);
 const claims=JSON.parse(Buffer.from(tokens.B.split('.')[1],'base64url'));
 sql("insert into security_session_blocks(session_id,user_id) values("+sq(claims.session_id)+","+sq(B)+") on conflict(session_id) do nothing");
 r=await req('/rest/v1/rpc/active_user_id',{method:'POST',body:{},token:tokens.B});check('real persisted session block invalidates B identity',r.status===200&&r.data===null);
 r=await req('/rest/v1/meeting_bookings?room_id=eq.'+f.room+'&select=booking_id');check('anonymous direct table access denied',r.status===401||r.status===403);
 r=await req('/auth/v1/token?grant_type=password',{method:'POST',body:{email:accounts.B.email,password:accounts.B.password}});check('B fresh unblocked Auth session before OAuth',r.status===200);tokens.B=r.data.access_token;
 phase='oauth-postgres';
 const verifier='v'.repeat(43);
 const start=async token=>{const r=await oauth(token,{action:'oauth_start',browser_verifier_hash:hash(verifier),return_to:'http://127.0.0.1:3000/Inspection/v2/'});check('OAuth start stores PostgreSQL state',r.status===200,{status:r.status});return r.data.data.state};
 let state=await start(tokens.A);
 r=await oauth(tokens.B,{action:'oauth_finish',state,code:'wrong-user',browser_verifier:verifier});check('different actual Auth user cannot consume A state',r.status===400);
 check('wrong-user attempt preserves PostgreSQL state',sql("select count(*) from google_calendar_oauth_states where state_hash="+sq(hash(state)))==='1');
 r=await oauth(tokens.A,{action:'oauth_finish',state,code:'wrong-verifier',browser_verifier:'x'.repeat(43)});check('wrong verifier rejected',r.status===400);
 const payload={action:'oauth_finish',state,code:'parallel-v111:first',browser_verifier:verifier};
 const responses=await Promise.all(Array.from({length:6},()=>oauth(tokens.A,payload)));
 check('six concurrent HTTP finishes yield exactly one success',responses.filter(x=>x.status===200).length===1&&responses.filter(x=>x.status===400).length===5,{statuses:responses.map(x=>x.status)});
 check('state consumed exactly once in real PostgreSQL',sql("select count(*) from google_calendar_oauth_states where state_hash="+sq(hash(state)))==='0');
 let pc=await req('/test/provider-counts');check('only one provider exchange after concurrent state consumption',pc.data.byCode[payload.code]===1);
 check('one real connection row for A',sql("select count(*) from google_calendar_connections where user_id="+sq(A)+" and google_subject='v111-parallel-v111'")==='1');
 // Separate genuine Auth login gives B a new session, preserving the blocked prior session as audit evidence.
 r=await req('/auth/v1/token?grant_type=password',{method:'POST',body:{email:accounts.B.email,password:accounts.B.password}});check('B fresh Auth session login succeeds',r.status===200);tokens.B=r.data.access_token;
 // Prepare two distinct valid OAuth transactions; both provider responses use same subject.
 const statesPair=await Promise.all([start(tokens.A),start(tokens.B)]);
 const results=await Promise.all(statesPair.map((s,i)=>oauth(tokens[i?'B':'A'],{action:'oauth_finish',state:s,code:'shared-v111:'+i,browser_verifier:verifier})));
 check('real unique index permits one concurrent owner only',results.filter(x=>x.status===200).length===1&&results.filter(x=>x.status>=400).length===1,{statuses:results.map(x=>x.status)});
 check('shared Google subject has exactly one DB owner',sql("select count(*) from google_calendar_connections where google_subject='v111-shared-v111'")==='1');
 const owner=sql("select user_id from google_calendar_connections where google_subject='v111-shared-v111'");
 sql("update google_calendar_connections set status='disconnected' where user_id="+sq(owner));
 const loser=owner===A?'B':'A';const inactiveState=await start(tokens[loser]);
 r=await oauth(tokens[loser],{action:'oauth_finish',state:inactiveState,code:'shared-v111:inactive',browser_verifier:verifier});
 check('inactive existing subject still protected by real unique index',r.status>=400&&sql("select count(*) from google_calendar_connections where google_subject='v111-shared-v111'")==='1',{status:r.status});
 phase='storage';
 // Add only a synthetic guard department in the clone and move test account A to it.
 const parent=sql("select dept_id from departments where code='MKT1'");
 sql("insert into departments(name,code,parent_id,level,status) select '隔離 V111 駐警隊','MKT1-GUARD',"+sq(parent)+",2,'active' where not exists(select 1 from departments where code='MKT1-GUARD')");
 const guard=sql("select dept_id from departments where code='MKT1-GUARD'");
 sql("update users set dept_id="+sq(guard)+" where user_id="+sq(A));
 for(const shift of ['V111早班','V111晚班'])sql("insert into patrol_shifts(shift_date,name,start_time,end_time,market_code) select "+[f.date,shift,'08:00','16:00','market_1'].map(sq).join(',')+" where not exists(select 1 from patrol_shifts where shift_date="+sq(f.date)+" and name="+sq(shift)+")");
 const attachBase={action:'handover_save',kind:'guard_attach_prepare',market_code:'market_1',duty_date:f.date,shift_name:'V111早班',incident_id:f.incident,file_name:'synthetic.jpg',file_size:128,content_type:'image/jpeg'};
 r=await api(tokens.A,attachBase);check('real app-api prepares signed Storage upload',r.status===200,{status:r.status,message:r.data.message});
 const path=r.data.data.path,uploadToken=r.data.data.token;
 const bytes=Buffer.alloc(128,17);
 const upload=await admin.storage.from('guard-handover-files').uploadToSignedUrl(path,uploadToken,bytes,{contentType:'image/jpeg'});
 check('actual Storage signed upload succeeds',!upload.error,{code:upload.error?.statusCode,message:upload.error?.message});
 const download=async(p)=>{const d=await admin.storage.from('guard-handover-files').download(p);if(d.error)throw Error('Storage download failed: '+d.error.message);return Buffer.from(await d.data.arrayBuffer())};
 const before=fileHash(await download(path));check('uploaded bytes read back with matching SHA256',before===fileHash(bytes));
 r=await api(tokens.A,{...attachBase,kind:'guard_attach_commit',path});check('valid attachment commit succeeds',r.status===200,{status:r.status,message:r.data.message});
 const attachment=r.data.data.attachment_id;
 r=await api(tokens.A,{...attachBase,kind:'guard_attach_commit',shift_name:'V111晚班',path});
 check('cross-shift duplicate triggers actual unique-index failure',r.status===409,{status:r.status,message:r.data.message});
 check('existing Storage bytes survive duplicate failure',fileHash(await download(path))===before);
 check('original attachment index remains linked to original shift',sql("select shift_name from guard_handover_attachments where attachment_id="+sq(attachment))==='V111早班');
 // Real DB constraint error after upload: original_size negative is normalized to null; use a temporary INSERT fault trigger limited to this test actor and incident.
 const failIncident=randomUUID();let prep=await api(tokens.A,{...attachBase,incident_id:failIncident});check('prepare second synthetic object',prep.status===200);
 const failPath=prep.data.data.path;const u2=await admin.storage.from('guard-handover-files').uploadToSignedUrl(failPath,prep.data.data.token,bytes,{contentType:'image/jpeg'});check('second Storage object uploaded',!u2.error);
 sql("create or replace function public.v111_attachment_fault() returns trigger language plpgsql as $$begin if new.incident_id="+sq(failIncident)+"::uuid then raise exception using errcode='42501',message='isolated attachment fault';end if;return new;end$$;create trigger v111_attachment_fault before insert on public.guard_handover_attachments for each row execute function public.v111_attachment_fault()");
 try{r=await api(tokens.A,{...attachBase,kind:'guard_attach_commit',incident_id:failIncident,path:failPath});check('actual PostgreSQL error returns safe commit failure',r.status===409);check('Storage bytes survive actual DB failure',fileHash(await download(failPath))===before)}
 finally{sql('drop trigger v111_attachment_fault on public.guard_handover_attachments;drop function public.v111_attachment_fault()')}
 r=await api(tokens.B,{...attachBase,kind:'guard_attach_commit',path});check('denied B cannot commit attachment',r.status===403);
 r=await api(tokens.A,{...attachBase,kind:'guard_attach_commit',market_code:'market_2',path});check('A cannot commit into unassigned market',r.status===403);
 // Insert a signed-shift record with genuine metadata; no trigger is disabled.
 sql("insert into guard_handover_logs(market_code,duty_date,shift_name,shift_start,shift_end,patrol_start,patrol_end,created_by,updated_by,status,handover_by,handover_at,receiver_id) values("+['market_1',f.date,'V111早班','08:00','16:00','08:00','16:00',A,A,'submitted',A].map(sq).join(',')+",now(),"+sq(B)+")");
 r=await api(tokens.A,{...attachBase,kind:'guard_attach_commit',path});check('signed shift blocks attachment mutation',r.status===409);
 check('signed attachment object remains byte-identical',fileHash(await download(path))===before);
 const objectCount=sql("select count(*) from storage.objects where bucket_id='guard-handover-files' and name in ("+sq(path)+","+sq(failPath)+")");
 check('both synthetic Storage objects still exist',objectCount==='2');
 phase='final';
 pc=await req('/test/provider-counts');check('no unexpected external network attempts',pc.data.blocked===0);
 const result={status:'pass',version:'V1.0.11',checks,counts:Object.fromEntries([...new Set(checks.map(x=>x.phase))].map(p=>[p,checks.filter(x=>x.phase===p).length])),limits:['Google token/userinfo are synthetic provider responses; Auth, REST, schema, PostgreSQL operations/indexes and Storage are real local services','New isolated clone only; no production operations','Existing local database is a full source-built schema with synthetic data; cron excluded and pre-existing Storage bytes not cloned']};
 fs.writeFileSync(root+'/results/integration.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:'pass',checks:checks.length,counts:result.counts}));
}catch(error){
 fs.writeFileSync(root+'/results/integration.json',JSON.stringify({status:'fail',phase,checks,error:error.message},null,2));console.error(JSON.stringify({status:'fail',phase,checks:checks.length,error:error.message}));process.exitCode=1;
}
