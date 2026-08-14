import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";

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
const isUuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
const clientIp = (req: Request) => {
  const raw = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for") || req.headers.get("fly-client-ip") || "";
  return cleanText(raw.split(",")[0], 80) || null;
};

type JwtClaims = { aal?: string; amr?: Array<{ method?: string } | string>; session_id?: string };
const decodeClaims = (token: string): JwtClaims => {
  try {
    const encoded = token.split(".")[1] || "";
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as JwtClaims;
  } catch {
    return {};
  }
};
const hasAal2 = (claims: JwtClaims) => claims.aal === "aal2" ||
  (Array.isArray(claims.amr) && claims.amr.some((item) =>
    typeof item === "string" ? /^(totp|otp|passkey)$/i.test(item) : /^(totp|otp|passkey)$/i.test(String(item?.method || ""))
  ));

type Profile = {
  user_id: string;
  username?: string | null;
  email?: string | null;
  name?: string | null;
  role?: string | null;
  rbac_role?: string | null;
};

const actorName = (profile: Profile) => cleanText(profile.name || profile.username || profile.email || "巡檢人員", 160);

async function recordAudit(admin: SupabaseClient, profile: Profile, req: Request, event: Record<string, unknown>) {
  const { error } = await admin.from("audit_logs").insert({
    table_name: "checkin_logs",
    record_id: String(event.checkin_id || "patrol-checkin"),
    action: "insert",
    changes: {
      event_type: "patrol_checkin",
      actor: { user_id: profile.user_id, username: profile.username, name: profile.name, role: profile.role, rbac_role: profile.rbac_role },
      details: event,
      occurred_at: new Date().toISOString()
    },
    operator_id: profile.user_id,
    ip_address: clientIp(req),
    user_agent: cleanText(req.headers.get("user-agent"), 1000) || null,
    source: "patrol-checkin"
  });
  if (error) console.error("patrol-checkin audit failed", error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { ok: false, code: "method_not_allowed", message: "不支援的要求方法" }, 405);

  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return reply(req, { ok: false, code: "unauthorized", message: "請先登入系統" }, 401);

    const claims = decodeClaims(token);
    if (!hasAal2(claims)) {
      return reply(req, { ok: false, code: "mfa_required", message: "巡檢簽到需要完成多因素驗證，請輸入驗證器代碼" }, 403);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return reply(req, { ok: false, code: "invalid_session", message: "登入狀態已失效，請重新登入" }, 401);

    const { data: profile, error: profileError } = await admin.from("users")
      .select("user_id,username,email,name,role,rbac_role,status")
      .eq("auth_id", authData.user.id).eq("status", "active").maybeSingle();
    if (profileError || !profile?.user_id) return reply(req, { ok: false, code: "inactive_account", message: "找不到啟用中的系統帳號" }, 403);

    const body = await req.json().catch(() => ({}));
    const targetType = cleanText(body.target_type, 20);
    const targetId = String(body.target_id || "");
    const requestedCheckinId = String(body.checkin_id || "");
    if (!(["marker", "space"] as string[]).includes(targetType) || !isUuid(targetId)) {
      return reply(req, { ok: false, code: "invalid_target", message: "巡檢 QR Code 資料格式不正確" }, 400);
    }
    const checkinId = isUuid(requestedCheckinId) ? requestedCheckinId : crypto.randomUUID();

    let point: { floor_id: string | null; label: string } | null = null;
    if (targetType === "marker") {
      const { data, error } = await admin.from("plan_markers")
        .select("marker_id,floor_id,label,kind,status").eq("marker_id", targetId).maybeSingle();
      if (error) throw error;
      if (!data || data.kind !== "patrol" || data.status !== "active") {
        return reply(req, { ok: false, code: "invalid_target", message: "此巡檢點已停用或不存在" }, 404);
      }
      point = { floor_id: data.floor_id, label: cleanText(data.label, 200) || "未命名巡檢點" };
    } else {
      const { data, error } = await admin.from("floor_spaces")
        .select("space_id,floor,space_name,status").eq("space_id", targetId).maybeSingle();
      if (error) throw error;
      if (!data || (data.status && data.status !== "active")) {
        return reply(req, { ok: false, code: "invalid_target", message: "此巡檢區域已停用或不存在" }, 404);
      }
      point = { floor_id: data.floor, label: cleanText(data.space_name, 200) || "未命名巡檢區域" };
    }

    const { data: duplicate, error: duplicateError } = await admin.from("checkin_logs")
      .select("checkin_id,target_type,target_id,floor_id,label,user_name,checkin_at")
      .eq("checkin_id", checkinId).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) return reply(req, { ok: true, duplicate: true, event: duplicate });

    const recentSince = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: recent, error: recentError } = await admin.from("checkin_logs")
      .select("checkin_id,checkin_at,user_name")
      .eq("user_id", profile.user_id).eq("target_type", targetType).eq("target_id", targetId)
      .gte("checkin_at", recentSince).order("checkin_at", { ascending: false }).limit(1).maybeSingle();
    if (recentError) throw recentError;
    if (recent) {
      return reply(req, { ok: false, code: "duplicate_recent", message: "本巡檢點五分鐘內已完成簽到，請勿重複簽到", event: recent }, 409);
    }

    const event = {
      checkin_id: checkinId,
      target_type: targetType,
      target_id: targetId,
      floor_id: point.floor_id,
      label: point.label,
      user_id: profile.user_id,
      user_name: actorName(profile),
      checkin_at: new Date().toISOString(),
      auth_level: "aal2",
      verification_method: "totp_or_passkey",
      source_ip: clientIp(req),
      user_agent: cleanText(req.headers.get("user-agent"), 1000) || null,
      checkin_source: "qr"
    };
    const { data: inserted, error: insertError } = await admin.from("checkin_logs").insert(event).select("*").single();
    if (insertError) {
      if (insertError.code === "23505") return reply(req, { ok: true, duplicate: true, event });
      throw insertError;
    }
    await recordAudit(admin, profile as Profile, req, event);
    return reply(req, { ok: true, event: inserted });
  } catch (error) {
    console.error("patrol-checkin failed", error instanceof Error ? error.message : String(error));
    return reply(req, { ok: false, code: "server_error", message: "巡檢簽到服務暫時無法使用，請稍後再試" }, 500);
  }
});
