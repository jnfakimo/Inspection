import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeidentifiedUser, visibleManagedUsers } from './user-visibility.ts';

test('帳號管理清單隱藏去識別化帳號，但保留一般停用帳號', () => {
  const users = [
    { user_id: 'active', name: '正常人員', username: 'normal', email: 'normal@example.com', status: 'active' },
    { user_id: 'inactive', name: '一般停用人員', username: 'inactive', email: 'inactive@example.com', status: 'inactive' },
    { user_id: 'by-username', name: '舊姓名', username: 'deidentified-uuid', email: 'old@example.com', status: 'inactive' },
    { user_id: 'by-email', name: '舊姓名', username: 'old', email: 'deidentified-uuid@example.invalid', status: 'inactive' },
    { user_id: 'by-name', name: '已離職人員-a8da', username: 'old', email: 'old2@example.com', status: 'inactive' },
  ];

  assert.equal(isDeidentifiedUser(users[0]), false);
  assert.deepEqual(visibleManagedUsers(users).map(user => user.user_id), ['active', 'inactive']);
});
