import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getLocalizedDateInputAccess } from './localized-date-input-access.ts';

const component = readFileSync(new URL('../components/LocalizedDateInput.tsx', import.meta.url), 'utf8');

test('native picker mode is read-only until a date is selected with the picker', () => {
  assert.deepEqual(getLocalizedDateInputAccess({ manual: false }), {
    inputReadOnly: true, ariaReadOnly: true, pickerDisabled: false, manualEditable: false, nativeChangeEnabled: true,
  });
});

test('manual fallback permits typing when the caller allows edits', () => {
  assert.deepEqual(getLocalizedDateInputAccess({ manual: true }), {
    inputReadOnly: false, ariaReadOnly: false, pickerDisabled: false, manualEditable: true, nativeChangeEnabled: true,
  });
});

test('read-only callers cannot open a picker or change values in either mode', () => {
  for (const manual of [false, true]) {
    const access = getLocalizedDateInputAccess({ manual, readOnly: true });
    assert.equal(access.pickerDisabled, true);
    assert.equal(access.manualEditable, false);
    assert.equal(access.nativeChangeEnabled, false);
    assert.equal(access.inputReadOnly, true);
  }
});

test('disabled callers cannot open a picker or change values in either mode', () => {
  for (const manual of [false, true]) {
    const access = getLocalizedDateInputAccess({ manual, disabled: true });
    assert.equal(access.pickerDisabled, true);
    assert.equal(access.manualEditable, false);
    assert.equal(access.nativeChangeEnabled, false);
  }
});

test('the component wires the access decision to both picker and manual controls', () => {
  assert.match(component, /getLocalizedDateInputAccess\(\{ manual, readOnly, disabled \}\)/);
  assert.match(component, /readOnly=\{access\.inputReadOnly\}/);
  assert.match(component, /aria-readonly=\{access\.ariaReadOnly\}/);
  assert.match(component, /disabled=\{access\.pickerDisabled\}/);
  assert.match(component, /onChange=\{access\.manualEditable \?/);
  assert.match(component, /onChange=\{access\.nativeChangeEnabled \? onChange : undefined\}/);
});
