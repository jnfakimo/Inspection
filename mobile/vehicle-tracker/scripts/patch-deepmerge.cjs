// Local mitigation for GHSA-gcqx-w48m-w2h4; retain upstream version/audit visibility.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const req = createRequire(path.join(root, 'package.json'));
const configReq = createRequire(req.resolve('@expo/config/package.json'));
const packagePath = configReq.resolve('deepmerge/package.json');
if (JSON.parse(fs.readFileSync(packagePath)).version !== '4.3.1') {
  throw new Error('deepmerge 版本變更，請重新審查修補；不得靜默略過。');
}
const inputs = {
  'index.js': '12440c84957c1990ea2d5e33dc0091722dc1dc1585c6d20e0c780e568ffa9d30',
  'dist/cjs.js': '2e5160f84a1141bd927264afe4d15766f1e6cf07daef182b37ff53fea121de7d',
  'dist/umd.js': 'f33e6596482d1fb5c7c427f8ef92f2aa849eea9223acd974176b2fb27ddbf73a',
};
const replacement = "return Object.keys(target).concat(getEnumerableOwnPropertySymbols(target)).filter(function(key) { return key !== '__proto__' && key !== 'constructor' && key !== 'prototype' })";
const original = 'return Object.keys(target).concat(getEnumerableOwnPropertySymbols(target))';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
// Validate every input before writing any file, and verify exact patched content on reruns.
const edits = Object.entries(inputs).map(([name, expected]) => {
  const file = path.join(path.dirname(packagePath), name);
  const text = fs.readFileSync(file, 'utf8');
  const restored = text.replace(replacement, original);
  if (digest(restored) !== expected) throw new Error(`修補來源雜湊不符：${name}`);
  const patched = restored.replace(original, replacement);
  if (patched === restored) throw new Error(`找不到修補位置：${name}`);
  if (process.argv.includes('--check') && text !== patched) throw new Error(`尚未套用修補：${name}；請執行 npm run postinstall`);
  return { file, patched };
});
if (!process.argv.includes('--check')) for (const { file, patched } of edits) fs.writeFileSync(file, patched);
console.log('deepmerge 本機修補與來源雜湊驗證通過；npm audit 的上游公告仍保留。');
