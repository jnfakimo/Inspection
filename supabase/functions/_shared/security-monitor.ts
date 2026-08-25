// 後端資安監測共用工具。本檔刻意同時相容「尚未套用最新 migration」的資料庫：
// 新版 RPC/告警類型尚未存在時，會退回既有限流 RPC 與 repeated_denied 告警，
// 不讓 Edge Function 因部署先後順序而全面回應 500。

type SecurityDb = {
  from: (relation: string) => any;
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: any; error: any }>;
};

export type SecurityIncidentType =
  | "bulk_read"
  | "repeated_denied"
  | "suspicious_file"
  | "rate_limit"
  | "login_bruteforce"
  | "error_threshold";

export type IncidentProfile = {
  user_id?: string | null;
  username?: string | null;
  email?: string | null;
  name?: string | null;
};

export type SecurityIncidentSpec = {
  alertType: SecurityIncidentType;
  severity: "warning" | "critical";
  title: string;
  message: string;
  resource?: string | null;
  eventCount?: number;
  windowMinutes?: number;
  details?: Record<string, unknown>;
  profile?: IncidentProfile | null;
  ipAddress?: string | null;
  notificationToggleKey?:
    | "line_notify_security_alerts"
    | "line_notify_error_threshold";
  notificationCooldownMinutes?: number;
};

export type SavedIncident = {
  alert_id: string;
  alert_type: SecurityIncidentType | "repeated_denied";
  updated: boolean;
  title: string;
  message: string;
  event_count: number;
  details: Record<string, unknown>;
};

const clean = (value: unknown, max = 500) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

export const securityClientIp = (req: Request) => {
  const raw = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for") || req.headers.get("fly-client-ip") ||
    "";
  return clean(raw.split(",")[0], 80) || null;
};

export const securityRequestId = () => {
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const RATE_LIMIT_CONFIG: Record<
  string,
  { maximum: number; windowSeconds: number }
> = {
  "app-api": { maximum: 60, windowSeconds: 60 },
  "app-api:module_data": { maximum: 30, windowSeconds: 60 },
  "app-api:dashboard": { maximum: 12, windowSeconds: 60 },
  "app-api:inspections": { maximum: 20, windowSeconds: 60 },
  "app-api:equipment_map": { maximum: 4, windowSeconds: 60 },
  "admin-api": { maximum: 30, windowSeconds: 60 },
  "admin-api:write": { maximum: 10, windowSeconds: 60 },
  "ipcam-proxy": { maximum: 30, windowSeconds: 60 },
  "patrol-checkin": { maximum: 12, windowSeconds: 60 },
  "audit-event": { maximum: 120, windowSeconds: 60 },
  "client-error-report": { maximum: 10, windowSeconds: 900 },
  "username-login:captcha": { maximum: 30, windowSeconds: 600 },
  "username-login:account_application": { maximum: 5, windowSeconds: 86400 },
  "username-login:login": { maximum: 20, windowSeconds: 600 },
};
const RESOURCE_LABELS: Record<string, string> = {
  "app-api": "應用程式介面",
  "app-api:module_data": "系統模組資料",
  "app-api:dashboard": "戰情儀表板",
  "app-api:inspections": "巡檢資料",
  "app-api:equipment_map": "設備地圖",
  "admin-api": "後台管理介面",
  "admin-api:write": "後台寫入操作",
  "ipcam-proxy": "監視影像代理",
  "patrol-checkin": "巡邏簽到",
  "audit-event": "系統稽核事件",
  "client-error-report": "前端錯誤回報",
  "username-login:captcha": "登入驗證碼",
  "username-login:account_application": "帳號申請",
  "username-login:login": "帳號登入",
  client_error_logs: "前端錯誤紀錄",
  "platform:edge_logs": "API Gateway 平台日誌",
  "platform:storage_logs": "Storage 平台日誌",
  "platform:auth_logs": "Auth 平台日誌",
  "platform:function_logs": "Edge Function 平台日誌",
  "platform:function_edge_logs": "Edge Function 網路日誌",
  "platform:management_api": "Supabase Logs API 監測",
  "synthetic:github_pages": "GitHub Pages 無腳本探針",
  "synthetic:supabase_rest": "Supabase REST 無腳本探針",
  "synthetic:supabase_storage": "Supabase Storage 無腳本探針",
  "synthetic:traffic:edge_logs": "API Gateway／REST 無腳本流量探針",
  "synthetic:traffic:storage_logs": "Storage 無腳本流量探針",
};

const isCompatibilityError = (error: any) => {
  const code = clean(error?.code, 40);
  const message = clean(error?.message, 500);
  return ["PGRST202", "42883", "42P01", "42703"].includes(code) ||
    /function .* does not exist|schema cache|could not find the function|relation .* does not exist/i
      .test(message);
};

export async function enforceDurableRateLimit(
  db: SecurityDb,
  req: Request,
  options: {
    subject: string;
    scope: string;
    actorId?: string | null;
    requestId?: string;
  },
) {
  const requestId = clean(options.requestId, 100) || securityRequestId();
  const ipAddress = securityClientIp(req);
  const extendedArgs = {
    p_subject: clean(options.subject, 200),
    p_scope: clean(options.scope, 100),
    p_ip_address: ipAddress,
    p_request_id: requestId,
    p_actor_id: options.actorId || null,
  };
  let result = await db.rpc("enforce_request_rate_limit", extendedArgs);
  let durable = true;
  if (result.error && isCompatibilityError(result.error)) {
    durable = false;
    result = await db.rpc("enforce_request_rate_limit", {
      p_subject: extendedArgs.p_subject,
      p_scope: extendedArgs.p_scope,
    });
  }
  const config = RATE_LIMIT_CONFIG[options.scope] ||
    { maximum: 1, windowSeconds: 60 };
  let requestCount = result.data === true ? 1 : config.maximum + 1;
  if (!result.error && result.data !== true && durable) {
    // 只有被阻擋的請求會寫 append-only 歷程；正常放行只更新當前視窗計數。
    const { data: event, error: eventError } = await db.from(
      "request_rate_limit_events",
    )
      .select("request_count,maximum_requests,window_seconds")
      .eq("request_id", requestId)
      .eq("scope", options.scope)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!eventError && event?.request_count) {
      requestCount = Number(event.request_count) || requestCount;
    }
  }
  return {
    allowed: result.data === true,
    error: result.error,
    durable,
    requestId,
    ipAddress,
    requestCount,
    config,
  };
}

