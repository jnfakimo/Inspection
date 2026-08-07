import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  await cp(path.join(projectRoot, 'assets'), path.join(outputRoot, 'assets'), { recursive: true });

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

function addNoIndexDirective(html) {
  if (/\bname\s*=\s*["']robots["']/i.test(html)) return html;
  return html.replace(
    /<head(?:\s[^>]*)?>/i,
    '$&<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">',
  );
}

async function minifyRuntimeCode() {
  const files = await listFiles(outputRoot);
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (extension === '.html') {
      const source = addNoIndexDirective(await readFile(file, 'utf8'));
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
      const source = await readFile(file, 'utf8');
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
await verifyArtifact();
