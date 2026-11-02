import { sendLineTextMessage } from "./line-message.ts";
import {
  createLineAccountLinkUrl,
  createVehicleLineAccountNonce,
  parseVehicleLineLinkCommand,
  sha256Hex,
  verifyLineWebhookSignature,
} from "./vehicle-line-link.ts";
import { isLineGroupId, lineGroupRegisterNotice, parseLineGroupRegisterCommand } from "./line-group-register.ts";

const LINE_BOT_INFO_URL = "https://api.line.me/v2/bot/info";
const LINE_ACCOUNT_LINK_TOKEN_URL = "https://api.line.me/v2/bot/user/";
const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-line-signature",
};

type RpcOutcome = { outcome: string; userId?: string | null };

export type VehicleLineWebhookStore = {
  ensureLinkSchema(): Promise<void>;
  loadChannelAccessToken(): Promise<string | null>;
  // 只有管理員產生的一次性登記碼能改變通知群組；其他群組事件一律不寫入設定。
  consumeGroupRegisterCode(input: {
    codeHash: string;
    groupId: string;
    groupIdHash: string;
    now: string;
  }): Promise<string>;
  consumeLinkIntent(input: {
    codeHash: string;
    lineUserIdHash: string;
    nonceHash: string;
    now: string;
  }): Promise<RpcOutcome>;
  completeAccountLink(input: {
    nonceHash: string;
    lineUserIdHash: string;
    lineUserId: string;
    result: "ok" | "failed";
    now: string;
  }): Promise<string>;
};

export type VehicleLineWebhookDependencies = {
  channelSecret: () => string;
  createStore: () => VehicleLineWebhookStore | Promise<VehicleLineWebhookStore>;
  fetcher: typeof fetch;
  now?: () => Date;
  createNonce?: () => string;
  verifySignature?: typeof verifyLineWebhookSignature;
  sendMessage?: typeof sendLineTextMessage;
};

type LinkCandidate =
  | { kind: "code"; lineUserId: string; code: string }
  | { kind: "accountLink"; lineUserId: string; nonce: string; result: "ok" | "failed" };

type GroupRegistration = { groupId: string; code: string; replyToken: string | null };

