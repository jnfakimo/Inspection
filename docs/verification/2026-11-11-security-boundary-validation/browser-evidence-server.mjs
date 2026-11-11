import http from 'node:http';
import fs from 'node:fs';
import vm from 'node:vm';
const root=import.meta.dirname;
const source=v=>fs.readFileSync(root+'/'+(v==='old'?'original':'current')+'/system/arealist.html','utf8');
const payload="');window.__evidenceXss=1;//";
const escapeFor=v=>{const ctx=vm.createContext({});vm.runInContext(source(v).match(/function esc\(s\)\{[^\n]+/)[0],ctx);return ctx.esc;};
const records=JSON.parse(fs.readFileSync(root+'/results/browser-csp.json','utf8')).cases;let uiChecks={};
const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'};
function render(v,csp){
 const s=source(v),esc=escapeFor(v);
 const regex=v==='old'?/<[^>\n]+onclick="(?:toggleFloor|setFloorPage)[^>\n]+>/g:/<[^>\n]+data-floor-action[^>\n]+>/g;
 const tags=[...s.matchAll(regex)].map(m=>m[0]);if(tags.length!==3)throw Error('Expected exactly 3 source controls');
 const html=['B1F',payload].flatMap((f,i)=>tags.map((t,j)=>{
  const out=t.replace(/\$\{esc\(f\)\}/g,esc(f)).replace(/\$\{isC\?' collapsed':''\}/g,'').replace(/\$\{page-1\}/g,'1').replace(/\$\{page\+1\}/g,'3').replace(/\$\{page[^}]+\}/g,'');
  const tag=out.match(/^<(\w+)/)[1];return out+(i?'特殊文字 ':'正常 ')+['標題','上一頁','下一頁'][j]+'</'+tag+'>';
 })).join('\n');
 return '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>隔離 XSS / CSP 驗證 V1.0.10</title><link rel="stylesheet" href="/style.css"><h1>隔離 XSS / CSP 驗證 V1.0.10</h1><p id="mode">'+v+' / '+csp+'</p><p>來源控制項：arealist.html；合成文字，僅本機；不是正式或歷史環境。</p><div id="list">'+html+'</div><button id="save">保存本頁結果</button><pre id="result">尚未完成點擊</pre><script src="/fixture.js?version='+v+'&csp='+csp+'"></script></html>';
}
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:8774');
 if(req.headers.host!=='127.0.0.1:8774'){res.writeHead(403);return res.end();}
 if(url.pathname==='/style.css'){res.writeHead(200,{'Content-Type':'text/css'});return res.end('body{font-family:system-ui;margin:30px;background:#f6f8fa;color:#172434}#list{display:grid;gap:12px;max-width:650px}#list>*{border:1px solid #7b8996;padding:15px;background:white;cursor:pointer}button{padding:12px;margin:8px}pre{white-space:pre-wrap;border:1px solid #bbb;padding:15px}');}
 if(url.pathname==='/fixture.js'){
  const v=url.searchParams.get('version'),csp=url.searchParams.get('csp');
  const s=source(v);const at=s.indexOf("document.getElementById('list').addEventListener('click'");const end=s.indexOf('function toggleFloor(f)');
  res.writeHead(200,{'Content-Type':'text/javascript'});
  return res.end('const calls=[];let violations=0;window.__evidenceXss=0;function toggleFloor(f){calls.push(["toggle",f])}function setFloorPage(f,p){calls.push(["page",f,p])}document.addEventListener("securitypolicyviolation",()=>violations++);'+(v==='new'?s.slice(at,end):'')+
  'document.getElementById("save").addEventListener("click",async()=>{const result={version:'+JSON.stringify(v)+',csp:'+JSON.stringify(csp)+',xss:window.__evidenceXss,calls,violations};const r=await fetch("/record",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(result)});document.getElementById("result").textContent=JSON.stringify(await r.json(),null,2)});');
 }
 if(url.pathname==='/record'&&req.method==='POST'){
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000){res.writeHead(413);return res.end();}}
  const r=JSON.parse(raw);const expected=r.version==='old'?(r.csp==='weak'?r.xss===1&&r.calls.length===6:r.xss===0&&r.calls.length===0):r.xss===0&&r.calls.length===6&&r.calls.filter(x=>x[1]===payload).length===3;
  records[r.version+'/'+r.csp]={...r,pass:expected};
  fs.writeFileSync(root+'/results/browser-csp.json',JSON.stringify({scope:'Extracted actual controls, live browser, synthetic server CSP; not historical effective headers',cases:records},null,2));
  res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify(records[r.version+'/'+r.csp]));
 }
 const m=url.pathname.match(/^\/fixture\/(old|new)\/(weak|strict)$/);
 if(m){res.writeHead(200,{...headers,'Content-Security-Policy':"default-src 'none'; script-src 'self'"+(m[2]==='weak'?" 'unsafe-inline'":'')+"; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'"});return res.end(render(m[1],m[2]));}
 if(url.pathname==='/summary'){res.writeHead(200,headers);return res.end(fs.readFileSync(root+'/results/summary.html','utf8')); /* previous detail view */ return res.end('<!doctype html><meta charset="utf-8"><title>V1.0.10 隔離驗收</title><link rel="stylesheet" href="/style.css"><h1>V1.0.10 隔離證據驗收</h1><p>僅本機合成資料；歷史判定仍為 2 accept、6 needs more validation。</p><pre>'+JSON.stringify({browser:records,other:uiChecks},null,2).replaceAll('&','&amp;').replaceAll('<','&lt;')+'</pre>');}
 if(url.pathname==='/load-summary'){for(const f of ['rest-boundary.json','line-oauth-summary.json']){try{uiChecks[f]=JSON.parse(fs.readFileSync(root+'/results/'+f,'utf8'));}catch{}}res.writeHead(200);return res.end('loaded');}
 res.writeHead(404);res.end();
});
server.listen(8774,'127.0.0.1',()=>console.log('Local evidence server ready on 127.0.0.1:8774'));
