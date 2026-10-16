import assert from "node:assert/strict";
import test from "node:test";
import { sendLineTextMessage } from "./line-message.ts";

const retryKey = "123e4567-e89b-42d3-a456-426614174000";

test("LINE push sends a stable retry key and captures accepted request ID without reading the body", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const response = new Response("private provider body", {
    status: 409,
    headers: { "x-line-accepted-request-id": "accepted-request-001" },
  });
  response.text = async () => { throw new Error("provider body must not be read"); };
  const result = await sendLineTextMessage({
    token: "synthetic-token",
    recipient: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    text: "synthetic notice",
    retryKey,
    fetcher: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return response;
    },
  });

  assert.equal(requestUrl, "https://api.line.me/v2/bot/message/push");
  assert.equal(new Headers(requestInit?.headers).get("x-line-retry-key"), retryKey);
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    to: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    messages: [{ type: "text", text: "synthetic notice" }],
  });
  assert.deepEqual(result, { ok: false, status: 409, acceptedRequestId: "accepted-request-001" });
});

test("LINE push reports API acceptance separately from recipient delivery", async () => {
  const result = await sendLineTextMessage({
    token: "synthetic-token",
    recipient: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    text: "synthetic notice",
    retryKey,
    fetcher: async () => new Response(null, { status: 200 }),
  });
  assert.deepEqual(result, { ok: true, status: 200, acceptedRequestId: null });
});

test("malformed retry keys fail closed without making a network request", async () => {
  let calls = 0;
  const result = await sendLineTextMessage({
    token: "synthetic-token",
    recipient: "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    text: "synthetic notice",
    retryKey: "not-a-uuid",
    fetcher: async () => { calls++; return new Response(null, { status: 200 }); },
  });
  assert.deepEqual(result, { ok: false, status: null });
  assert.equal(calls, 0);
});
