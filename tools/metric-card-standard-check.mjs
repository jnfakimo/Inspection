import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const card = readFileSync(resolve(root, 'web/components/MetricCard.tsx'), 'utf8');
const css = readFileSync(resolve(root, 'web/app/globals.css'), 'utf8');
const analysis = readFileSync(resolve(root, 'web/components/admin/LocationAnalysisAdmin.tsx'), 'utf8');

const toneType = card.match(/type MetricTone\s*=\s*([^;]+);/);
assert.ok(toneType, 'MetricCard must define a closed MetricTone union');
const tones = [...toneType[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
assert.deepEqual(tones, ['cyan', 'green', 'amber', 'violet', 'red']);
assert.match(card, /tone\?:\s*MetricTone/, 'MetricCard tone prop must use the closed union');
assert.match(card, /tone\s*=\s*'cyan'/, 'MetricCard default tone must stay cyan');
for (const tone of tones.filter((name) => name !== 'cyan')) {
  assert.ok(css.includes(`.metric-card.${tone}{border-top-color:var(--${tone})}`), `Missing themed metric-card tone: ${tone}`);
}
const tokens = readFileSync(resolve(root, 'web/app/tokens.css'), 'utf8');
assert.match(tokens, /--red\s*:/, 'The shared red theme token must exist');
assert.match(analysis, /tone="red"/, 'The anomaly metric must keep the red tone that exposed this regression');
console.log(`MetricCard tone contract passed (${tones.length} tones).`);