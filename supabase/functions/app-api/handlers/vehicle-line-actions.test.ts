import assert from "node:assert/strict";
import test from "node:test";
import { handleVehicleAction } from "./vehicle.ts";

type Call = { table: string; ops: Array<[string, unknown[]]> };
type Result = { data?: unknown; error?: { message?: string; code?: string } | null };

const sessionUser = "11111111-1111-1111-1111-111111111111";
const suppliedOtherUser = "22222222-2222-2222-2222-222222222222";

function fakeDb(respond: (call: Call) => Result = () => ({ data: null, error: null })) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: Record<string, unknown> = new Proxy({}, {
      get(_target, prop: string) {
        if (prop === "then") return (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) =>
          Promise.resolve(respond(call)).then(resolve, reject);
        return (...args: unknown[]) => { call.ops.push([prop, args]); return chain; };
      },
    });
    return chain;
  };
  const rpc = (name: string, args: Record<string, unknown>) => {
    const call: Call = { table: `rpc:${name}`, ops: [["args", [args]]] };
    calls.push(call);
    return Promise.resolve(respond(call));
  };
  return { from, rpc, calls };
}

function context({
  userDb = fakeDb(),
  admin = fakeDb(),
  body = {},
  allowed = true,
}: {
  userDb?: ReturnType<typeof fakeDb>;
  admin?: ReturnType<typeof fakeDb>;
  body?: Record<string, unknown>;
  allowed?: boolean;
} = {}) {
  const ctx = {
    req: new Request("https://example.test/app-api", { method: "POST" }),
    body,
    profile: { user_id: sessionUser, status: "active" },
    admin,
    userDb,
    reply: (_req: Request, value: unknown, status = 200) => ({ status, body: value }) as unknown as Response,
    can: () => allowed,
    canModule: () => true,
    isAdmin: false,
    isSysadmin: false,
  } as never;
  return { ctx, userDb, admin };
}

const response = (value: Response | null) => value as unknown as { status: number; body: Record<string, any> };

test("link start requires system permission, explicit consent, and active driver roster", async () => {
  const denied = context({ allowed: false, body: { consent: true } });
  assert.equal(response(await handleVehicleAction("vehicle_line_link_start", denied.ctx)).status, 403);
  assert.equal(denied.userDb.calls.length, 0);

  const noConsent = context({ body: { consent: false } });
  assert.equal(response(await handleVehicleAction("vehicle_line_link_start", noConsent.ctx)).status, 400);
  assert.equal(noConsent.userDb.calls.length, 0);

  const notDriver = context({ body: { consent: true } });
  assert.equal(response(await handleVehicleAction("vehicle_line_link_start", notDriver.ctx)).status, 403);
  assert.equal(notDriver.admin.calls.length, 0);
});

test("link start derives the service identity from the session and stores only a code hash", async () => {
  const userDb = fakeDb((call) => call.table === "vehicle_dispatch_drivers"
    ? { data: { user_id: sessionUser }, error: null } : { data: null, error: null });
  const admin = fakeDb((call) => call.table === "rpc:create_vehicle_line_link_intent"
    ? { data: [{ outcome: "created", expires_at: "2026-10-08T07:10:00.000Z" }], error: null }
    : { data: null, error: null });
  const { ctx } = context({ userDb, admin, body: { user_id: suppliedOtherUser, consent: true } });
  const result = response(await handleVehicleAction("vehicle_line_link_start", ctx));
  assert.equal(result.status, 200);
  assert.match(result.body.data.code, /^LINK-[A-Za-z0-9_-]{32}$/);
  assert.equal(result.body.data.expires_at, "2026-10-08T07:10:00.000Z");

  const rpc = admin.calls.find((call) => call.table === "rpc:create_vehicle_line_link_intent");
  const params = rpc?.ops[0][1][0] as Record<string, unknown>;
  assert.equal(params.p_user_id, sessionUser);
  assert.notEqual(params.p_user_id, suppliedOtherUser);
  assert.match(String(params.p_code_hash), /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(params).includes(result.body.data.code), false);
});

test("already-linked response requires unlink before rebinding", async () => {
  const userDb = fakeDb((call) => call.table === "vehicle_dispatch_drivers"
    ? { data: { user_id: sessionUser }, error: null } : { data: null, error: null });
  const admin = fakeDb((call) => call.table === "rpc:create_vehicle_line_link_intent"
    ? { data: [{ outcome: "already_linked", expires_at: null }], error: null } : { data: null, error: null });
  const result = response(await handleVehicleAction("vehicle_line_link_start", context({ userDb, admin, body: { consent: true } }).ctx));
  assert.equal(result.status, 409);
  assert.match(result.body.message, /先解除綁定/);
  assert.equal("code" in (result.body.data || {}), false);
});

test("status returns only self binding state and never selects or returns LINE identity", async () => {
  const admin = fakeDb((call) => call.table === "vehicle_driver_line_bindings"
    ? { data: { state: "linked", linked_at: "2026-10-08T06:00:00.000Z" }, error: null }
    : { data: { expires_at: "2026-10-08T07:10:00.000Z" }, error: null });
  const result = response(await handleVehicleAction("vehicle_line_link_status", context({ admin }).ctx));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, { linked: true, linked_at: "2026-10-08T06:00:00.000Z", pending_expires_at: null });
  assert.equal(JSON.stringify(result.body).includes("line_user_id"), false);
  assert.ok(admin.calls.every((call) => !(call.ops.find(([op]) => op === "select")?.[1][0] as string).includes("line_user_id")));
  assert.ok(admin.calls.every((call) => call.ops.some(([op, args]) => op === "eq" && args[0] === "user_id" && args[1] === sessionUser)));
});

test("unlink is self-only, allowed after driver access is removed, and never trusts body user_id", async () => {
  const admin = fakeDb((call) => call.table === "rpc:unlink_vehicle_line_account"
    ? { data: true, error: null } : { data: null, error: null });
  const { ctx, userDb } = context({ allowed: false, admin, body: { user_id: suppliedOtherUser } });
  const result = response(await handleVehicleAction("vehicle_line_unlink", ctx));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data, { unlinked: true });
  const rpc = admin.calls.find((call) => call.table === "rpc:unlink_vehicle_line_account");
  assert.deepEqual(rpc?.ops[0][1][0], { p_user_id: sessionUser });
  assert.notEqual((rpc?.ops[0][1][0] as Record<string, unknown>).p_user_id, suppliedOtherUser);
  assert.ok(userDb.calls.some((call) => call.table === "audit_logs"));
});

test("missing binding schema fails closed without direct-table fallback", async () => {
  const userDb = fakeDb((call) => call.table === "vehicle_dispatch_drivers"
    ? { data: { user_id: sessionUser }, error: null } : { data: null, error: null });
  const admin = fakeDb((call) => call.table.startsWith("rpc:")
    ? { data: null, error: { code: "PGRST202", message: "missing function" } } : { data: null, error: null });
  const result = response(await handleVehicleAction("vehicle_line_link_start", context({ userDb, admin, body: { consent: true } }).ctx));
  assert.equal(result.status, 503);
  assert.equal(admin.calls.filter((call) => call.table === "vehicle_line_link_intents").length, 0);
});
