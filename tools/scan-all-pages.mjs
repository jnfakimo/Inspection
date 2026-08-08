import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';
import { createPublicKey, verify as verifySignature } from 'node:crypto';

const projectRoot = process.cwd();
const outputRoot = path.join(projectRoot, '_site');
const remoteBaseUrl = process.argv[2] ? new URL(process.argv[2]) : null;
const expectedCommit = process.env.EXPECTED_COMMIT || process.env.GITHUB_SHA || '';
const provenanceNamespace = 'com.jnfakimo.word-cloud.provenance';
const sensitivePaths = [
  'PROJECT_CONTEXT.md',
  'system/sql/schema.sql',
  'supabase/functions/ipcam-proxy/index.ts',
  'system/ipcam-config.json',
];

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

async function sourcePagePaths() {
  const systemEntries = await readdir(path.join(projectRoot, 'system'), { withFileTypes: true });
  return [
    'index.html',
    ...systemEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
      .map((entry) => `system/${entry.name}`),
  ].sort();
}

function compileInlineScripts(html, file) {
  let count = 0;
  const scripts = html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*\btype=["'](?:module|application\/ld\+json|application\/json)["'])[^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    if (!match[1].trim()) continue;
    new vm.Script(match[1], { filename: `${file}:inline-${count + 1}` });
    count += 1;
  }
  return count;
}

