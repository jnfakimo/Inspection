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
  role?: string | null;
  rbac_role?: string | null;
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

type LineNotificationState = {
  status?: string;
  attempted_at?: string;
  sent_at?: string | null;
};

type SavedSecurityAlert = {
  alert_id: string;
  alert_type: AlertSpec["alertType"];
  updated: boolean;
  severity: AlertSpec["severity"];
  title: string;
  message: string;
  resource: string | null;
  event_count: number;
  line_notification: LineNotificationState | null;
  details: Record<string, unknown>;
};

const alertActor = (profile: AuditProfile) =>
  cleanText(profile.username || profile.email || profile.name || profile.user_id, 160);

const isSysadminProfile = (profile: AuditProfile) =>
  profile.rbac_role === "sysadmin" || profile.role === "admin";

const sessionIdFromToken = (token: string) => {
  try {
    const encoded = token.split(".")[1] || "";
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const claims = JSON.parse(atob(padded)) as Record<string, unknown>;
    const sessionId = cleanText(claims.session_id, 80);
    return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sessionId) ? sessionId : null;
  } catch {
    return null;
  }
};

async function enforceBulkReadCutoff(
  admin: SupabaseClient,
  profile: AuditProfile,
  token: string,
  alert: {
    alert_id: string;
    alert_type: string;
    details?: Record<string, unknown>;
  }
) {
  const signal = alert.details || {};
  const readCount = Number(signal.read_count) || 0;
  const automatedReadCount = Number(signal.automated_read_count) || 0;
  const uniqueResourceCount = Number(signal.unique_resource_count) || 0;
  const sessionId = sessionIdFromToken(token);
  let databaseBlocked = false;
  let authSessionRevoked = false;
  const errors: string[] = [];

  if (sessionId) {
    const { error } = await admin.from("security_session_blocks").upsert({
      session_id: sessionId,
      user_id: profile.user_id,
      alert_id: alert.alert_id,
      reason: "non_admin_bulk_read",
      details: {
        alert_type: alert.alert_type,
        enforcement: "force_logout_current_session",
        actor: alertActor(profile)
      },
      blocked_at: new Date().toISOString()
    }, { onConflict: "session_id" });
    if (error) errors.push(`資料庫阻擋失敗：${cleanText(error.message, 180)}`);
    else databaseBlocked = true;
  } else {
    errors.push("JWT 缺少 session_id，無法建立資料庫阻擋紀錄");
  }

  const { error: signOutError } = await admin.auth.admin.signOut(token, "local");
  if (signOutError) errors.push(`工作階段撤銷失敗：${cleanText(signOutError.message, 180)}`);
  else authSessionRevoked = true;
  const enforcementSucceeded = databaseBlocked || authSessionRevoked;

  return {
    force_logout: enforcementSucceeded,
    // 僅在具備完整的非互動高頻存取證據，且後端確實完成處置時，前端才允許強制離線。
    confirmed_automated_access: true,
    detection_basis: "non_interactive_high_rate",
    read_count: readCount,
    automated_read_count: automatedReadCount,
    unique_resource_count: uniqueResourceCount,
    reason: "non_admin_bulk_read",
    message: enforcementSucceeded
      ? "系統確認目前工作階段出現非互動高頻資料存取（" + automatedReadCount + " 次、" + uniqueResourceCount + " 個資源），已中止目前連線並通知系統管理員。"
      : "系統確認目前工作階段出現非互動高頻資料存取（" + automatedReadCount + " 次、" + uniqueResourceCount + " 個資源），已建立告警；後端未能立即中止連線，請系統管理員處理。",
    alert_id: alert.alert_id,
    session_id: sessionId,
    database_blocked: databaseBlocked,
    auth_session_revoked: authSessionRevoked,
    errors
  };
}

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
    .select("alert_id,event_count,details")
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
      details: {
        ...((existing.details && typeof existing.details === "object") ? existing.details : {}),
        ...spec.details
      },
      last_seen_at: now.toISOString()
    }).eq("alert_id", existing.alert_id);
    if (error) throw error;
    const existingDetails = (existing.details && typeof existing.details === "object")
      ? existing.details as Record<string, unknown>
      : {};
    return {
      alert_id: existing.alert_id,
      alert_type: spec.alertType,
      updated: true,
      severity: spec.severity,
      title: spec.title,
      message: spec.message,
      resource: spec.resource,
      event_count: spec.eventCount,
      line_notification: (existingDetails.line_notification as LineNotificationState) || null,
      details: { ...existingDetails, ...spec.details }
    } satisfies SavedSecurityAlert;
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
      .select("alert_id,event_count,details")
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
        details: {
          ...((concurrent.details && typeof concurrent.details === "object") ? concurrent.details : {}),
          ...spec.details
        },
        last_seen_at: now.toISOString()
      }).eq("alert_id", concurrent.alert_id);
      if (updateError) throw updateError;
      const concurrentDetails = (concurrent.details && typeof concurrent.details === "object")
        ? concurrent.details as Record<string, unknown>
        : {};
      return {
        alert_id: concurrent.alert_id,
        alert_type: spec.alertType,
        updated: true,
        severity: spec.severity,
        title: spec.title,
        message: spec.message,
        resource: spec.resource,
        event_count: spec.eventCount,
        line_notification: (concurrentDetails.line_notification as LineNotificationState) || null,
        details: { ...concurrentDetails, ...spec.details }
      } satisfies SavedSecurityAlert;
    }
  }
  if (error) throw error;
  return {
    alert_id: data.alert_id,
    alert_type: spec.alertType,
    updated: false,
    severity: spec.severity,
    title: spec.title,
    message: spec.message,
    resource: spec.resource,
    event_count: spec.eventCount,
    line_notification: null,
    details: spec.details
  } satisfies SavedSecurityAlert;
}

