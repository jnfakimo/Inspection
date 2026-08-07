import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";

const PROD_ORIGIN = "https://jnfakimo.github.io";
const allowedOrigin = (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (origin === PROD_ORIGIN || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return PROD_ORIGIN;
};
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": allowedOrigin(req),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
});
const reply = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" }
});

const cleanText = (value: unknown, max = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const cleanValue = (value: unknown, depth = 0): unknown => {
  if (depth > 3) return "[內容過深]";
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => cleanValue(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).slice(0, 40).forEach(([key, item]) => {
      if (/password|passwd|token|secret|authorization|cookie|credential/i.test(key)) return;
      out[cleanText(key, 80)] = cleanValue(item, depth + 1);
    });
    return out;
  }
  return cleanText(value);
};

const clientIp = (req: Request) => {
  const raw = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for") || req.headers.get("fly-client-ip") || "";
  return cleanText(raw.split(",")[0], 80) || null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { ok: false, message: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) return reply(req, { ok: false, message: "未登入" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return reply(req, { ok: false, message: "登入狀態無效" }, 401);

    const { data: profile, error: profileError } = await admin.from("users")
      .select("user_id,username,email,name,role,rbac_role,department,dept_id,status")
      .eq("auth_id", authData.user.id)
      .eq("status", "active")
      .maybeSingle();
    if (profileError || !profile?.user_id) return reply(req, { ok: false, message: "找不到啟用中的系統帳號" }, 403);

    const body = await req.json().catch(() => ({}));
    const eventType = cleanText(body.event_type, 40);
    if (!["login", "logout", "page_view", "function_use", "data_action"].includes(eventType)) {
      return reply(req, { ok: false, message: "不支援的稽核事件" }, 400);
    }

    const eventId = /^[0-9a-z-]{8,80}$/i.test(String(body.event_id || ""))
      ? String(body.event_id)
      : crypto.randomUUID();
    const isAuth = eventType === "login" || eventType === "logout";
    const ipAddress = clientIp(req);
    const userAgent = cleanText(req.headers.get("user-agent"), 1000) || null;
    const page = cleanValue(body.page || {});
    const changes = {
      event_id: eventId,
      event_type: eventType,
      occurred_at: new Date().toISOString(),
      actor: {
        user_id: profile.user_id,
        username: profile.username,
        email: profile.email,
        name: profile.name,
        role: profile.role,
        rbac_role: profile.rbac_role,
        department: profile.department,
        dept_id: profile.dept_id
      },
      client: { ip_address: ipAddress, user_agent: userAgent },
      page,
      details: cleanValue(body.details || {})
    };

    const source = cleanText((page as Record<string, unknown>)?.path || "system", 160) || "system";
    const { data: inserted, error: insertError } = await admin.from("audit_logs").insert({
      table_name: isAuth ? "auth" : "system_usage",
      record_id: isAuth ? String(profile.user_id) : eventId,
      action: isAuth ? eventType : "insert",
      changes,
      operator_id: profile.user_id,
      ip_address: ipAddress,
      user_agent: userAgent,
      source
    }).select("audit_id").single();
    if (insertError) throw insertError;

    return reply(req, { ok: true, audit_id: inserted.audit_id });
  } catch (error) {
    console.error("Audit event failed", error instanceof Error ? error.message : String(error));
    return reply(req, { ok: false, message: "系統紀錄寫入失敗" }, 500);
  }
});
