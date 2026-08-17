import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash, createPublicKey, sign as signPayload, verify as verifySignature } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const { minify: minifyHtml } = require('html-minifier-terser');
const { minify: minifyJs } = require('terser');

const projectRoot = process.cwd();
const outputRoot = path.join(projectRoot, '_site');
const systemRoot = path.join(projectRoot, 'system');
const outputSystemRoot = path.join(outputRoot, 'system');
const publicKeySource = path.join(projectRoot, 'security', 'provenance-public-key.pem');
const provenanceNamespace = 'com.jnfakimo.word-cloud.provenance';
const provenanceOwner = 'jnfakimo';
const provenanceRepository = process.env.GITHUB_REPOSITORY || 'jnfakimo/word-cloud';
const provenanceCommit = process.env.GITHUB_SHA || 'local-validation';

const runtimeSystemDirectories = ['assets', 'icons', 'plans', 'vendor'];
const runtimeSystemExtensions = new Set([
  '.css',
  '.html',
  '.js',
  '.mobileconfig',
  '.webmanifest',
]);
const forbiddenOutputExtensions = new Set([
  '.bak', '.bat', '.env', '.map', '.md', '.mjs', '.odb', '.ps1', '.py', '.sql', '.ts',
]);
const requiredOutputFiles = [
  'index.html',
  'system/index.html',
  'system/login.html',
  'system/admin.html',
  'system/theme.js',
  'system/supabase-config.js',
  'provenance-public-key.pem',
  'proprietary-notice.txt',
  'provenance.json',
  'provenance.sig',
];
const sensitiveOutputFiles = [
  'PROJECT_CONTEXT.md',
  'system/sql/schema.sql',
  'system/ipcam-config.json',
  'supabase/functions/ipcam-proxy/index.ts',
];

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function copyRuntimeFiles() {
  await cp(path.join(projectRoot, 'index.html'), path.join(outputRoot, 'index.html'));
  await cp(path.join(projectRoot, 'LICENSE'), path.join(outputRoot, 'proprietary-notice.txt'));
  await cp(path.join(projectRoot, 'assets'), path.join(outputRoot, 'assets'), { recursive: true });
  // V2 is kept in the repository for maintenance, but is intentionally not
  // published in this V1-only deployment.  This removes /Inspection/v2/ from
  // the generated GitHub Pages artifact without deleting its source files.

  const systemEntries = await readdir(systemRoot, { withFileTypes: true });
  for (const entry of systemEntries) {
    const source = path.join(systemRoot, entry.name);
    const destination = path.join(outputSystemRoot, entry.name);
    if (entry.isDirectory()) {
      if (runtimeSystemDirectories.includes(entry.name)) {
        await cp(source, destination, { recursive: true });
      }
      continue;
    }
    if (entry.isFile() && runtimeSystemExtensions.has(path.extname(entry.name).toLowerCase())) {
      await cp(source, destination);
    }
  }
}

function provenanceMarker(relativePath) {
  return createHash('sha256')
    .update(`${provenanceNamespace}\0${provenanceRepository}\0${provenanceCommit}\0${relativePath}`)
    .digest('base64url')
    .slice(0, 32);
}

