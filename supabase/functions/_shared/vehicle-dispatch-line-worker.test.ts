import assert from "node:assert/strict";
import test from "node:test";
import type { LineTextMessageInput, LineTextMessageResult } from "./line-message.ts";
import {
  createVehicleDispatchLineWorkerHandler,
  VEHICLE_DISPATCH_NOTICE_TEXT,
  VEHICLE_DISPATCH_NOTICE_URL,
  VEHICLE_LINE_NOTIFICATION_TEST_TEXT,
  type VehicleDispatchLineWorkerStore,
} from "./vehicle-dispatch-line-worker.ts";
import { classifyLineAttempt } from "./vehicle-dispatch-line-retry.ts";

const cronSecret = "synthetic-cron-secret";
const lineUserId = "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const retryKey = "123e4567-e89b-42d3-a456-426614174000";
const fixedNow = new Date("2026-10-08T08:00:00.000Z");

function prepared(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "ready",
    line_user_id: lineUserId,
    retry_key: retryKey,
    message_text: VEHICLE_DISPATCH_NOTICE_TEXT,
    attempts: 1,
    first_attempt_at: fixedNow.toISOString(),
    ...overrides,
  };
}

function makeStore(overrides: Partial<VehicleDispatchLineWorkerStore> = {}) {
  const calls: { claimed: unknown[]; prepared: unknown[]; finished: unknown[]; testClaimed: unknown[]; testPrepared: unknown[]; testFinished: unknown[] } = {
    claimed: [], prepared: [], finished: [], testClaimed: [], testPrepared: [], testFinished: [],
  };
  const store: VehicleDispatchLineWorkerStore = {
    loadChannelAccessToken: async () => "synthetic-line-token",
    claim: async (input) => { calls.claimed.push(input); return [{ outbox_id: "outbox-synthetic-1", lease_token: "lease-synthetic-1" }]; },
    prepare: async (input) => { calls.prepared.push(input); return prepared(); },
    finish: async (input) => { calls.finished.push(input); return input.resolution; },
    claimTest: async (input) => { calls.testClaimed.push(input); return [{ outbox_id: input.testRunId, lease_token: "test-lease-synthetic" }]; },
    prepareTest: async (input) => { calls.testPrepared.push(input); return prepared({ message_text: VEHICLE_LINE_NOTIFICATION_TEST_TEXT }); },
    finishTest: async (input) => { calls.testFinished.push(input); return input.resolution; },
    ...overrides,
  };
  return { store, calls };
}

function request(headers: Record<string, string> = {}, body = "") {
  return new Request("https://worker.test/vehicle-line-dispatch-worker", {
    method: "POST", headers, body,
  });
}

function authorizedRequest(body = "") {
  return request({ "x-cron-secret": cronSecret, "content-type": "application/json" }, body);
}

test("worker requires POST and a configured constant-time cron secret before store access", async () => {
  let storeCreated = 0;
  const handler = createVehicleDispatchLineWorkerHandler({
    cronSecret: () => cronSecret,
    createStore: () => { storeCreated++; throw new Error("must not create store"); },
  });
  assert.equal((await handler(new Request("https://worker.test", { method: "GET" }))).status, 405);
  assert.equal((await handler(request({ "x-cron-secret": "wrong" }))).status, 401);
  assert.equal(storeCreated, 0);

  const unavailable = createVehicleDispatchLineWorkerHandler({ cronSecret: () => "", createStore: () => { storeCreated++; throw new Error(); } });
  assert.equal((await unavailable(authorizedRequest())).status, 503);
  assert.equal(storeCreated, 0);
});

test("missing LINE configuration fails before claiming any outbox work", async () => {
  let claims = 0;
  const { store } = makeStore({
    loadChannelAccessToken: async () => null,
    claim: async () => { claims++; return []; },
  });
  const handler = createVehicleDispatchLineWorkerHandler({ cronSecret: () => cronSecret, createStore: () => store });
  assert.equal((await handler(authorizedRequest())).status, 503);
  assert.equal(claims, 0);
});

