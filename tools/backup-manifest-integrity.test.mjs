import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyBackup } from './database-backup.mjs';

test('備份清單拒絕未列出檔案、重複表、錯誤總計與路徑穿越', async () => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'inspection-manifest-'));
 try {
  await fs.mkdir(path.join(dir,'tables'));
  const body='{"id":1}\n';
  const manifest={version:2,scope:{public_tables:true,storage_objects:false},totals:{tables:1,rows:1,storage_objects:0,storage_bytes:0},tables:[{name:'sample',rows:1,sha256:createHash('sha256').update(body).digest('hex')}],storage:[]};
  const save=m=>fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(m));
  await fs.writeFile(path.join(dir,'tables/sample.ndjson'),body);await save(manifest);
  assert.deepEqual((await verifyBackup(dir)).problems,[]);
  await fs.writeFile(path.join(dir,'tables/unlisted.ndjson'),body);
  assert.ok((await verifyBackup(dir)).problems.some(p=>p.includes('清單外')));
  await fs.unlink(path.join(dir,'tables/unlisted.ndjson'));
  for(const changed of [
   {...manifest,tables:[...manifest.tables,...manifest.tables]},
   {...manifest,totals:{...manifest.totals,rows:10}},
   {...manifest,tables:[{...manifest.tables[0],name:'../outside'}]},
  ]){await save(changed);assert.ok((await verifyBackup(dir)).problems.length>0);}
 } finally { await fs.rm(dir,{recursive:true,force:true}); }
});
