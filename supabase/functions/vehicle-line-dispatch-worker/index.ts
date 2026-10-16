import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { createVehicleDispatchLineWorkerHandler, type VehicleDispatchLinePrepared, type VehicleDispatchLineWorkerStore } from "../_shared/vehicle-dispatch-line-worker.ts";

function rpcRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? row as Record<string, unknown> : null;
}

async function createStore(): Promise<VehicleDispatchLineWorkerStore> {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) throw new Error("Worker unavailable");
  const db = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });

  return {
    async loadChannelAccessToken() {
      const { data, error } = await db.from("system_settings")
        .select("value").eq("key", "line_channel_token").maybeSingle();
      if (error) throw error;
      return typeof data?.value === "string" && data.value ? data.value : null;
    },
    async claim({ limit, leaseSeconds, now }) {
      const { data, error } = await db.rpc("claim_vehicle_dispatch_line_notifications", {
        p_limit: limit, p_lease_seconds: leaseSeconds, p_now: now,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []).flatMap((value) => {
        const row = rpcRow([value]);
        return typeof row?.outbox_id === "string" && typeof row.lease_token === "string"
          ? [{ outbox_id: row.outbox_id, lease_token: row.lease_token }]
          : [];
      });
    },
    async prepare({ outboxId, leaseToken, now }) {
      const { data, error } = await db.rpc("prepare_vehicle_dispatch_line_notification", {
        p_outbox_id: outboxId, p_lease_token: leaseToken, p_now: now,
      });
      if (error) throw error;
      return (rpcRow(data) ?? { outcome: "lease_lost" }) as VehicleDispatchLinePrepared;
    },
    async finish(input) {
      const { data, error } = await db.rpc("finish_vehicle_dispatch_line_notification", {
        p_outbox_id: input.outboxId,
        p_lease_token: input.leaseToken,
        p_resolution: input.resolution,
        p_http_status: input.httpStatus,
        p_error_code: input.errorCode,
        p_next_attempt_at: input.nextAttemptAt,
        p_accepted_request_id: input.acceptedRequestId,
        p_now: input.now,
      });
      if (error) throw error;
      return typeof data === "string" ? data : "lease_lost";
    },
    async claimTest(input) {
      const { data, error } = await db.rpc("claim_vehicle_line_notification_test", {
        p_test_run_id: input.testRunId,
        p_lease_seconds: input.leaseSeconds,
        p_now: input.now,
      });
      if (error) throw error;
      return (Array.isArray(data) ? data : []).flatMap((value) => {
        const row = rpcRow([value]);
        return typeof row?.test_run_id === "string" && typeof row.lease_token === "string"
          ? [{ outbox_id: row.test_run_id, lease_token: row.lease_token }]
          : [];
      });
    },
    async prepareTest(input) {
      const { data, error } = await db.rpc("prepare_vehicle_line_notification_test", {
        p_test_run_id: input.testRunId,
        p_lease_token: input.leaseToken,
        p_now: input.now,
      });
      if (error) throw error;
      return (rpcRow(data) ?? { outcome: "lease_lost" }) as VehicleDispatchLinePrepared;
    },
    async finishTest(input) {
      const { data, error } = await db.rpc("finish_vehicle_line_notification_test", {
        p_test_run_id: input.testRunId,
        p_lease_token: input.leaseToken,
        p_resolution: input.resolution,
        p_http_status: input.httpStatus,
        p_now: input.now,
      });
      if (error) throw error;
      return typeof data === "string" ? data : "lease_lost";
    },
  };
}

Deno.serve(createVehicleDispatchLineWorkerHandler({
  cronSecret: () => Deno.env.get("CRON_SECRET") || "",
  createStore,
}));
