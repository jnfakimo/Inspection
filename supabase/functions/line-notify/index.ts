import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { sendLineTextMessage } from "../_shared/line-message.ts";
import { createVehicleLineWebhookHandler, type VehicleLineWebhookStore } from "../_shared/vehicle-line-webhook.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-line-signature, x-webhook-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const fetcher = fetch;

function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !serviceKey) throw new Error("Notification service unavailable");
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetcher },
  });
}

const lineWebhook = createVehicleLineWebhookHandler({
  channelSecret: () => Deno.env.get("LINE_CHANNEL_SECRET") || "",
  fetcher,
  createStore: async (): Promise<VehicleLineWebhookStore> => {
    const db = createServiceClient();
    return {
      async ensureLinkSchema() {
        for (const [table, column] of [
          ["vehicle_driver_line_bindings", "user_id"],
          ["vehicle_line_link_intents", "intent_id"],
          ["vehicle_line_account_link_nonces", "nonce_id"],
        ]) {
          const { error } = await db.from(table).select(column).limit(0);
          if (error) throw error;
        }
      },
      async loadChannelAccessToken() {
        const { data, error } = await db.from("system_settings")
          .select("value").eq("key", "line_channel_token").maybeSingle();
        if (error) throw error;
        return typeof data?.value === "string" && data.value ? data.value : null;
      },
      async consumeGroupRegisterCode(input) {
        const { data, error } = await db.rpc("consume_line_group_register_code", {
          p_code_hash: input.codeHash,
          p_group_id: input.groupId,
          p_group_id_hash: input.groupIdHash,
          p_now: input.now,
        });
        if (error) throw error;
        return typeof data === "string" ? data : "invalid_request";
      },
      async consumeLinkIntent(input) {
        const { data, error } = await db.rpc("consume_vehicle_line_link_intent", {
          p_code_hash: input.codeHash,
          p_line_user_id_hash: input.lineUserIdHash,
          p_nonce_hash: input.nonceHash,
          p_now: input.now,
        });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        return row && typeof row === "object" ? row as { outcome: string; userId?: string | null } : { outcome: "invalid_request" };
      },
      async completeAccountLink(input) {
        const { data, error } = await db.rpc("complete_vehicle_line_account_link", {
          p_nonce_hash: input.nonceHash,
          p_line_user_id_hash: input.lineUserIdHash,
          p_line_user_id: input.lineUserId,
          p_link_result: input.result,
          p_now: input.now,
        });
        if (error) throw error;
        return typeof data === "string" ? data : "invalid_request";
      },
    };
  },
});

type ActiveProfile = {
  user_id: string;
  role: string | null;
  rbac_role: string | null;
  status: string | null;
};

async function authenticatedProfile(req: Request, db: any): Promise<ActiveProfile | null> {
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const { data: { user } } = await db.auth.getUser(bearer);
  if (!user) return null;
  const { data } = await db.from("users")
    .select("user_id,role,rbac_role,status")
    .eq("auth_id", user.id)
    .maybeSingle();
  const profile = data as ActiveProfile | null;
  return profile?.status === "active" ? profile : null;
}

