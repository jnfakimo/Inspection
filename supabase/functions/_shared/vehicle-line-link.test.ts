import assert from "node:assert/strict";
import test from "node:test";
import { webcrypto } from "node:crypto";
import {
  createLineAccountLinkUrl,
  createVehicleLineAccountNonce,
  createVehicleLineLinkCode,
  evaluateVehicleLineLinkIntent,
  parseVehicleLineLinkCommand,
  sha256Hex,
  VEHICLE_LINE_LINK_TTL_MS,
  verifyLineWebhookSignature,
} from "./vehicle-line-link.ts";

test("link codes are opaque single-use candidates and command parsing is narrow", () => {
  const first = createVehicleLineLinkCode(webcrypto);
  const second = createVehicleLineLinkCode(webcrypto);
  assert.match(first, /^LINK-[A-Za-z0-9_-]{32}$/);
  assert.notEqual(first, second);
  assert.equal(parseVehicleLineLinkCommand(first), first);
  assert.equal(parseVehicleLineLinkCommand(` ${first} `), first);
  assert.equal(parseVehicleLineLinkCommand("12345"), null);
  assert.equal(parseVehicleLineLinkCommand(`LINK-${"A".repeat(31)}`), null);
});

test("account-link nonce is cryptographically random and within LINE's permitted length", () => {
  const nonce = createVehicleLineAccountNonce(webcrypto);
  assert.match(nonce, /^[A-Za-z0-9_-]{32}$/);
  assert.ok(nonce.length >= 10 && nonce.length <= 255);
});

test("intent decision fails closed on reused, expired, and non-consented flows", () => {
  const now = new Date("2026-10-08T07:00:00.000Z");
  assert.deepEqual(evaluateVehicleLineLinkIntent({
    status: "pending",
    expiresAt: new Date(now.getTime() + VEHICLE_LINE_LINK_TTL_MS).toISOString(),
    consentedAt: now.toISOString(),
  }, now), { allowed: true });
  assert.deepEqual(evaluateVehicleLineLinkIntent({
    status: "consumed", expiresAt: new Date(now.getTime() + 1).toISOString(), consentedAt: now.toISOString(),
  }, now), { allowed: false, reason: "already_used" });
  assert.deepEqual(evaluateVehicleLineLinkIntent({
    status: "pending", expiresAt: now.toISOString(), consentedAt: now.toISOString(),
  }, now), { allowed: false, reason: "expired" });
  assert.deepEqual(evaluateVehicleLineLinkIntent({
    status: "pending", expiresAt: new Date(now.getTime() + 1).toISOString(), consentedAt: null,
  }, now), { allowed: false, reason: "consent_required" });
});

test("LINE webhook signature uses the exact UTF-8 body and rejects tampering", async () => {
  const secret = "synthetic-line-channel-secret";
  const rawBody = '{"events":[{"type":"accountLink","message":"\n"}]}';
  const key = await webcrypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const digest = new Uint8Array(await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const signature = btoa([...digest].map((byte) => String.fromCharCode(byte)).join(""));
  assert.equal(await verifyLineWebhookSignature(rawBody, signature, secret, webcrypto), true);
  assert.equal(await verifyLineWebhookSignature(`${rawBody} `, signature, secret, webcrypto), false);
  assert.equal(await verifyLineWebhookSignature(rawBody, null, secret, webcrypto), false);
  assert.equal(await verifyLineWebhookSignature(rawBody, signature, "", webcrypto), false);
});

test("hashed identity helpers do not return raw values and official URL is fixed to HTTPS", async () => {
  const value = "synthetic-line-user-id";
  assert.equal(await sha256Hex(value, webcrypto), "cc9cfb32ed210c3f2dbbb51f9785503609ee0827b4814793ac220240e6fb1dc2");
  const url = new URL(createLineAccountLinkUrl("synthetic-link-token", "synthetic-nonce"));
  assert.equal(url.protocol, "https:");
  assert.equal(url.origin, "https://access.line.me");
  assert.equal(url.pathname, "/dialog/bot/accountLink");
  assert.equal(url.searchParams.get("linkToken"), "synthetic-link-token");
  assert.equal(url.searchParams.get("nonce"), "synthetic-nonce");
});
