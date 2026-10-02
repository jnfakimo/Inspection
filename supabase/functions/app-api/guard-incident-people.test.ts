import assert from 'node:assert/strict';
import test from 'node:test';
import { incidentPersonMatches, normalizeGuardIncidentPeople } from './guard-incident-people.ts';

test('相關人員僅保留姓名、身分證字號及電話，並限制格式', () => {
  assert.deepEqual(normalizeGuardIncidentPeople([{ name: ' 王小明 ', id_number: 'a123456789', phone: '0912-345-678', secret: 'discard' }]),
    [{ name: '王小明', id_number: 'A123456789', phone: '0912-345-678' }]);
  assert.equal(normalizeGuardIncidentPeople([{ name: '', id_number: '', phone: '' }]), null);
  assert.equal(normalizeGuardIncidentPeople([{ name: '王小明', id_number: 'A123', phone: '' }]), null);
  assert.equal(normalizeGuardIncidentPeople([{ name: '王小明', id_number: '', phone: '123' }]), null);
  assert.equal(normalizeGuardIncidentPeople(Array.from({ length: 11 }, () => ({ name: '王小明', id_number: '', phone: '' }))), null);
});

test('主管的身分證與電話搜尋使用完整值比對', () => {
  const person = { name: '王小明', id_number: 'A123456789', phone: '0912-345-678' };
  assert.equal(incidentPersonMatches(person, 'name', '小明'), true);
  assert.equal(incidentPersonMatches(person, 'id_number', 'A123456789'), true);
  assert.equal(incidentPersonMatches(person, 'id_number', 'A1234'), false);
  assert.equal(incidentPersonMatches(person, 'phone', '0912345678'), true);
  assert.equal(incidentPersonMatches(person, 'phone', '091234'), false);
});
