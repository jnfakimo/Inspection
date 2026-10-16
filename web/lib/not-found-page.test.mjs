// 繁中 404 頁與 GitHub Pages 根目錄發布的契約。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('404 頁為繁中、使用共用主要按鈕回到首頁，色彩只用主題 token', async () => {
  const [page, css] = await Promise.all([read('../app/not-found.tsx'), read('../app/not-found.module.css')]);
  assert.match(page, /找不到頁面/);
  assert.match(page, /<Link className="primary-btn" href="\/">返回首頁<\/Link>/);
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, '404 頁不可硬編碼色碼');
  assert.match(css, /overflow-wrap:anywhere/);
});

test('建置腳本在加上 CSP 之後、簽章之前把 404 頁發布到網站根目錄', async () => {
  const build = await read('../../tools/build-hardened-pages.mjs');
  const order = ['await minifyRuntimeCode();', 'await publishRootNotFoundPage();', 'await writeSignedProvenance();', 'await verifyArtifact();']
    .map(step => build.indexOf(step));
  assert.ok(order.every(index => index >= 0), '建置步驟缺漏');
  assert.deepEqual([...order].sort((a, b) => a - b), order, '根目錄 404 頁必須在 CSP 之後、簽章之前發布');
  assert.match(build, /path\.join\(outputRoot, '404\.html'\)/);
  assert.match(build, /html\.includes\('找不到頁面'\)/);
});
