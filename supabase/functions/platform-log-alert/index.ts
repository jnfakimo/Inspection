import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";
import {
  recordAndNotifySecurityIncident,
  securityRequestId,
} from "../_shared/security-monitor.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});
const clean = (value: unknown, max = 500) => String(value ?? "")
  .replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const safeEqual = (a: string, b: string) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
};
// 監測排程每 10 分鐘執行一次；持續中的同一平台事件改以 30 分鐘冷卻，
// 仍會在 security_alerts 更新 last_seen_at，不讓 LINE 變成每次排程的噪音。
const PLATFORM_NOTIFICATION_COOLDOWN_MINUTES = 30;

const allowedTypes = new Set([
  "rate_limit",
  "login_bruteforce",
  "error_threshold",
  "suspicious_file",
]);

type PlatformSignal = {
  source?: unknown;
  alert_type?: unknown;
  severity?: unknown;
  title?: unknown;
  resource?: unknown;
  event_count?: unknown;
  window_minutes?: unknown;
  message?: unknown;
  details?: unknown;
};

function objectDetails(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 30));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply({ ok: false, state: "degraded", message: "僅支援 POST" }, 405);
  const expectedSecret = Deno.env.get("CRON_SECRET") || "";
  if (!expectedSecret || !safeEqual(req.headers.get("x-cron-secret") || "", expectedSecret)) {
    return reply({ ok: false, state: "degraded", message: "未授權" }, 401);
  }

  const requestId = securityRequestId();
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const rawSignals = Array.isArray(body.signals) ? body.signals.slice(0, 20) as PlatformSignal[] : [];
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const outcomes: Array<Record<string, unknown>> = [];
    for (const raw of rawSignals) {
      const alertType = clean(raw.alert_type, 40);
      if (!allowedTypes.has(alertType)) continue;
      const source = clean(raw.source, 80) || "unknown";
      const severity = raw.severity === "critical" ? "critical" : "warning";
      const eventCount = Math.max(1, Math.min(1000000, Math.floor(Number(raw.event_count) || 1)));
      const windowMinutes = Math.max(1, Math.min(1440, Math.floor(Number(raw.window_minutes) || 20)));
      const resource = clean(raw.resource, 160) || `platform:${source}`;
      const details = {
        ...objectDetails(raw.details),
        detection_source: "supabase_platform_logs",
        request_id: requestId,
        source,
        monitor_window_start: clean(body.window_start, 80),
        monitor_window_end: clean(body.window_end, 80),
      };
      const result = await recordAndNotifySecurityIncident(admin, {
        alertType: alertType as "rate_limit" | "login_bruteforce" | "error_threshold" | "suspicious_file",
        severity,
        title: clean(raw.title, 300) || "Supabase 平台層異常",
        message: clean(raw.message, 1800) || "Supabase 平台日誌達到異常門檻。",
        resource,
        eventCount,
        windowMinutes,
        details,
        notificationToggleKey: alertType === "error_threshold" ? "line_notify_error_threshold" : "line_notify_security_alerts",
        notificationCooldownMinutes: PLATFORM_NOTIFICATION_COOLDOWN_MINUTES,
      });
      outcomes.push({
        source,
        alert_id: result.alert.alert_id,
        delivery_status: result.delivery.status,
      });
    }

    const monitorError = clean(body.monitor_error, 500);
    if (monitorError) {
      const result = await recordAndNotifySecurityIncident(admin, {
        alertType: "error_threshold",
        severity: "critical",
        title: "Supabase 平台日誌監測失敗",
        message: `管理 API 日誌查詢失敗：${monitorError}`,
        resource: "platform:management_api",
        eventCount: 1,
        windowMinutes: 20,
        details: {
          detection_source: "supabase_platform_logs_monitor",
          request_id: requestId,
          error: monitorError,
        },
        notificationToggleKey: "line_notify_error_threshold",
        notificationCooldownMinutes: 30,
      });
      outcomes.push({
        source: "management_api",
        alert_id: result.alert.alert_id,
        delivery_status: result.delivery.status,
      });
    }
    return reply({
      ok: true,
      state: outcomes.length ? "alerted" : "healthy",
      request_id: requestId,
      alerts: outcomes,
    });
  } catch (error) {
    console.error("Platform log alert failed", error instanceof Error ? error.message : String(error));
    return reply({ ok: false, state: "degraded", request_id: requestId, message: "平台日誌告警處理失敗" }, 500);
  }
});
