// 密碼政策集中在受信任後端，前端提示只是提升操作體驗，不能取代這裡的檢查。
export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 8,
} as const;

export function passwordPolicyMessage(password: string) {
  if (password.length !== PASSWORD_POLICY.minLength) {
    return `密碼必須是 ${PASSWORD_POLICY.minLength} 位數字`;
  }
  return /^\d{8}$/.test(password) ? '' : '密碼只能包含數字';
}
