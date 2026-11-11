import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { createClient } from '@supabase/supabase-js';
const root=import.meta.dirname+'/..';const cfg=JSON.parse(fs.readFileSync(root+'/.local/config.json','utf8'));
if(cfg.API_URL!=='http://127.0.0.1:55440')throw Error('Dedicated loopback required');
const realFetch=globalThis.fetch;const provider={token:0,userinfo:0,blocked:0,byCode:{}};
globalThis.fetch=async(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 if(url.href==='https://oauth2.googleapis.com/token'){
  provider.token++;const code=new URLSearchParams(init.body).get('code');provider.byCode[code]=(provider.byCode[code]||0)+1;
  await new Promise(resolve=>setTimeout(resolve,60));
  return Response.json({access_token:'synthetic:'+code,refresh_token:'synthetic-refresh:'+code,scope:'calendar'});
 }
 if(url.href==='https://openidconnect.googleapis.com/v1/userinfo'){
  provider.userinfo++;const value=new Headers(init.headers).get('Authorization').replace('Bearer synthetic:','');
  return Response.json({sub:'v111-'+value.split(':')[0],email:'synthetic@example.invalid',email_verified:true});
 }
 if(!['http://127.0.0.1:55440','http://127.0.0.1:55441','http://127.0.0.1:55442','http://127.0.0.1:55443'].includes(url.origin)){provider.blocked++;throw Error('External network blocked')}
 return realFetch(input,init);
};
globalThis.reviewActualClient=createClient;
const env={SUPABASE_URL:cfg.API_URL,SUPABASE_ANON_KEY:cfg.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:cfg.SERVICE_ROLE_KEY,GOOGLE_CALENDAR_CLIENT_ID:'synthetic-client',GOOGLE_CALENDAR_CLIENT_SECRET:'synthetic-secret',GOOGLE_TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
const handlers={};
for(const name of ['app-api','google-calendar','google-calendar-callback']){
 globalThis.Deno={env:{get:k=>env[k]},serve:fn=>handlers[name]=fn};
 const output=await build({entryPoints:[root+'/source/supabase/functions/'+name+'/index.ts'],bundle:true,write:false,platform:'node',format:'esm',plugins:[{name:'actual-local-supabase-client',setup(b){b.onResolve({filter:/^https:\/\/esm.sh\/@supabase\/supabase-js@/},()=>({path:'client',namespace:'local-client'}));b.onLoad({filter:/.*/,namespace:'local-client'},()=>({contents:'export const createClient=(...args)=>globalThis.reviewActualClient(...args);'}));}}]});
 await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text+'\n//'+name).toString('base64'));
}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.headers.host!=='127.0.0.1:55440'){res.writeHead(403);return res.end();}
  const u=new URL(req.url,cfg.API_URL);
  if(u.pathname==='/test/provider-counts'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(provider));}
  const fn=u.pathname.match(/^\/functions\/v1\/([^/]+)$/);
  let body=Buffer.alloc(0);for await(const chunk of req){body=Buffer.concat([body,chunk]);if(body.length>15e6)throw Error('Body limit');}
  let result;
  if(fn){
   if(!handlers[fn[1]]){res.writeHead(404);return res.end();}
   result=await handlers[fn[1]](new Request(u,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:body}));
  }else{
   const routes=[['/auth/v1',55441],['/rest/v1',55442],['/storage/v1',55443]];
   const route=routes.find(([p])=>u.pathname.startsWith(p));if(!route){res.writeHead(404);return res.end();}
   const target='http://127.0.0.1:'+route[1]+u.pathname.slice(route[0].length)+u.search;
   const headers={...req.headers};delete headers.host;delete headers.connection;delete headers['content-length'];
   const relay=await new Promise((resolve,reject)=>{const child=spawn('wsl',['-d','Inspection-test','-u','root','--','python3','/mnt/c/projects/Inspection-isolated-v111-20261111/scripts/internal-relay.py']);let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.on('close',code=>{if(code!==0){fs.writeFileSync(root+'/.local/relay-error.txt',err);return reject(Error('Local relay failed'))}try{resolve(JSON.parse(out))}catch(e){reject(e)}});child.stdin.end(JSON.stringify({service:{55441:'auth',55442:'rest',55443:'storage'}[route[1]],path:u.pathname.slice(route[0].length)+u.search,method:req.method,headers,body:body.toString('base64')}));});result=new Response(relay.status===204||relay.status===304?null:Buffer.from(relay.body,'base64'),{status:relay.status,headers:relay.headers});
  }
  const headers=Object.fromEntries(result.headers);delete headers['content-encoding'];delete headers['transfer-encoding'];delete headers['content-length'];
  res.writeHead(result.status,headers);res.end(Buffer.from(await result.arrayBuffer()));
 }catch(error){console.error('Local request failed:',error.message);res.writeHead(500,{'Content-Type':'application/json'});res.end('{"error":"local harness failure"}');}
});
server.listen(55440,'127.0.0.1',()=>console.log('Dedicated local Auth/REST/Storage/application gateway ready: 127.0.0.1:55440'));