async function loadCanonicalRecord(
  db: any,
  table: string,
  record: Record<string, unknown> | undefined,
) {
  const keys: Record<string, string> = {
    inspection_records: "record_id",
    repair_requests: "request_id",
    handover_cases: "case_id",
  };
  const key = keys[table];
  const id = key && record?.[key];
  if (!key || typeof id !== "string" || !id) return null;
  const { data, error } = await db.from(table).select("*").eq(key, id).maybeSingle();
  if (error) throw error;
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS, status: 204 });
  }

  // The signed LINE route consumes the exact body before JSON parsing or DB setup.
  if (req.headers.has("x-line-signature")) return await lineWebhook(req);
  const webhookSecret = Deno.env.get("LINE_NOTIFY_WEBHOOK_SECRET") || "";
  const suppliedWebhookSecret = req.headers.get("x-webhook-secret") || "";
  const trustedNotificationWebhook = !!webhookSecret && safeEqual(webhookSecret, suppliedWebhookSecret);
  if (!req.headers.get("authorization") && !trustedNotificationWebhook) {
    return json({ ok: false, msg: "Unauthorized" }, 401);
  }

  try {
    const db = createServiceClient();

    const rawBody = await req.text();
    const payload = JSON.parse(rawBody || "{}");

    // LINE 事件只走上方的簽章路徑；沒有簽章的事件一律拒絕，也不再自動寫入群組 ID。
    if (Array.isArray(payload.events)) {
      return json({ ok: false, msg: "Invalid LINE signature" }, 401);
    }

    const profile = await authenticatedProfile(req, db);
    if (payload.test === true) {
      if (!profile || !(profile.role === "admin" || ["admin", "sysadmin"].includes(profile.rbac_role || ""))) {
        return json({ ok: false, msg: "Unauthorized" }, 401);
      }
    } else {
      const expected = Deno.env.get("LINE_NOTIFY_WEBHOOK_SECRET") || "";
      const supplied = req.headers.get("x-webhook-secret") || "";
      const trustedWebhook = !!expected && safeEqual(expected, supplied);
      if (!profile && !trustedWebhook) return json({ ok: false, msg: "Unauthorized" }, 401);
      const canonical = await loadCanonicalRecord(db, payload.table, payload.record);
      if (!canonical) return json({ ok: false, msg: "Notification record was not found" }, 404);
      const isAdmin = !!profile && (profile.role === "admin" || ["admin", "sysadmin"].includes(profile.rbac_role || ""));
      const ownerColumn: Record<string, string> = {
        inspection_records: "inspector_id",
        repair_requests: "created_by",
        handover_cases: "created_by",
      };
      const owner = ownerColumn[payload.table];
      if (profile && !isAdmin && (!owner || canonical[owner] !== profile.user_id)) {
        return json({ ok: false, msg: "Forbidden" }, 403);
      }
      payload.record = canonical;
    }

    // ── Load system_settings ─────────────────────────────────────────────────
    const { data: rows } = await db.from("system_settings").select("key,value");
    const s: Record<string, string> = {};
    (rows ?? []).forEach((r: { key: string; value: string }) => (s[r.key] = r.value));

    const token   = s.line_channel_token;
    const groupId = s.line_group_id;

    if (!token || !groupId) {
      return json({ ok: false, msg: "LINE not configured" });
    }

    let text = "";

    // ── Test message ──────────────────────────────────────────────────────────
    if (payload.test === true) {
      text = "✅ 系統測試訊息\n臺北農產巡檢維修系統 LINE 推播連線正常。";
    }

    // ── Inspection abnormal ───────────────────────────────────────────────────
    else if (
      payload.table === "inspection_records" &&
      payload.record?.run_status === "abnormal"
    ) {
      if (s.line_notify_inspect !== "true") return json({ ok: true, msg: "disabled" });
      const rec = payload.record;
      let eqName: string = rec.equipment_id ?? "—";
      if (rec.equipment_id) {
        const { data: eq } = await db
          .from("equipment")
          .select("name")
          .eq("equipment_id", rec.equipment_id)
          .single();
        if (eq?.name) eqName = eq.name;
      }
      const dtStr = new Date(rec.inspect_time ?? rec.created_at).toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
      });
      text = `⚠️ 巡檢異常警報\n設備：${eqName}\n時間：${dtStr}\n說明：${rec.note ?? "（未填）"}`;
    }

    // ── New repair request ────────────────────────────────────────────────────
    else if (payload.table === "repair_requests") {
      if (s.line_notify_repair !== "true") return json({ ok: true, msg: "disabled" });
      const rec = payload.record;
      let eqName: string = rec.equipment_id ?? "—";
      if (rec.equipment_id) {
        const { data: eq } = await db
          .from("equipment")
          .select("name")
          .eq("equipment_id", rec.equipment_id)
          .single();
        if (eq?.name) eqName = eq.name;
      }
      text = `🔧 新報修單\n設備：${eqName}\n報修人：${rec.reporter ?? "—"}\n說明：${rec.fault_desc ?? "—"}`;
    }

    // ── New handover case ─────────────────────────────────────────────────────
    else if (payload.table === "handover_cases") {
      if (s.line_notify_case !== "true") return json({ ok: true, msg: "disabled" });
      const rec = payload.record;
      text = `📋 新異常案件\n案件編號：${rec.case_no ?? "—"}\n標題：${rec.title ?? "—"}\n狀態：待處理`;
    }

    if (!text) return json({ ok: true, msg: "skip" });

    // ── Send LINE push ────────────────────────────────────────────────────────
    const lineRes = await sendLineTextMessage({ token, recipient: groupId, text });

    if (!lineRes.ok) {
      console.error("LINE push failed:", lineRes.status);
      return json({ ok: false, msg: "LINE delivery failed" }, 502);
    }

    return json({ ok: true });
  } catch {
    console.error("Edge function error");
    return json({ ok: false, msg: "Notification service unavailable" }, 500);
  }
});
