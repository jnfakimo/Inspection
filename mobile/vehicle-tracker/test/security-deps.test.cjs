const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve(__dirname, '../package.json'));
const configReq = createRequire(req.resolve('@expo/config/package.json'));
const merge = configReq('deepmerge');
const expoReq = createRequire(req.resolve('expo/package.json'));
const cliPath = expoReq.resolve('@expo/cli/package.json');
const cliReq = createRequire(cliPath);
const server = path.join(path.dirname(cliPath), 'build/src/start/server');
const { PluginSchema, DevToolsPluginOutputSchema } = require(path.join(server, 'DevToolsPlugin.schema.js'));
const { createMCPDevToolsExtensionSchema } = require(path.join(server, 'createMCPDevToolsExtensionSchema.js'));

test('prototype poisoning blocked in source, target, nested objects and arrays', () => {
  const poison = JSON.parse('{"__proto__":{"auditPoison":true},"constructor":{"prototype":{"auditPoison":true}}}');
  for (const result of [merge(poison, {}), merge(Object.create(null), poison), merge({}, { nested: poison }).nested, merge([], [poison])[0]]) {
    assert.equal(result.auditPoison, undefined);
    assert.equal(Object.hasOwn(result, '__proto__'), false);
    assert.equal(Object.hasOwn(result, 'constructor'), false);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
  }
  assert.equal({}.auditPoison, undefined);
});
test('legitimate Expo configuration merges remain intact and do not mutate inputs', () => {
  const a = { ios: { supportsTablet: true }, plugins: ['a'] };
  const b = { ios: { bundleIdentifier: 'test.app' }, plugins: ['b'] };
  assert.deepEqual(merge(a, b), { ios: { supportsTablet: true, bundleIdentifier: 'test.app' }, plugins: ['a', 'b'] });
  assert.deepEqual(a, { ios: { supportsTablet: true }, plugins: ['a'] });
  const sym = Symbol('setting');
  assert.equal(merge({}, { [sym]: 7 })[sym], 7);
});
test('Expo CLI resolves patched Zod and accepts/rejects real plugin schemas', () => {
  assert.equal(cliReq('zod/package.json').version, '4.6.7');
  assert.equal(PluginSchema.safeParse({ packageName: 'test', packageRoot: '/test' }).success, true);
  assert.equal(PluginSchema.safeParse({ packageName: '', packageRoot: '/test' }).success, false);
  assert.equal(DevToolsPluginOutputSchema.safeParse([{ type: 'text', text: 'ok', level: 'info' }]).success, true);
  assert.equal(DevToolsPluginOutputSchema.safeParse([{ type: 'image', url: 'invalid' }]).success, false);
});
test('oversized constrained arrays reject before expanding element errors', () => {
  const z = cliReq('zod').z;
  const result = z.array(z.string()).max(2).safeParse(Array(10000).fill(1));
  assert.equal(result.success, false);
  assert.equal(result.error.issues.length, 1);
  assert.equal(result.error.issues[0].code, 'too_big');
});
test('patch checker refuses unexpected installed source changes', () => {
  const fs = require('node:fs');
  const { spawnSync } = require('node:child_process');
  const file = configReq.resolve('deepmerge');
  const original = fs.readFileSync(file);
  try {
    fs.appendFileSync(file, '\n// unexpected source drift\n');
    const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/patch-deepmerge.cjs'), '--check'], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /修補來源雜湊不符/);
  } finally {
    fs.writeFileSync(file, original);
  }
});
test('Expo MCP command schema preserves parameter types and rejects undeclared fields', () => {
  const schema = createMCPDevToolsExtensionSchema({ packageName: 'test', cliExtensions: { commands: [{ name: 'read', title: 'Read', parameters: [{ name: 'count', type: 'number' }, { name: 'enabled', type: 'confirm' }, { name: 'label', type: 'text' }] }] } });
  assert.equal(schema.safeParse({ command: 'read', count: 2, enabled: true, label: 'x' }).success, true);
  for (const value of [{ command: 'write' }, { command: 'read', count: '2' }, { command: 'read', extra: true }]) assert.equal(schema.safeParse(value).success, false);
  const json = cliReq('zod').z.toJSONSchema(schema);
  assert.equal(json.additionalProperties, false);
  assert.deepEqual(json.properties.command.enum ?? [json.properties.command.const], ['read']);
});
