import assert from 'node:assert/strict';
import test from 'node:test';
import { clientIpFromRequest, normalizeProxyIp } from './client-ip.ts';

test('accepts valid proxy addresses and rejects malformed or non-IP values', () => {
  assert.equal(normalizeProxyIp('203.0.113.8:443'), '203.0.113.8');
  assert.equal(normalizeProxyIp('[2001:db8::1]:443'), '2001:db8::1');
  for (const value of ['999.1.1.1', 'attacker', '1.2.3.4 evil', ':::']) {
    assert.equal(normalizeProxyIp(value), null);
  }
});

test('uses the first address in a gateway forwarding chain', () => {
  const request = new Request('https://example.invalid', { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.2' } });
  assert.equal(clientIpFromRequest(request), '203.0.113.9');
});
