import assert from 'node:assert/strict';
import test from 'node:test';
import { marketForDepartment } from './handover-market.ts';

const departments = [
  { dept_id: '1', code: 'MKT1', status: 'active' },
  { dept_id: '2', code: 'MKT2', status: 'active' },
  { dept_id: '3', parent_id: '1', code: 'MKT1-ADMIN', status: 'active' },
  { dept_id: '4', parent_id: '2', code: 'MKT2-ADMIN', status: 'active' },
  { dept_id: '5', parent_id: '1', code: 'MKT1-GUARD', status: 'active' },
  { dept_id: '6', parent_id: '2', code: 'MKT2-GUARD', status: 'active' },
  { dept_id: '7', parent_id: '2', code: 'MKT2-VEG', status: 'active' },
];

test('business and guard team affiliation follows the department hierarchy', () => {
  assert.equal(marketForDepartment('3', departments, 'ADMIN'), 'market_1');
  assert.equal(marketForDepartment('4', departments, 'ADMIN'), 'market_2');
  assert.equal(marketForDepartment('5', departments, 'GUARD'), 'market_1');
  assert.equal(marketForDepartment('6', departments, 'GUARD'), 'market_2');
  assert.equal(marketForDepartment('6', departments, 'ADMIN'), null);
  assert.equal(marketForDepartment('7', departments, 'GUARD'), null);
});

test('inactive or orphaned organizational records cannot authorize a market', () => {
  assert.equal(marketForDepartment('3', departments.map(row => row.dept_id === '1' ? { ...row, status: 'inactive' } : row), 'ADMIN'), null);
  assert.equal(marketForDepartment('missing', departments, 'ADMIN'), null);
});
