import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const sharedCss = read('../web/app/systems/[system]/[module]/handover-sheet.css');
const guardCss = read('../web/app/systems/[system]/[module]/guard-handover.css');
const mechanicalCss = read('../web/app/systems/[system]/[module]/mechanical-handover.css');
const businessCss = read('../web/app/systems/[system]/[module]/business-handover.css');
const guardView = read('../web/app/systems/[system]/[module]/guard-handover-view.tsx');
const mechanical = read('../web/app/systems/[system]/[module]/mechanical-handover.tsx');
const business = read('../web/app/systems/[system]/[module]/business-handover.tsx');

for (const [name, css] of Object.entries({ sharedCss, guardCss, mechanicalCss, businessCss })) {
  test(`${name} has balanced CSS blocks`, () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const withoutStrings = withoutComments.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
    assert.equal((withoutStrings.match(/\{/g) || []).length, (withoutStrings.match(/\}/g) || []).length);
  });
}

const shortAndLongStates = [
  { content: 'short', approval: 'pending', canApprove: true },
  { content: 'short', approval: 'pending', canApprove: false },
  { content: 'short', approval: 'approved', canApprove: false },
  { content: 'long', approval: 'pending', canApprove: true },
  { content: 'long', approval: 'pending', canApprove: false },
  { content: 'long', approval: 'approved', canApprove: false },
];

const fixtureMarkup = ({ content, approval, canApprove }) => {
  const shifts = [1, 2, 3].map(index => `<section class="hs-report-shift-card hs-report-shift-${index}${content === 'long' ? ' is-long' : ''}"><h3>班別 ${index}</h3><table class="hs-report-shift"><tbody><tr><td>${content === 'long' ? '交接內容'.repeat(160) : '例行巡檢完成'}</td></tr></tbody></table></section>`).join('');
  const signed = approval === 'approved';
  const controls = !signed && canApprove ? '<div class="hs-report-approval-form"><textarea>簽核說明</textarea><button>確認</button></div>' : '';
  const readonly = !signed && !canApprove ? '<p class="hs-report-approval-readonly">唯讀</p>' : '';
  const note = signed ? '已簽核說明' : '—';
  return `<article class="hs-report hs-daily-report"><header class="hs-report-heading"><h2>每日交接報表</h2><span class="hs-report-state${signed ? ' is-approved' : ''}">${signed ? '已簽核' : '待簽核'}</span></header>${shifts}<footer class="hs-report-footer"><div class="hs-report-approval-details"><div><strong>${signed ? '簽核人' : '尚未簽核'}</strong></div><div><p>${note}</p></div></div>${controls}${readonly}</footer></article>`;
};

test('all three reports share the daily heading, overview, palette and approval language', () => {
  for (const source of [guardView, mechanical, business]) {
    assert.ok(source.includes('HandoverReportHeading'));
    assert.ok(source.includes('HandoverReportOverview'));
  }
  assert.ok(guardView.includes('HandoverReportShiftCard'));
  assert.ok(mechanical.includes('HandoverReportShiftCard'));
  assert.ok(business.includes('hs-report-shift-row'));
  assert.ok(business.includes('hs-report-approval-stage'));
  for (const color of ['--hs-shift-color-1:#0284c7', '--hs-shift-color-2:#047857', '--hs-shift-color-3:#b45309']) {
    assert.ok(sharedCss.includes(color), `missing shared shift color ${color}`);
  }
  assert.ok(sharedCss.includes('.hs-report-approval-stage{border:1px solid #cbd5e1'));
  assert.ok(sharedCss.includes('.hs-report-footer-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;background:#e2e8f0;color:#334155}'));
});

