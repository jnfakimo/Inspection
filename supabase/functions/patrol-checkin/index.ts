import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";
import { canonicalFloor } from "../_shared/floor.ts";
import { clientIpFromRequest } from "../_shared/client-ip.ts";

const PROD_ORIGIN = "https://jnfakimo.github.io";
const configuredOrigins = new Set((Deno.env.get("APP_ALLOWED_ORIGINS") || "")
  .split(",").map((value) => value.trim()).filter(Boolean));
const allowedOrigin = (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (origin === PROD_ORIGIN || configuredOrigins.has(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
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
const clientIp = clientIpFromRequest;

type JwtClaims = { aal?: string; amr?: Array<{ method?: string; timestamp?: number } | string>; session_id?: string; iat?: number };
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
const patrolSessionAgeSeconds = (claims: JwtClaims) => {
  const timestamps = (claims.amr || []).map((item) =>
    typeof item === "string" ? 0 : Number(item?.timestamp) || 0
  ).filter((value) => value > 0);
  const startedAt = timestamps.length ? Math.min(...timestamps) : Number(claims.iat) || 0;
  if (!startedAt) return null;
  return Math.floor(Date.now() / 1000) - startedAt;
};

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
    const sessionAge = patrolSessionAgeSeconds(claims);
    if (sessionAge === null || sessionAge < -60 || sessionAge > 2 * 60 * 60) {
      return reply(req, { ok: false, code: "patrol_session_expired", message: "巡檢登入已超過兩小時，請重新登入後再簽到" }, 401);
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return reply(req, { ok: false, code: "invalid_session", message: "登入狀態已失效，請重新登入" }, 401);
    const { data: rateAllowed, error: rateError } = await admin.rpc("enforce_request_rate_limit", {
      p_subject: authData.user.id,
      p_scope: "patrol-checkin",
    });
    if (rateError) {
      console.error("patrol-checkin rate limit failed", rateError.message);
      return reply(req, { ok: false, code: "rate_limit_unavailable", message: "安全限流服務暫時無法使用" }, 503);
    }
    if (rateAllowed !== true) {
      return reply(req, { ok: false, code: "rate_limited", message: "簽到請求過於頻繁，請稍後再試" }, 429);
    }

    const { data: profile, error: profileError } = await admin.from("users")
      .select("user_id,username,email,name,role,rbac_role,status")
      .eq("auth_id", authData.user.id).eq("status", "active").maybeSingle();
    if (profileError || !profile?.user_id) return reply(req, { ok: false, code: "inactive_account", message: "找不到啟用中的系統帳號" }, 403);

    const authorizedClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: patrolAllowed, error: patrolAccessError } = await authorizedClient.rpc("has_system_access", { p_permission: "sys_guardpatrol" });
    if (patrolAccessError || patrolAllowed !== true) {
      return reply(req, { ok: false, code: "forbidden", message: "此帳號沒有駐衛警巡檢系統權限" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const targetType = cleanText(body.target_type, 20);
    const targetId = String(body.target_id || "");
    const requestedCheckinId = String(body.checkin_id || "");
    const checkinSource = body.checkin_source === "nfc" ? "nfc" : "qr";
    if (!(["marker", "space"] as string[]).includes(targetType) || !isUuid(targetId)) {
      return reply(req, { ok: false, code: "invalid_target", message: "巡檢掃描碼資料格式不正確" }, 400);
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
      point = { floor_id: canonicalFloor(data.floor_id) || null, label: cleanText(data.label, 200) || "未命名巡檢點" };
    } else {
      const { data, error } = await admin.from("floor_spaces")
        .select("space_id,floor,space_name,status").eq("space_id", targetId).maybeSingle();
      if (error) throw error;
      if (!data || (data.status && data.status !== "active")) {
        return reply(req, { ok: false, code: "invalid_target", message: "此巡檢區域已停用或不存在" }, 404);
      }
      point = { floor_id: canonicalFloor(data.floor) || null, label: cleanText(data.space_name, 200) || "未命名巡檢區域" };
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
      auth_level: claims.aal || "aal1",
      verification_method: "password_session",
      source_ip: clientIp(req),
      user_agent: cleanText(req.headers.get("user-agent"), 1000) || null,
      checkin_source: checkinSource
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
