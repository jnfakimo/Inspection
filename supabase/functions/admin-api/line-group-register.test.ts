import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import { sha256Hex } from "../_shared/vehicle-line-link.ts";
import { executeLineGroupRegisterAction, LINE_GROUP_REGISTER_ACTION } from "./line-group-register.ts";

const fixedCode = () => ({ code: "ABCD2345", display: "ABCD-2345" });
const now = () => new Date("2026-10-31T01:00:00.000Z");

test("creates a hashed register code and returns the plain code only to the caller", async () => {
  const intents: unknown[] = [];
  const result = await executeLineGroupRegisterAction({ action: LINE_GROUP_REGISTER_ACTION }, {
    userId: "admin-user",
    now,
    createCode: fixedCode,
    createIntent: async (input) => { intents.push(input); return { outcome: "created", expiresAt: "2026-10-31T01:10:00.000Z" }; },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(intents, [{
    userId: "admin-user",
    codeHash: await sha256Hex("ABCD2345", webcrypto as Crypto),
    now: "2026-10-31T01:00:00.000Z",
  }]);
  assert.deepEqual(result.body.data, { code: "ABCD-2345", expires_at: "2026-10-31T01:10:00.000Z" });
  assert.match(result.body.message, /登記 ABCD-2345/);
  assert.equal(JSON.stringify(result.audit).includes("ABCD"), false);
});

test("rejects extra parameters so a caller cannot choose the code or group", async () => {
  let called = false;
  const result = await executeLineGroupRegisterAction({ action: LINE_GROUP_REGISTER_ACTION, group_id: "C1" }, {
    userId: "admin-user",
    createIntent: async () => { called = true; return { outcome: "created", expiresAt: "x" }; },
  });
  assert.equal(result.status, 400);
  assert.equal(called, false);
});

test("database failures and refused outcomes do not leak a usable code", async () => {
  const unavailable = await executeLineGroupRegisterAction({ action: LINE_GROUP_REGISTER_ACTION }, {
    userId: "admin-user", createCode: fixedCode,
    createIntent: async () => { throw new Error("db down"); },
  });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body.data, undefined);

  const refused = await executeLineGroupRegisterAction({ action: LINE_GROUP_REGISTER_ACTION }, {
    userId: "admin-user", createCode: fixedCode,
    createIntent: async () => ({ outcome: "user_inactive", expiresAt: null }),
  });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.data, undefined);
  assert.equal(refused.audit, undefined);
});
