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

type AuditProfile = {
  user_id: string;
  username?: string | null;
  email?: string | null;
  name?: string | null;
};

type AlertSpec = {
  alertType: "bulk_read" | "repeated_denied" | "suspicious_file";
  severity: "warning" | "critical";
  title: string;
  message: string;
  resource: string | null;
  eventCount: number;
  windowMinutes: number;
  details: Record<string, unknown>;
};

const alertActor = (profile: AuditProfile) =>
  cleanText(profile.username || profile.email || profile.name || profile.user_id, 160);

async function saveSecurityAlert(
  admin: SupabaseClient,
  profile: AuditProfile,
  ipAddress: string | null,
  spec: AlertSpec
) {
  const now = new Date();
  const dedupeMinutes = Math.max(spec.windowMinutes, 10);
  const dedupeSince = new Date(now.getTime() - dedupeMinutes * 60_000).toISOString();
  const { data: existing, error: existingError } = await admin.from("security_alerts")
    .select("alert_id,event_count")
    .eq("alert_type", spec.alertType)
    .eq("operator_id", profile.user_id)
    .eq("status", "open")
    .gte("last_seen_at", dedupeSince)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing?.alert_id) {
    const { error } = await admin.from("security_alerts").update({
      severity: spec.severity,
      title: spec.title,
      message: spec.message,
      ip_address: ipAddress,
      resource: spec.resource,
      event_count: Math.max(Number(existing.event_count) || 1, spec.eventCount),
      window_minutes: spec.windowMinutes,
      details: spec.details,
      last_seen_at: now.toISOString()
    }).eq("alert_id", existing.alert_id);
    if (error) throw error;
    return { alert_id: existing.alert_id, alert_type: spec.alertType, updated: true };
  }

  const newAlert = {
    alert_type: spec.alertType,
    severity: spec.severity,
    title: spec.title,
    message: spec.message,
    operator_id: profile.user_id,
    actor_identifier: alertActor(profile),
    ip_address: ipAddress,
    resource: spec.resource,
    event_count: spec.eventCount,
    window_minutes: spec.windowMinutes,
    details: spec.details,
    detected_at: now.toISOString(),
    last_seen_at: now.toISOString()
  };
  const { data, error } = await admin.from("security_alerts").insert(newAlert).select("alert_id").single();
  if (error?.code === "23505") {
    const { data: concurrent, error: concurrentError } = await admin.from("security_alerts")
      .select("alert_id,event_count")
      .eq("alert_type", spec.alertType)
      .eq("operator_id", profile.user_id)
      .eq("status", "open")
      .maybeSingle();
    if (concurrentError) throw concurrentError;
    if (concurrent?.alert_id) {
      const { error: updateError } = await admin.from("security_alerts").update({
        severity: spec.severity,
        title: spec.title,
        message: spec.message,
        ip_address: ipAddress,
        resource: spec.resource,
        event_count: Math.max(Number(concurrent.event_count) || 1, spec.eventCount),
        window_minutes: spec.windowMinutes,
        details: spec.details,
        last_seen_at: now.toISOString()
      }).eq("alert_id", concurrent.alert_id);
      if (updateError) throw updateError;
      return { alert_id: concurrent.alert_id, alert_type: spec.alertType, updated: true };
    }
  }
  if (error) throw error;
  return { alert_id: data.alert_id, alert_type: spec.alertType, updated: false };
}

