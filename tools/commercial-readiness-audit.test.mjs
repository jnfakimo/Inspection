import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const auditor = fileURLToPath(new URL('./commercial-readiness-audit.mjs', import.meta.url));
const head = '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>驗收</title><meta http-equiv="Content-Security-Policy" content="default-src &apos;self&apos;"></head>';
test('路由目錄存在但缺少 index.html 仍阻擋發布', () => {
  const result = audit('<a href="/Inspection/v2/empty/?next=home">入口</a>', {'_site/v2/empty/data.txt':'not a page'});
  assert.equal(result.status,1); assert.match(result.output,/missing-asset/);
});
function audit(markup, extra = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'inspection-audit-'));
  try {
    const files = { '_site/v2/index.html': head + markup, ...extra };
    for (const [name, value] of Object.entries(files)) {
      if (value === null) continue;
      const file = path.join(dir, name);
      mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, value);
    }
    const result = spawnSync(process.execPath, [auditor], { cwd: dir, encoding: 'utf8' });
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    assert.equal(path.dirname(dir), path.resolve(tmpdir()));
    assert.ok(path.basename(dir).startsWith('inspection-audit-'));
    rmSync(dir, { recursive: true, force: true });
  }
}
test('部署基底網址、中文資源及 CSS 查詢參數均解析至產物', () => {
  const result = audit('<a href="/Inspection/v2/">首頁</a><img src="/Inspection/v2/%E5%9C%96.svg"><link rel="stylesheet" href="theme.css">', {
    '_site/v2/圖.svg': '<svg/>', '_site/v2/theme.css': 'body{background:url(/Inspection/v2/%E5%9C%96.svg?v=1)}',
  });
  assert.equal(result.status, 0, result.output);
});
test('遺漏 CSP 的實際產物仍阻擋發布', () => {
  const result = audit('', { '_site/system/old.html': '<head><meta charset="UTF-8"><meta name="viewport"><title>舊入口</title></head>' });
  assert.equal(result.status, 1); assert.match(result.output, /content-security-policy/);
});
test('缺檔與缺少外部完整性防護仍會失敗', () => {
  const result = audit('<img src="/Inspection/v2/missing.png"><script src="https://example.org/library.js"></script>');
  assert.equal(result.status, 1); assert.match(result.output, /missing-asset/); assert.match(result.output, /script-integrity/);
});
test('不把 hydration 字串中的範例網址當 DOM 資源，仍檢查腳本語法', () => {
  assert.equal(audit('<script>const example=`href="/missing"`;</script>').status, 0);
  assert.equal(audit('<script>const = ;</script>').status, 1);
});

test('HTML 解析保留腳本資源、忽略原始文字內容與特殊結束標記', () => {
  assert.equal(audit('<script type="application/json" data-note=">">{"sample":"href=\"/missing\""}</script ><style>.a::after{content:\'id="duplicate"\'}</style><div id="duplicate"></div>').status,0);
  const missing = audit('<script src="/Inspection/v2/missing.js"></script>');
  assert.equal(missing.status,1); assert.match(missing.output,/missing-asset/);
});
test('V2 頁面及 CSS 資源納入檢查', () => {
  const result = audit('', { '_site/v2/nested/index.html': head+'<a target="_blank" href="#">連結</a>', '_site/v2/theme.css': 'body{background:url(missing.png)}' });
  assert.equal(result.status, 1); assert.match(result.output, /noopener/); assert.match(result.output, /missing-css-asset/);
});

test('合法相對路由、部署基底、中文編碼與查詢參數通過；不連外', () => {
  const result = audit('<a href="child/?from=home#section">子頁</a><a href="https://example.invalid/">外站不檢查</a><img src="/Inspection/v2/%E5%9C%96.svg?v=1">', {
    '_site/v2/child/index.html': head+'<a href="../?from=child">返回</a>',
    '_site/v2/圖.svg': '<svg/>',
  });
  assert.equal(result.status, 0, result.output);
});

for (const [label, markup, extra, diagnostic] of [
  ['遺失頁面連結', '<a href="missing.html">壞連結</a>', {}, 'missing-asset'],
  ['遺失圖片', '<img src="missing.png">', {}, 'missing-asset'],
  ['遺失 CSS 圖片', '<link rel="stylesheet" href="theme.css">', { '_site/v2/theme.css': 'body{background:url(missing.png?v=1)}' }, 'missing-css-asset'],
  ['沒有建置產物', '', { '_site/v2/index.html': null }, '請先建置完整網站產物'],
]) {
  test(`${label}單獨造成非零退出狀態`, () => {
    const result = audit(markup, extra);
    assert.equal(result.status, 1, result.output);
    assert.ok(result.output.includes(diagnostic), result.output);
  });
}

test('CI 與完整產物工作流均保留稽核失敗狀態', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const commercial = readFileSync(new URL('../.github/workflows/commercial-readiness.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(ci, /broken-link-checker/);
  // Exact step bodies guard against reintroducing shell masking or skipped checks.
  assert.match(ci, /- name: Verify local link and image audit failure detection\r?\n\s+run: node --test tools\/commercial-readiness-audit\.test\.mjs\r?\n\s*\r?\n/);
  assert.match(commercial, /- name: Build audit artifact \(never published\)\r?\n\s+run: npm run build:v2 && node tools\/build-hardened-pages\.mjs --unsigned-audit\r?\n/);
  assert.match(commercial, /- name: Audit built local links, images and static application\r?\n\s+run: node tools\/commercial-readiness-audit\.mjs\r?\n\s+- name:/);
  assert.ok(commercial.indexOf('- name: Build audit artifact') < commercial.indexOf('- name: Audit built local links'));
  assert.doesNotMatch(commercial, /continue-on-error:|\|\|\s*true|^\s+if:/m);
});
