import assert from "node:assert/strict";
import test from "node:test";
import { sendLineTextMessage } from "../_shared/line-message.ts";
import {
  executeLineGroupTestAction,
  LINE_GROUP_TEST_ACTION,
  LINE_GROUP_TEST_MESSAGE,
} from "./line-group-test.ts";

const configuredSettings = {
  token: "synthetic-test-token",
  groupId: "C-synthetic-group-id",
};

test("group test uses only configured group and a fixed group-labelled message", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await executeLineGroupTestAction({ action: LINE_GROUP_TEST_ACTION }, {
    readSettings: async () => configuredSettings,
    sendMessage: (token, recipient, text) => sendLineTextMessage({
      token,
      recipient,
      text,
      fetcher: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(null, { status: 200 });
      },
    }),
  });

  assert.equal(requestUrl, "https://api.line.me/v2/bot/message/push");
  assert.equal(requestInit?.method, "POST");
  assert.equal(new Headers(requestInit?.headers).get("authorization"), "Bearer synthetic-test-token");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    to: configuredSettings.groupId,
    messages: [{ type: "text", text: LINE_GROUP_TEST_MESSAGE }],
  });
  assert.match(LINE_GROUP_TEST_MESSAGE, /群組測試通知/);
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.match(result.body.message, /LINE 群組/);
  assert.deepEqual(result.audit, {
    destination: "configured_group",
    result: "sent",
    http_status: 200,
  });
});

test("group test rejects recipient or message input, including a personal identifier", async () => {
  let sent = false;
  const result = await executeLineGroupTestAction({
    action: LINE_GROUP_TEST_ACTION,
    recipient: "022443",
    text: "personal test",
  }, {
    readSettings: async () => configuredSettings,
    sendMessage: async () => {
      sent = true;
      return { ok: true, status: 200 };
    },
  });

  assert.equal(sent, false);
  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.match(result.body.message, /不接受額外參數/);
});

test("configuration and provider failures return generic messages without secrets", async () => {
  const missing = await executeLineGroupTestAction({ action: LINE_GROUP_TEST_ACTION }, {
    readSettings: async () => ({ token: null, groupId: configuredSettings.groupId }),
    sendMessage: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.message, "LINE 群組測試設定尚未完成");

  const unavailable = await executeLineGroupTestAction({ action: LINE_GROUP_TEST_ACTION }, {
    readSettings: async () => { throw new Error("synthetic-test-token leaked by dependency"); },
    sendMessage: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.message, "LINE 群組測試設定暫時無法讀取");

  const rejected = await executeLineGroupTestAction({ action: LINE_GROUP_TEST_ACTION }, {
    readSettings: async () => configuredSettings,
    sendMessage: async () => ({ ok: false, status: 401 }),
  });
  assert.equal(rejected.status, 502);
  assert.equal(rejected.body.message, "LINE 群組測試發送失敗，請檢查設定或服務狀態。");
  assert.doesNotMatch(JSON.stringify([missing, unavailable, rejected]), /synthetic-test-token/);
});

test("LINE adapter does not read provider response bodies or expose fetch errors", async () => {
  let providerResponse: Response | null = null;
  const failed = await sendLineTextMessage({
    token: "synthetic-test-token",
    recipient: configuredSettings.groupId,
    text: LINE_GROUP_TEST_MESSAGE,
    fetcher: async () => {
      providerResponse = new Response("synthetic private provider detail", { status: 401 });
      providerResponse.text = async () => { throw new Error("provider body must not be read"); };
      return providerResponse;
    },
  });
  assert.deepEqual(failed, { ok: false, status: 401, acceptedRequestId: null });
  assert.equal(providerResponse?.bodyUsed, true); // Unused provider stream is cancelled, not retained.

  const networkFailure = await sendLineTextMessage({
    token: "synthetic-test-token",
    recipient: configuredSettings.groupId,
    text: LINE_GROUP_TEST_MESSAGE,
    fetcher: async () => { throw new Error("synthetic-test-token in network error"); },
  });
  assert.deepEqual(networkFailure, { ok: false, status: null });
});