function actorLabel(profile?: IncidentProfile | null) {
  return clean(
    profile?.username || profile?.email || profile?.name || profile?.user_id ||
      "未識別來源",
    160,
  );
}

async function findOpenIncident(
  db: SecurityDb,
  alertType: string,
  spec: SecurityIncidentSpec,
) {
  let query = db.from("security_alerts")
    .select("alert_id,event_count,details,title,message")
    .eq("alert_type", alertType)
    .eq("status", "open");
  const resource = clean(spec.resource, 300) || null;
  if (spec.profile?.user_id) {
    query = query.eq("operator_id", spec.profile.user_id);
  } else {
    // 匿名異常依類型＋資源聚合，避免大量來源 IP 各自建立告警與 LINE 風暴；
    // 個別 IP 證據保留在 append-only 的限流檢查點歷程。
    query = query.is("operator_id", null);
    query = resource
      ? query.eq("resource", resource)
      : query.is("resource", null);
  }
  return await query.order("last_seen_at", { ascending: false }).limit(1)
    .maybeSingle();
}

async function persistIncidentWithType(
  db: SecurityDb,
  spec: SecurityIncidentSpec,
  alertType: string,
) {
  const now = new Date().toISOString();
  const eventCount = Math.max(1, Math.floor(Number(spec.eventCount) || 1));
  const details = {
    ...(spec.details || {}),
    incident_type: spec.alertType,
    detection_source: "trusted_edge_function",
  };
  const { data: existing, error: existingError } = await findOpenIncident(
    db,
    alertType,
    spec,
  );
  if (existingError) return { data: null, error: existingError };
  if (existing?.alert_id) {
    const mergedDetails = {
      ...((existing.details && typeof existing.details === "object")
        ? existing.details
        : {}),
      ...details,
    };
    const { error } = await db.from("security_alerts").update({
      severity: spec.severity,
      title: clean(spec.title, 300),
      message: clean(spec.message, 2000),
      actor_identifier: actorLabel(spec.profile),
      ip_address: spec.ipAddress || null,
      resource: clean(spec.resource, 300) || null,
      event_count: Math.max(Number(existing.event_count) || 1, eventCount),
      window_minutes: Math.max(0, Math.floor(Number(spec.windowMinutes) || 0)),
      details: mergedDetails,
      last_seen_at: now,
    }).eq("alert_id", existing.alert_id);
    return {
      data: error ? null : {
        alert_id: existing.alert_id,
        alert_type: alertType,
        updated: true,
        title: clean(spec.title, 300),
        message: clean(spec.message, 2000),
        event_count: eventCount,
        details: mergedDetails,
      },
      error,
    };
  }

  const payload = {
    alert_type: alertType,
    severity: spec.severity,
    title: clean(spec.title, 300),
    message: clean(spec.message, 2000),
    operator_id: spec.profile?.user_id || null,
    actor_identifier: actorLabel(spec.profile),
    ip_address: spec.ipAddress || null,
    resource: clean(spec.resource, 300) || null,
    event_count: eventCount,
    window_minutes: Math.max(0, Math.floor(Number(spec.windowMinutes) || 0)),
    details,
    detected_at: now,
    last_seen_at: now,
  };
  const { data, error } = await db.from("security_alerts").insert(payload)
    .select("alert_id").single();
  if (error?.code === "23505") {
    const concurrent = await findOpenIncident(db, alertType, spec);
    if (concurrent.data?.alert_id) {
      const { error: updateError } = await db.from("security_alerts").update({
        severity: spec.severity,
        title: payload.title,
        message: payload.message,
        ip_address: payload.ip_address,
        resource: payload.resource,
        event_count: eventCount,
        window_minutes: payload.window_minutes,
        details: {
          ...((concurrent.data.details &&
              typeof concurrent.data.details === "object")
            ? concurrent.data.details
            : {}),
          ...details,
        },
        last_seen_at: now,
      }).eq("alert_id", concurrent.data.alert_id);
      return {
        data: updateError ? null : {
          alert_id: concurrent.data.alert_id,
          alert_type: alertType,
          updated: true,
          title: payload.title,
          message: payload.message,
          event_count: eventCount,
          details,
        },
        error: updateError,
      };
    }
  }
  return {
    data: error ? null : {
      alert_id: data.alert_id,
      alert_type: alertType,
      updated: false,
      title: payload.title,
      message: payload.message,
      event_count: eventCount,
      details,
    },
    error,
  };
}

