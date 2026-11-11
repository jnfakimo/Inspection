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
try {
 const accounts=JSON.parse(fs.readFileSync(root+'/.local/accounts.json'));
 const A=accounts.A.user_id,B=accounts.B.user_id,f=JSON.parse(fs.readFileSync(root+'/.local/fixture.json'));
 for(const name of ['A','B']){const login=await req('/auth/v1/token?grant_type=password',{method:'POST',body:{email:accounts[name].email,password:accounts[name].password}});assert.equal(login.status,200);tokens[name]=login.data.access_token;}
 let r,pc; phase='storage-final';
 const path=sql("select storage_path from guard_handover_attachments where incident_id="+sq(f.incident)+" and shift_name='V111早班' order by uploaded_at desc limit 1");
 const attachBase={action:'handover_save',kind:'guard_attach_commit',market_code:'market_1',duty_date:f.date,shift_name:'V111早班',incident_id:f.incident,file_name:'synthetic.jpg',file_size:128,content_type:'image/jpeg',path};
 const bytes=Buffer.alloc(128,17),before=fileHash(bytes);
 const download=async(p)=>{const d=await admin.storage.from('guard-handover-files').download(p);if(d.error)throw Error('Storage download failed');return Buffer.from(await d.data.arrayBuffer())};
 const guard=sql("select dept_id from departments where code='MKT1-GUARD'");
 sql("update users set dept_id="+sq(guard)+" where user_id="+sq(B));
 check('B has same actual guard market qualification',sql("select handover_staff_markets("+sq(B)+",'guard')::text").includes('market_1'));
 r=await api(tokens.B,attachBase);check('qualified-market module-denied B attachment blocked',r.status===403);
 r=await api(tokens.A,{...attachBase,kind:'guard_attach_prepare',file_size:52428801});check('declared oversized upload rejected',r.status===400);
 const receiver=sql("select user_id from users where rbac_role='sysadmin' and status='active' order by user_id limit 1");
 sql("insert into guard_handover_logs(market_code,duty_date,shift_name,shift_start,shift_end,patrol_start,patrol_end,created_by,updated_by,status) values("+['market_1',f.date,'V111早班','08:00','16:00','08:00','16:00',A,A,'draft'].map(sq).join(',')+")");
 sql("update guard_handover_logs set status='submitted',handover_by="+sq(A)+",updated_by="+sq(A)+",receiver_id="+sq(receiver)+" where market_code='market_1' and duty_date="+sq(f.date)+" and shift_name='V111早班'");
 check('actual DB permits legal draft to submitted transition',sql("select status from guard_handover_logs where market_code='market_1' and duty_date="+sq(f.date)+" and shift_name='V111早班'")==='submitted');
 r=await api(tokens.A,attachBase);check('signed shift blocks attachment mutation',r.status===409,{status:r.status,message:r.data.message});
 check('signed attachment object remains byte-identical',fileHash(await download(path))===before);
 check('no fault injection trigger remains',sql("select count(*) from pg_trigger where tgname='v111_attachment_fault'")==='0');
 check('both newly uploaded Storage objects still exist',sql("select count(*) from storage.objects where bucket_id='guard-handover-files' and created_at > (select min(created_at) from auth.users where email like 'isolated-v111-%@example.invalid')")==='2'); phase='final';
 pc=await req('/test/provider-counts');check('no unexpected external network attempts',pc.data.blocked===0);
 const result={status:'pass',version:'V1.0.11',checks,counts:Object.fromEntries([...new Set(checks.map(x=>x.phase))].map(p=>[p,checks.filter(x=>x.phase===p).length])),limits:['Google token/userinfo are synthetic provider responses; Auth, REST, schema, PostgreSQL operations/indexes and Storage are real local services','New isolated clone only; no production operations','Existing local database is a full source-built schema with synthetic data; cron excluded and pre-existing Storage bytes not cloned']};
 fs.writeFileSync(root+'/results/storage-final.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:'pass',checks:checks.length,counts:result.counts}));
}catch(error){
 fs.writeFileSync(root+'/results/storage-final.json',JSON.stringify({status:'fail',phase,checks,error:error.message},null,2));console.error(JSON.stringify({status:'fail',phase,checks:checks.length,error:error.message}));process.exitCode=1;
}
