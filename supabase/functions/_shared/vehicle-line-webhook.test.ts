import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { createVehicleLineWebhookHandler, type VehicleLineWebhookStore } from "./vehicle-line-webhook.ts";
import { sha256Hex } from "./vehicle-line-link.ts";

const secret = "synthetic-line-secret";
const botUserId = `U${"b".repeat(32)}`;
const lineUserId = `U${"a".repeat(32)}`;
const linkCode = `LINK-${"C".repeat(32)}`;
const fixedNonce = `N${"x".repeat(31)}`;
const groupId = `C${"d".repeat(32)}`;

async function signature(rawBody: string) {
  const key = await webcrypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = new Uint8Array(await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  return btoa([...digest].map((byte) => String.fromCharCode(byte)).join(""));
}

function signedRequest(rawBody: string, signatureValue: string) {
  return new Request("https://edge.test/line-notify", {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": signatureValue },
    body: rawBody,
  });
}

function makeStore(overrides: Partial<VehicleLineWebhookStore> = {}) {
  const calls: Record<string, unknown[]> = { registrations: [], consumed: [], completed: [] };
  const store: VehicleLineWebhookStore = {
    ensureLinkSchema: async () => { calls.schemaChecked = [true]; },
    loadChannelAccessToken: async () => "synthetic-token",
    consumeGroupRegisterCode: async (input) => { calls.registrations.push(input); return "registered"; },
    consumeLinkIntent: async (input) => { calls.consumed.push(input); return { outcome: "ready", userId: "synthetic-user" }; },
    completeAccountLink: async (input) => { calls.completed.push(input); return "linked"; },
    ...overrides,
  };
  return { store, calls };
}

function makeHandler(store: VehicleLineWebhookStore, fetcher: typeof fetch, calls: Record<string, unknown[]> = {}) {
  return createVehicleLineWebhookHandler({
    channelSecret: () => secret,
    createStore: () => { calls.storeCreated = [true]; return store; },
    fetcher,
    now: () => new Date("2026-10-08T07:00:00.000Z"),
    createNonce: () => fixedNonce,
  });
}

function mockedLineFetch(calls: Array<{ url: string; init?: RequestInit }> = [], ownerId = botUserId): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://api.line.me/v2/bot/info") {
      return Response.json({ userId: ownerId });
    }
    if (url === `https://api.line.me/v2/bot/user/${lineUserId}/linkToken`) {
      return Response.json({ linkToken: "syntheticLinkToken000001" });
    }
    if (url === "https://api.line.me/v2/bot/message/push") return new Response(null, { status: 200 });
    if (url === "https://api.line.me/v2/bot/message/reply") return new Response(null, { status: 200 });
    throw new Error(`Unexpected external request: ${url}`);
  };
}

test("invalid signature is rejected before JSON parsing, DB construction, or LINE fetch", async () => {
  const { store } = makeStore();
  const externalCalls: Array<{ url: string; init?: RequestInit }> = [];
  let storeCreated = false;
  const handler = createVehicleLineWebhookHandler({
    channelSecret: () => secret,
    createStore: () => { storeCreated = true; return store; },
    fetcher: mockedLineFetch(externalCalls),
    verifySignature: async () => false,
  });
  const response = await handler(signedRequest("not json", "bad"));
  assert.equal(response.status, 401);
  assert.equal(storeCreated, false);
  assert.equal(externalCalls.length, 0);
});

test("valid signature precedes parsing and malformed signed body makes no DB call", async () => {
  const { store } = makeStore();
  let storeCreated = false;
  const handler = createVehicleLineWebhookHandler({
    channelSecret: () => secret,
    createStore: () => { storeCreated = true; return store; },
    fetcher: mockedLineFetch(),
  });
  const raw = "{";
  const response = await handler(signedRequest(raw, await signature(raw)));
  assert.equal(response.status, 400);
  assert.equal(storeCreated, false);
});

test("direct link command matches the channel owner, consumes once, and pushes the official link", async () => {
  const { store, calls } = makeStore();
  const externalCalls: Array<{ url: string; init?: RequestInit }> = [];
  const handler = makeHandler(store, mockedLineFetch(externalCalls), calls);
  const raw = JSON.stringify({
    destination: botUserId,
    events: [{
      type: "message",
      source: { type: "user", userId: lineUserId },
      message: { type: "text", text: linkCode },
    }],
  });
  const response = await handler(signedRequest(raw, await signature(raw)));
  assert.equal(response.status, 200);
  assert.equal(calls.consumed.length, 1);
  assert.equal(calls.consumed[0] && (calls.consumed[0] as { codeHash: string }).codeHash, await sha256Hex(linkCode, webcrypto));
  assert.equal((calls.consumed[0] as { lineUserIdHash: string }).lineUserIdHash, await sha256Hex(lineUserId, webcrypto));
  assert.equal((calls.consumed[0] as { nonceHash: string }).nonceHash, await sha256Hex(fixedNonce, webcrypto));
  assert.deepEqual(externalCalls.map((call) => call.url), [
    "https://api.line.me/v2/bot/info",
    `https://api.line.me/v2/bot/user/${lineUserId}/linkToken`,
    "https://api.line.me/v2/bot/message/push",
  ]);
  const push = JSON.parse(String(externalCalls[2].init?.body));
  assert.equal(push.to, lineUserId);
  assert.match(push.messages[0].text, /https:\/\/access\.line\.me\/dialog\/bot\/accountLink/);
  assert.match(push.messages[0].text, /您之後可隨時回系統解除綁定/);
  assert.equal(JSON.stringify(push).includes("synthetic-user"), false);
});

