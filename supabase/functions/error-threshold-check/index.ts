// 系統錯誤爆量監測：後端建立永久告警、站內通知與 LINE 送達歷程。
// GitHub Actions 排程若延遲，會從上次成功檢查點回頭掃描滑動視窗，
// 不再只看「執行當下的前 15 分鐘」而漏掉排程間的高峰。
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.2";
import {
  recordAndNotifySecurityIncident,
  saveSecurityIncident,
  securityRequestId,
} from "../_shared/security-monitor.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-cron-secret",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
const safeEqual = (a: string, b: string) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
};
const clean = (value: unknown, max = 500) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const integerSetting = (
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
};

async function authorized(req: Request, db: any) {
  const cron = Deno.env.get("CRON_SECRET") || "";
  if (cron && safeEqual(req.headers.get("x-cron-secret") || "", cron)) {
    return true;
  }
  const bearer = (req.headers.get("authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  ).trim();
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  // admin-api 的「測試通知」由受信任 Edge Function 以 service role 呼叫。
  if (serviceRole && safeEqual(bearer, serviceRole)) return true;
  if (!bearer) return false;
  const { data: { user } } = await db.auth.getUser(bearer);
  if (!user) return false;
  const { data: profile } = await db.from("users")
    .select("role,rbac_role,status").eq("auth_id", user.id).maybeSingle();
  return profile?.status === "active" &&
    (profile.role === "admin" ||
      ["admin", "sysadmin"].includes(profile.rbac_role || ""));
}

async function updateSetting(db: any, key: string, value: string) {
  const { error } = await db.from("system_settings")
    .upsert({ key, value, updated_at: new Date().toISOString() }, {
      onConflict: "key",
    });
  if (error) throw error;
}

async function sendTestLine(token: string, groupId: string, settings: {
  windowMinutes: number;
  threshold: number;
  cooldownMinutes: number;
}) {
  const text = [
    "🧪 北農系統錯誤告警測試",
    "這是系統管理員主動發送的測試訊息，不代表當前正在發生異常。",
    `統計視窗：${settings.windowMinutes} 分鐘`,
    `錯誤門檻：${settings.threshold} 筆`,
    `正式冷卻：${settings.cooldownMinutes} 分鐘`,
    "測試不會建立正式告警，也不會改變冷卻時間。",
  ].join("\n");
  let responseStatus: number | null = null;
  let responseText = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        signal: AbortSignal.timeout(5000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: groupId,
          messages: [{ type: "text", text }],
        }),
      });
      responseStatus = response.status;
      responseText = await response.text();
      if (response.ok) return { ok: true, http_status: response.status };
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      responseText = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.error(
    "LINE error-threshold test failed",
    responseStatus,
    clean(responseText, 300),
  );
  return { ok: false, http_status: responseStatus };
}

type ErrorRow = { occurred_at: string; kind: string | null };
const ERROR_KIND_LABELS: Record<string, string> = {
  js_error: "JavaScript 程式錯誤",
  unhandled_rejection: "未處理的非同步錯誤",
  manual: "重要功能異常",
  unknown: "未分類",
};

