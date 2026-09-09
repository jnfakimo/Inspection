// Local-only, synthetic fixture using the actual exported page's complete CSS.
// Run after the V2 build; inspect 320/375/1280 CSS pixels, then stop this process.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const root = resolve('web/out');
const page = readFileSync(resolve(root, 'systems/vehicletracking/live/index.html'), 'utf8');
const links = [...page.matchAll(/<link\b[^>]*>/g)].map(m => m[0])
  .filter(tag => tag.includes('rel="stylesheet"'))
  .map(tag => tag.match(/href="([^"]+)"/)[1]);
assert.ok(links.length > 0, '先完成 V2 建置');
const linkedStyles = links.map(href => {
  const relative = href.slice(href.indexOf('/_next/') + 1);
  assert.ok(relative.startsWith('_next/') && !relative.includes('..'));
  return readFileSync(resolve(root, relative), 'utf8');
});
// The login gate defers module chunks until the client is authenticated.
// Use the current manifest, never stale/unrelated chunks left in the output folder.
const manifest = JSON.parse(readFileSync('web/.next/react-loadable-manifest.json','utf8'));
const trackingEntry = Object.entries(manifest).find(([name]) => name.endsWith(' -> ./vehicle-tracking-workspace'));
assert.ok(trackingEntry, '找不到定位模組的建置清單');
const lazyStyles = trackingEntry[1].files.filter(name => name.endsWith('.css'))
  .map(name => readFileSync(resolve(root, '_next', name), 'utf8'))
  .filter(css => !linkedStyles.includes(css));
const styles = [...linkedStyles, ...lazyStyles].join('\n');
assert.ok(styles.includes('.findtag-sync') && styles.includes('.user-meta.v1-meta'));
const html = `<!doctype html><html lang="zh-Hant" data-theme="light"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FindTag 合成版型驗證</title><style>${styles}</style></head><body>
<div class="app-shell v1-shell"><header class="v1-navbar">
<div class="v1-brand"><b>■ TAIPEC-MKT-1</b><strong>即時車況</strong><span>臺北農產公司／第一果菜市場</span></div>
<div class="user-meta v1-meta"><span>管理部／總務課｜合成人員</span><i><em></em>系統連線中</i><time>2026-09-08 12:34:56</time></div>
<nav class="v1-actions"><a>首頁</a><a>個人資料</a><a>登出</a></nav></header>
<main class="content v1-content"><div class="vehicle-tracking-page">
<section class="panel tracking-table-panel findtag-sync">
<div class="findtag-sync-heading"><div><h2>FindTag 桌機自動同步</h2><p>每 30 秒更新畫面；桌機每 60 秒讀取一次目前可見清單。</p></div><button class="secondary-btn compact">更新同步狀態</button></div>
<p class="tracking-form-hint">合成資料版型驗證。沒有真實地址、憑證或定位資訊。</p>
<article class="findtag-source"><div class="findtag-sync-heading"><h3>合成桌機</h3><span>桌機同步連線正常（不代表位置即時）</span></div>
<p>最後聯絡：2026-09-08 12:34:56　｜　最後讀取：2026-09-08 12:34:55</p>
<div class="responsive-table"><table><thead><tr><th>設備顯示名稱</th><th>FindTag 顯示地址</th><th>FindTag 原始時間（時區未確認）</th><th>資料品質</th></tr></thead>
<tbody><tr><td>合成標籤</td><td>合成地址文字</td><td>2026-09-08 12:34:00</td><td>畫面文字／尚無座標</td></tr><tr><td>合成標籤</td><td>尚未取得完整地址</td><td>畫面未顯示時間</td><td>資料未完整顯示／尚待確認</td></tr></tbody></table></div>
<button class="danger-btn compact">停用桌機授權</button></article>
<details class="findtag-setup" open><summary>新增桌機同步授權</summary><div class="findtag-actions"><label>桌機名稱<input value="合成桌機"></label><button class="primary-btn compact">產生桌機配對檔</button></div></details>
</section></div></main></div></body></html>`;
const server = createServer((req,res) => {
  if (req.url !== '/') { res.writeHead(404).end(); return; }
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(html);
});
server.listen(0,'127.0.0.1',()=>console.log(`http://127.0.0.1:${server.address().port}/`));
