#!/usr/bin/env node

/**
 * Supabase unified Logs API monitor.
 *
 * The Management API token is supplied only by GitHub Actions.  This script
 * never writes the token to stdout, a file, Supabase, or an alert payload.
 */

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "qztffronusdhgxhjjubt";
const MANAGEMENT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const ALERT_FUNCTION_URL = process.env.PLATFORM_LOG_ALERT_FUNCTION_URL ||
  `https://${PROJECT_REF}.supabase.co/functions/v1/platform-log-alert`;
const WINDOW_MINUTES = integerEnv("PLATFORM_LOG_WINDOW_MINUTES", 20, 5, 60);
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

function requireEnv(name, value) {
  if (!value) throw new Error(`缺少必要的 GitHub Actions secret：${name}`);
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value, max = 240) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const SOURCE_CONFIG = {
  edge_logs: {
    title: "API Gateway 平台層異常",
    alertType: "error_threshold",
    severity: "warning",
    errorThreshold: integerEnv("PLATFORM_API_ERROR_THRESHOLD", 20, 1, 5000),
    volumeThreshold: integerEnv("PLATFORM_API_VOLUME_THRESHOLD", 1000, 10, 100000),
    errorLabel: "API 4xx／5xx",
  },
  storage_logs: {
    title: "Storage 平台層異常",
    alertType: "error_threshold",
    severity: "warning",
    errorThreshold: integerEnv("PLATFORM_STORAGE_ERROR_THRESHOLD", 10, 1, 5000),
    volumeThreshold: integerEnv("PLATFORM_STORAGE_VOLUME_THRESHOLD", 500, 10, 100000),
    errorLabel: "Storage 4xx／5xx",
  },
  auth_logs: {
    title: "Auth 平台層登入異常",
    alertType: "login_bruteforce",
    severity: "critical",
    signalThreshold: integerEnv("PLATFORM_AUTH_SIGNAL_THRESHOLD", 10, 1, 5000),
    errorLabel: "登入／授權錯誤訊號",
  },
  function_logs: {
    title: "Edge Function 平台層執行異常",
    alertType: "error_threshold",
    severity: "critical",
    signalThreshold: integerEnv("PLATFORM_FUNCTION_SIGNAL_THRESHOLD", 5, 1, 5000),
    errorLabel: "例外／逾時／失敗訊號",
  },
};

const LOG_QUERY = `
SELECT
  source,
  log_attributes['request.path'] AS path,
  count() AS request_count,
  countIf(
    toInt32OrZero(log_attributes['response.status_code']) >= 400
    OR toInt32OrZero(log_attributes['res.statusCode']) >= 400
  ) AS http_error_count,
  countIf(
    positionCaseInsensitive(event_message, 'error') > 0
    OR positionCaseInsensitive(event_message, 'exception') > 0
    OR positionCaseInsensitive(event_message, 'failed') > 0
    OR positionCaseInsensitive(event_message, 'denied') > 0
    OR positionCaseInsensitive(event_message, 'invalid') > 0
    OR positionCaseInsensitive(event_message, 'timeout') > 0
    OR positionCaseInsensitive(event_message, 'rate') > 0
  ) AS signal_count
FROM logs
WHERE source IN ('edge_logs', 'storage_logs', 'auth_logs', 'function_logs')
GROUP BY source, path
ORDER BY request_count DESC
LIMIT 2000`;

