import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import { htmlElements, htmlScripts, isClassicInlineScript } from './html-audit-parser.mjs';
import { javascriptStringLiteral } from './javascript-literal.mjs';

test('HTML 節點解析保留外部腳本、忽略註解與字串中的假連結',()=>{
 const input='<!-- <a href="/false"> --><script data-note=">">const sample=\'href="/fake"\';</script ><script SRC=/missing.js></script><a href="/real">ok</a>';
 const refs=htmlElements(input).flatMap(n=>n.attrs.filter(a=>['src','href'].includes(a.name)).map(a=>a.value));
 assert.deepEqual(refs,['/missing.js','/real']);
 const scripts=htmlScripts(input);assert.equal(scripts.length,2);assert.equal(isClassicInlineScript(scripts[0].attrs),true);assert.equal(isClassicInlineScript(scripts[1].attrs),false);
 assert.throws(()=>new vm.Script(htmlScripts('<script>const = ;</script >')[0].code),SyntaxError);
});
test('JavaScript 字串可往返引號、HTML 結束標記、換行與 Unicode 分隔符',()=>{
 for(const value of ['normal','</script><script>globalThis.injected=1</script>','";globalThis.injected=1;//','繁中\u2028\u2029&<>']){
  const literal=javascriptStringLiteral(value),context=vm.createContext({});
  assert.equal(/[<>&\u2028\u2029]/.test(literal),false);
  new vm.Script('result='+literal).runInContext(context);assert.equal(context.result,value);assert.equal(context.injected,undefined);
 }
});
for(const name of ['meeting-booking-check','patrol-timeout-check'])test(name+' 初始化或授權錯誤不向未授權呼叫者洩漏內容',async()=>{
 const source=fs.readFileSync('supabase/functions/'+name+'/index.ts','utf8').replace(/^import .*;\r?\n/gm,'');
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 for(const error of [new Error('Bearer isolated-secret /private/file.ts:42'),{message:'isolated-secret',details:'db private schema'},'isolated-secret']){
  let handle;const logs=[];
  const context=vm.createContext({Response,Request,crypto,Deno:{env:{get:()=>''},serve:fn=>{handle=fn;}},createClient:()=>{throw error;},console:{error:(...values)=>logs.push(values)}});
  new vm.Script(js).runInContext(context);const response=await handle(new Request('http://isolated.invalid/'));
  assert.equal(response.status,500);const body=await response.json();assert.equal(body.ok,false);assert.match(body.incident_id,/^[a-f0-9-]{36}$/);assert.equal(body.msg,'服務暫時無法完成作業，請稍後重試');assert.equal(JSON.stringify([body,logs]).includes('isolated-secret'),false);
 }
});
test('V1 巡檢橋接移除舊永久權杖，更新時不延長兩小時上限',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const expires=Date.now()+60000,key='beinongPatrolTrustedSessionV1';storage.setItem(key,JSON.stringify({version:1,user_id:'u1',access_token:'old-secret',refresh_token:'old-refresh',valid_until:expires}));
 const context=vm.createContext({window:{},localStorage:storage,console});const source=fs.readFileSync('system/supabase-config.js','utf8');new vm.Script(source.slice(source.indexOf('window.PatrolSessionBridge ='),source.indexOf('window.createDb ='))).runInContext(context);
 const bridge=context.window.PatrolSessionBridge;assert.equal(bridge.read().user_id,'u1');assert.equal(storage.getItem(key).includes('old-secret'),false);
 assert.equal(bridge.update({user:{id:'u1'},access_token:'new-secret',refresh_token:'new-refresh'}),true);assert.equal(bridge.read().valid_until,expires);assert.equal(storage.getItem(key).includes('new-secret'),false);
 bridge.clear();assert.equal(bridge.read(),null);
});

test('V1 恢復期間登出不被晚到的 SIGNED_IN 復活，並清除已建立的 SDK session',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const context=vm.createContext({window:{},localStorage:storage,console});const source=fs.readFileSync('system/supabase-config.js','utf8');new vm.Script(source.slice(source.indexOf('window.PatrolSessionBridge ='),source.indexOf('window.createDb ='))).runInContext(context);
 const bridge=context.window.PatrolSessionBridge,s={user:{id:'u1'},access_token:'ephemeral-access',refresh_token:'ephemeral-refresh'};bridge.save(s);let signedOut=0;
 const client={auth:{getSession:async()=>({data:{session:s},error:null}),setSession:async()=>{bridge.clear();bridge.signedIn(s);return {data:{session:s},error:null};},signOut:async()=>{signedOut++;return {error:null};}}};
 assert.equal(await bridge.restore(client),null);assert.equal(bridge.read(),null);assert.equal(signedOut,1);
});
