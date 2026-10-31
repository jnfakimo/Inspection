import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import {
  createLineGroupRegisterCode,
  isLineGroupId,
  lineGroupRegisterNotice,
  parseLineGroupRegisterCommand,
} from "./line-group-register.ts";

test("register codes are 8 unambiguous characters shown as XXXX-XXXX", () => {
  for (let i = 0; i < 200; i++) {
    const { code, display } = createLineGroupRegisterCode(webcrypto as Crypto);
    assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(display, `${code.slice(0, 4)}-${code.slice(4)}`);
    assert.equal(parseLineGroupRegisterCommand(`登記 ${display}`), code);
  }
});

test("register command accepts spacing, case and missing hyphen variants only", () => {
  assert.equal(parseLineGroupRegisterCommand("登記 ABCD-2345"), "ABCD2345");
  assert.equal(parseLineGroupRegisterCommand("  登記abcd2345 "), "ABCD2345");
  assert.equal(parseLineGroupRegisterCommand("登記 ABCD-1345"), null);
  assert.equal(parseLineGroupRegisterCommand("登記 ABCD-O345"), null);
  assert.equal(parseLineGroupRegisterCommand("請登記 ABCD-2345"), null);
  assert.equal(parseLineGroupRegisterCommand("登記 ABCD-23456"), null);
  assert.equal(parseLineGroupRegisterCommand("hello"), null);
});

test("only real LINE group IDs are accepted", () => {
  assert.equal(isLineGroupId(`C${"a".repeat(32)}`), true);
  assert.equal(isLineGroupId(`U${"a".repeat(32)}`), false);
  assert.equal(isLineGroupId("synthetic-group"), false);
  assert.equal(isLineGroupId(undefined), false);
});

test("register notices never echo the code", () => {
  for (const outcome of ["registered", "expired", "already_used", "invalid_code", "invalid_request"]) {
    assert.doesNotMatch(lineGroupRegisterNotice(outcome), /[A-HJ-NP-Z2-9]{4}-/);
  }
  assert.match(lineGroupRegisterNotice("registered"), /已將此群組登記/);
});