test("signed payload for another LINE bot cannot consume a code or write group settings", async () => {
  const { store, calls } = makeStore();
  const externalCalls: Array<{ url: string; init?: RequestInit }> = [];
  const handler = makeHandler(store, mockedLineFetch(externalCalls, `U${"c".repeat(32)}`), calls);
  const raw = JSON.stringify({
    destination: botUserId,
    events: [
      { type: "message", source: { type: "user", userId: lineUserId }, message: { type: "text", text: linkCode } },
      { type: "message", replyToken: "r1", source: { type: "group", groupId }, message: { type: "text", text: "登記 ABCD-2345" } },
    ],
  });
  const response = await handler(signedRequest(raw, await signature(raw)));
  assert.equal(response.status, 401);
  assert.equal(calls.consumed.length, 0);
  assert.equal(calls.registrations.length, 0);
  assert.deepEqual(externalCalls.map((call) => call.url), ["https://api.line.me/v2/bot/info"]);
});

test("missing binding schema fails closed before calling the LINE API", async () => {
  const { store, calls } = makeStore({ ensureLinkSchema: async () => { throw new Error("schema unavailable"); } });
  const externalCalls: Array<{ url: string; init?: RequestInit }> = [];
  const handler = makeHandler(store, mockedLineFetch(externalCalls), calls);
  const raw = JSON.stringify({ destination: botUserId, events: [{
    type: "message", source: { type: "user", userId: lineUserId },
    message: { type: "text", text: linkCode },
  }] });
  assert.equal((await handler(signedRequest(raw, await signature(raw)))).status, 503);
  assert.equal(externalCalls.length, 0);
  assert.equal(calls.consumed.length, 0);
});

test("duplicate, expired, and failed link outcomes never bind or issue a second link token", async () => {
  const outcomes = ["already_used", "expired"];
  for (const outcome of outcomes) {
    const { store, calls } = makeStore({ consumeLinkIntent: async (input) => { calls.consumed.push(input); return { outcome }; } });
    const externalCalls: Array<{ url: string; init?: RequestInit }> = [];
    const handler = makeHandler(store, mockedLineFetch(externalCalls), calls);
    const raw = JSON.stringify({ destination: botUserId, events: [{ type: "message", source: { type: "user", userId: lineUserId }, message: { type: "text", text: linkCode } }] });
    assert.equal((await handler(signedRequest(raw, await signature(raw)))).status, 200);
    assert.deepEqual(externalCalls.map((call) => call.url), ["https://api.line.me/v2/bot/info"]);
  }

  const { store, calls } = makeStore({ completeAccountLink: async (input) => { calls.completed.push(input); return "line_verification_failed"; } });
  const externalCalls: Array<{ url: string; init?: RequestInit }> = [];
  const handler = makeHandler(store, mockedLineFetch(externalCalls), calls);
  const raw = JSON.stringify({ destination: botUserId, events: [{ type: "accountLink", source: { type: "user", userId: lineUserId }, link: { nonce: fixedNonce, result: "failed" } }] });
  assert.equal((await handler(signedRequest(raw, await signature(raw)))).status, 200);
  assert.equal((calls.completed[0] as { result: string }).result, "failed");
  const push = JSON.parse(String(externalCalls.at(-1)?.init?.body));
  assert.match(push.messages[0].text, /身分驗證未完成/);
});

test("LINE account-link callback records conflict by LINE identity, not a supplied service user", async () => {
  const { store, calls } = makeStore({ completeAccountLink: async (input) => { calls.completed.push(input); return "binding_conflict"; } });
  const externalCalls: Array<{ url: string; init?: RequestInit }> = [];
  const handler = makeHandler(store, mockedLineFetch(externalCalls), calls);
  const raw = JSON.stringify({ destination: botUserId, events: [{ type: "accountLink", source: { type: "user", userId: lineUserId }, link: { nonce: fixedNonce, result: "ok", userId: "forged" } }] });
  assert.equal((await handler(signedRequest(raw, await signature(raw)))).status, 200);
  assert.deepEqual(calls.completed[0], {
    nonceHash: await sha256Hex(fixedNonce, webcrypto),
    lineUserIdHash: await sha256Hex(lineUserId, webcrypto),
    lineUserId,
    result: "ok",
    now: "2026-10-08T07:00:00.000Z",
  });
  const push = JSON.parse(String(externalCalls.at(-1)?.init?.body));
  assert.match(push.messages[0].text, /不會自動移轉/);
});

