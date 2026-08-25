#!/usr/bin/env node

/**
 * Low-frequency, no-JavaScript synthetic probe for the V2 production edges.
 *
 * This process makes only one small, read-only request per endpoint. It does
 * not open a browser, execute page JavaScript, write application data, or
 * replay user traffic. Supabase traffic counts are read from the Management
 * Logs API so a short-lived volume spike is visible alongside the HTTP probe.
 */

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "qztffronusdhgxhjjubt";
const SUPABASE_URL = process.env.SUPABASE_URL ||
  `https://${PROJECT_REF}.supabase.co`;
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const MANAGEMENT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const ALERT_FUNCTION_URL = process.env.SYNTHETIC_PROBE_ALERT_FUNCTION_URL ||
  `https://${PROJECT_REF}.supabase.co/functions/v1/platform-log-alert`;
const WINDOW_MINUTES = integerEnv("SYNTHETIC_PROBE_WINDOW_MINUTES", 15, 5, 60);
const REQUEST_TIMEOUT_MS = integerEnv("SYNTHETIC_PROBE_TIMEOUT_MS", 15_000, 2_000, 60_000);
const LATENCY_WARNING_MS = integerEnv("SYNTHETIC_PROBE_LATENCY_WARNING_MS", 3_000, 100, 60_000);
const LATENCY_CRITICAL_MS = integerEnv("SYNTHETIC_PROBE_LATENCY_CRITICAL_MS", 10_000, 500, 120_000);
const EDGE_TRAFFIC_THRESHOLD = integerEnv("SYNTHETIC_EDGE_TRAFFIC_THRESHOLD", 300, 10, 100_000);
const STORAGE_TRAFFIC_THRESHOLD = integerEnv("SYNTHETIC_STORAGE_TRAFFIC_THRESHOLD", 100, 10, 100_000);
const NOW = new Date();
const WINDOW_START = new Date(NOW.getTime() - WINDOW_MINUTES * 60_000);
const MANAGEMENT_LOGS_URL =
  `https://api.supabase.com/v1/projects/${encodeURIComponent(PROJECT_REF)}` +
  "/analytics/endpoints/logs";

function integerEnv(name, fallback, minimum, maximum) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function clean(value, max = 500) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function requireEnv(name, value) {
  if (!value) throw new Error(`缺少必要的 GitHub Actions secret：${name}`);
}

function statusMatches(result, expected) {
  if (Array.isArray(expected)) return expected.includes(result.status);
  return expected(result.status);
}

const endpoints = [
  {
    key: "github_pages",
    name: "GitHub Pages V2 入口",
    url: process.env.SYNTHETIC_PAGES_URL || "https://jnfakimo.github.io/Inspection/",
    method: "HEAD",
    headers: { Accept: "text/html" },
    expected: (status) => status >= 200 && status < 400,
  },
  {
    key: "supabase_rest",
    name: "Supabase REST floor_models",
    url: `${SUPABASE_URL}/rest/v1/floor_models?select=floor_id&limit=1`,
    method: "GET",
    headers: {
      Accept: "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      Prefer: "count=none",
    },
    expected: (status) => status >= 200 && status < 300,
  },
  {
    key: "supabase_storage",
    name: "Supabase Storage floorplans 封鎖邊界",
    url: `${SUPABASE_URL}/storage/v1/object/public/floorplans/B1.png`,
    method: "HEAD",
    headers: { Accept: "*/*" },
    // floorplans is private. A request without a session must remain blocked.
    expected: [400],
    expectedBlockedStatus: true,
  },
];

async function requestEndpoint(endpoint) {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let status = 0;
  let error = null;
  try {
    const response = await fetch(endpoint.url, {
      method: endpoint.method,
      headers: endpoint.headers,
      redirect: "follow",
      signal: controller.signal,
    });
    status = response.status;
    // Do not download page or object bodies. The REST response is capped by
    // limit=1; cancelling it keeps this probe deliberately small.
    if (response.body) await response.body.cancel();
  } catch (caught) {
    error = caught?.name === "AbortError"
      ? `逾時（>${REQUEST_TIMEOUT_MS} ms）`
      : clean(caught instanceof Error ? caught.message : caught, 300);
  } finally {
    clearTimeout(timeout);
  }
  const latencyMs = Math.round(performance.now() - started);
  const expected = !error && statusMatches({ status }, endpoint.expected);
  const statusClass = error
    ? "network_error"
    : status >= 500
    ? "http_5xx"
    : status >= 400
    ? "http_4xx"
    : "success";
  return {
    key: endpoint.key,
    name: endpoint.name,
    url: endpoint.url,
    method: endpoint.method,
    status,
    status_class: statusClass,
    latency_ms: latencyMs,
    expected,
    expected_blocked_status: Boolean(endpoint.expectedBlockedStatus),
    error,
  };
}

const TRAFFIC_QUERY = `
SELECT
  source,
  count() AS request_count,
  countIf(
    toInt32OrZero(log_attributes['response.status_code']) >= 400
    OR toInt32OrZero(log_attributes['res.statusCode']) >= 400
  ) AS http_error_count
FROM logs
WHERE source IN ('edge_logs', 'storage_logs')
GROUP BY source`;

