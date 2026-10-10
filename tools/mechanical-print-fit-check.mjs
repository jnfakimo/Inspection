import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const component = read('../web/app/systems/[system]/[module]/mechanical-handover.tsx');
const css = read('../web/app/systems/[system]/[module]/mechanical-handover.css');

assert.ok(component.includes("import { calculateMechanicalPrintFit } from '@/lib/mechanical-print-fit'"), 'mechanical print must use the tested fit algorithm');
assert.ok(component.includes("sheet.classList.remove('is-multipage')"), 'recalculating must clear stale multi-page state');
assert.ok(component.includes("const fit = calculateMechanicalPrintFit(sheet.clientHeight - verticalPadding - 2, content.scrollHeight)"), 'fit must use available printable height and full content height');
assert.ok(component.includes("sheet.classList.add('is-multipage')"), 'reports below the fit floor must enable multi-page layout');
assert.ok(component.includes("content.style.setProperty('--mechanical-print-scale', String(fit.scale))"), 'single-page reports must use the calculated scale');
assert.ok((component.match(/fitMechanicalPrint\(\);/g) ?? []).length >= 2, 'print preparation hooks must continue recalculating layout');
assert.ok(css.includes('.mechanical-print-sheet.is-multipage{height:auto;min-height:297mm;overflow:visible;'), 'multi-page sheets must release fixed height and clipping');
assert.ok(css.includes('.mechanical-print-sheet.is-multipage .mechanical-print-table thead{display:table-header-group}'), 'multi-page tables must repeat their header');
assert.ok(css.includes('.mechanical-print-sheet.is-multipage .hs-report-footer,.mechanical-print-sheet.is-multipage .mechanical-report-handoffs{break-inside:avoid-page;page-break-inside:avoid}'), 'approval footer and handoff section must stay grouped');

console.log('Mechanical print integration check passed.');