test("request body cannot choose a recipient, message or work item", async () => {
  const { store, calls } = makeStore();
  let sent: LineTextMessageInput | null = null;
  const handler = createVehicleDispatchLineWorkerHandler({
    cronSecret: () => cronSecret,
    createStore: () => store,
    now: () => new Date(fixedNow),
    random: () => 0.5,
    sendMessage: async (input) => { sent = input; return { ok: true, status: 200 }; },
  });
  const response = await handler(authorizedRequest(JSON.stringify({
    recipient: "Uforged", text: "forged message", outbox_id: "forged-id", limit: 999,
  })));
  assert.equal(response.status, 200);
  assert.equal(calls.claimed.length, 1);
  assert.equal(calls.testClaimed.length, 0);
  assert.deepEqual(calls.claimed[0], { limit: 20, leaseSeconds: 90, now: fixedNow.toISOString() });
  assert.equal(sent?.recipient, lineUserId);
  assert.equal(sent?.text, VEHICLE_DISPATCH_NOTICE_TEXT);
  assert.equal(sent?.retryKey, retryKey);
  assert.equal(calls.finished[0] && (calls.finished[0] as { resolution: string }).resolution, "accepted");
  const body = await response.json();
  assert.equal(body.data.accepted, 1);
  assert.equal(JSON.stringify(body).includes("delivered"), false);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("invalid or localhost payload is never sent and is dead-lettered", async () => {
  for (const invalidText of ["notice http://localhost:3000", "notice https://evil.test/route"]) {
    const { store, calls } = makeStore({ prepare: async () => prepared({ message_text: invalidText }) });
    let sends = 0;
    const handler = createVehicleDispatchLineWorkerHandler({
      cronSecret: () => cronSecret, createStore: () => store, now: () => new Date(fixedNow),
      sendMessage: async () => { sends++; return { ok: true, status: 200 }; },
    });
    assert.equal((await handler(authorizedRequest())).status, 200);
    assert.equal(sends, 0);
    assert.equal((calls.finished[0] as { resolution: string }).resolution, "dead_letter");
    assert.equal((calls.finished[0] as { errorCode: string }).errorCode, "invalid_payload");
  }
  assert.match(VEHICLE_DISPATCH_NOTICE_URL, /^https:\/\//);
  assert.doesNotMatch(VEHICLE_DISPATCH_NOTICE_URL, /localhost|127\.0\.0\.1/);
});

test("suppressed jobs do not call LINE", async () => {
  const { store, calls } = makeStore({ prepare: async () => ({ outcome: "suppressed" }) });
  let sends = 0;
  const handler = createVehicleDispatchLineWorkerHandler({
    cronSecret: () => cronSecret, createStore: () => store,
    sendMessage: async () => { sends++; return { ok: true, status: 200 }; },
  });
  const response = await handler(authorizedRequest());
  assert.equal(response.status, 200);
  assert.equal(sends, 0);
  assert.equal((await response.json()).data.suppressed, 1);
  assert.equal(calls.finished.length, 0);
});

test("test mode claims exactly one synthetic run and never touches production claims", async () => {
  const testRunId = "123e4567-e89b-42d3-a456-426614174001";
  const { store, calls } = makeStore();
  let sent: LineTextMessageInput | null = null;
  const handler = createVehicleDispatchLineWorkerHandler({
    cronSecret: () => cronSecret,
    createStore: () => store,
    now: () => new Date(fixedNow),
    sendMessage: async (input) => { sent = input; return { ok: true, status: 200 }; },
  });
  const response = await handler(authorizedRequest(JSON.stringify({ mode: "test", test_run_id: testRunId })));
  assert.equal(response.status, 200);
  assert.deepEqual(calls.testClaimed, [{ testRunId, leaseSeconds: 90, now: fixedNow.toISOString() }]);
  assert.equal(calls.claimed.length, 0);
  assert.deepEqual(calls.testPrepared, [{ testRunId, leaseToken: "test-lease-synthetic", now: fixedNow.toISOString() }]);
  assert.equal(sent?.recipient, lineUserId);
  assert.equal(sent?.text, VEHICLE_LINE_NOTIFICATION_TEST_TEXT);
  assert.equal(sent?.retryKey, retryKey);
  assert.equal(calls.finished.length, 0);
  assert.equal((calls.testFinished[0] as { resolution: string }).resolution, "accepted");
  assert.deepEqual(await response.json().then((body) => body.data), {
    claimed: 1, accepted: 1, retry_wait: 0, uncertain: 0, dead_letter: 0, suppressed: 0, stale: 0, failed: 0,
  });
});

test("test mode rejects extra caller-controlled data and never creates a store", async () => {
  let stores = 0;
  const handler = createVehicleDispatchLineWorkerHandler({
    cronSecret: () => cronSecret,
    createStore: () => { stores++; throw new Error("must not create store"); },
  });
  const response = await handler(authorizedRequest(JSON.stringify({
    mode: "test", test_run_id: "123e4567-e89b-42d3-a456-426614174001", recipient: "Uforged", text: "forged", group_id: "Cforged",
  })));
  assert.equal(response.status, 400);
  assert.equal(stores, 0);
});

test("2xx and LINE 409 with accepted request ID mean API accepted, not delivered", () => {
  assert.deepEqual(classifyLineAttempt({ ok: true, status: 200 }, {
    attempts: 1, firstAttemptAt: fixedNow.toISOString(), now: fixedNow,
  }), { resolution: "accepted", errorCode: null, nextAttemptAt: null });
  assert.deepEqual(classifyLineAttempt({ ok: false, status: 409, acceptedRequestId: "accepted-id" }, {
    attempts: 2, firstAttemptAt: fixedNow.toISOString(), now: fixedNow,
  }), { resolution: "accepted", errorCode: null, nextAttemptAt: null });
});

test("5xx and unknown network outcomes use bounded exponential backoff with the stable retry key", async () => {
  const base = classifyLineAttempt({ ok: false, status: 503 }, {
    attempts: 1, firstAttemptAt: fixedNow.toISOString(), now: fixedNow, random: () => 0.5,
  });
  assert.equal(base.resolution, "retry_wait");
  assert.equal(Date.parse(base.nextAttemptAt!) - fixedNow.getTime(), 22_500);
  assert.equal(base.errorCode, "line_server_error");

  const higherAttempt = classifyLineAttempt({ ok: false, status: null }, {
    attempts: 3, firstAttemptAt: fixedNow.toISOString(), now: fixedNow, random: () => 0.5,
  });
  assert.equal(higherAttempt.resolution, "retry_wait");
  assert.ok(Date.parse(higherAttempt.nextAttemptAt!) > Date.parse(base.nextAttemptAt!));
  assert.equal(higherAttempt.errorCode, "network_unknown");
});

test("LINE 4xx including 429 are not retried; exhausted unknown attempts stay uncertain", () => {
  const limited = classifyLineAttempt({ ok: false, status: 429 }, {
    attempts: 1, firstAttemptAt: fixedNow.toISOString(), now: fixedNow,
  });
  assert.deepEqual(limited, { resolution: "dead_letter", errorCode: "line_rate_limited", nextAttemptAt: null });

  const invalid = classifyLineAttempt({ ok: false, status: 400 }, {
    attempts: 1, firstAttemptAt: fixedNow.toISOString(), now: fixedNow,
  });
  assert.equal(invalid.resolution, "dead_letter");

  const exhausted = classifyLineAttempt({ ok: false, status: null }, {
    attempts: 8, firstAttemptAt: fixedNow.toISOString(), now: fixedNow,
  });
  assert.deepEqual(exhausted, { resolution: "uncertain", errorCode: "max_attempts", nextAttemptAt: null });
});

test("LINE 409 without accepted request ID remains uncertain without a blind retry", () => {
  const result: LineTextMessageResult = { ok: false, status: 409 };
  assert.deepEqual(classifyLineAttempt(result, {
    attempts: 2, firstAttemptAt: fixedNow.toISOString(), now: fixedNow,
  }), { resolution: "uncertain", errorCode: "line_conflict_without_id", nextAttemptAt: null });
});
