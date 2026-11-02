// LINE 通知群組登記碼：管理員在後台產生，於目標群組輸入「登記 XXXX-XXXX」後才會寫入群組 ID。
// 字元集去掉容易混淆的 0/O、1/I，32 個字元剛好整除 256，取餘數不會偏斜。
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export const LINE_GROUP_REGISTER_TTL_MS = 10 * 60 * 1000;

export function createLineGroupRegisterCode(cryptoProvider: Crypto = crypto): { code: string; display: string } {
  const bytes = new Uint8Array(CODE_LENGTH);
  cryptoProvider.getRandomValues(bytes);
  const code = [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
  return { code, display: `${code.slice(0, 4)}-${code.slice(4)}` };
}

/** 接受「登記 ABCD-2345」「登記ABCD2345」，大小寫不拘；回傳不含連字號的大寫碼。 */
export function parseLineGroupRegisterCommand(text: string): string | null {
  const match = /^登記\s*([A-Za-z0-9]{4})-?([A-Za-z0-9]{4})$/.exec(text.trim());
  if (!match) return null;
  const code = `${match[1]}${match[2]}`.toUpperCase();
  return [...code].every((char) => ALPHABET.includes(char)) ? code : null;
}

export function isLineGroupId(value: unknown): value is string {
  return typeof value === "string" && /^C[0-9a-f]{32}$/i.test(value);
}

export function lineGroupRegisterNotice(outcome: string): string {
  if (outcome === "registered") return "✅ 已將此群組登記為北農巡檢平台的 LINE 通知群組，之後的系統通知會送到這裡。";
  if (outcome === "expired") return "登記碼已過期，請系統管理員到後台重新產生。";
  return "登記碼無效或已使用，請系統管理員到後台重新產生。";
}
