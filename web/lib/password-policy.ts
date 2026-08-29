export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 8,
} as const;

export function passwordPolicyMessage(password: string) {
  if (password.length !== PASSWORD_POLICY.minLength) return `密碼必須是 ${PASSWORD_POLICY.minLength} 位數字`;
  return /^\d{8}$/.test(password) ? '' : '密碼只能包含數字';
}