async function recordSecurityLineDelivery(
  admin: SupabaseClient,
  alertId: string,
  status: "sent" | "failed" | "disabled" | "not_configured",
  httpStatus: number | null,
  response: string
) {
  const { error } = await admin.rpc("record_security_alert_line_delivery", {
    p_alert_id: alertId,
    p_status: status,
    p_http_status: httpStatus,
    p_response: cleanText(response, 500)
  });
  if (error) console.error("Security LINE delivery audit failed", error.message);
}

async function sendSecurityAlertLine(
  admin: SupabaseClient,
  profile: AuditProfile,
  ipAddress: string | null,
  alert: SavedSecurityAlert
) {
  const previous = alert.line_notification;
  if (previous?.status === "sent") return { status: "already_sent" };
  if (previous?.attempted_at) {
    const attemptedAt = new Date(previous.attempted_at).getTime();
    if (Number.isFinite(attemptedAt) && Date.now() - attemptedAt < 5 * 60_000) {
      return { status: "cooldown" };
    }
  }

  const { data: rows, error: settingsError } = await admin.from("system_settings")
    .select("key,value")
    .in("key", ["line_notify_security_alerts", "line_channel_token", "line_group_id"]);
  if (settingsError) throw settingsError;
  const settings: Record<string, string> = {};
  (rows || []).forEach((row) => {
    settings[String(row.key)] = String(row.value ?? "");
  });

  if (settings.line_notify_security_alerts !== "true") {
    await recordSecurityLineDelivery(admin, alert.alert_id, "disabled", null, "資安告警 LINE 推播已關閉");
    return { status: "disabled" };
  }
  const token = settings.line_channel_token;
  const groupId = settings.line_group_id;
  if (!token || !groupId) {
    await recordSecurityLineDelivery(admin, alert.alert_id, "not_configured", null, "LINE Token 或 Group ID 尚未設定");
    return { status: "not_configured" };
  }

  const typeLabel: Record<string, string> = {
    bulk_read: "大量資料讀取",
    repeated_denied: "重複未授權存取",
    suspicious_file: "可疑檔案讀取"
  };
  const taipeiTime = new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false
  });
  const action = alert.alert_type === "bulk_read"
    ? (isSysadminProfile(profile)
      ? "已保留異常紀錄並通知；系統管理員工作階段未中止"
      : "已強制中止該使用者目前工作階段")
    : "已建立高風險告警並保留完整系統紀錄";
  const text = [
    "🚨 北農系統資安告警",
    `類型：${typeLabel[alert.alert_type] || alert.alert_type}`,
    `帳號：${alertActor(profile)}`,
    `來源 IP：${ipAddress || "無法取得"}`,
    `時間：${taipeiTime}`,
    `事件數：${alert.event_count}`,
    `處置：${action}`,
    `說明：${alert.message}`,
    alert.resource ? `資源：${cleanText(alert.resource, 300)}` : ""
  ].filter(Boolean).join("\n");

  try {
    // 對外呼叫必須有逾時上限：原本沒有 AbortSignal，LINE 一慢就會把 worker 卡住
    // 直到被平台強制終止，前端因而收到 502（且該回應不帶 CORS 標頭，瀏覽器會再
    // 報一次 CORS 錯誤）。
    const lineResponse = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: groupId,
        messages: [{ type: "text", text }]
      })
    });
    const responseText = await lineResponse.text();
    const status = lineResponse.ok ? "sent" : "failed";
    await recordSecurityLineDelivery(admin, alert.alert_id, status, lineResponse.status, responseText);
    if (!lineResponse.ok) console.error("Security LINE push failed", lineResponse.status, responseText);
    return { status, http_status: lineResponse.status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordSecurityLineDelivery(admin, alert.alert_id, "failed", null, message);
    console.error("Security LINE push failed", message);
    return { status: "failed" };
  }
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
    const sysadminRead = isSysadminProfile(profile);
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: recent, error } = await admin.from("audit_logs")
      .select("changes,ip_address,operated_at,user_agent")
      .eq("operator_id", profile.user_id)
      .gte("operated_at", since)
      .in("table_name", ["data_access", "file_access"])
      .order("operated_at", { ascending: false })
      .limit(240);
    if (error) throw error;

    // 只有新稽核格式明確標記為 page_load 的事件，才可作為自動化讀取訊號；
    // 缺少標記的舊資料不列入，避免歷史紀錄或舊快取造成誤判。
    const automatedEvents = (recent || []).filter((row) => {
      const item = row.changes as Record<string, unknown> | null;
      const itemDetails = item?.details as Record<string, unknown> | undefined;
      const sameSource = !ipAddress || row.ip_address === ipAddress;
      return sameSource &&
        (item?.event_type === "data_read" || item?.event_type === "file_read") &&
        itemDetails?.user_initiated === false &&
        itemDetails?.access_origin === "page_load";
    });
    const readCount = automatedEvents.length;
    const resources = [...new Set(automatedEvents.map((row) => {
      const item = row.changes as Record<string, unknown>;
      const itemDetails = item.details as Record<string, unknown> | undefined;
      return cleanText(itemDetails?.resource, 320);
    }).filter(Boolean))];
    const userAgentSet = [...new Set(automatedEvents.map((row) =>
      cleanText(row.user_agent, 320)
    ).filter(Boolean))];
    const uniqueResourceCount = resources.length;

    // 正常頁面載入通常是少量查詢；只有同一來源在短時間內持續非互動讀取，
    // 且同時跨越多個資源，才視為可能由外部程式或自動化工具大量存取。
    const automatedReadThreshold = 40;
    const resourceThreshold = 8;
    const automationSuspected = readCount >= automatedReadThreshold &&
      uniqueResourceCount >= resourceThreshold;
    if (automationSuspected) {
      const resourceSummary = resources.slice(0, 8).join("、");
      return saveSecurityAlert(admin, profile, ipAddress, {
        alertType: "bulk_read",
        severity: "critical",
        title: sysadminRead ? "系統管理員非互動高頻讀取" : "疑似非互動高頻讀取，待處置",
        message: sysadminRead
          ? alertActor(profile) + " 在 5 分鐘內出現 " + readCount + " 次非互動讀取，涉及 " + uniqueResourceCount + " 個不同資源；系統已保留紀錄並通知，管理員工作階段不強制中止。"
          : alertActor(profile) + " 在 5 分鐘內出現 " + readCount + " 次非互動讀取，涉及 " + uniqueResourceCount + " 個不同資源；系統確認可能存在外部程式或自動化工具，將依後端處置結果決定是否中止目前工作階段。",
        resource: resourceSummary || resource,
        eventCount: readCount,
        windowMinutes: 5,
        details: {
          detection_basis: "non_interactive_high_rate",
          automation_suspected: true,
          automated_event_threshold: automatedReadThreshold,
          unique_resource_threshold: resourceThreshold,
          read_count: readCount,
          automated_read_count: readCount,
          unique_resource_count: uniqueResourceCount,
          user_initiated_read_count: 0,
          resources: resources.slice(0, 20),
          observed_user_agents: userAgentSet.slice(0, 5),
          enforcement: sysadminRead ? "audit_and_notify_only" : "force_logout_current_session",
          sysadmin_exempt_from_logout: sysadminRead
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

    let alert: SavedSecurityAlert | null = null;
    let securityAction = null;
    let lineNotification = null;
    if (["data_read", "file_read", "access_denied"].includes(eventType)) {
      try {
        // 告警偵測與大量讀取切斷維持同步：前端會讀回應中的 security_action 來
        // 強制登出，移到背景會使該資安控制失效。兩者皆為資料庫查詢，成本可控。
        alert = await detectSecurityAlert(admin, profile, ipAddress, eventType, details);
        if (alert?.alert_type === "bulk_read" && !isSysadminProfile(profile)) {
          securityAction = await enforceBulkReadCutoff(admin, profile, token, alert);
        }
        // LINE 推播改為背景執行：它是本函式唯一的對外呼叫，延遲不可控，而其結果
        // （line_notification）前端並未使用。以 EdgeRuntime.waitUntil 保住 worker
        // 直到背景工作結束，避免回應送出後任務被中斷。
        if (alert) {
          lineNotification = { status: "queued" };
          const linePush = sendSecurityAlertLine(admin, profile, ipAddress, alert)
            .catch((lineError) => {
              console.error("Security alert LINE push failed",
                lineError instanceof Error ? lineError.message : String(lineError));
            });
          const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
          if (typeof runtime?.waitUntil === "function") runtime.waitUntil(linePush);
        }
      } catch (alertError) {
        console.error("Security alert detection failed", alertError instanceof Error ? alertError.message : String(alertError));
      }
    }

    return reply(req, { ok: true, audit_id: inserted.audit_id, alert, security_action: securityAction, line_notification: lineNotification });
  } catch (error) {
    console.error("Audit event failed", error instanceof Error ? error.message : String(error));
    return reply(req, { ok: false, message: "系統紀錄寫入失敗" }, 500);
  }
});
