import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

function addColumn(tables, table, column) {
  if (!tables.has(table)) tables.set(table, new Set());
  tables.get(table).add(column);
}

function loadSchema() {
  const tables = new Map();
  const files = [...listFiles(path.join(root, 'system/sql')), ...listFiles(path.join(root, 'supabase/migrations'))]
    .filter(file => file.endsWith('.sql'));
  for (const file of files) {
    const sql = fs.readFileSync(file, 'utf8').replace(/--[^\n]*/g, '');
    for (const match of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\);/gi)) {
      const table = match[1].toLowerCase();
      for (const line of match[2].split(/,\s*(?=[a-z_][a-z0-9_]*\s+)/i)) {
        const column = line.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+/i)?.[1];
        if (column) addColumn(tables, table, column.toLowerCase());
      }
    }
    for (const match of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
      addColumn(tables, match[1].toLowerCase(), match[2].toLowerCase());
    }
  }
  return tables;
}

function unique(values) { return [...new Set(values)]; }

function collectModuleSources() {
  const source = fs.readFileSync(path.join(root, 'supabase/functions/app-api/index.ts'), 'utf8');
  const contracts = [];
  const re = /source\('([^']+)'\s*,\s*'[^']+'\s*,\s*'[^']+'\s*,\s*\[\[([\s\S]*?)\]\]\s*(?:,\s*'([^']*)')?/g;
  for (const match of source.matchAll(re)) {
    const columns = [...match[2].matchAll(/\['([^']+)'/g)].map(item => item[1]);
    contracts.push({ name: `MODULE_SOURCES ${match[1]}`, table: match[1], columns, order: match[3] || '' });
  }
  return contracts;
}

function collectEquipmentTableConfig() {
  const source = fs.readFileSync(path.join(root, 'supabase/functions/app-api/index.ts'), 'utf8');
  const contracts = [];
  const start = source.indexOf('const EQUIPMENT_TABLES');
  const end = source.indexOf('export async function handleAppApiRequest', start);
  const body = source.slice(start, end);
  for (const match of body.matchAll(/(\w+):\s*\{\s*pk:\s*'([^']+)'[\s\S]*?fields:\s*\{([\s\S]*?)\n\s*\},\s*\n\s*\},/g)) {
    const fields = [...match[3].matchAll(/([a-z_][a-z0-9_]*):\s*\{/gi)].map(item => item[1]);
    const metadata = body.slice(match.index, match.index + match[0].length);
    const createdBy = metadata.match(/createdBy:\s*'([^']+)'/)?.[1];
    const updatedBy = metadata.match(/updatedBy:\s*'([^']+)'/)?.[1];
    contracts.push({
      name: `EQUIPMENT_TABLES ${match[1]}`,
      table: match[1],
      columns: unique([match[2], ...fields, createdBy, updatedBy].filter(Boolean)),
    });
  }
  return contracts;
}

function collectDirectSelects() {
  const contracts = [];
  const files = [...listFiles(path.join(root, 'web')), ...listFiles(path.join(root, 'system')), ...listFiles(path.join(root, 'supabase/functions'))]
    .filter(file => /\.(tsx?|html)$/.test(file));
  const splitTopLevel = (value) => {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
      if (value[index] === '(') depth += 1;
      if (value[index] === ')') depth -= 1;
      if (value[index] === ',' && depth === 0) {
        parts.push(value.slice(start, index).trim());
        start = index + 1;
      }
    }
    parts.push(value.slice(start).trim());
    return parts.filter(Boolean);
  };
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\.from\(\s*['"]([a-z_][a-z0-9_]*)['"]\s*\)\.select\(\s*['"]([^'"]+)['"]/gi)) {
      const select = match[2].trim();
      if (select === '*') continue;
      const collect = (table, content, label) => {
        const columns = [];
        for (const part of splitTopLevel(content)) {
          const relation = part.match(/^([a-z_][a-z0-9_]*(?::[a-z_][a-z0-9_]*)?)(?:![^()]+)?\(([\s\S]*)\)$/i);
          if (relation) {
            const relationTable = relation[1].split(':').find(candidate => schema.has(candidate.toLowerCase())) || relation[1].split(':')[0];
            collect(relationTable, relation[2], `${label} nested select`);
            continue;
          }
          const column = part.split(/\s+as\s+/i)[0];
          if (/^[a-z_][a-z0-9_]*$/i.test(column)) columns.push(column);
        }
        if (columns.length) contracts.push({ name: label, table, columns });
      };
      collect(match[1], select, `${path.relative(root, file)} direct select`);
    }
  }
  return contracts;
}

const schema = loadSchema();
const contracts = [...collectModuleSources(), ...collectEquipmentTableConfig(), ...collectDirectSelects()];
const errors = [];
for (const contract of contracts) {
  const columns = schema.get(contract.table);
  if (!columns) {
    errors.push(`${contract.name}: 找不到資料表 ${contract.table}`);
    continue;
  }
  for (const column of contract.columns) {
    if (!columns.has(column)) errors.push(`${contract.name}: ${contract.table}.${column} 不存在於 SQL schema`);
  }
  if (contract.order && !columns.has(contract.order)) errors.push(`${contract.name}: 排序欄位 ${contract.table}.${contract.order} 不存在於 SQL schema`);
}

// 系統存取權限（sys_*）的清單散在三個地方，彼此沒有任何關聯：
//   web/components/admin/shared.tsx     後台「系統存取權限」矩陣顯示的欄位
//   supabase/functions/admin-api        admin_set_permission 的伺服器端白名單
//   system/sql/system_access_seed.sql   新專案佈建時要建立的權限列
// 只加前面沒加後面時，畫面上會出現一個勾得動、但伺服器一律回「權限代碼無效」的
// 核取方塊——2026-08-31 加 sys_dashboard 就是這樣，看起來像「不能取消」。
const sharedSource = fs.readFileSync(path.join(root, 'web/components/admin/shared.tsx'), 'utf8');
const adminApiSource = fs.readFileSync(path.join(root, 'supabase/functions/admin-api/index.ts'), 'utf8');
const seedSource = fs.readFileSync(path.join(root, 'system/sql/system_access_seed.sql'), 'utf8');

const uiSystemPerms = [...(sharedSource.match(/SYSTEM_PERMISSIONS[\s\S]*?\] as const;/) || [''])[0]
  .matchAll(/'(sys_[a-z_]+)'/g)].map(match => match[1]);
const apiPerms = new Set([...(adminApiSource.match(/const PERMISSIONS = new Set\(\[[^\]]*\]/) || [''])[0]
  .matchAll(/'(sys_[a-z_]+)'/g)].map(match => match[1]));
const seedPerms = new Set([...seedSource.matchAll(/\('(sys_[a-z_]+)'\)/g)].map(match => match[1]));

if (!uiSystemPerms.length) errors.push('系統存取權限：讀不到 shared.tsx 的 SYSTEM_PERMISSIONS');
for (const perm of uiSystemPerms) {
  if (!apiPerms.has(perm)) errors.push(`系統存取權限：${perm} 不在 admin-api 的 PERMISSIONS 白名單，後台會勾不動`);
  if (!seedPerms.has(perm)) errors.push(`系統存取權限：${perm} 不在 system_access_seed.sql，新專案佈建會缺這一列`);
}

if (errors.length) {
  console.error(`資料表／前端欄位一致性檢查失敗（${errors.length} 項）：`);
  for (const error of unique(errors)) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`資料表／前端欄位一致性檢查通過：${contracts.length} 組契約，涵蓋 ${schema.size} 張資料表。`);
}