async function queryTraffic() {
  requireEnv("SUPABASE_ACCESS_TOKEN", MANAGEMENT_TOKEN);
  const params = new URLSearchParams({
    sql: TRAFFIC_QUERY,
    iso_timestamp_start: WINDOW_START.toISOString(),
    iso_timestamp_end: NOW.toISOString(),
  });
  const response = await fetch(`${MANAGEMENT_LOGS_URL}?${params}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${MANAGEMENT_TOKEN}`,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    throw new Error(`Supabase Logs API 查詢失敗：${clean(body.error || body.message || `HTTP ${response.status}`)}`);
  }
  const summary = {
    edge_logs: { request_count: 0, http_error_count: 0 },
    storage_logs: { request_count: 0, http_error_count: 0 },
  };
  for (const row of Array.isArray(body.result) ? body.result : []) {
    if (!summary[row.source]) continue;
    summary[row.source] = {
      request_count: Number(row.request_count) || 0,
      http_error_count: Number(row.http_error_count) || 0,
    };
  }
  return summary;
}

function endpointSignals(results) {
  return results.flatMap((result) => {
    const reasons = [];
    let severity = "warning";
    let alertType = "error_threshold";
    if (result.error) {
      reasons.push(result.error);
      severity = "critical";
    } else if (result.status >= 500) {
      reasons.push(`HTTP ${result.status}`);
      severity = "critical";
    } else if (!result.expected) {
      reasons.push(`未符合預期的 HTTP ${result.status}`);
      // A private floorplan becoming publicly readable is a security event,
      // not merely an availability failure.
      if (result.key === "supabase_storage" && result.status >= 200 && result.status < 300) {
        alertType = "suspicious_file";
        severity = "critical";
      }
    }
    if (result.latency_ms >= LATENCY_CRITICAL_MS) {
      reasons.push(`延遲 ${result.latency_ms} ms`);
      severity = "critical";
    } else if (result.latency_ms >= LATENCY_WARNING_MS) {
      reasons.push(`延遲 ${result.latency_ms} ms`);
    }
    if (!reasons.length) return [];
    return [{
      source: `synthetic:${result.key}`,
      alert_type: alertType,
      severity,
      title: `${result.name} synthetic probe 異常`,
      resource: `synthetic:${result.key}`,
      event_count: 1,
      window_minutes: WINDOW_MINUTES,
      message: `${result.name}：${reasons.join("；")}。請檢查 GitHub Pages／Supabase 平台日誌。`,
      details: {
        detection_basis: "no_javascript_synthetic_probe",
        window_start: WINDOW_START.toISOString(),
        window_end: NOW.toISOString(),
        method: result.method,
        url: result.url,
        status: result.status,
        status_class: result.status_class,
        expected: result.expected,
        expected_blocked_status: result.expected_blocked_status,
        latency_ms: result.latency_ms,
        error: result.error,
      },
    }];
  });
}

function trafficSignals(traffic) {
  const specs = [
    ["edge_logs", "API Gateway／REST", EDGE_TRAFFIC_THRESHOLD],
    ["storage_logs", "Storage", STORAGE_TRAFFIC_THRESHOLD],
  ];
  return specs.flatMap(([source, name, threshold]) => {
    const entry = traffic[source];
    if (entry.request_count < threshold) return [];
    return [{
      source: `synthetic:traffic:${source}`,
      alert_type: "error_threshold",
      severity: "warning",
      title: `${name} 流量突增`,
      resource: `synthetic:traffic:${source}`,
      event_count: entry.request_count,
      window_minutes: WINDOW_MINUTES,
      message: `${WINDOW_MINUTES} 分鐘內 ${name} 請求 ${entry.request_count} 次，達到 synthetic probe 流量門檻 ${threshold} 次。`,
      details: {
        detection_basis: "supabase_management_logs_volume_threshold",
        window_start: WINDOW_START.toISOString(),
        window_end: NOW.toISOString(),
        source,
        request_count: entry.request_count,
        http_error_count: entry.http_error_count,
        threshold,
      },
    }];
  });
}

async function sendToAlertFunction(signals, summary, monitorError = null) {
  requireEnv("SUPABASE_ANON_KEY", ANON_KEY);
  requireEnv("CRON_SECRET", CRON_SECRET);
  const response = await fetch(ALERT_FUNCTION_URL, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "x-cron-secret": CRON_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      request_id: clean(process.env.GITHUB_RUN_ID || `synthetic-${Date.now()}`, 100),
      window_start: WINDOW_START.toISOString(),
      window_end: NOW.toISOString(),
      signals,
      summary,
      monitor_error: monitorError ? clean(monitorError, 500) : null,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    throw new Error(`synthetic probe 告警 Edge Function 失敗：${clean(body.message || `HTTP ${response.status}`)}`);
  }
  return body;
}

async function main() {
  const results = await Promise.all(endpoints.map(requestEndpoint));
  let traffic = null;
  let monitorError = null;
  try {
    traffic = await queryTraffic();
  } catch (error) {
    monitorError = error instanceof Error ? error.message : String(error);
  }

  const signals = endpointSignals(results);
  if (traffic) signals.push(...trafficSignals(traffic));
  const summary = {
    endpoints: results.map((result) => ({
      key: result.key,
      status: result.status,
      status_class: result.status_class,
      expected: result.expected,
      latency_ms: result.latency_ms,
      error: result.error,
    })),
    traffic,
  };

  if (monitorError || signals.length) {
    const alert = await sendToAlertFunction(signals, summary, monitorError);
    console.log(JSON.stringify({
      ok: true,
      state: signals.length || monitorError ? "alerted" : "healthy",
      alert_state: alert.state,
      signal_count: signals.length,
      summary,
    }));
    return;
  }
  console.log(JSON.stringify({
    ok: true,
    state: "healthy",
    window_start: WINDOW_START.toISOString(),
    window_end: NOW.toISOString(),
    summary,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
