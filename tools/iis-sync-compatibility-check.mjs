import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function writeTestTar(sourceRoot, names, archive) {
  const blocks = [];
  const octal = (header, offset, length, value) => {
    Buffer.from(value.toString(8).padStart(length - 1, '0') + '\0').copy(header, offset);
  };
  const append = (name, content, type) => {
    const header = Buffer.alloc(512);
    const encodedName = Buffer.from(name, 'utf8');
    assert.ok(encodedName.length <= 100, `tar fixture path too long: ${name}`);
    encodedName.copy(header);
    octal(header, 100, 8, 0o644);
    octal(header, 108, 8, 0);
    octal(header, 116, 8, 0);
    octal(header, 124, 12, content.length);
    octal(header, 136, 12, 0);
    header.fill(0x20, 148, 156);
    header.write(type, 156, 'ascii');
    header.write('ustar\0', 257, 'ascii');
    header.write('00', 263, 'ascii');
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    Buffer.from(checksum.toString(8).padStart(6, '0') + '\0 ').copy(header, 148);
    blocks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
  };
  for (const [index, name] of names.entries()) {
    const content = fs.readFileSync(path.join(sourceRoot, name));
    const tarName = name.replaceAll('\\', '/');
    if (!/^[\x00-\x7F]*$/.test(tarName)) {
      const record = `path=${tarName}\n`;
      let length = Buffer.byteLength(record) + 2;
      while (length !== Buffer.byteLength(record) + String(length).length + 1) {
        length = Buffer.byteLength(record) + String(length).length + 1;
      }
      append(`PaxHeader-${index}`, Buffer.from(`${length} ${record}`), 'x');
      append(`file-${index}`, content, '0');
    } else {
      append(tarName, content, '0');
    }
  }
  blocks.push(Buffer.alloc(1024));
  fs.writeFileSync(archive, Buffer.concat(blocks));
}

