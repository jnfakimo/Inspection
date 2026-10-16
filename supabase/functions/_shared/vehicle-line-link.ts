export const VEHICLE_LINE_LINK_TTL_MS = 10 * 60 * 1000;

export type LinkIntentState = {
  status: "pending" | "consumed" | "expired" | "cancelled";
  expiresAt: string;
  consentedAt: string | null;
};

export type LinkIntentDecision =
  | { allowed: true }
  | { allowed: false; reason: "already_used" | "expired" | "consent_required" };

export function evaluateVehicleLineLinkIntent(
  intent: LinkIntentState,
  now: Date,
): LinkIntentDecision {
  if (intent.status !== "pending") return { allowed: false, reason: "already_used" };
  if (!intent.consentedAt) return { allowed: false, reason: "consent_required" };
  if (Date.parse(intent.expiresAt) <= now.getTime()) return { allowed: false, reason: "expired" };
  return { allowed: true };
}

export function createVehicleLineLinkCode(cryptoProvider: Crypto = crypto): string {
  const bytes = new Uint8Array(24);
  cryptoProvider.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `LINK-${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

export function createVehicleLineAccountNonce(cryptoProvider: Crypto = crypto): string {
  const bytes = new Uint8Array(24);
  cryptoProvider.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256Hex(value: string, cryptoProvider: Crypto = crypto): Promise<string> {
  const digest = new Uint8Array(await cryptoProvider.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function parseVehicleLineLinkCommand(text: string): string | null {
  const match = /^LINK-([A-Za-z0-9_-]{32})$/.exec(text.trim());
  return match ? `LINK-${match[1]}` : null;
}

export async function verifyLineWebhookSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
  cryptoProvider: Crypto = crypto,
): Promise<boolean> {
  if (!signature || !channelSecret) return false;
  try {
    const key = await cryptoProvider.subtle.importKey(
      "raw",
      new TextEncoder().encode(channelSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = new Uint8Array(await cryptoProvider.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(rawBody),
    ));
    let binary = "";
    for (const byte of digest) binary += String.fromCharCode(byte);
    const expected = btoa(binary);
    if (expected.length !== signature.length) return false;
    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) {
      difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
    }
    return difference === 0;
  } catch {
    return false;
  }
}

export function createLineAccountLinkUrl(linkToken: string, nonce: string): string {
  const url = new URL("https://access.line.me/dialog/bot/accountLink");
  url.searchParams.set("linkToken", linkToken);
  url.searchParams.set("nonce", nonce);
  return url.toString();
}