async function loadRecentErrorRows(db: any, since: string, until: string) {
  const collected: ErrorRow[] = [];
  const pageSize = 1000;
  const maximumRows = 5000;
  for (let offset = 0; offset < maximumRows; offset += pageSize) {
    const { data, error } = await db.from("client_error_logs")
      .select("occurred_at,kind")
      .gte("occurred_at", since)
      .lte("occurred_at", until)
      .order("occurred_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const page = (data || []) as ErrorRow[];
    collected.push(...page);
    if (page.length < pageSize) break;
  }
  // 分頁以最新為起點，滑動視窗計算前再恢復時間正序。
  return {
    rows: collected.reverse(),
    truncated: collected.length >= maximumRows,
  };
}

function peakWindow(
  rows: ErrorRow[],
  windowMinutes: number,
  lastCheckedAt: number | null,
) {
  const windowMs = windowMinutes * 60_000;
  let left = 0;
  let bestStart = 0;
  let bestEnd = -1;
  for (let right = 0; right < rows.length; right += 1) {
    const rightTime = new Date(rows[right].occurred_at).getTime();
    while (
      left <= right &&
      rightTime - new Date(rows[left].occurred_at).getTime() > windowMs
    ) left += 1;
    // 回溯資料只用來補齊視窗左邊；高峰結束點必須是上次成功檢查後才發生。
    if (lastCheckedAt && rightTime <= lastCheckedAt) continue;
    if (bestEnd < bestStart || right - left > bestEnd - bestStart) {
      bestStart = left;
      bestEnd = right;
    }
  }
  const selected = bestEnd >= bestStart
    ? rows.slice(bestStart, bestEnd + 1)
    : [];
  return {
    count: selected.length,
    rows: selected,
    startedAt: selected[0]?.occurred_at || null,
    endedAt: selected[selected.length - 1]?.occurred_at || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== "POST") {
    return reply({ ok: false, state: "degraded", message: "僅支援 POST" }, 405);
  }
  const requestId = securityRequestId();
  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    if (!await authorized(req, db)) {
      return reply({ ok: false, state: "degraded", message: "未授權" }, 401);
    }
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const { data: rows, error: settingsError } = await db.from(
      "system_settings",
    )
      .select("key,value")
      .in("key", [
        "line_notify_error_threshold",
        "line_channel_token",
        "line_group_id",
        "error_threshold_window_minutes",
        "error_threshold_count",
        "error_threshold_cooldown_minutes",
        "error_threshold_last_notified",
        "error_threshold_last_checked_at",
      ]);
    if (settingsError) throw settingsError;
    const settings = Object.fromEntries(
      (rows || []).map((
        row: { key: unknown; value: unknown },
      ) => [String(row.key), String(row.value ?? "")]),
    );
    const windowMinutes = integerSetting(
      body.window_minutes ?? settings.error_threshold_window_minutes,
      15,
      1,
      1440,
    );
    const threshold = integerSetting(
      body.threshold_count ?? settings.error_threshold_count,
      20,
      1,
      5000,
    );
    const cooldownMinutes = integerSetting(
      body.cooldown_minutes ?? settings.error_threshold_cooldown_minutes,
      60,
      1,
      10080,
    );

    if (body.test === true) {
      if (!settings.line_channel_token || !settings.line_group_id) {
        return reply({
          ok: false,
          state: "degraded",
          message: "LINE Token 或群組 ID 尚未設定",
        }, 503);
      }
      const test = await sendTestLine(
        settings.line_channel_token,
        settings.line_group_id,
        {
          windowMinutes,
          threshold,
          cooldownMinutes,
        },
      );
      if (!test.ok) {
        return reply({
          ok: false,
          state: "degraded",
          message: "測試 LINE 通知發送失敗",
          http_status: test.http_status,
        }, 502);
      }
      return reply({
        ok: true,
        state: "test_sent",
        message: "測試 LINE 通知已送達；未建立正式告警，也未變更冷卻時間",
        http_status: test.http_status,
      });
    }

    const enabled = settings.line_notify_error_threshold === "true";
    if (!enabled && body.force !== true) {
      // 排程監測被關閉屬於退化狀態，必須讓 GitHub Actions 失敗，不可偽綠。
      return reply({
        ok: false,
        state: "disabled",
        message: "系統錯誤門檻監測已停用",
      }, 503);
    }

    const now = Date.now();
    const parsedLastChecked = settings.error_threshold_last_checked_at
      ? new Date(settings.error_threshold_last_checked_at).getTime()
      : NaN;
    const lastCheckedAt = Number.isFinite(parsedLastChecked)
      ? parsedLastChecked
      : null;
    const ordinaryStart = now - windowMinutes * 60_000;
    const catchupStart = lastCheckedAt
      ? lastCheckedAt - windowMinutes * 60_000
      : ordinaryStart;
    // 避免因設定錯誤一次載入無上限歷史；最多回溯 24 小時。
    const scanStart = Math.max(
      now - 24 * 60 * 60_000,
      Math.min(ordinaryStart, catchupStart),
    );
    const loadedErrors = await loadRecentErrorRows(
      db,
      new Date(scanStart).toISOString(),
      new Date(now).toISOString(),
    );
    const normalizedRows = loadedErrors.rows;
    const peak = peakWindow(normalizedRows, windowMinutes, lastCheckedAt);
    const forced = body.force === true;

    if (body.dryRun === true) {
      return reply({
        ok: true,
        state: "dry_run",
        request_id: requestId,
        peak_count: peak.count,
        threshold,
        window_minutes: windowMinutes,
        catchup_from: new Date(scanStart).toISOString(),
      });
    }

    if (peak.count < threshold && !forced) {
      await updateSetting(
        db,
        "error_threshold_last_checked_at",
        new Date(now).toISOString(),
      );
      return reply({
        ok: true,
        state: "healthy",
        message: "錯誤量未達通知門檻",
        request_id: requestId,
        peak_count: peak.count,
        threshold,
        window_minutes: windowMinutes,
        catchup_from: new Date(scanStart).toISOString(),
      });
    }

    const kindCounts: Record<string, number> = {};
    for (const row of peak.rows) {
      const kind = clean(row.kind || "unknown", 80) || "unknown";
      kindCounts[kind] = (kindCounts[kind] || 0) + 1;
    }
    const kindText = Object.entries(kindCounts).map(([kind, count]) =>
      `${ERROR_KIND_LABELS[kind] || "其他異常"}：${count} 筆`
    ).join("、") || "無分類明細";
    const message =
      `任一 ${windowMinutes} 分鐘視窗內最高發生 ${peak.count} 筆前端錯誤（門檻 ${threshold}）。${kindText}`;
    const spec = {
      alertType: "error_threshold" as const,
      severity: "critical" as const,
      title: "系統錯誤達異常門檻",
      message,
      resource: "client_error_logs",
      eventCount: Math.max(1, peak.count),
      windowMinutes,
      details: {
        detection_basis: "server_side_sliding_error_window",
        request_id: requestId,
        threshold,
        peak_started_at: peak.startedAt,
        peak_ended_at: peak.endedAt,
        kind_counts: kindCounts,
        catchup_from: new Date(scanStart).toISOString(),
        scanned_rows: normalizedRows.length,
        scan_truncated: loadedErrors.truncated,
      },
      ipAddress: null,
      notificationToggleKey: "line_notify_error_threshold" as const,
      notificationCooldownMinutes: cooldownMinutes,
    };

    const parsedLastNotified = settings.error_threshold_last_notified
      ? new Date(settings.error_threshold_last_notified).getTime()
      : NaN;
    const inCooldown = Number.isFinite(parsedLastNotified) &&
      now - parsedLastNotified < cooldownMinutes * 60_000;
    if (inCooldown && !forced) {
      const alert = await saveSecurityIncident(db, spec);
      await updateSetting(
        db,
        "error_threshold_last_checked_at",
        new Date(now).toISOString(),
      );
      return reply({
        ok: true,
        state: "cooldown",
        message: "告警已永久記錄，LINE 仍在冷卻時間內",
        request_id: requestId,
        alert_id: alert.alert_id,
        peak_count: peak.count,
        threshold,
        last_notified: settings.error_threshold_last_notified,
      });
    }

    const { alert, delivery } = await recordAndNotifySecurityIncident(db, spec);
    if (delivery.status === "sent") {
      // 只有 LINE 真正送達後才進入冷卻；失敗不會壓掉下次重試。
      if (!forced) {
        await updateSetting(
          db,
          "error_threshold_last_notified",
          new Date(now).toISOString(),
        );
      }
      await updateSetting(
        db,
        "error_threshold_last_checked_at",
        new Date(now).toISOString(),
      );
      return reply({
        ok: true,
        state: "alert_sent",
        message: "錯誤告警已永久記錄並送達 LINE",
        request_id: requestId,
        alert_id: alert.alert_id,
        peak_count: peak.count,
        threshold,
      });
    }
    if (delivery.status === "cooldown") {
      await updateSetting(
        db,
        "error_threshold_last_checked_at",
        new Date(now).toISOString(),
      );
      return reply({
        ok: true,
        state: "cooldown",
        message: "告警已永久記錄，重複 LINE 通知已抑制",
        request_id: requestId,
        alert_id: alert.alert_id,
        peak_count: peak.count,
        threshold,
      });
    }
    return reply({
      ok: false,
      state: "degraded",
      message: delivery.status === "not_configured"
        ? "告警已記錄，但 LINE Token 或群組 ID 尚未設定"
        : delivery.status === "disabled"
        ? "告警已記錄，但 LINE 錯誤門檻通知已關閉"
        : "告警已記錄，但 LINE 送達失敗，下次排程會重試",
      request_id: requestId,
      alert_id: alert.alert_id,
      delivery_status: delivery.status,
      peak_count: peak.count,
      threshold,
    }, 502);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : typeof error === "object" && error
      ? JSON.stringify(error)
      : String(error);
    console.error("Error threshold check failed", clean(message, 500));
    return reply({
      ok: false,
      state: "degraded",
      message: "錯誤門檻監測服務暫時無法使用",
      request_id: requestId,
    }, 500);
  }
});
