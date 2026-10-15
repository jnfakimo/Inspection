// 色彩 token 守門檢查（2026-10-15）。
// 規則見 web/app/tokens.css 檔首與 AGENTS.md「色彩與主題」。
//  1. UI 樣式不得寫 hex 色碼；一律使用 tokens.css 的 token。
//     例外：@media print、紙本報表選擇器（.hs-report*／paper／a4／print）、
//     主題專屬覆寫（選擇器含 data-theme）、theme-toggle（刻意不走 token）、vendor。
//  2. 核心 token 只能在 tokens.css 定義，其他 CSS 不得重新宣告。
//  3. tsx／ts 內的 hex 只允許出現在圖表／3D／圖面等資料視覺化檔案（見 ALLOW_TSX）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(root, 'web');
const SKIP = new Set(['node_modules', '.next', 'out', 'dist', 'vendor', 'public']);
const PAPER = /\.hs-(daily-)?report|\.hs-report|paper|a4|print|theme-toggle/i;
const CORE_TOKENS = ['bg', 'panel', 'panel2', 'line', 'text', 'dim', 'muted', 'ink', 'cyan', 'green', 'amber', 'red', 'violet', 'blue',
  'surface', 'surface-soft', 'surface-muted', 'surface-deep', 'primary', 'font', 'head', 'form-control-height'];

// tsx／ts 中允許直接寫色碼的檔案：圖表系列色、3D／圖面標記、列印視窗、第三方地圖。
const ALLOW_TSX = [
  /chart-palette\.ts$/, // 圖表系列色盤唯一正本（web/lib/chart-palette.ts）
  /structuremap-viewers\.tsx$/, /structuremap-markerboard\.tsx$/, /structuremap-floor3d\.tsx$/,
  /floor-stack-3d\.tsx$/, /repair-map3d\.tsx$/, /patrol-map3d\.tsx$/, /modeler-client\.tsx$/,
  /vehicle-tracking-workspace\.tsx$/, /vehicle-workspace\.tsx$/, /patrol-status\.ts$/, /layout\.tsx$/,
  /official-docs-workspace\.tsx$/, // 條碼 SVG 固定黑色
  /handover-sheet\.tsx$/, // 列印 @page 邊角文字（紙本）
  /weather-widget\.tsx$/, // 縣市地圖 SVG 描邊
  /\.test\.(ts|tsx|mjs)$/,
];

const errors = [];
const walk = (dir, out = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const files = walk(webRoot);

for (const file of files.filter((f) => f.endsWith('.css'))) {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  const isTokens = rel === 'web/app/tokens.css';
  const src = fs.readFileSync(file, 'utf8');
  const stack = [];
  let buf = '';
  let line = 1;
  let inComment = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\n') line++;
    if (inComment) { if (c === '*' && src[i + 1] === '/') { inComment = false; i++; } continue; }
    if (c === '/' && src[i + 1] === '*') { inComment = true; i++; continue; }
    if (c === '{') { stack.push(buf.trim()); buf = ''; continue; }
    if (c === '}') {
      const selector = stack[stack.length - 1] ?? '';
      const inPrint = stack.some((s) => /^@media[^{]*print/.test(s));
      const isAt = selector.startsWith('@');
      if (!isAt && !isTokens) {
        const themeScoped = /data-theme/.test(selector);
        const exempt = inPrint || themeScoped || PAPER.test(selector) || /@keyframes|@font-face/.test(stack.join(' '));
        // 全站單一主色：系統卡、維修入口卡、手機快捷卡不得再以 amber／green／violet 區分（含 :not() 排除寫法）。
        if (/\.(system-card|maintenance-card)(\.|:not\(\.)(amber|green|violet)\b|\.quick-grid a(\.|:not\(\.)(amber|green|violet)\b/.test(selector)) {
          errors.push(`${rel}:${line} 卡片不得依系統分色（${selector.slice(0, 60)}），全站單一主色`);
        }
        // 亮色實心底配 --on-solid（固定白字）在科技版對比不足（白字配 #00d4ff 只有 1.77:1）；改用 --on-bright 或 --on-primary-solid。
        if (!exempt && /background(-color)?\s*:\s*var\(--(cyan|primary|green|amber|violet|live|blue|red)\)/.test(buf)
          && /(^|;)\s*color\s*:\s*var\(--on-solid\)/.test(buf)) {
          errors.push(`${rel}:${line} 亮色實心底不得配 --on-solid（${selector.slice(0, 50)}），請改用 --on-bright`);
        }
        for (const decl of buf.split(';')) {
          const idx = decl.indexOf(':');
          if (idx < 0) continue;
          const prop = decl.slice(0, idx).trim();
          const val = decl.slice(idx + 1);
          if (!exempt && HEX.test(val)) {
            errors.push(`${rel}:${line} 色碼不得硬編碼（${selector.slice(0, 50)} { ${prop} }），請改用 tokens.css 的 token`);
          }
          HEX.lastIndex = 0;
          // 卡片上緣只能是統一的 --icon-sky（或邊線色），不得依位置（:nth-child）或系統分色。
          if (!exempt && /(system-card|maintenance-card|operations-portal-card|module-grid a|quick-grid a)/.test(selector)
            && /^border-top(-color)?$/.test(prop) && /var\(--/.test(val) && !/var\(--(icon-sky|line)\)/.test(val)) {
            errors.push(`${rel}:${line} 卡片上緣色只能使用 --icon-sky（${selector.slice(0, 60)} { ${prop} }）`);
          }
          const m = prop.match(/^--([\w-]+)$/);
          if (m && CORE_TOKENS.includes(m[1])) {
            errors.push(`${rel}:${line} 核心 token --${m[1]} 只能在 tokens.css 定義`);
          }
        }
      }
      buf = '';
      stack.pop();
      continue;
    }
    buf += c;
  }
}

for (const file of files.filter((f) => /\.(tsx|ts)$/.test(f))) {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  if (ALLOW_TSX.some((re) => re.test(rel))) continue;
  const src = fs.readFileSync(file, 'utf8');
  src.split('\n').forEach((ln, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(ln)) return;
    const code = ln.replace(/\/\/.*$/, '');
    if (HEX.test(code) && !/(href|src|url\(|&#|\bid=|#\w+['"]\s*[,)]?\s*$)/.test(code) && /(color|background|fill|stroke|border|shadow|style|tone)/i.test(code)) {
      errors.push(`${rel}:${i + 1} tsx 內不得硬編碼色碼，請改用 var(--token)，或將檔案列入 color-token-check 的 ALLOW_TSX 並說明理由`);
    }
    HEX.lastIndex = 0;
  });
}

if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n色彩 token 檢查失敗：${errors.length} 處`);
  process.exit(1);
}
console.log('色彩 token 檢查通過：UI 樣式無硬編碼色碼，核心 token 只在 tokens.css 定義。');
