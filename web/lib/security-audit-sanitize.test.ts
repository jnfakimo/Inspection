import assert from 'node:assert/strict';
import test from 'node:test';
import { auditIsSensitivePath, auditSafeDestination, auditSafeHash, auditSafeText, auditSafeValue } from './security-audit-sanitize.ts';

test('權杖遮蔽判定可重複呼叫，不受 RegExp lastIndex 影響', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.aVeryLongSignatureValue';
  assert.equal(auditSafeText(`Bearer ${jwt}`), '[已遮蔽]');
  assert.equal(auditSafeHash(`#access_token=${jwt}`), '#[已遮蔽]');
  assert.equal(auditSafeHash(`#access_token=${jwt}`), '#[已遮蔽]');
});

test('稽核內容移除密碼、Cookie、驗證碼及權杖欄位', () => {
  const cleaned = auditSafeValue({
    feature: '送出表單', form_id: 'profile-form', password: 'never-store-me',
    nested: { access_token: 'never-store-me', cookie: 'never-store-me', captcha_answer: '1234' },
  });
  assert.deepEqual(cleaned, { feature: '送出表單', form_id: 'profile-form', nested: {} });
  assert.doesNotMatch(JSON.stringify(cleaned), /never-store-me|1234/);
});

test('導覽目的地不保存 query，且權杖 hash 會遮蔽', () => {
  const origin = 'https://example.test';
  assert.equal(
    auditSafeDestination('/systems/admin/?person=42&token=secret#users', `${origin}/current/`, origin),
    '/systems/admin/#users',
  );
  assert.equal(
    auditSafeDestination('/oauth/#access_token=secret-value', `${origin}/current/`, origin),
    '/oauth/#[已遮蔽]',
  );
});

test('目錄跳脫與敏感檔名會被識別，正常檔案不誤擋', () => {
  assert.equal(auditIsSensitivePath('floorplans/../.env'), true);
  assert.equal(auditIsSensitivePath('private/.git/config'), true);
  assert.equal(auditIsSensitivePath('repair-files/2026/report.pdf'), false);
});
