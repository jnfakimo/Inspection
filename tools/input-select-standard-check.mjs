import fs from 'node:fs';

const mechanicalPath = 'web/app/systems/[system]/[module]/mechanical-handover.tsx';
const mechanical = fs.readFileSync(mechanicalPath, 'utf8');
for (const label of ['工作分類', '常用工作項目']) {
  const pattern = new RegExp(`${label}<select[\\s\\S]{0,320}?<BlankSelectOption \\/>`);
  if (!pattern.test(mechanical)) throw new Error(`${label} 下拉選單的第一列必須使用 BlankSelectOption`);
}

const blankOption = fs.readFileSync('web/components/BlankSelectOption.tsx', 'utf8');
if (!/<option value="" aria-label="空白選項"><\/option>/.test(blankOption)) {
  throw new Error('BlankSelectOption 必須輸出真正的空值選項');
}

const personnelPickers = [
  mechanicalPath,
  'web/app/systems/[system]/[module]/mechanical-schedule.tsx',
  'web/app/systems/[system]/[module]/business-handover.tsx',
  'web/app/systems/[system]/[module]/handover-workspace.tsx',
  'web/app/systems/[system]/[module]/meeting-workspace.tsx',
  'web/app/systems/[system]/[module]/patrol-workspace.tsx',
  'web/app/systems/[system]/[module]/vehicle-workspace.tsx',
];
for (const file of personnelPickers) {
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes('selectableActiveUsers')) throw new Error(`${file} 的人員選單缺少離職／去識別化帳號排除規則`);
}

console.log(`資料下拉空白列與 ${personnelPickers.length} 個人員選單檢查通過`);