for (const fixture of shortAndLongStates) {
  test(`offline fixture: ${fixture.content} report / ${fixture.approval} / ${fixture.canApprove ? 'authorized' : 'read-only'}`, () => {
    const html = fixtureMarkup(fixture);
    for (const index of [1, 2, 3]) assert.ok(html.includes(`hs-report-shift-${index}`));
    assert.equal((html.match(/class="hs-report-shift-card/g) || []).length, 3);
    assert.equal(html.includes('is-long'), fixture.content === 'long');
    assert.equal(html.includes('is-approved'), fixture.approval === 'approved');
    assert.equal(html.includes('hs-report-approval-form'), fixture.approval === 'pending' && fixture.canApprove);
    assert.ok(html.includes(fixture.approval === 'approved' ? '已簽核說明' : '—'));
    assert.ok(sharedCss.includes('.hs-report-footer{display:block;margin-top:24px;overflow:hidden;'));
    assert.match(sharedCss.slice(sharedCss.indexOf('@media print')), /\.hs-report-footer\{[^}]*break-inside:auto;page-break-inside:auto/);
    assert.match(sharedCss.slice(sharedCss.indexOf('@media print')), /\.hs-report-approval-form,\.hs-report-approval-readonly\{display:none!important\}/);
  });
}

test('short shifts stay together, long shifts and long signoff notes can flow', () => {
  const print = sharedCss.slice(sharedCss.indexOf('@media print'));
  assert.match(print, /\.hs-report-shift-card\{[^}]*break-inside:avoid-page/);
  assert.match(print, /\.hs-report-shift-card\.is-long,[^{]+\{break-inside:auto\}/);
  assert.match(print, /\.hs-report-footer\{[^}]*break-inside:auto;page-break-inside:auto/);
  assert.match(businessCss, /\.business-print-approvals-grid\{break-inside:auto!important;page-break-inside:auto!important\}/);
  assert.match(businessCss, /\.business-print-approval-box\.is-long\{break-inside:auto;page-break-inside:auto\}/);
});

test('A4 page boxes and batch report starts use one shared print geometry', () => {
  const print = sharedCss.slice(sharedCss.indexOf('@media print'));
  const heading = read('../web/app/systems/[system]/[module]/handover-sheet.tsx');
  assert.ok(heading.includes('margin:14mm 9mm 12mm'));
  assert.ok(heading.includes('counter(page)'));
  assert.ok(heading.includes('counter(pages)'));
  assert.ok(heading.includes('HandoverPrintPage'));
  assert.ok(print.includes('width:100%;min-height:0;height:auto;overflow:visible'));
  assert.ok(!guardCss.includes('@page{'));
  assert.ok(guardCss.includes('.guard-print-root .guard-print-day:not(.is-first){break-before:page;page-break-before:always}'));
  assert.ok(mechanicalCss.includes('break-after:page;page-break-after:always'));
  assert.ok(mechanicalCss.includes('.mechanical-print-sheet.is-multipage{height:auto;min-height:0;overflow:visible;'));
});

test('mechanical market caption follows the market-scoped roster', () => {
 assert.ok(mechanical.includes('market ? HANDOVER_MARKETS[market].short'));
 assert.ok(!mechanical.includes('<span>二市排班表</span>'));
 for (const table of ['mechanical_schedule_assignments','mechanical_staff_market_scopes']) {
  const query=mechanical.slice(mechanical.indexOf("from('"+table+"')"),mechanical.indexOf("from('"+table+"')")+450);
  assert.ok(query.includes(".eq('market_code', market)"), table);
 }
});
test('mobile report scroll region preserves the printable table',()=>{
 assert.ok(mechanical.includes('mechanical-report-table-scroll'));
 assert.match(mechanicalCss, /overflow-x:\s*auto/);
 assert.match(mechanicalCss, /display:\s*contents/);
 assert.ok(mechanicalCss.includes('body:has(.mechanical-report-preview) .theme-toggle'));
});

test('business short rows stay whole while long rows may flow', () => {
 assert.ok(businessCss.includes('.business-print-shift-table td{break-inside:avoid-page!important'));
 assert.ok(businessCss.includes('.business-print-shift-table tr.is-long-row>td{break-inside:auto!important'));
 assert.ok(business.includes("? ' is-long-row' : ''"));
});
