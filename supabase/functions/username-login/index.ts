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
const clientIp = (req: Request) => {
  const raw = req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for") || req.headers.get("fly-client-ip") || "";
  return cleanText(raw.split(",")[0], 80) || null;
};

type LoginProfile = {
  user_id: string;
  username: string | null;
  email: string | null;
  name: string | null;
  role: string | null;
  rbac_role: string | null;
  department: string | null;
  dept_id: string | null;
};

async function writeLoginAttempt(
  admin: ReturnType<typeof createClient>,
  req: Request,
  identifier: string,
  method: "username" | "email" | "unknown",
  profile: LoginProfile | null,
  result: "成功" | "失敗" | "已阻擋",
  reason: string,
  recentAttempts: number
) {
  const ipAddress = clientIp(req);
  const userAgent = cleanText(req.headers.get("user-agent"), 1000) || null;
  const riskLevel = result === "成功" ? "一般" : (recentAttempts >= 5 || result === "已阻擋" ? "高風險" : "注意");
  const eventId = crypto.randomUUID();
  const actor = {
    user_id: profile?.user_id || null,
    username: profile?.username || (method === "username" ? identifier : null),
    email: profile?.email || (method === "email" ? identifier : null),
    name: profile?.name || "未識別登入者",
    role: profile?.role || null,
    rbac_role: profile?.rbac_role || null,
    department: profile?.department || null,
    dept_id: profile?.dept_id || null
  };
  const { error } = await admin.from("audit_logs").insert({
    table_name: "auth",
    record_id: profile?.user_id || eventId,
    action: "login",
    changes: {
      event_id: eventId,
      event_type: "login_attempt",
      occurred_at: new Date().toISOString(),
      actor,
      client: { ip_address: ipAddress, user_agent: userAgent },
      page: { system: "login", page: "登入系統", path: "login.html" },
      details: {
        attempted_identifier: identifier,
        login_method: method,
        result,
        reason,
        recent_attempts_from_ip: recentAttempts + 1,
        risk_level: riskLevel
      }
    },
    operator_id: profile?.user_id || null,
    ip_address: ipAddress,
    user_agent: userAgent,
    source: "login.html"
  });
  if (error) console.error("Login audit insert failed", error.message);
  return !error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return reply(req, { ok: false, message: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const identifier = cleanText(body.identifier || body.username, 120);
    const password = String(body.password || "");
    const isEmail = /^[^\s@%]+@[^\s@%]+\.[^\s@%]+$/.test(identifier);
    const isUsername = /^[\p{L}0-9._-]{2,80}$/u.test(identifier);
    const method: "username" | "email" | "unknown" = isEmail ? "email" : (isUsername ? "username" : "unknown");
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const ipAddress = clientIp(req);
    let recentAttempts = 0;
    if (ipAddress) {
      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { count } = await admin.from("audit_logs")
        .select("audit_id", { count: "exact", head: true })
        .eq("table_name", "auth")
        .eq("action", "login")
        .eq("ip_address", ipAddress)
        .eq("changes->>event_type", "login_attempt")
        .neq("changes->details->>result", "成功")
        .gte("operated_at", since);
      recentAttempts = count || 0;
    }

    if (recentAttempts >= 20) {
      const audited = await writeLoginAttempt(admin, req, identifier || "未提供", method, null, "已阻擋", "短時間登入嘗試次數過多", recentAttempts);
      if (!audited) return reply(req, { ok: false, message: "登入稽核服務暫時無法使用" }, 503);
      return reply(req, { ok: false, message: "登入嘗試過於頻繁，請稍後再試" }, 429);
    }
    if (method === "unknown" || password.length < 8 || password.length > 200) {
      const audited = await writeLoginAttempt(admin, req, identifier || "未提供", method, null, "失敗", "帳號格式或密碼長度不符", recentAttempts);
      if (!audited) return reply(req, { ok: false, message: "登入稽核服務暫時無法使用" }, 503);
      return reply(req, { ok: false, message: "帳號或密碼錯誤" }, 401);
    }

    const field = method === "email" ? "email" : "username";
    const { data: profileData, error: profileError } = await admin.from("users")
      .select("user_id,username,email,name,role,rbac_role,department,dept_id")
      .eq("status", "active")
      .ilike(field, identifier)
      .maybeSingle();
    const profile = profileData as LoginProfile | null;
    if (profileError || !profile?.email) {
      const audited = await writeLoginAttempt(admin, req, identifier, method, null, "失敗", "帳號不存在或已停用", recentAttempts);
      if (!audited) return reply(req, { ok: false, message: "登入稽核服務暫時無法使用" }, 503);
      return reply(req, { ok: false, message: "帳號或密碼錯誤" }, 401);
    }

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data, error } = await authClient.auth.signInWithPassword({ email: profile.email, password });
    if (error || !data.session) {
      const audited = await writeLoginAttempt(admin, req, identifier, method, profile, "失敗", "密碼錯誤或登入狀態無效", recentAttempts);
      if (!audited) return reply(req, { ok: false, message: "登入稽核服務暫時無法使用" }, 503);
      return reply(req, { ok: false, message: "帳號或密碼錯誤" }, 401);
    }

    const audited = await writeLoginAttempt(admin, req, identifier, method, profile, "成功", "帳號與密碼驗證成功", recentAttempts);
    if (!audited) return reply(req, { ok: false, message: "登入稽核服務暫時無法使用" }, 503);
    return reply(req, {
      ok: true,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in
    });
  } catch (error) {
    console.error("Username login failed", error instanceof Error ? error.message : String(error));
    return reply(req, { ok: false, message: "登入服務暫時無法使用" }, 503);
  }
});