type WebhookEvent = {
  type?: unknown;
  replyToken?: unknown;
  source?: { type?: unknown; userId?: unknown; groupId?: unknown };
  message?: { type?: unknown; text?: unknown };
  link?: { nonce?: unknown; result?: unknown };
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function isLineUserId(value: unknown): value is string {
  return typeof value === "string" && /^U[a-f0-9]{32}$/i.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

async function verifyChannelOwner(
  token: string,
  destination: unknown,
  fetcher: typeof fetch,
): Promise<"match" | "mismatch" | "unavailable"> {
  if (!isLineUserId(destination)) return "mismatch";
  try {
    const response = await fetcher(LINE_BOT_INFO_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return "unavailable";
    const info = await readJson(response);
    if (!info || !isLineUserId(info.userId)) return "unavailable";
    return info.userId === destination ? "match" : "mismatch";
  } catch {
    return "unavailable";
  }
}

async function issueLinkToken(
  token: string,
  lineUserId: string,
  fetcher: typeof fetch,
): Promise<string | null> {
  try {
    const response = await fetcher(
      `${LINE_ACCOUNT_LINK_TOKEN_URL}${encodeURIComponent(lineUserId)}/linkToken`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) return null;
    const payload = await readJson(response);
    const linkToken = payload?.linkToken;
    return typeof linkToken === "string" && /^[A-Za-z0-9_-]{16,200}$/.test(linkToken)
      ? linkToken
      : null;
  } catch {
    return null;
  }
}

async function replyText(token: string, replyToken: string, text: string, fetcher: typeof fetch) {
  try {
    const response = await fetcher(LINE_REPLY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
      signal: AbortSignal.timeout(5000),
    });
    try { await response.body?.cancel(); } catch { /* 回覆失敗不影響登記結果 */ }
  } catch {
    // 回覆只是提示，失敗時登記結果仍以資料庫為準。
  }
}

function accountLinkNotice(outcome: string): string | null {
  if (outcome === "linked") return "LINE 帳號已完成綁定；您之後可隨時回系統解除綁定。";
  if (outcome === "binding_conflict" || outcome === "already_linked") {
    return "此 LINE 帳號已綁定其他系統帳號，系統不會自動移轉。請先登入原帳號解除綁定，再重新操作。";
  }
  if (outcome === "line_verification_failed") return "LINE 身分驗證未完成，請回系統重新開始綁定。";
  return null;
}

/** Verify exact raw bytes before parsing or constructing a database client. */
export function createVehicleLineWebhookHandler(deps: VehicleLineWebhookDependencies) {
  const now = deps.now ?? (() => new Date());
  const createNonce = deps.createNonce ?? (() => createVehicleLineAccountNonce());
  const verify = deps.verifySignature ?? verifyLineWebhookSignature;
  const sendMessage = deps.sendMessage ?? sendLineTextMessage;

  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (req.method !== "POST") return json({ ok: false, message: "Method not allowed" }, 405);

    let rawBody: string;
    try {
      rawBody = await req.text();
    } catch {
      return json({ ok: false, message: "Invalid webhook body" }, 400);
    }

    const signature = req.headers.get("x-line-signature");
    if (!await verify(rawBody, signature, deps.channelSecret())) {
      return json({ ok: false, message: "Invalid LINE signature" }, 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json({ ok: false, message: "Invalid webhook body" }, 400);
    }
    if (!isObject(payload) || !Array.isArray(payload.events)) {
      return json({ ok: false, message: "Invalid webhook payload" }, 400);
    }

    const events = payload.events as WebhookEvent[];
    const linkCandidates = events.flatMap((event): LinkCandidate[] => {
      const userId = event.source?.userId;
      if (!isLineUserId(userId) || event.source?.type !== "user") return [];
      if (event.type === "message" && event.message?.type === "text") {
        const code = parseVehicleLineLinkCommand(getText(event.message.text) ?? "");
        return code ? [{ kind: "code", lineUserId: userId, code }] : [];
      }
      if (event.type === "accountLink") {
        const nonce = getText(event.link?.nonce);
        const result = event.link?.result;
        return nonce && (result === "ok" || result === "failed")
          ? [{ kind: "accountLink", lineUserId: userId, nonce, result }]
          : [];
      }
      return [];
    });
    // 群組只處理「登記 XXXX-XXXX」文字訊息；被拉進陌生群組或一般聊天都不會改變任何設定。
    const registrations = events.flatMap((event): GroupRegistration[] => {
      const groupId = event.source?.groupId;
      if (event.type !== "message" || event.source?.type !== "group" || !isLineGroupId(groupId)) return [];
      if (event.message?.type !== "text") return [];
      const code = parseLineGroupRegisterCommand(getText(event.message.text) ?? "");
      return code ? [{ groupId, code, replyToken: getText(event.replyToken) }] : [];
    });

    if (!linkCandidates.length && !registrations.length) return json({ ok: true });

    try {
      const store = await deps.createStore();
      if (linkCandidates.length) await store.ensureLinkSchema();
      const token = await store.loadChannelAccessToken();
      if (!token) return json({ ok: false, message: "LINE link service unavailable" }, 503);
      const owner = await verifyChannelOwner(token, payload.destination, deps.fetcher);
      if (owner === "mismatch") return json({ ok: false, message: "LINE channel mismatch" }, 401);
      if (owner !== "match") return json({ ok: false, message: "LINE link service unavailable" }, 503);

      for (const candidate of linkCandidates) {
        const at = now().toISOString();
        const lineUserIdHash = await sha256Hex(candidate.lineUserId);

        if (candidate.kind === "code") {
          const nonce = createNonce();
          if (!/^[A-Za-z0-9_-]{32,128}$/.test(nonce)) continue;
          const consumed = await store.consumeLinkIntent({
            codeHash: await sha256Hex(candidate.code),
            lineUserIdHash,
            nonceHash: await sha256Hex(nonce),
            now: at,
          });
          if (consumed.outcome !== "ready") continue;

          const linkToken = await issueLinkToken(token, candidate.lineUserId, deps.fetcher);
          if (!linkToken) continue;
          const linkUrl = createLineAccountLinkUrl(linkToken, nonce);
          await sendMessage({
            token,
            recipient: candidate.lineUserId,
            text: `請在 10 分鐘內開啟此連結完成帳號綁定；您之後可隨時回系統解除綁定。\n${linkUrl}`,
            fetcher: deps.fetcher,
          });
          continue;
        }

        const outcome = await store.completeAccountLink({
          nonceHash: await sha256Hex(candidate.nonce),
          lineUserIdHash,
          lineUserId: candidate.lineUserId,
          result: candidate.result,
          now: at,
        });
        const notice = accountLinkNotice(outcome);
        if (notice) {
          await sendMessage({
            token,
            recipient: candidate.lineUserId,
            text: notice,
            fetcher: deps.fetcher,
          });
        }
      }

      for (const registration of registrations) {
        const outcome = await store.consumeGroupRegisterCode({
          codeHash: await sha256Hex(registration.code),
          groupId: registration.groupId,
          groupIdHash: await sha256Hex(registration.groupId),
          now: now().toISOString(),
        });
        if (registration.replyToken) {
          await replyText(token, registration.replyToken, lineGroupRegisterNotice(outcome), deps.fetcher);
        }
      }
      return json({ ok: true });
    } catch {
      // Do not log request bodies, LINE IDs, tokens, link codes, or provider responses.
      return json({ ok: false, message: "LINE webhook service unavailable" }, 503);
    }
  };
}
