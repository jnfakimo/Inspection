import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";
import {
  enforceDurableRateLimit,
  recordRateLimitDenial,
  securityRequestId,
} from "../_shared/security-monitor.ts";
import { clientIpFromRequest } from "../_shared/client-ip.ts";

const PROD_ORIGIN = "https://jnfakimo.github.io";
const configuredOrigins = new Set((Deno.env.get("APP_ALLOWED_ORIGINS") || "")
  .split(",").map((value) => value.trim()).filter(Boolean));
// 自架站常見於內網 IP（RFC1918）；放行反射 CORS。登入本身仍要帳密＋驗證碼。
const PRIVATE_NET_ORIGIN = /^https?:\/\/(?:10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})(?::\d{1,5})?$/;
const allowedOrigin = (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (origin === PROD_ORIGIN || configuredOrigins.has(origin) || PRIVATE_NET_ORIGIN.test(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
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
// 這三個輔助函式只需要 PostgREST 的 from()。避免用 ReturnType<typeof createClient>：
// supabase-js 2.110 的未帶 Database 泛型版本會被 Deno 推成 never，讓每次部署的
// `deno check` 對既有 insert/update 全部誤報型別錯誤。
type AdminClient = {
  from: (relation: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};
const clientIp = clientIpFromRequest;
const CAPTCHA_TTL_SECONDS = 300;
const CAPTCHA_LENGTH = 6;
const CAPTCHA_SEGMENTS: Record<string, string[]> = {
  "0": ["a", "b", "c", "d", "e", "f"],
  "1": ["b", "c"],
  "2": ["a", "b", "d", "e", "g"],
  "3": ["a", "b", "c", "d", "g"],
  "4": ["b", "c", "f", "g"],
  "5": ["a", "c", "d", "f", "g"],
  "6": ["a", "c", "d", "e", "f", "g"],
  "7": ["a", "b", "c"],
  "8": ["a", "b", "c", "d", "e", "f", "g"],
  "9": ["a", "b", "c", "d", "f", "g"]
};
const CAPTCHA_PATHS: Record<string, string> = {
  a: "M4 2H20L17 5H7Z",
  b: "M21 4V18L18 21V7Z",
  c: "M21 22V36L18 33V25Z",
  d: "M4 38H20L17 35H7Z",
  e: "M3 22V36L6 33V25Z",
  f: "M3 4V18L6 21V7Z",
  g: "M4 20H20L17 23H7Z"
};

const randomCode = () => {
  const bytes = new Uint8Array(CAPTCHA_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => String(byte % 10)).join("");
};

const hmacHex = async (challengeId: string, answer: string) => {
  const secret = Deno.env.get("CAPTCHA_SECRET") || "";
  if (secret.length < 32) throw new Error("CAPTCHA_SECRET is not configured");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${challengeId}:${answer}`)
  ));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const safeEqual = (left: string, right: string) => {
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
};

const captchaImage = (code: string) => {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const digits = code.split("").map((digit, index) => {
    const paths = (CAPTCHA_SEGMENTS[digit] || []).map((segment) => CAPTCHA_PATHS[segment]).join(" ");
    const x = 12 + index * 34 + (random[index] % 5) - 2;
    const y = 12 + (random[index + 6] % 7) - 3;
    const rotate = (random[index + 12] % 15) - 7;
    return `<g transform="translate(${x} ${y}) rotate(${rotate} 12 20)"><path d="${paths}"/></g>`;
  }).join("");
  const noiseLines = Array.from({ length: 8 }, (_, index) => {
    const x1 = random[index * 2] % 220;
    const y1 = random[index * 2 + 1] % 70;
    const x2 = random[index * 2 + 8] % 220;
    const y2 = random[index * 2 + 9] % 70;
    return `<path d="M${x1} ${y1}L${x2} ${y2}"/>`;
  }).join("");
  const dots = Array.from({ length: 18 }, (_, index) => {
    const x = (random[index % random.length] * (index + 7)) % 220;
    const y = (random[(index + 11) % random.length] * (index + 3)) % 70;
    const radius = 1 + (random[(index + 19) % random.length] % 2);
    return `<circle cx="${x}" cy="${y}" r="${radius}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="70" viewBox="0 0 220 70" role="img"><defs><filter id="w"><feTurbulence type="fractalNoise" baseFrequency=".012 .035" numOctaves="1" seed="${random[31]}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2"/></filter></defs><rect width="220" height="70" rx="10" fill="#f8fafc"/><g fill="none" stroke="#94a3b8" stroke-width="1" opacity=".42">${noiseLines}</g><g fill="#6366f1" opacity=".28">${dots}</g><g fill="#172554" filter="url(#w)">${digits}</g><rect x="1" y="1" width="218" height="68" rx="9" fill="none" stroke="#cbd5e1" stroke-width="2"/></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
};

async function issueCaptcha(admin: AdminClient, req: Request, requestId: string) {
  const ipAddress = clientIp(req);
  if (ipAddress) {
    const rate = await enforceDurableRateLimit(admin, req, {
      subject: ipAddress,
      scope: "username-login:captcha",
      requestId,
    });
    if (rate.error) {
      console.error("Captcha rate limit failed", cleanText(rate.error.message, 300));
      return reply(req, { ok: false, message: "安全限流服務暫時無法使用" }, 503);
    }
    if (!rate.allowed) {
      try {
        await recordRateLimitDenial(admin, req, {
          scope: "username-login:captcha",
          requestId,
          eventCount: rate.requestCount,
          historyAlreadyRecorded: rate.durable,
          title: "驗證碼索取異常頻繁，已阻擋",
          message: "同一來源在短時間內過度索取登入驗證碼，受信任後端已阻擋請求。",
          windowMinutes: 10,
        });
      } catch (alertError) {
        console.error("Captcha rate-limit alert failed", alertError instanceof Error ? alertError.message : String(alertError));
      }
      return reply(req, { ok: false, message: "驗證碼索取過於頻繁，請稍後再試", request_id: requestId }, 429);
    }
  }

  const challengeId = crypto.randomUUID();
  const answer = randomCode();
  const now = Date.now();
  const { error } = await admin.from("login_captcha_challenges").insert({
    challenge_id: challengeId,
    answer_hash: await hmacHex(challengeId, answer),
    ip_address: ipAddress,
    expires_at: new Date(now + CAPTCHA_TTL_SECONDS * 1000).toISOString()
  });
  if (error) throw error;
  return reply(req, {
    ok: true,
    challenge_id: challengeId,
    image: captchaImage(answer),
    expires_in: CAPTCHA_TTL_SECONDS
  });
}

async function consumeCaptcha(
  admin: AdminClient,
  req: Request,
  challengeIdValue: unknown,
  answerValue: unknown
) {
  const challengeId = cleanText(challengeIdValue, 80);
  const answer = cleanText(answerValue, 20).replace(/\s+/g, "");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(challengeId) || !/^\d{6}$/.test(answer)) return false;

  const consumedAt = new Date().toISOString();
  let query = admin.from("login_captcha_challenges")
    .update({ consumed_at: consumedAt, attempt_count: 1 })
    .eq("challenge_id", challengeId)
    .is("consumed_at", null)
    .gt("expires_at", consumedAt);
  const ipAddress = clientIp(req);
  query = ipAddress ? query.eq("ip_address", ipAddress) : query.is("ip_address", null);
  const { data, error } = await query.select("answer_hash").maybeSingle();
  if (error) throw error;
  if (!data?.answer_hash) return false;
  return safeEqual(data.answer_hash, await hmacHex(challengeId, answer));
}


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
  admin: AdminClient,
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

  const securityEventRequestId = securityRequestId();
  try {
    const body = await req.json().catch(() => ({}));
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    if (body.action === "captcha") return await issueCaptcha(admin, req, securityEventRequestId);
    if (body.action === "account_application_options") {
      const { data, error } = await admin.from("departments")
        .select("dept_id,parent_id,name,code,level,sort_order")
        .eq("status", "active")
        .order("sort_order")
        .limit(500);
      if (error) throw error;
      return reply(req, { ok: true, departments: data || [] });
    }
    if (body.action === "account_application") {
      const captchaValid = await consumeCaptcha(admin, req, body.captcha_id, body.captcha_answer);
      if (!captchaValid) return reply(req, { ok: false, message: "驗證碼錯誤或已過期，請重新輸入" }, 400);

      const name = cleanText(body.name, 100);
      const username = cleanText(body.username, 64);
      const email = cleanText(body.email, 200).toLowerCase();
      const phone = cleanText(body.phone, 50) || null;
      const deptId = cleanText(body.dept_id, 80);
      const reason = cleanText(body.reason, 1000) || null;
      if (!name || !/^[A-Za-z0-9._-]{3,64}$/.test(username)
          || !/^[^\s@%]+@[^\s@%]+\.[^\s@%]+$/.test(email)
          || /[(),]/.test(email)
          || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(deptId)) {
        return reply(req, { ok: false, message: "請完整填寫姓名、英數字帳號、電子郵件與所屬單位" }, 400);
      }

      const ipAddress = clientIp(req);
      if (ipAddress) {
        const rate = await enforceDurableRateLimit(admin, req, {
          subject: ipAddress,
          scope: "username-login:account_application",
          requestId: securityEventRequestId,
        });
        if (rate.error) {
          console.error("Account application rate limit failed", cleanText(rate.error.message, 300));
          return reply(req, { ok: false, message: "安全限流服務暫時無法使用" }, 503);
        }
        if (!rate.allowed) {
          try {
            await recordRateLimitDenial(admin, req, {
              scope: "username-login:account_application",
              requestId: securityEventRequestId,
              eventCount: rate.requestCount,
              historyAlreadyRecorded: rate.durable,
              title: "帳號申請異常頻繁，已阻擋",
              message: "同一來源一日內送出過多帳號申請，受信任後端已阻擋請求。",
              windowMinutes: 1440,
            });
          } catch (alertError) {
            console.error("Account application rate-limit alert failed", alertError instanceof Error ? alertError.message : String(alertError));
          }
          return reply(req, { ok: false, message: "帳號申請過於頻繁，請稍後再試", request_id: securityEventRequestId }, 429);
        }
      }

      const [{ data: department }, { count: userCount }, { count: pendingCount }] = await Promise.all([
        admin.from("departments").select("dept_id").eq("dept_id", deptId).eq("status", "active").maybeSingle(),
        admin.from("users").select("user_id", { count: "exact", head: true }).or(`username.ilike.${username},email.ilike.${email}`),
        admin.from("account_applications").select("application_id", { count: "exact", head: true })
          .eq("status", "pending").or(`username.ilike.${username},email.ilike.${email}`),
      ]);
      if (!department) return reply(req, { ok: false, message: "所屬單位不存在或已停用" }, 400);
      if ((userCount || 0) > 0) return reply(req, { ok: false, message: "此帳號或電子郵件已存在，請改用登入或忘記密碼" }, 409);
      if ((pendingCount || 0) > 0) return reply(req, { ok: false, message: "此帳號或電子郵件已有待審申請" }, 409);

      const { data, error } = await admin.from("account_applications").insert({
        name, username, email, phone, dept_id: deptId, reason,
        source_ip: ipAddress,
        user_agent: cleanText(req.headers.get("user-agent"), 1000) || null,
      }).select("application_id").single();
      if (error) {
        if (error.code === "23505") return reply(req, { ok: false, message: "此帳號或電子郵件已有待審申請" }, 409);
        throw error;
      }
      return reply(req, { ok: true, application_id: data.application_id, message: "帳號申請已送出，請等待系統管理員審核" });
    }

    const identifier = cleanText(body.identifier || body.username, 120);
    const password = String(body.password || "");
    const isEmail = /^[^\s@%]+@[^\s@%]+\.[^\s@%]+$/.test(identifier);
    const isUsername = /^[\p{L}0-9._-]{2,80}$/u.test(identifier);
    const method: "username" | "email" | "unknown" = isEmail ? "email" : (isUsername ? "username" : "unknown");
    const ipAddress = clientIp(req);
    let recentAttempts = 0;
    if (ipAddress) {
      const rate = await enforceDurableRateLimit(admin, req, {
        subject: ipAddress,
        scope: "username-login:login",
        requestId: securityEventRequestId,
      });
      if (rate.error) {
        console.error("Login rate limit failed", cleanText(rate.error.message, 300));
        return reply(req, { ok: false, message: "安全限流服務暫時無法使用" }, 503);
      }
      recentAttempts = Math.max(0, rate.requestCount - 1);
      if (!rate.allowed) {
        const audited = await writeLoginAttempt(admin, req, identifier || "未提供", method, null, "已阻擋", "短時間登入嘗試次數過多", recentAttempts);
        if (!audited) return reply(req, { ok: false, message: "登入稽核服務暫時無法使用" }, 503);
        try {
          await recordRateLimitDenial(admin, req, {
            scope: "username-login:login",
            requestId: securityEventRequestId,
            eventCount: rate.requestCount,
            historyAlreadyRecorded: rate.durable,
            alertType: "login_bruteforce",
            title: "疑似登入暴力嘗試，已阻擋",
            message: "同一來源十分鐘內發生過多登入嘗試，系統已阻擋後續請求。",
            windowMinutes: 10,
          });
        } catch (alertError) {
          console.error("Login brute-force alert failed", alertError instanceof Error ? alertError.message : String(alertError));
        }
        return reply(req, { ok: false, message: "登入嘗試過於頻繁，請稍後再試", request_id: securityEventRequestId }, 429);
      }
    }
    const captchaValid = await consumeCaptcha(admin, req, body.captcha_id, body.captcha_answer);
    if (!captchaValid) {
      const audited = await writeLoginAttempt(admin, req, identifier || "未提供", method, null, "失敗", "驗證碼錯誤、逾時、來源不符或已使用", recentAttempts);
      if (!audited) return reply(req, { ok: false, message: "登入稽核服務暫時無法使用" }, 503);
      return reply(req, { ok: false, message: "驗證碼錯誤或已過期，請重新輸入" }, 400);
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