export async function saveSecurityIncident(
  db: SecurityDb,
  spec: SecurityIncidentSpec,
): Promise<SavedIncident> {
  let saved = await persistIncidentWithType(db, spec, spec.alertType);
  // 舊 schema 的 check constraint 只允許三種 V1 類型；新類型在 migration 尚未套用時
  // 改以 repeated_denied 保存，真實類型仍留在 details.incident_type。
  if (
    saved.error?.code === "23514" &&
    !["bulk_read", "repeated_denied", "suspicious_file"].includes(
      spec.alertType,
    )
  ) {
    // 不將新類型套在舊的 (alert_type,operator_id) 唯一索引上，否則可能在
    // 部署窗口中把真正的 repeated_denied 未處理告警覆寫成限流告警。
    saved = await persistIncidentWithType(db, {
      ...spec,
      profile: null,
      details: {
        ...(spec.details || {}),
        fallback_operator_id: spec.profile?.user_id || null,
      },
    }, "repeated_denied");
  }
  if (saved.error || !saved.data) {
    throw saved.error || new Error("資安告警寫入失敗");
  }
  return saved.data as SavedIncident;
}

async function createAdminNotices(db: SecurityDb, alert: SavedIncident) {
  if (alert.updated) return;
  const { data: admins, error } = await db.from("users")
    .select("user_id")
    .eq("status", "active")
    .or("role.eq.admin,rbac_role.eq.sysadmin,rbac_role.eq.admin")
    .limit(100);
  if (error) throw error;
  const rows = (admins || []).map((row: { user_id: string }) => ({
    recipient_id: row.user_id,
    event: "security_alert",
    title: clean(alert.title, 300),
    body: clean(`${alert.message}（告警編號 ${alert.alert_id}）`, 500),
    is_read: false,
  }));
  if (!rows.length) return;
  const { error: insertError } = await db.from("notifications").insert(rows);
  if (insertError) throw insertError;
}