function localReferenceTarget(pagePath, rawReference) {
  const reference = String(rawReference || '').trim();
  if (!reference || reference.startsWith('#') || /^(?:[a-z]+:|\/\/)/i.test(reference)) return null;
  if (/[`${}]/.test(reference)) return null;
  const clean = decodeURIComponent(reference.split(/[?#]/)[0]);
  if (!clean) return null;
  const normalized = clean.startsWith('/word-cloud/')
    ? clean.slice('/word-cloud/'.length)
    : clean.startsWith('/')
      ? clean.slice(1)
      : toPosix(path.normalize(path.join(path.posix.dirname(pagePath), clean)));
  return normalized.endsWith('/') ? `${normalized}index.html` : normalized;
}

function validateStaticReferences(html, pagePath) {
  const missing = [];
  const markupOnly = html.replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi, '');
  const attributes = markupOnly.matchAll(/\b(?:href|src|manifest)\s*=\s*["']([^"']*)["']/gi);
  for (const match of attributes) {
    const target = localReferenceTarget(pagePath, match[1]);
    if (!target) continue;
    const absoluteTarget = path.join(outputRoot, ...target.split('/'));
    if (!existsSync(absoluteTarget)) missing.push(`${match[1]} → ${target}`);
  }
  if (missing.length) {
    throw new Error(`${pagePath} 包含不存在的本機連結：\n${missing.map((item) => `  - ${item}`).join('\n')}`);
  }
}

async function scanLocalArtifact(pagePaths) {
  let inlineScriptCount = 0;
  for (const pagePath of pagePaths) {
    const outputPath = path.join(outputRoot, ...pagePath.split('/'));
    if (!existsSync(outputPath)) throw new Error(`安全產物缺少頁面：${pagePath}`);
    const html = await readFile(outputPath, 'utf8');
    if (!/name="application-provenance" content="TAPM1:[A-Za-z0-9_-]{32}"/.test(html)) {
      throw new Error(`頁面缺少隱藏來源指紋：${pagePath}`);
    }
    if (!/name="copyright" content="Copyright © 2026 jnfakimo\. All rights reserved\."/.test(html)) {
      throw new Error(`頁面缺少權利標記：${pagePath}`);
    }
    inlineScriptCount += compileInlineScripts(html, pagePath);
    validateStaticReferences(html, pagePath);
  }

  const outputSystemEntries = await readdir(path.join(outputRoot, 'system'), { withFileTypes: true });
  let javaScriptCount = 0;
  for (const entry of outputSystemEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const file = path.join(outputRoot, 'system', entry.name);
    const source = await readFile(file, 'utf8');
    new vm.Script(source, { filename: `system/${entry.name}` });
    if (!source.includes(provenanceNamespace)) {
      throw new Error(`JavaScript 缺少執行階段來源標記：system/${entry.name}`);
    }
    javaScriptCount += 1;
  }
  console.log(`本機全站掃描通過：${pagePaths.length} 個頁面、${inlineScriptCount} 段內嵌程式、${javaScriptCount} 個自有 JavaScript。`);
}

async function fetchWithRetry(url, expectedStatus, attempts = 6) {
  let lastStatus = 0;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'cache-control': 'no-cache' },
      });
      lastStatus = response.status;
      if (response.status === expectedStatus) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }
  throw new Error(`${url} 預期 HTTP ${expectedStatus}，實際 ${lastStatus || String(lastError)}`);
}

async function scanRemoteArtifact(pagePaths) {
  const scanToken = `${expectedCommit || 'manual'}-${Date.now()}`;
  let scanned = 0;
  for (let offset = 0; offset < pagePaths.length; offset += 6) {
    const batch = pagePaths.slice(offset, offset + 6);
    await Promise.all(batch.map(async (pagePath) => {
      const url = new URL(pagePath, remoteBaseUrl);
      url.searchParams.set('provenance-scan', scanToken);
      const response = await fetchWithRetry(url, 200);
      const contentType = response.headers.get('content-type') || '';
      const html = await response.text();
      if (!contentType.includes('text/html')) throw new Error(`${pagePath} 回傳非 HTML：${contentType}`);
      if (!/name="application-provenance" content="TAPM1:[A-Za-z0-9_-]{32}"/.test(html)) {
        throw new Error(`正式頁面缺少隱藏來源指紋：${pagePath}`);
      }
      scanned += 1;
    }));
  }

  for (const sensitivePath of sensitivePaths) {
    const url = new URL(sensitivePath, remoteBaseUrl);
    url.searchParams.set('provenance-scan', scanToken);
    await fetchWithRetry(url, 404);
  }

  const manifestUrl = new URL('provenance.json', remoteBaseUrl);
  const signatureUrl = new URL('provenance.sig', remoteBaseUrl);
  const publicKeyUrl = new URL('.well-known/provenance-public-key.pem', remoteBaseUrl);
  [manifestUrl, signatureUrl, publicKeyUrl].forEach((url) => url.searchParams.set('provenance-scan', scanToken));
  const [manifestResponse, signatureResponse, publicKeyResponse] = await Promise.all([
    fetchWithRetry(manifestUrl, 200),
    fetchWithRetry(signatureUrl, 200),
    fetchWithRetry(publicKeyUrl, 200),
  ]);
  const [manifestText, signatureText, publicKeyText] = await Promise.all([
    manifestResponse.text(),
    signatureResponse.text(),
    publicKeyResponse.text(),
  ]);
  const manifest = JSON.parse(manifestText);
  if (manifest.signed !== true) throw new Error('正式網站來源清單未簽章。');
  if (expectedCommit && manifest.commit !== expectedCommit) {
    throw new Error(`正式網站版本不符：預期 ${expectedCommit}，實際 ${manifest.commit}`);
  }
  const valid = verifySignature(
    null,
    Buffer.from(manifestText, 'utf8'),
    createPublicKey(publicKeyText),
    Buffer.from(signatureText.trim(), 'base64'),
  );
  if (!valid) throw new Error('正式網站數位來源簽章無效。');
  const manifestPages = new Set(manifest.files.filter((file) => file.path.endsWith('.html')).map((file) => file.path));
  for (const pagePath of pagePaths) {
    if (!manifestPages.has(pagePath)) throw new Error(`來源清單缺少頁面：${pagePath}`);
  }
  console.log(`正式全站掃描通過：${scanned} 個頁面、${sensitivePaths.length} 個敏感路徑封鎖、數位簽章有效。`);
}

const pages = await sourcePagePaths();
if (remoteBaseUrl) await scanRemoteArtifact(pages);
else await scanLocalArtifact(pages);
