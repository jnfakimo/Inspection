import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import vm from 'node:vm';
import { parseFragment } from 'parse5';
import { transform } from 'esbuild';
import { captchaImage } from '../supabase/functions/_shared/captcha-image.ts';
import { startCalendarLink, consumeCalendarReturn } from '../web/lib/google-calendar-browser.ts';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('CAPTCHA outputs randomized decodable PNG without SVG/answer metadata', () => {
 const image=captchaImage('012345'),bytes=Buffer.from(image.split(',')[1],'base64');
 assert.ok(image.startsWith('data:image/png;base64,'));
 assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 let at=8;const names=[],compressed=[];
 while(at<bytes.length){const n=bytes.readUInt32BE(at),name=bytes.toString('ascii',at+4,at+8),data=bytes.subarray(at+8,at+8+n);names.push(name);
 if(name==='IHDR'){assert.equal(data.readUInt32BE(0),220);assert.equal(data.readUInt32BE(4),70);assert.equal(data[9],0);}
 if(name==='IDAT')compressed.push(data);at+=12+n;}
 assert.deepEqual(names,['IHDR','IDAT','IEND']);
 const raw=inflateSync(Buffer.concat(compressed));assert.equal(raw.length,221*70);
 assert.ok(raw.filter(v=>v>0&&v<60).length>1000);
 assert.notEqual(captchaImage('012345'),image);
 for(const bad of ['', '12345','1234567','<svg/>'])assert.throws(()=>captchaImage(bad));
});
test('floor toggle and pager preserve hostile text as data after actual HTML parsing',()=>{
 const source=read('system/arealist.html'),esc=source.match(/function esc\(s\)\{[^\n]+/)[0];
 const handler=source.slice(source.indexOf("document.getElementById('list').addEventListener('click'"),source.indexOf('function toggleFloor(f)'));
 const templates=[...source.matchAll(/<[^>\n]+data-floor-action[^>\n]+>/g)].map(m=>m[0]);assert.equal(templates.length,3);
 for(const floor of ["B1F","');globalThis.pwned=true;//",'"<&amp;\\\n']){
  const calls=[],list={contains:()=>true,addEventListener:(_t,fn)=>{list.handler=fn;}};
  class Element{closest(){return this;}}
  const context=vm.createContext({Element,document:{getElementById:()=>list},toggleFloor:f=>calls.push(['toggle',f]),setFloorPage:(f,p)=>calls.push(['page',f,p])});
  vm.runInContext(esc,context);vm.runInContext(handler,context);
  for(const template of templates){
   const html=template.replace(/\$\{esc\(f\)\}/g,context.esc(floor)).replace(/\$\{isC\?' collapsed':''\}/g,'').replace(/\$\{page-1\}/g,'1').replace(/\$\{page\+1\}/g,'3').replace(/\$\{page[^}]+\}/g,'');
   const node=parseFragment(html).childNodes[0];assert.ok(!node.attrs.some(a=>a.name.startsWith('on')));
   const target=new Element();target.dataset={};
   for(const a of node.attrs)if(a.name.startsWith('data-'))target.dataset[a.name.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=a.value;
   list.handler({target});assert.equal(calls.at(-1)[1],floor);assert.equal(context.pwned,undefined);
  }
  assert.deepEqual(calls,[['toggle',floor],['page',floor,1],['page',floor,3]]);
 }
});
const store=()=>{const data=new Map();return{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),data};};
test('OAuth browser accepts original tab/account, rejects different tab/account/replay and keeps verifier out of URL',async()=>{
 const s=store(),state='s'.repeat(43);let sent;
 const invoke=async(action,payload)=>{sent={action,payload};return{state,url:'https://accounts.google.com/o/oauth2/v2/auth?state='+state};};
 const url=await startCalendarLink(invoke,s,'actor','https://app.test/Inspection/v2/'),pending=JSON.parse([...s.data.values()][0]);
 assert.notEqual(sent.payload.browser_verifier_hash,pending.verifier);assert.ok(!url.includes(pending.verifier));
 const result=new URL('https://app.test/Inspection/v2/#'+new URLSearchParams({google_calendar:'finish',state,code:'synthetic-code'}));
 assert.throws(()=>consumeCalendarReturn(result,'actor',store()));
 const copied=store();for(const[k,v]of s.data)copied.setItem(k,v);
 assert.throws(()=>consumeCalendarReturn(result,'other',copied));
 assert.equal(consumeCalendarReturn(result,'actor',s).browser_verifier,pending.verifier);
 assert.throws(()=>consumeCalendarReturn(result,'actor',s));
 let invoked=false;await assert.rejects(startCalendarLink(async()=>{invoked=true;},{...store(),setItem(){throw Error('blocked');}},'actor','https://app.test'));assert.equal(invoked,false);
});
test('actual guard commit preserves existing files on duplicate/DB error/oversize; legal commit succeeds',async()=>{
 const source=read('supabase/functions/app-api/index.ts'),start=source.indexOf("      if (kind === 'guard_attach_prepare' || kind === 'guard_attach_commit') {"),end=source.indexOf("\n      if (kind ===",start+20);
 assert.ok(start>=0&&end>start);
 const compiled=await transform('async function run(ctx){const {kind,body,req,admin,profile,guardMarket,text,id,validISODate,reply,dbMessage,guardContentType,guardFileExtension,writeAudit,GUARD_ATTACHMENT_MAX_BYTES,GUARD_ATTACHMENTS_PER_INCIDENT}=ctx;\n'+source.slice(start,end)+'\n}',{loader:'ts'});
 const context=vm.createContext({GUARD_ATTACHMENT_BUCKET:'synthetic-bucket'});vm.runInContext(compiled.code,context);
 for(const mode of ['duplicate','db-error','oversized','success']){
  let removes=0;const incident='00000000-0000-0000-0000-000000000001',path='market_1/2026-11-06/'+incident+'/00000000-0000-0000-0000-000000000002.jpg';
  const admin={from(){
   const q={select(){return q;},eq(){return q;},neq(){return q;},limit(){return Promise.resolve({data:[{name:'later-shift'}],error:null});},insert(){return q;},
    single(){return Promise.resolve(mode==='success'?{data:{attachment_id:'new'},error:null}:{data:null,error:{code:mode==='duplicate'?'23505':'42501'}});},
    maybeSingle(){return Promise.resolve({data:null,error:null});},then(resolve,reject){return Promise.resolve({count:0,data:null,error:null}).then(resolve,reject);}};return q;
  },storage:{from:()=>({list:async()=>({data:[{name:path.split('/').at(-1),metadata:{size:mode==='oversized'?9999:42}}],error:null}),remove:async()=>{removes++;return{error:null};}})}};
  const result=await context.run({kind:'guard_attach_commit',body:{duty_date:'2026-11-06',shift_name:'later-shift',incident_id:incident,file_name:'photo.jpg',file_size:42,path},req:{},admin,profile:{user_id:'actor'},guardMarket:'market_1',text:v=>String(v??''),id:v=>v,validISODate:()=>true,reply:(_r,body,status=200)=>({body,status}),dbMessage:()=> 'synthetic error',guardContentType:()=> 'image/jpeg',guardFileExtension:()=>'.jpg',writeAudit:async()=>{},GUARD_ATTACHMENT_MAX_BYTES:1000,GUARD_ATTACHMENTS_PER_INCIDENT:5});
  assert.equal(removes,0,mode);assert.equal(result.status,mode==='success'?200:mode==='oversized'?400:409);
 }
});