async function queryLogs() {
  const params = new URLSearchParams({
    sql: LOG_QUERY,
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
    const reason = clean(body.error || body.message || `HTTP ${response.status}`);
    throw new Error(`Supabase Logs API 查詢失敗：${reason}`);
  }
  return Array.isArray(body.result) ? body.result : [];
}

function summarize(rows) {
  const summaries = Object.fromEntries(
    Object.keys(SOURCE_CONFIG).map((source) => [source, {
      requestCount: 0,
      httpErrorCount: 0,
      signalCount: 0,
      paths: [],
    }]),
  );
  for (const row of rows) {
    const source = clean(row.source, 80);
    const summary = summaries[source];
    if (!summary) continue;
    summary.requestCount += finiteNumber(row.request_count);
    summary.httpErrorCount += finiteNumber(row.http_error_count);
    summary.signalCount += finiteNumber(row.signal_count);
    const path = clean(row.path, 180) || "(未標示路徑)";
    summary.paths.push({
      path,
      requestCount: finiteNumber(row.request_count),
      httpErrorCount: finiteNumber(row.http_error_count),
      signalCount: finiteNumber(row.signal_count),
    });
  }
  for (const summary of Object.values(summaries)) {
    summary.paths.sort((a, b) => b.requestCount - a.requestCount);
    summary.paths = summary.paths.slice(0, 5);
  }
  return summaries;
}

function buildSignals(summaries) {
  const signals = [];
  for (const [source, config] of Object.entries(SOURCE_CONFIG)) {
    const summary = summaries[source];
    const errorCount = Math.max(summary.httpErrorCount, summary.signalCount);
    const volumeHit = config.volumeThreshold &&
      summary.requestCount >= config.volumeThreshold;
    const errorHit = config.errorThreshold
      ? errorCount >= config.errorThreshold
      : summary.signalCount >= config.signalThreshold;
    if (!volumeHit && !errorHit) continue;

    const reasons = [];
    if (volumeHit) reasons.push(`請求 ${summary.requestCount} 次達 ${config.volumeThreshold} 次`);
    if (errorHit) reasons.push(`${config.errorLabel} ${errorCount} 次達 ${config.errorThreshold || config.signalThreshold} 次`);
    signals.push({
      source,
      alert_type: config.alertType,
      severity: config.severity,
      title: config.title,
      resource: `platform:${source}`,
      event_count: Math.max(summary.requestCount, errorCount, 1),
      window_minutes: WINDOW_MINUTES,
      message: `${WINDOW_MINUTES} 分鐘內${reasons.join("；")}。請檢查 Supabase Logs Explorer 與來源路徑。`,
      details: {
        detection_basis: "supabase_management_logs",
        window_start: WINDOW_START.toISOString(),
        window_end: NOW.toISOString(),
        request_count: summary.requestCount,
        http_error_count: summary.httpErrorCount,
        signal_count: summary.signalCount,
        top_paths: summary.paths,
      },
    });
  }
  return signals;
}

async function sendToAlertFunction(signals, summary, monitorError = null) {
  requireEnv("SUPABASE_ANON_KEY", ANON_KEY);
  requireEnv("CRON_SECRET", CRON_SECRET);
  const payload = {
    request_id: clean(process.env.GITHUB_RUN_ID || `actions-${Date.now()}`, 100),
    window_start: WINDOW_START.toISOString(),
    window_end: NOW.toISOString(),
    signals,
    summary,
    monitor_error: monitorError ? clean(monitorError, 500) : null,
  };
  const response = await fetch(ALERT_FUNCTION_URL, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "x-cron-secret": CRON_SECRET,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true) {
    throw new Error(`平台層告警 Edge Function 失敗：${clean(body.message || `HTTP ${response.status}`)}`);
  }
  return body;
}

async function main() {
  requireEnv("SUPABASE_ACCESS_TOKEN", MANAGEMENT_TOKEN);
  let rows;
  try {
    rows = await queryLogs();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const alert = await sendToAlertFunction([], {}, reason);
    console.error(JSON.stringify({ ok: false, state: "degraded", alert_state: alert.state }));
    process.exitCode = 1;
    return;
  }
  const summaries = summarize(rows);
  const signals = buildSignals(summaries);
  const compact = Object.fromEntries(Object.entries(summaries).map(([source, value]) => [source, {
    request_count: value.requestCount,
    http_error_count: value.httpErrorCount,
    signal_count: value.signalCount,
  }]));
  if (!signals.length) {
    console.log(JSON.stringify({
      ok: true,
      state: "healthy",
      window_start: WINDOW_START.toISOString(),
      window_end: NOW.toISOString(),
      summary: compact,
    }));
    return;
  }
  const alert = await sendToAlertFunction(signals, compact);
  console.log(JSON.stringify({
    ok: true,
    state: "alerted",
    alert_state: alert.state,
    signal_count: signals.length,
    summary: compact,
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
