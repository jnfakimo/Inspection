import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createPublicKey, verify as verifySignature } from 'node:crypto';

const projectRoot = process.cwd();
const manifestPath = process.argv[2] || path.join(projectRoot, '_site', 'provenance.json');
const signaturePath = process.argv[3] || path.join(projectRoot, '_site', 'provenance.sig');
const publicKeyPath = process.argv[4] || path.join(projectRoot, 'security', 'provenance-public-key.pem');

const [manifestText, signatureText, publicKeyText] = await Promise.all([
  readFile(manifestPath, 'utf8'),
  readFile(signaturePath, 'utf8'),
  readFile(publicKeyPath, 'utf8'),
]);
const manifest = JSON.parse(manifestText);
if (manifest.schema !== 'tapm1-provenance-v1' || manifest.signed !== true) {
  throw new Error('來源清單不是已簽章的正式版本。');
}
const signature = Buffer.from(signatureText.trim(), 'base64');
const valid = verifySignature(
  null,
  Buffer.from(manifestText, 'utf8'),
  createPublicKey(publicKeyText),
  signature,
);
if (!valid) throw new Error('來源清單簽章無效。');
console.log(`來源簽章有效：${manifest.repository}@${manifest.commit}，共 ${manifest.files.length} 個檔案。`);
