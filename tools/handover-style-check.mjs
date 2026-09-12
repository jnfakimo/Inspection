// SYS-04 三本電子交接簿（機電課、業管組、駐警隊）的版型一致性檢查。
//
// 三本交接簿內容不同，但外觀必須一致：共同版型只放在 handover-sheet.css／handover-sheet.tsx，
// 各本只在自己的檔案放「本簿特有」的區塊。歷史上就是各自複製一份樣式與圖示，才長成三種風格。
// 這支檢查擋住三種退步：改回自己的版型、在自己的 css 重新定義 hs-* 的外觀、又複製一份圖示表。
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dir = path.join(root, 'web/app/systems/[system]/[module]');
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');

const SHEETS = [
  { name: '機電課', tsx: 'mechanical-handover.tsx', css: 'mechanical-handover.css' },
  { name: '業管組', tsx: 'business-handover.tsx', css: 'business-handover.css' },
  { name: '駐警隊', tsx: 'guard-handover.tsx', css: 'guard-handover.css', view: 'guard-handover-view.tsx' },
];

// 共同骨架：少一項就是某一本又自己長了一套版面。
const REQUIRED = ['hs-page', 'hs-toolbar', 'hs-sheet', 'hs-shift'];
// 列印版面各本不同（表格欄位不一樣），允許各自在 @media print 內覆寫；
// 這幾個類別也允許各本自行決定顯示時機。
const PRINT_SCOPED = new Set(['.hs-print-sheet']);

const errors = [];
const shared = read('handover-sheet.css');
const sharedTsx = read('handover-sheet.tsx');

if (!/HandoverSheetHeader/.test(sharedTsx) || !/HandoverIcon/.test(sharedTsx)) {
  errors.push('handover-sheet.tsx 必須提供 HandoverIcon 與 HandoverSheetHeader');
}

for (const sheet of SHEETS) {
  const sources = [sheet.tsx, sheet.view].filter(Boolean).map(read);
  const markup = sources.join('\n');
  const css = read(sheet.css);

  if (!/import '\.\/handover-sheet\.css'/.test(sources[0])) {
    errors.push(`${sheet.name}：${sheet.tsx} 必須 import './handover-sheet.css'`);
  }
  for (const token of REQUIRED) {
    if (!markup.includes(token)) errors.push(`${sheet.name}：畫面沒有使用共同版型的 ${token}`);
  }
  if (!/HandoverSheetHeader/.test(markup)) {
    errors.push(`${sheet.name}：表頭必須用 handover-sheet 的 HandoverSheetHeader，不可自己寫一份`);
  }
  if (/const ICON_PATHS/.test(markup)) {
    errors.push(`${sheet.name}：不可自備一份 ICON_PATHS，圖示請用 handover-sheet 的 HandoverIcon`);
  }
  // 本簿的 css 只能替共用類別加修飾子或子選擇器，不得重新定義 hs-* 本身的外觀。
  // @media print 內是各本自己的紙本排版，不受此限。
  const screenCss = css.split(/@media\s+print/)[0];
  for (const match of screenCss.matchAll(/(^|[},])\s*([^{}@]*?)\{/g)) {
    for (const selector of match[2].split(',')) {
      const trimmed = selector.trim();
      if (/^\.hs-[a-z0-9-]+$/.test(trimmed) && !PRINT_SCOPED.has(trimmed)) {
        errors.push(`${sheet.name}：${sheet.css} 重新定義了 ${trimmed}，共同版型只能改 handover-sheet.css`);
      }
    }
  }
  // 舊的自有前綴骨架類別不該再出現在畫面上。
  const prefix = sheet.css.split('-')[0];
  for (const legacy of ['sheet', 'kpis', 'shift-head', 'approval-seal']) {
    if (markup.includes(`${prefix}-${legacy}"`) || markup.includes(`${prefix}-${legacy} `)) {
      errors.push(`${sheet.name}：畫面還在用舊的 ${prefix}-${legacy}，請改用共同版型`);
    }
  }
}

// 共用樣式本身要涵蓋骨架，否則三本會一起壞掉。
for (const token of REQUIRED) {
  if (!shared.includes(`.${token}`)) errors.push(`handover-sheet.css 缺少 .${token}`);
}

// 機電課簽核意見必須從畫面一路送入既有 note 欄位，並列入 A4 報表。
const mechanical = read('mechanical-handover.tsx');
for (const token of ['approvalNote.trim()', 'note: approvalNote.trim()', '批核意見', 'mechanical-print-approval-note']) {
  if (!mechanical.includes(token)) errors.push(`機電課：課長批核意見流程缺少 ${token}`);
}

if (errors.length) {
  console.error(`電子交接簿版型一致性檢查失敗（${errors.length} 項）：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`電子交接簿版型一致性檢查通過：${SHEETS.length} 本交接簿共用 handover-sheet 的表頭、指標、班別卡片、簽名與簽核列。`);
}