function addHtmlDirectives(html, relativePath) {
  const directives = [];
  if (!/\bname\s*=\s*["']robots["']/i.test(html)) {
    directives.push('<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">');
  }
  if (!/\bname\s*=\s*["']application-provenance["']/i.test(html)) {
    directives.push(`<meta name="application-provenance" content="TAPM1:${provenanceMarker(relativePath)}">`);
  }
  if (!/\bname\s*=\s*["']copyright["']/i.test(html)) {
    directives.push('<meta name="copyright" content="Copyright © 2026 jnfakimo. All rights reserved.">');
  }
  if (!directives.length) return html;
  return html.replace(/<head(?:\s[^>]*)?>/i, `$&${directives.join('')}`);
}

function addJavaScriptProvenance(source, relativePath) {
  const registry = JSON.stringify(provenanceNamespace);
  const marker = JSON.stringify(provenanceMarker(relativePath));
  return `(()=>{const k=Symbol.for(${registry}),g=globalThis;if(!g[k])Object.defineProperty(g,k,{value:new Set,enumerable:false,configurable:false,writable:false});g[k].add(${marker})})();\n${source}`;
}

async function minifyRuntimeCode() {
  const files = await listFiles(outputRoot);
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    const relative = toPosix(path.relative(outputRoot, file));
    const isNextArtifact = relative.startsWith('v2/');
    if (extension === '.html') {
      const source = addHtmlDirectives(await readFile(file, 'utf8'), relative);
      // Next.js 的靜態 HTML 內含 React Server Component / hydration 對照資料。
      // 二次折疊空白會令瀏覽器端樹狀結構與建置時不同，因此只加入安全標記，
      // 不再對 Next 已最佳化的輸出進行第二次 HTML 壓縮。
      if (isNextArtifact) {
        await writeFile(file, source, 'utf8');
        continue;
      }
      const result = await minifyHtml(source, {
        caseSensitive: true,
        collapseBooleanAttributes: false,
        collapseWhitespace: true,
        conservativeCollapse: false,
        decodeEntities: false,
        keepClosingSlash: true,
        minifyCSS: true,
        minifyJS: {
          compress: { passes: 2 },
          format: { comments: false },
          mangle: { toplevel: false },
        },
        minifyURLs: false,
        removeAttributeQuotes: false,
        removeComments: true,
        removeOptionalTags: false,
        sortAttributes: false,
        sortClassName: false,
      });
      await writeFile(file, result, 'utf8');
    } else if (extension === '.js' && !toPosix(file).includes('/vendor/')) {
      const source = addJavaScriptProvenance(await readFile(file, 'utf8'), relative);
      if (isNextArtifact) {
        await writeFile(file, source, 'utf8');
        continue;
      }
      const result = await minifyJs(source, {
        compress: { passes: 2 },
        format: { comments: false },
        mangle: { toplevel: false },
      });
      if (!result.code) throw new Error(`JavaScript 壓縮失敗：${toPosix(path.relative(projectRoot, file))}`);
      await writeFile(file, result.code, 'utf8');
    }
  }
}

async function sha256File(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

async function writeSignedProvenance() {
  const publicKey = await readFile(publicKeySource, 'utf8');
  await writeFile(path.join(outputRoot, 'provenance-public-key.pem'), publicKey, 'utf8');

  const files = (await listFiles(outputRoot))
    .filter((file) => !['provenance.json', 'provenance.sig'].includes(path.basename(file)));
  const entries = [];
  for (const file of files) {
    entries.push({
      path: toPosix(path.relative(outputRoot, file)),
      sha256: await sha256File(file),
    });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, 'en'));

  const privateKey = String(process.env.PROVENANCE_PRIVATE_KEY || '').trim();
  if (process.env.GITHUB_ACTIONS === 'true' && !privateKey) {
    throw new Error('正式部署缺少 PROVENANCE_PRIVATE_KEY，拒絕產生未簽章網站。');
  }
  const manifest = {
    schema: 'tapm1-provenance-v1',
    application: '臺北農產第一果菜市場整合管理系統',
    ownerMarker: provenanceOwner,
    repository: provenanceRepository,
    commit: provenanceCommit,
    generatedAt: new Date().toISOString(),
    signed: Boolean(privateKey),
    files: entries,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  let signatureText = 'UNSIGNED-LOCAL-BUILD\n';
  if (privateKey) {
    const signature = signPayload(null, Buffer.from(manifestText, 'utf8'), privateKey);
    if (!verifySignature(null, Buffer.from(manifestText, 'utf8'), createPublicKey(publicKey), signature)) {
      throw new Error('數位來源簽章驗證失敗，停止部署。');
    }
    signatureText = `${signature.toString('base64')}\n`;
  }
  await writeFile(path.join(outputRoot, 'provenance.json'), manifestText, 'utf8');
  await writeFile(path.join(outputRoot, 'provenance.sig'), signatureText, 'utf8');
}

function assertNoElevatedJwt(text, file) {
  const candidates = text.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [];
  for (const token of candidates) {
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      if (payload?.role === 'service_role') {
        throw new Error(`正式網站包含 service_role JWT：${file}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('正式網站包含')) throw error;
    }
  }
}

async function verifyArtifact() {
  const files = await listFiles(outputRoot);
  const relativeFiles = files.map((file) => toPosix(path.relative(outputRoot, file)));
  const fileSet = new Set(relativeFiles);

  for (const required of requiredOutputFiles) {
    if (!fileSet.has(required)) throw new Error(`正式網站缺少必要檔案：${required}`);
  }
  for (const sensitive of sensitiveOutputFiles) {
    if (fileSet.has(sensitive)) throw new Error(`正式網站不應包含敏感來源檔案：${sensitive}`);
  }
  for (const file of relativeFiles) {
    const extension = path.extname(file).toLowerCase();
    if (forbiddenOutputExtensions.has(extension)) {
      throw new Error(`正式網站包含禁止發佈的檔案：${file}`);
    }
  }

  const textFiles = files.filter((file) => ['.css', '.html', '.js', '.json', '.webmanifest'].includes(path.extname(file).toLowerCase()));
  for (const file of textFiles) {
    const text = await readFile(file, 'utf8');
    const relative = toPosix(path.relative(outputRoot, file));
    if (relative.endsWith('.html') && !/name="application-provenance" content="TAPM1:[A-Za-z0-9_-]{32}"/.test(text)) {
      throw new Error(`正式頁面缺少隱藏來源指紋：${relative}`);
    }
    if (relative.endsWith('.js') && !relative.includes('/vendor/') && !text.includes(provenanceNamespace)) {
      throw new Error(`正式 JavaScript 缺少隱藏來源指紋：${relative}`);
    }
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
      throw new Error(`正式網站包含私鑰內容：${relative}`);
    }
    if (/\bsb_secret_[A-Za-z0-9_-]+/.test(text)) {
      throw new Error(`正式網站包含 Supabase secret key：${relative}`);
    }
    if (/tray-wax-pace-tampa\.trycloudflare\.com\/ipcam/i.test(text)) {
      throw new Error(`正式網站包含攝影機來源位址：${relative}`);
    }
    assertNoElevatedJwt(text, relative);
  }

  const htmlCount = relativeFiles.filter((file) => file.endsWith('.html')).length;
  if (htmlCount < 30) throw new Error(`正式網站 HTML 數量異常：${htmlCount}`);
  console.log(`安全部署產物完成：${relativeFiles.length} 個檔案、${htmlCount} 個頁面。`);
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputSystemRoot, { recursive: true });
await copyRuntimeFiles();
await minifyRuntimeCode();
await writeFile(path.join(outputRoot, '.nojekyll'), '', 'utf8');
await writeFile(
  path.join(outputRoot, 'robots.txt'),
  'User-agent: *\nDisallow: /word-cloud/system/\n',
  'utf8',
);
await writeSignedProvenance();
await verifyArtifact();