const source = fs.readFileSync('tools/sync-iis-cloud-site.ps1');
assert.deepEqual([...source.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'Windows PowerShell 5.1 requires the UTF-8 BOM');
if (process.platform !== 'win32') {
  console.log('IIS script UTF-8 BOM verified; Windows PowerShell integration requires Windows.');
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'inspection-iis-sync-test-'));
  const project = path.join(root, 'project');
  const release = path.join(root, 'release');
  const site = path.join(root, 'site');
  const state = path.join(root, 'state');
  const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000, ...options });
    assert.equal(result.status, 0, `${command}: ${result.error || ''}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  try {
    write(path.join(project, 'tools/sync-iis-cloud-site.ps1'), source);
    write(path.join(project, 'tools/verify-provenance.mjs'), fs.readFileSync('tools/verify-provenance.mjs'));
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    write(path.join(project, 'security/provenance-public-key.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
    const files = [
      { path: 'v2/login/index.html', content: '<html>new release</html>' },
      { path: 'assets/巡檢.txt', content: '繁體中文資產' },
    ];
    for (const file of files) write(path.join(release, file.path), file.content);
    const manifest = JSON.stringify({ schema: 'tapm1-provenance-v1', signed: true, repository: 'jnfakimo/Inspection', commit: 'test-commit',
      files: files.map(file => ({ path: file.path, sha256: createHash('sha256').update(file.content).digest('hex') })) });
    write(path.join(release, 'provenance.json'), manifest);
    write(path.join(release, 'provenance.sig'), sign(null, Buffer.from(manifest), privateKey).toString('base64'));
    write(path.join(site, 'v2/login/index.html'), 'old page');
    write(path.join(site, 'v2/_next/old.js'), 'keep old chunk');
    write(path.join(site, 'web.config'), 'keep IIS config');
    const archive = path.join(root, 'artifact.tar');
    // Construct the fixture without the hosted Windows tar.exe creation bug;
    // the sync script still lists and extracts the archive with the real tar.
    writeTestTar(release, [...files.map(file => file.path), 'provenance.json', 'provenance.sig'], archive);
    // Only GitHub transport is mocked; extraction, signature checks, backup and copy are real.
    const harness = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:IIS_TEST_GIT_TAR) {
  function tar {
    $converted = @($args | ForEach-Object {
      if ($_ -match '^([A-Za-z]):\\(.*)$') {
        '/' + $Matches[1].ToLowerInvariant() + '/' + $Matches[2].Replace('\', '/')
      } else { $_ }
    })
    & $env:IIS_TEST_GIT_TAR --force-local @converted
  }
}
function gh {
  $Arguments = @($args)
  $global:LASTEXITCODE = 0
  if ($Arguments[1] -eq 'list') { return '[{"databaseId":1,"headSha":"test-commit"}]' }
  if ($Arguments[1] -eq 'download') {
    $destination = $Arguments[[Array]::IndexOf($Arguments, '-D') + 1]
    [IO.Directory]::CreateDirectory($destination) | Out-Null
    Copy-Item -LiteralPath $env:IIS_TEST_ARCHIVE -Destination (Join-Path $destination 'artifact.tar')
    return
  }
  throw 'Unexpected GitHub command'
}
& (Join-Path $env:IIS_TEST_PROJECT 'tools\sync-iis-cloud-site.ps1') -SiteRoot $env:IIS_TEST_SITE -StateRoot $env:IIS_TEST_STATE -ExpectedCommit $env:IIS_TEST_COMMIT -Apply
`;
    const childEnv = { ...process.env, IIS_TEST_ARCHIVE: archive, IIS_TEST_PROJECT: project, IIS_TEST_SITE: site, IIS_TEST_STATE: state, IIS_TEST_COMMIT: 'test-commit' };
    if (process.env.GITHUB_ACTIONS === 'true') {
      // Hosted Windows tar.exe cannot reliably read this UTF-8/PAX fixture.
      // Use the runner's real Git-for-Windows tar for the integration test.
      const gitTarDirectory = path.join(process.env.ProgramFiles, 'Git', 'usr', 'bin');
      assert.ok(fs.existsSync(path.join(gitTarDirectory, 'tar.exe')), 'Git-for-Windows tar is required on the hosted runner');
      childEnv.IIS_TEST_GIT_TAR = path.join(gitTarDirectory, 'tar.exe');
    }
    // Do not pass a PowerShell 7 module search path into Windows PowerShell 5.1.
    for (const key of Object.keys(childEnv)) if (key.toLowerCase() === 'psmodulepath') delete childEnv[key];
    const rejected = spawnSync(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(harness, 'utf16le').toString('base64')],
      { encoding: 'utf8', timeout: 60000, env: { ...childEnv, IIS_TEST_COMMIT: 'different-release' } });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /differs from the reviewed commit/);
    assert.equal(fs.readFileSync(path.join(site, 'v2/login/index.html'), 'utf8'), 'old page');
    assert.equal(fs.existsSync(path.join(state, 'last-success.json')), false);
    const output = run(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(harness, 'utf16le').toString('base64')],
      { env: childEnv });
    for (const file of files) assert.equal(fs.readFileSync(path.join(site, file.path), 'utf8'), file.content);
    assert.equal(fs.readFileSync(path.join(site, 'v2/_next/old.js'), 'utf8'), 'keep old chunk');
    assert.equal(fs.readFileSync(path.join(site, 'web.config'), 'utf8'), 'keep IIS config');
    const completed = JSON.parse(fs.readFileSync(path.join(state, 'last-success.json'), 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(completed.commit, 'test-commit');
    assert.equal(fs.readFileSync(path.join(completed.backup, 'v2/login/index.html'), 'utf8'), 'old page');
    assert.ok(output.includes('test-commit'));
    console.log('Windows PowerShell 5.1 signed-artifact sync passed: wrong release refused, UTF-8 paths, backup, hashes, old chunks and IIS config preserved.');
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('inspection-iis-sync-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
}
