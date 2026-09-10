type UserVisibilityRecord = {
  username?: unknown;
  email?: unknown;
  name?: unknown;
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
