import assert from 'node:assert/strict';
import test from 'node:test';
import { isDeidentifiedUser, selectableActiveUsers, visibleManagedUsers } from './user-visibility.ts';

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
  assert.deepEqual(selectableActiveUsers(users).map(user => user.user_id), ['active']);
});

test('人員選單排除狀態仍為 active 的已離職去識別化帳號', () => {
  const users = [
    { user_id: 'normal', name: '林竹泉', username: 'lin', status: 'active' },
    { user_id: 'departed', name: '已離職人員-dac7', username: 'deidentified-dac7', status: 'active' },
  ];
  assert.deepEqual(selectableActiveUsers(users).map(user => user.user_id), ['normal']);
});
