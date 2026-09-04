// 密碼政策集中在受信任後端，前端提示只是提升操作體驗，不能取代這裡的檢查。
export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 200,
  requiredCharacterClasses: 3,
} as const;

export function passwordPolicyMessage(password: string) {
  if (password.length < PASSWORD_POLICY.minLength) {
    return `密碼至少需要 ${PASSWORD_POLICY.minLength} 個字元`;
  }
  if (password.length > PASSWORD_POLICY.maxLength) {
    return `密碼不可超過 ${PASSWORD_POLICY.maxLength} 個字元`;
  }
  if (/\s/.test(password)) return '密碼不可包含空白字元';

  const classes = [/[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)]
    .filter(Boolean).length;
  if (classes < PASSWORD_POLICY.requiredCharacterClasses) {
    return '密碼需包含大寫、小寫、數字、特殊字元中的至少 3 類';
  }
  return '';
}