test("ordinary group traffic never writes the notification group", async () => {
  const { store, calls } = makeStore();
  const externalCalls: Array<{ url: string; init?: RequestInit }> = [];
  const handler = makeHandler(store, mockedLineFetch(externalCalls), calls);
  const raw = JSON.stringify({ destination: botUserId, events: [
    { type: "join", replyToken: "r0", source: { type: "group", groupId } },
    { type: "message", replyToken: "r1", source: { type: "group", groupId }, message: { type: "text", text: "hello" } },
    { type: "message", replyToken: "r2", source: { type: "group", groupId }, message: { type: "text", text: linkCode } },
    { type: "message", replyToken: "r3", source: { type: "room", roomId: "synthetic-room" }, message: { type: "text", text: "登記 ABCD-2345" } },
    { type: "message", replyToken: "r4", source: { type: "user", userId: lineUserId }, message: { type: "text", text: "登記 ABCD-2345" } },
    { type: "message", replyToken: "r5", source: { type: "group", groupId: "not-a-group-id" }, message: { type: "text", text: "登記 ABCD-2345" } },
  ] });
  assert.equal((await handler(signedRequest(raw, await signature(raw)))).status, 200);
  assert.equal(calls.storeCreated, undefined);
  assert.equal(calls.registrations.length, 0);
  assert.equal(calls.consumed.length, 0);
  assert.equal(externalCalls.length, 0);
});

test("group registration code is hashed, consumed once, and answered with a free reply", async () => {
  const { store, calls } = makeStore();
  const externalCalls: Array<{ url: string; init?: RequestInit }> = [];
  const handler = makeHandler(store, mockedLineFetch(externalCalls), calls);
  const raw = JSON.stringify({ destination: botUserId, events: [
    { type: "message", replyToken: "reply-token-1", source: { type: "group", groupId, userId: lineUserId }, message: { type: "text", text: " 登記 abcd-2345 " } },
  ] });
  assert.equal((await handler(signedRequest(raw, await signature(raw)))).status, 200);
  assert.deepEqual(calls.registrations, [{
    codeHash: await sha256Hex("ABCD2345", webcrypto),
    groupId,
    groupIdHash: await sha256Hex(groupId, webcrypto),
    now: "2026-10-08T07:00:00.000Z",
  }]);
  assert.equal(calls.schemaChecked, undefined);
  assert.deepEqual(externalCalls.map((call) => call.url), [
    "https://api.line.me/v2/bot/info",
    "https://api.line.me/v2/bot/message/reply",
  ]);
  const reply = JSON.parse(String(externalCalls[1].init?.body));
  assert.equal(reply.replyToken, "reply-token-1");
  assert.match(reply.messages[0].text, /已將此群組登記/);
  assert.equal(JSON.stringify(reply).includes("ABCD"), false);
});

test("expired or reused group codes are refused with a reply and no other side effect", async () => {
  for (const [outcome, pattern] of [["expired", /已過期/], ["already_used", /無效或已使用/], ["invalid_code", /無效或已使用/]] as const) {
    const { store, calls } = makeStore({ consumeGroupRegisterCode: async (input) => { calls.registrations.push(input); return outcome; } });
    const externalCalls: Array<{ url: string; init?: RequestInit }> = [];
    const handler = makeHandler(store, mockedLineFetch(externalCalls), calls);
    const raw = JSON.stringify({ destination: botUserId, events: [
      { type: "message", replyToken: "reply-token-2", source: { type: "group", groupId }, message: { type: "text", text: "登記ABCD2345" } },
    ] });
    assert.equal((await handler(signedRequest(raw, await signature(raw)))).status, 200);
    assert.equal(calls.registrations.length, 1);
    const reply = JSON.parse(String(externalCalls.at(-1)?.init?.body));
    assert.match(reply.messages[0].text, pattern);
  }
});

test("group registration fails closed when the store is unavailable", async () => {
  const { store, calls } = makeStore({ consumeGroupRegisterCode: async () => { throw new Error("db down"); } });
  const externalCalls: Array<{ url: string; init?: RequestInit }> = [];
  const handler = makeHandler(store, mockedLineFetch(externalCalls), calls);
  const raw = JSON.stringify({ destination: botUserId, events: [
    { type: "message", replyToken: "reply-token-3", source: { type: "group", groupId }, message: { type: "text", text: "登記 ABCD-2345" } },
  ] });
  assert.equal((await handler(signedRequest(raw, await signature(raw)))).status, 503);
  assert.deepEqual(externalCalls.map((call) => call.url), ["https://api.line.me/v2/bot/info"]);
});
