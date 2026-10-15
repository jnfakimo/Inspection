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



const globals = fs.readFileSync('web/app/tokens.css', 'utf8');
if (!/@media\s+screen\s*\{\s*:root\s*\{[^}]*--form-control-height\s*:\s*42px/s.test(globals)) {
  throw new Error('共用表單欄位高度必須由 screen 專用 42px 主題 token 定義');
}
const layout = fs.readFileSync('web/app/layout.tsx', 'utf8');
const buttonStandardImport = layout.indexOf("import './button-standard.css';");
const controlStandardImport = layout.indexOf("import './control-standard.css';");
if (buttonStandardImport < 0 || controlStandardImport <= buttonStandardImport) {
  throw new Error('共用欄位樣式必須在共用按鈕樣式後載入');
}
const controlStandard = fs.readFileSync('web/app/control-standard.css', 'utf8');
for (const required of ['@media screen', ':where(', 'height: var(--form-control-height)', 'min-height: var(--form-control-height)', ':not([type="checkbox"])', ':not([type="radio"])', ':not([type="file"])', ':not([type^="date"])', ':not([type^="time"])', ':not([type="month"])', ':not([type="week"])', ':not(.localized-date-native)']) {
  if (!controlStandard.includes(required)) throw new Error('共用欄位樣式缺少必要規則：' + required);
}
const settingsStyle = fs.readFileSync('web/app/systems/admin/settings/settings.module.css', 'utf8');
if (!settingsStyle.includes(':global(:root[data-theme="tech"]) .page') || !settingsStyle.includes('--settings-primary-bg: var(--blue)') || !settingsStyle.includes('--settings-primary-bg: var(--cyan)')) {
  throw new Error('管理設定頁必須同時支援 light 與 tech 主題的主要動作色');
}
if (/#(?:[0-9a-f]{3,8})\b/i.test(settingsStyle)) {
  throw new Error('管理設定頁不可保留硬編碼色碼，需使用主題 token');
}

console.log(`資料下拉空白列與 ${personnelPickers.length} 個人員選單檢查通過`);
