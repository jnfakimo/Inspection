export type LineTextMessageResult = {
  ok: boolean;
  status: number | null;
  acceptedRequestId?: string | null;
};

export type LineTextMessageInput = {
  token: string;
  recipient: string;
  text: string;
  retryKey?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
const UUID_RETRY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Send one text push without reading or logging LINE's response body. */
export async function sendLineTextMessage({
  token,
  recipient,
  text,
  retryKey,
  fetcher = fetch,
  timeoutMs = 5000,
}: LineTextMessageInput): Promise<LineTextMessageResult> {
  if (retryKey !== undefined && !UUID_RETRY_KEY.test(retryKey)) return { ok: false, status: null };
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (retryKey) headers["X-Line-Retry-Key"] = retryKey;
    const response = await fetcher(LINE_PUSH_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers,
      body: JSON.stringify({
        to: recipient,
        messages: [{ type: "text", text }],
      }),
    });
    const rawAcceptedRequestId = response.headers.get("x-line-accepted-request-id");
    const acceptedRequestId = rawAcceptedRequestId && /^[A-Za-z0-9._:-]{1,200}$/.test(rawAcceptedRequestId)
      ? rawAcceptedRequestId
      : null;
    return { ok: response.ok, status: response.status, acceptedRequestId };
  } catch {
    return { ok: false, status: null };
  }
}