async function recordLineDelivery(
  db: SecurityDb,
  alertId: string,
  status: "sent" | "failed" | "disabled" | "not_configured",
  httpStatus: number | null,
  response: string,
) {
  let lastError: any = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { error } = await db.rpc("record_security_alert_line_delivery", {
        p_alert_id: alertId,
        p_status: status,
        p_http_status: httpStatus,
        p_response: clean(response, 500),
      });
      if (!error) return true;
      lastError = error;
    } catch (error) {
      lastError = error;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  console.error(
    "Security LINE delivery record failed",
    clean(lastError?.message, 300),
  );
  return false;
}

export async function sendSecurityIncidentLine(
  db: SecurityDb,
  alert: SavedIncident,
  spec: SecurityIncidentSpec,
) {
  const toggleKey = spec.notificationToggleKey || "line_notify_security_alerts";
  const { data: rows, error: settingsError } = await db.from("system_settings")
    .select("key,value")
    .in("key", [
      toggleKey,
      "line_notify_security_alerts",
      "line_notify_security",
      "line_channel_token",
      "line_group_id",
    ]);
  if (settingsError) throw settingsError;
  const settings = Object.fromEntries(
    (rows || []).map((
      row: { key: unknown; value: unknown },
    ) => [String(row.key), String(row.value ?? "")]),
  );
  const enabled = toggleKey === "line_notify_security_alerts"
    ? (settings.line_notify_security_alerts ||
      settings.line_notify_security) === "true"
    : settings[toggleKey] === "true";
  if (!enabled) {
    await recordLineDelivery(
      db,
      alert.alert_id,
      "disabled",
      null,
      "該類資安告警 LINE 推播已關閉",
    );
    return { status: "disabled" as const, httpStatus: null };
  }
  if (!settings.line_channel_token || !settings.line_group_id) {
    await recordLineDelivery(
      db,
      alert.alert_id,
      "not_configured",
      null,
      "LINE Token 或 Group ID 尚未設定",
    );
    return { status: "not_configured" as const, httpStatus: null };
  }

  const previous = alert.details?.line_notification as {
    status?: string;
    sent_at?: string;
  } | undefined;
  const cooldownMs =
    Math.max(0, Number(spec.notificationCooldownMinutes) || 10) * 60_000;
  if (previous?.status === "sent" && previous.sent_at) {
    const sentAt = new Date(previous.sent_at).getTime();
    if (Number.isFinite(sentAt) && Date.now() - sentAt < cooldownMs) {
      return { status: "cooldown" as const, httpStatus: null };
    }
  }

  const typeLabel: Record<string, string> = {
    rate_limit: "API 異常流量",
    login_bruteforce: "登入暴力嘗試",
    error_threshold: "系統錯誤爆量",
    repeated_denied: "重複未授權存取",
    bulk_read: "大量資料讀取",
    suspicious_file: "可疑檔案存取",
  };
  const text = [
    "🚨 北農系統資安告警",
    `類型：${typeLabel[spec.alertType] || spec.alertType}`,
    `帳號：${actorLabel(spec.profile)}`,
    `來源 IP：${spec.ipAddress || "無法取得"}`,
    `事件數：${alert.event_count}`,
    `說明：${alert.message}`,
    spec.resource
      ? `範圍：${
        RESOURCE_LABELS[clean(spec.resource, 300)] || "受保護系統資源"
      }`
      : "",
    `告警編號：${alert.alert_id}`,
  ].filter(Boolean).join("\n");

  let lastStatus: number | null = null;
  let lastResponse = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        signal: AbortSignal.timeout(5000),
        headers: {
          Authorization: `Bearer ${settings.line_channel_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: settings.line_group_id,
          messages: [{ type: "text", text }],
        }),
      });
      lastStatus = response.status;
      lastResponse = await response.text();
      if (response.ok) {
        await recordLineDelivery(
          db,
          alert.alert_id,
          "sent",
          response.status,
          lastResponse,
        );
        return { status: "sent" as const, httpStatus: response.status };
      }
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastResponse = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await recordLineDelivery(
    db,
    alert.alert_id,
    "failed",
    lastStatus,
    lastResponse,
  );
  return { status: "failed" as const, httpStatus: lastStatus };
}

export async function recordAndNotifySecurityIncident(
  db: SecurityDb,
  spec: SecurityIncidentSpec,
) {
  const alert = await saveSecurityIncident(db, spec);
  try {
    await createAdminNotices(db, alert);
  } catch (error) {
    console.error(
      "Security in-app notification failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  const delivery = await sendSecurityIncidentLine(db, alert, spec);
  return { alert, delivery };
}

export async function recordRateLimitDenial(
  db: SecurityDb,
  req: Request,
  options: {
    scope: string;
    requestId: string;
    profile?: IncidentProfile | null;
    eventCount?: number;
    title?: string;
    message?: string;
    alertType?: "rate_limit" | "login_bruteforce";
    windowMinutes?: number;
    historyAlreadyRecorded?: boolean;
  },
) {
  const config = RATE_LIMIT_CONFIG[options.scope] ||
    {
      maximum: 1,
      windowSeconds: Math.max(60, (options.windowMinutes || 1) * 60),
    };
  const eventCount = Math.max(
    config.maximum + 1,
    Math.floor(Number(options.eventCount) || 0),
  );
  if (!options.historyAlreadyRecorded) {
    const now = new Date();
    const { error: historyError } = await db.from("request_rate_limit_events")
      .insert({
        subject: clean(
          options.profile?.user_id || securityClientIp(req) || "unknown",
          200,
        ),
        actor_id: options.profile?.user_id || null,
        ip_address: securityClientIp(req),
        scope: clean(options.scope, 100),
        request_id: clean(options.requestId, 100),
        window_started: new Date(now.getTime() - config.windowSeconds * 1000)
          .toISOString(),
        window_seconds: config.windowSeconds,
        request_count: eventCount,
        maximum_requests: config.maximum,
        allowed: false,
        occurred_at: now.toISOString(),
      });
    if (historyError && !isCompatibilityError(historyError)) {
      console.error(
        "Manual rate-limit history failed",
        clean(historyError.message, 300),
      );
    }
  }
  const spec: SecurityIncidentSpec = {
    alertType: options.alertType || "rate_limit",
    severity: options.alertType === "login_bruteforce" ? "critical" : "warning",
    title: options.title || "API 請求達安全限制",
    message: options.message ||
      `受信任後端已阻擋短時間內過多的${
        RESOURCE_LABELS[options.scope] || "系統"
      }請求。`,
    resource: clean(options.scope, 100),
    eventCount,
    windowMinutes: options.windowMinutes ||
      Math.max(1, Math.ceil(config.windowSeconds / 60)),
    details: {
      detection_basis: "server_side_rate_limit",
      scope: clean(options.scope, 100),
      request_id: clean(options.requestId, 100),
      request_count: eventCount,
      maximum_requests: config.maximum,
      window_seconds: config.windowSeconds,
    },
    profile: options.profile || null,
    ipAddress: securityClientIp(req),
    notificationCooldownMinutes: 10,
  };
  // 429 路徑不可等待最多兩次、5 秒的 LINE 外部呼叫，否則攻擊者可將限流
  // 放大成 worker 耗盡。告警本體先同步落地，只有新告警才排入背景通知；重複
  // 429 僅更新 event_count/last_seen_at，不會重複放大 LINE 流量。
  const alert = await saveSecurityIncident(db, spec);
  if (alert.updated) {
    const previous = alert.details?.line_notification as {
      status?: string;
      attempted_at?: string;
    } | undefined;
    const attemptedAt = previous?.attempted_at
      ? new Date(previous.attempted_at).getTime()
      : NaN;
    const retryable = ["failed", "not_configured"].includes(previous?.status || "") &&
      (!Number.isFinite(attemptedAt) || Date.now() - attemptedAt >= 5 * 60_000);
    if (!retryable) {
      return { alert, delivery: { status: "deduplicated" as const } };
    }
  }
  const background = (async () => {
    try {
      await createAdminNotices(db, alert);
    } catch (error) {
      console.error(
        "Security in-app notification failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      return await sendSecurityIncidentLine(db, alert, spec);
    } catch (error) {
      console.error(
        "Security LINE notification failed",
        error instanceof Error ? error.message : String(error),
      );
      return { status: "failed" as const, httpStatus: null };
    }
  })();
  const edgeRuntime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(background);
  else background.catch(() => undefined);
  return { alert, delivery: { status: "queued" as const } };
}
