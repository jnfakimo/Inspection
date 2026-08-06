import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";

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

async function validLineSignature(rawBody: string, signature: string | null) {
  const secret = Deno.env.get("LINE_CHANNEL_SECRET") || "";
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)),
  );
  let binary = "";
  digest.forEach((byte) => binary += String.fromCharCode(byte));
  return safeEqual(btoa(binary), signature);
}

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

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const rawBody = await req.text();
    const payload = JSON.parse(rawBody || "{}");

    // ── Incoming LINE Webhook (from LINE → capture groupId) ───────────────────
    if (Array.isArray(payload.events)) {
      if (!await validLineSignature(rawBody, req.headers.get("x-line-signature"))) {
        return json({ ok: false, msg: "Invalid LINE signature" }, 401);
      }
      for (const ev of payload.events) {
        const src = ev.source;
        if (src?.type === "group" && src.groupId) {
          // Auto-save groupId to system_settings
          await db.from("system_settings").upsert(
            [{ key: "line_group_id", value: src.groupId }],
            { onConflict: "key" },
          );
        }
      }
      return new Response("ok", { status: 200 });
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
    const lineRes = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to: groupId, messages: [{ type: "text", text }] }),
    });

    if (!lineRes.ok) {
      const errBody = await lineRes.text();
      console.error("LINE push error:", lineRes.status, errBody);
      return json({ ok: false, msg: "LINE delivery failed" }, 502);
    }

    return json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Edge function error:", msg);
    return json({ ok: false, msg: "Notification service unavailable" }, 500);
  }
});