async function detectSecurityAlert(
  admin: SupabaseClient,
  profile: AuditProfile,
  ipAddress: string | null,
  eventType: string,
  details: Record<string, unknown>
) {
  const reason = cleanText(details.reason, 240);
  const result = cleanText(details.result, 240);
  const resource = cleanText(details.resource, 320) || "未識別資源";
  const suspiciousFile = eventType === "access_denied" &&
    (details.access_kind === "file") &&
    /目錄跳脫|敏感檔名|可疑路徑|系統已阻擋可疑路徑/.test(`${reason} ${result}`);

  if (suspiciousFile) {
    return saveSecurityAlert(admin, profile, ipAddress, {
      alertType: "suspicious_file",
      severity: "critical",
      title: "偵測到可疑檔案讀取",
      message: `${alertActor(profile)} 嘗試讀取可疑或敏感檔案路徑「${resource}」，系統已阻擋。`,
      resource,
      eventCount: 1,
      windowMinutes: 10,
      details: { event_type: eventType, reason, result, resource }
    });
  }

  if (eventType === "access_denied") {
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count, error } = await admin.from("audit_logs")
      .select("audit_id", { count: "exact", head: true })
      .eq("operator_id", profile.user_id)
      .gte("operated_at", since)
      .contains("changes", { event_type: "access_denied" });
    if (error) throw error;
    const deniedCount = count || 0;
    if (deniedCount >= 5) {
      return saveSecurityAlert(admin, profile, ipAddress, {
        alertType: "repeated_denied",
        severity: "critical",
        title: "重複嘗試未授權讀取",
        message: `${alertActor(profile)} 在 10 分鐘內已有 ${deniedCount} 次讀取遭拒，請立即確認帳號及來源網路位址。`,
        resource,
        eventCount: deniedCount,
        windowMinutes: 10,
        details: { threshold: 5, denied_count: deniedCount, latest_resource: resource }
      });
    }
    return null;
  }

  if (eventType === "data_read" || eventType === "file_read") {
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: recent, error } = await admin.from("audit_logs")
      .select("changes")
      .eq("operator_id", profile.user_id)
      .gte("operated_at", since)
      .in("table_name", ["data_access", "file_access"])
      .order("operated_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const readEvents = (recent || []).filter((row) => {
      const item = row.changes as Record<string, unknown> | null;
      return item?.event_type === "data_read" || item?.event_type === "file_read";
    });
    const resources = [...new Set(readEvents.map((row) => {
      const item = row.changes as Record<string, unknown>;
      const itemDetails = item.details as Record<string, unknown> | undefined;
      return cleanText(itemDetails?.resource, 320);
    }).filter(Boolean))];
    const readCount = readEvents.length;
    const broadRead = resources.length >= 8;
    const repeatedRead = readCount >= 25;
    if (broadRead || repeatedRead) {
      const resourceSummary = resources.slice(0, 8).join("、");
      return saveSecurityAlert(admin, profile, ipAddress, {
        alertType: "bulk_read",
        severity: repeatedRead && resources.length >= 8 ? "critical" : "warning",
        title: "偵測到大量資料讀取",
        message: `${alertActor(profile)} 在 5 分鐘內讀取 ${readCount} 次，涉及 ${resources.length} 個不同資源，請確認是否為正常操作。`,
        resource: resourceSummary || resource,
        eventCount: readCount,
        windowMinutes: 5,
        details: {
          event_threshold: 25,
          unique_resource_threshold: 8,
          read_count: readCount,
          unique_resource_count: resources.length,
          resources: resources.slice(0, 20)
        }
      });
    }
  }
  return null;
}

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
    if (!["login", "logout", "page_view", "function_use", "data_action", "data_read", "file_read", "access_denied"].includes(eventType)) {
      return reply(req, { ok: false, message: "不支援的稽核事件" }, 400);
    }

    const eventId = /^[0-9a-z-]{8,80}$/i.test(String(body.event_id || ""))
      ? String(body.event_id)
      : crypto.randomUUID();
    const isAuth = eventType === "login" || eventType === "logout";
    const ipAddress = clientIp(req);
    const userAgent = cleanText(req.headers.get("user-agent"), 1000) || null;
    const page = cleanValue(body.page || {});
    const details = cleanValue(body.details || {}) as Record<string, unknown>;
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
      details
    };

    const source = cleanText((page as Record<string, unknown>)?.path || "system", 160) || "system";
    const isFileAccess = eventType === "file_read" || (eventType === "access_denied" && details.access_kind === "file");
    const isDataAccess = eventType === "data_read" || (eventType === "access_denied" && details.access_kind === "data");
    const { data: inserted, error: insertError } = await admin.from("audit_logs").insert({
      table_name: isAuth ? "auth" : (isFileAccess ? "file_access" : (isDataAccess ? "data_access" : "system_usage")),
      record_id: isAuth ? String(profile.user_id) : eventId,
      action: isAuth ? eventType : "insert",
      changes,
      operator_id: profile.user_id,
      ip_address: ipAddress,
      user_agent: userAgent,
      source
    }).select("audit_id").single();
    if (insertError) throw insertError;

    let alert = null;
    if (["data_read", "file_read", "access_denied"].includes(eventType)) {
      try {
        alert = await detectSecurityAlert(admin, profile, ipAddress, eventType, details);
      } catch (alertError) {
        console.error("Security alert detection failed", alertError instanceof Error ? alertError.message : String(alertError));
      }
    }

    return reply(req, { ok: true, audit_id: inserted.audit_id, alert });
  } catch (error) {
    console.error("Audit event failed", error instanceof Error ? error.message : String(error));
    return reply(req, { ok: false, message: "系統紀錄寫入失敗" }, 500);
  }
});
