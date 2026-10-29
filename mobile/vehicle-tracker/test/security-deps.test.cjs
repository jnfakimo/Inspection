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

test('all supported Expo commands check the mitigation even when lifecycle scripts are disabled', () => {
  const fs = require('node:fs');
  const { spawnSync } = require('node:child_process');
  const root = path.resolve(__dirname, '..');
  const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const commands = ['start', 'android', 'ios', 'export', 'native:prebuild', 'typecheck'];
  for (const command of commands) {
    assert.ok(scripts[command]?.startsWith('node scripts/patch-deepmerge.cjs --check && '), `${command} must fail closed before loading Expo`);
  }
  const file = configReq.resolve('deepmerge');
  const original = fs.readFileSync(file);
  const guard = ".filter(function(key) { return key !== '__proto__' && key !== 'constructor' && key !== 'prototype' })";
  assert.ok(original.toString().includes(guard));
  try {
    // Simulate npm ci --ignore-scripts without reinstalling or starting a server.
    fs.writeFileSync(file, original.toString().replace(guard, ''));
    assert.ok(process.env.npm_execpath, 'run through npm run test:security-deps');
    for (const command of commands) {
      const result = spawnSync(process.execPath, [process.env.npm_execpath, '--ignore-scripts', 'run', command, '--', '--help'], {
        cwd: root, encoding: 'utf8', timeout: 15000,
        env: { ...process.env, CI: '1', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_DOTENV: '1' },
      });
      assert.equal(result.error, undefined);
      assert.notEqual(result.status, 0, command);
      assert.match(result.stderr, /尚未套用修補/, command);
    }
  } finally {
    fs.writeFileSync(file, original);
  }
});

test('both distributed entry points block the advisory exploit reproduced with original code', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const dir = path.dirname(configReq.resolve('deepmerge/package.json'));
  const guard = ".filter(function(key) { return key !== '__proto__' && key !== 'constructor' && key !== 'prototype' })";
  for (const entry of ['dist/cjs.js', 'dist/umd.js']) {
    const source = fs.readFileSync(path.join(dir, entry), 'utf8');
    assert.ok(source.includes(guard));
    for (const patched of [false, true]) {
      const context = vm.createContext({ module: { exports: {} }, exports: {} });
      vm.runInContext(patched ? source : source.replace(guard, ''), context);
      const outcome = vm.runInContext(`(() => {
        const poison = JSON.parse('{"__proto__":{"auditPoison":true},"constructor":{"prototype":{"auditPoison":true}},"prototype":{"auditPoison":true}}');
        const merge = module.exports;
        const result = merge(poison, {});
        const variants = [result, merge(Object.create(null), poison), merge({}, { nested: poison }).nested, merge([], [poison])[0], merge.all([poison, {}])];
        return { reproduced: result.auditPoison === true, blocked: variants.every(value => value.auditPoison === undefined && ['__proto__', 'constructor', 'prototype'].every(key => !Object.hasOwn(value, key))), globalClean: ({}).auditPoison === undefined };
      })()`, context);
      assert.equal(outcome.reproduced, !patched, entry);
      if (patched) assert.equal(outcome.blocked, true, entry);
      assert.equal(outcome.globalClean, true, 'returned-object poisoning differs from global pollution');
    }
  }
});

test('real Expo config modification rejects poisoned plugin options and preserves normal options', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspection-config-security-'));
  try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"isolated-config","version":"1.0.0"}');
    const original = '{"expo":{"name":"isolated","slug":"isolated","plugins":[["test-plugin",{"__proto__":{"auditPoison":true},"safe":1}]]}}';
    fs.writeFileSync(path.join(dir, 'app.json'), original);
    const { modifyConfigAsync } = req('@expo/config');
    const result = await modifyConfigAsync(dir, { plugins: [['test-plugin', { added: 2 }]] }, { skipPlugins: true, skipSDKVersionRequirement: true }, { dryRun: true });
    assert.equal(result.type, 'success');
    assert.deepEqual(result.config.plugins, [['test-plugin', { safe: 1, added: 2 }]]);
    assert.equal(result.config.plugins[0][1].auditPoison, undefined);
    assert.equal(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'), original);
  } finally {
    // Only the two synthetic files created above; never recursively delete a derived path.
    for (const name of ['app.json', 'package.json']) fs.rmSync(path.join(dir, name), { force: true });
    fs.rmdirSync(dir);
  }
});

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
