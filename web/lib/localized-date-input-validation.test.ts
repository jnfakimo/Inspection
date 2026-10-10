import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  formatLocalizedDate,
  localizedDateDraftForUpdate,
  normalizeLocalizedDate,
  validateLocalizedDate,
} from './localized-date-input.ts';

const component = readFileSync(new URL('../components/LocalizedDateInput.tsx', import.meta.url), 'utf8');

test('normalizes only real ISO and slash-formatted calendar dates', () => {
  assert.equal(normalizeLocalizedDate('2026-10-06'), '2026-10-06');
  assert.equal(normalizeLocalizedDate('2026/10/06'), '2026-10-06');
  assert.equal(normalizeLocalizedDate(''), '');
  assert.equal(normalizeLocalizedDate('2025/02/29'), null);
  assert.equal(normalizeLocalizedDate('2026-02-30'), null);
  assert.equal(normalizeLocalizedDate('2026/13/01'), null);
  assert.equal(normalizeLocalizedDate('26/10/06'), null);
});

test('formats values and validates required, min, and max constraints', () => {
  assert.equal(formatLocalizedDate('2026-10-06'), '2026/10/06');
  assert.equal(validateLocalizedDate('', { required: true }), 'required');
  assert.equal(validateLocalizedDate('', { required: false }), null);
  assert.equal(validateLocalizedDate('not-a-date'), 'invalid');
  assert.equal(validateLocalizedDate('2026/10/06', { min: '2026-10-07' }), 'min');
  assert.equal(validateLocalizedDate('2026-10-08', { max: '2026-10-07' }), 'max');
  assert.equal(validateLocalizedDate('2026/10/07', { min: '2026-10-07', max: '2026-10-07' }), null);
});

test('preserves a draft across constraint changes but clears it for a new controlled value', () => {
  assert.equal(localizedDateDraftForUpdate('2026-10-06', '2026-10-06', '2026/10/10'), '2026/10/10');
  assert.equal(localizedDateDraftForUpdate('2026-10-07', '2026-10-06', '2026/10/10'), null);
});

test('manual input validates before updating state and exposes invalid feedback', () => {
  assert.match(component, /const error = updateValidity\(draft\);/);
  assert.match(component, /if \(!error && onChange\)/);
  assert.match(component, /aria-invalid=\{validationError \? true/);
  assert.match(component, /localized-date-error/);
  assert.match(component, /getLocalizedDateInputAccess\(\{ manual, readOnly, disabled \}\)/);
});