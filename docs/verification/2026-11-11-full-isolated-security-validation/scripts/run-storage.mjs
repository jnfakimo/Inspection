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
 let r,pc; phase='storage';
 // Add only a synthetic guard department in the clone and move test account A to it.
  for(const shift of ['V111早班','V111晚班'])sql("insert into patrol_shift_template(name,start_time,end_time,sort_order,status,market_code) select "+[shift,'08:00','16:00','99','active','market_1'].map(sq).join(',')+" where not exists(select 1 from patrol_shift_template where market_code='market_1' and name="+sq(shift)+")");
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
 fs.writeFileSync(root+'/results/storage.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:'pass',checks:checks.length,counts:result.counts}));
}catch(error){
 fs.writeFileSync(root+'/results/storage.json',JSON.stringify({status:'fail',phase,checks,error:error.message},null,2));console.error(JSON.stringify({status:'fail',phase,checks:checks.length,error:error.message}));process.exitCode=1;
}
