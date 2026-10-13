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

if (!/HandoverSheetHeader/.test(sharedTsx) || !/HandoverIcon/.test(sharedTsx) || !/HandoverDateNavigation/.test(sharedTsx)) {
  errors.push('handover-sheet.tsx 必須提供 HandoverIcon、HandoverSheetHeader 與 HandoverDateNavigation');
}
const dateNavigation = sharedTsx.split('export function HandoverDateNavigation')[1]?.split('export type HandoverKpi')[0] || '';
const dateOrderTokens = ['hs-date-label', 'hs-date-arrow', 'hs-date-input', 'hs-date-arrow', 'hs-date-today'];
let dateOrderCursor = -1;
const dateOrder = dateOrderTokens.map(token => { dateOrderCursor = dateNavigation.indexOf(token, dateOrderCursor + 1); return dateOrderCursor; });
if (dateOrder.some(index => index < 0) || dateOrder.some((index, i) => i > 0 && index <= dateOrder[i - 1])) {
  errors.push('HandoverDateNavigation 必須依序輸出日期標籤、前一天、日期欄、後一天、回到今天');
}
for (const token of ['.hs-date-nav>.localized-date-input{', 'min-width:120px;height:44px', '.hs-date-nav>.hs-date-arrow{', 'height:44px']) {
  if (!shared.includes(token)) errors.push(`handover-sheet.css 缺少共用日期列尺寸規則：${token}`);
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
  if (!/HandoverDateNavigation/.test(sources[0])) {
    errors.push(`${sheet.name}：日期列必須使用三本共用的 HandoverDateNavigation`);
  }
  if (!/hideDescription/.test(sources[0])) {
    errors.push(`${sheet.name}：AdminHeader 必須隱藏與系統頁首重複的說明文字`);
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

// Guard 的主管狀態／入口卡在交接內容後；實際簽核表單仍由日報 footer 提供。
const guard = read('guard-handover.tsx');
const guardSheetStart = guard.indexOf('<section className="hs-sheet"');
const guardSheetEnd = guard.indexOf('</section>', guardSheetStart);
const guardApprovalCard = guard.indexOf('<section className={`hs-approval');
const guardReportForm = guard.indexOf('HandoverReportApprovalForm');
if (guardSheetStart < 0 || guardSheetEnd < 0 || guardApprovalCard <= guardSheetEnd) {
  errors.push('駐警隊：主管每日簽核狀態卡必須位於三班交接內容之後');
}
if (guardReportForm < 0) errors.push('駐警隊：日報 footer 的實際主管簽核表單不可移除');

// 業管組的三階段主管簽核區須位於交接內容下方；列印摘要仍由 A4 報表內容呈現。
const business = read('business-handover.tsx');
const businessSheetStart = business.indexOf('<section className="hs-sheet"');
const businessApprovalStart = business.indexOf('<section className="business-approval-section panel"');
const businessPrintStart = business.indexOf('<section className="hs-print-sheet"');
if (businessSheetStart < 0 || businessApprovalStart <= businessSheetStart || businessPrintStart <= businessApprovalStart
  || !/<section className="hs-sheet"[\s\S]*<\/section>\s*\{\/\* 主管三級批核流程區塊/u.test(business)) {
  errors.push('業管組：三階段主管簽核區必須放在交接內容之後、列印報表區之前');
}
for (const token of ['簽核說明（可留白）', '簽核說明（已保存）', 'business-print-approvals-grid', 'APPROVAL_STAGES.map']) {
  if (!business.includes(token)) errors.push(`業管組：三階段簽核說明／列印摘要缺少 ${token}`);
}
if (business.includes('<strong>📋 業管組主管批核流程</strong>')) errors.push('業管組：主管簽核標題不可再重複使用 emoji 圖示');
const businessCss = read('business-handover.css');
for (const token of ['.business-approval-section.panel{', 'border:1px solid #CBD5E1', 'background:#F1F5F9', 'background:#E2E8F0;color:#475569', 'color:#334155']) {
  if (!businessCss.includes(token)) errors.push(`業管組：主管簽核區缺少共用藍灰色系 ${token}`);
}
// SYS-04 七個頁面模組的資料載入失敗必須顯示訊息，並解除 busy 狀態。
const assertLoadLifecycle = (source, label, componentMarker = '') => {
  const componentStart = componentMarker ? source.indexOf(componentMarker) : 0;
  const loadStart = source.indexOf('const load = useCallback(async () => {', componentStart);
  const loadEnd = source.indexOf('  },', loadStart);
  const load = loadStart >= 0 && loadEnd > loadStart ? source.slice(loadStart, loadEnd) : '';
  if (!/catch\s*\(/.test(load) || !load.includes('setBusy(false)')) {
    errors.push(`${label}：資料載入必須處理例外並解除載入狀態`);
  }
};
const handoverWorkspace = read('handover-workspace.tsx');
for (const [name, marker] of [['指揮台交接', 'function RecordsModule('], ['未結事項', 'function CasesModule('], ['設備概況', 'function EquipmentOverview(']]) {
  assertLoadLifecycle(handoverWorkspace, name, marker);
}
for (const [name, file] of [['機電排班', 'mechanical-schedule.tsx'], ['機電課', 'mechanical-handover.tsx'], ['業管組', 'business-handover.tsx'], ['駐警隊', 'guard-handover.tsx']]) {
  assertLoadLifecycle(read(file), name);
}

// 機電課簽核意見必須從畫面一路送入既有 note 欄位，並列入 A4 報表。
const mechanical = read('mechanical-handover.tsx');
for (const token of ['approvalNote.trim()', 'note: approvalNote.trim()', 'HandoverReportApprovalForm', 'id="mechanical-report-approval-note"']) {
  if (!mechanical.includes(token)) errors.push(`機電課：課長批核意見流程缺少 ${token}`);
}

// Daily report footers should flow with long content instead of jumping as one block.
const printStyles = shared.slice(shared.indexOf('@media print'));
if (!/\.hs-report-footer\{[^}]*break-inside:auto;page-break-inside:auto/.test(printStyles)) {
  errors.push('handover-sheet.css：列印簽核 footer 必須可自然跨頁，不能整塊推至空白頁');
}
const mechanicalPrintCss = read('mechanical-handover.css');
if (/\.mechanical-print-sheet\.is-multipage \.hs-report-footer/.test(mechanicalPrintCss)) {
  errors.push('機電課：多頁報表不可重新把共用簽核 footer 設為整塊避免拆頁');
}
const guardPrintCss = read('guard-handover.css');
if (!guardPrintCss.includes('.guard-print-root .guard-print-day:not(.is-first){break-before:page;page-break-before:always}')) {
  errors.push('駐警隊：列印區間的每日報表必須保留每日另起新頁');
}
const businessReportSource = read('business-handover.tsx');
for (const token of ['className="business-print-content hs-report hs-daily-report"', 'HandoverReportHeading', 'HandoverReportOverview', 'hs-report-shift-row', 'hs-report-approval-stage']) {
  if (!businessReportSource.includes(token)) errors.push(`業管組日報未沿用共用報表樣式：${token}`);
}
for (const token of ['--hs-shift-color-1:#0284c7', '--hs-shift-color-2:#047857', '--hs-shift-color-3:#b45309', '.hs-report-approval-stage{border:1px solid #cbd5e1']) {
  if (!shared.includes(token)) errors.push(`handover-sheet.css 缺少共用設計 token：${token}`);
}
if (!read('handover-sheet.tsx').includes('size:A4') || !read('handover-sheet.tsx').includes('margin:14mm 9mm 12mm') || !printStyles.includes('width:100%;min-height:0;height:auto;overflow:visible')
  || !/\.hs-report-footer\{[^}]*break-inside:auto;page-break-inside:auto/.test(printStyles)) {
  errors.push('三本日報需共用 A4／每頁留白，並允許簽核摘要自然跨頁');
}
if (/\.business-print-approvals-grid\{break-inside:avoid/.test(read('business-handover.css'))) {
  errors.push('業管組三級簽核區不可整組推頁，長說明須可自然跨頁');
}
if (errors.length) {
  console.error(`電子交接簿版型一致性檢查失敗（${errors.length} 項）：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`電子交接簿版型一致性檢查通過：${SHEETS.length} 本交接簿共用表頭與班別樣式；SYS-04 七個頁面模組的資料錯誤檢查也通過。`);
}
