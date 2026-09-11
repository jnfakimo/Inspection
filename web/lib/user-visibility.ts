type UserVisibilityRecord = {
  username?: unknown;
  email?: unknown;
  name?: unknown;
  status?: unknown;
};

// 去識別化帳號仍需留在資料庫供歷史紀錄與稽核關聯使用，但不再是可管理的登入帳號。
export function isDeidentifiedUser(user: UserVisibilityRecord) {
  const username = String(user.username || '').trim().toLowerCase();
  const email = String(user.email || '').trim().toLowerCase();
  const name = String(user.name || '').trim();
  return username.startsWith('deidentified-')
    || email.startsWith('deidentified-')
    || name.startsWith('已離職人員-');
}

export function visibleManagedUsers<T extends UserVisibilityRecord>(users: T[]) {
  return users.filter(user => !isDeidentifiedUser(user));
}

// 人員指派、排班與簽名選單只列在職且尚未去識別化的帳號。部分查詢已在
// PostgREST 端限定 status=active，因此 status 未隨欄位取回時仍視為有效。
export function selectableActiveUsers<T extends UserVisibilityRecord>(users: T[]) {
  return users.filter(user => (user.status == null || String(user.status) === 'active') && !isDeidentifiedUser(user));
}
