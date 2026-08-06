import md5 from "npm:md5@2.3.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.7";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

function textResponse(message: string, status = 500) {
  return new Response(message, {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function fetchWithTimeout(url: URL, init: RequestInit = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parseDigestHeader(header: string) {
  const value = header.replace(/^Digest\s+/i, "");
  const parts: Record<string, string> = {};
  const pattern = /([a-z0-9_-]+)=(?:"([^"]*)"|([^,\s]*))/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    parts[match[1]] = match[2] ?? match[3] ?? "";
  }
  return parts;
}

function digestAuthorization(params: Record<string, string>, method: string, url: URL, username: string, password: string) {
  const realm = params.realm;
  const nonce = params.nonce;
  if (!realm || !nonce) throw new Error("IPCAM digest challenge missing realm or nonce");

  const uri = url.pathname + url.search;
  const qop = (params.qop || "").split(",").map((item) => item.trim()).find((item) => item === "auth");
  const nc = "00000001";
  const cnonce = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const fields: Record<string, string> = {
    username,
    realm,
    nonce,
    uri,
    response,
  };
  if (params.opaque) fields.opaque = params.opaque;
  if (params.algorithm) fields.algorithm = params.algorithm;
  if (qop) {
    fields.qop = qop;
    fields.nc = nc;
    fields.cnonce = cnonce;
  }

  return "Digest " + Object.entries(fields)
    .map(([key, value]) => key === "qop" || key === "nc" || key === "algorithm" ? `${key}=${value}` : `${key}="${value}"`)
    .join(", ");
}

async function fetchIpcamFrame(targetUrl: URL, username: string, password: string) {
  const first = await fetchWithTimeout(targetUrl, { headers: { "Cache-Control": "no-cache" } });
  if (first.status !== 401) return first;

  const challenge = first.headers.get("www-authenticate") || "";
  if (!/^Digest/i.test(challenge)) return first;

  const auth = digestAuthorization(parseDigestHeader(challenge), "GET", targetUrl, username, password);
  return fetchWithTimeout(targetUrl, {
    headers: {
      Authorization: auth,
      "Cache-Control": "no-cache",
    },
  });
}

async function isAuthorized(req: Request) {
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return false;
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: { user } } = await db.auth.getUser(bearer);
  if (!user) return false;
  const { data: profile } = await db.from("users")
    .select("rbac_role,role,status")
    .eq("auth_id", user.id).maybeSingle();
  if (!profile || profile.status !== "active") return false;
  const role = profile.rbac_role || (profile.role === "admin" ? "sysadmin" : profile.role);
  if (role === "sysadmin") return true;
  const { data: permission } = await db.from("role_permissions")
    .select("allowed").eq("role_id", role).eq("perm", "sys_admin").maybeSingle();
  return permission?.allowed === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (!await isAuthorized(req)) return textResponse("Unauthorized", 401);
    const requestUrl = new URL(req.url);
    if (requestUrl.searchParams.get("health") === "1") {
      return jsonResponse({ ok: true, fn: "ipcam-proxy", time: new Date().toISOString() });
    }

    const target = new URL(Deno.env.get("IPCAM_JPEG_URL") || "http://1.34.250.22:8085/ipcam/jpegcif");
    target.searchParams.set("ts", Date.now().toString());

    const username = Deno.env.get("IPCAM_USERNAME");
    const password = Deno.env.get("IPCAM_PASSWORD");
    if (!username || !password) {
      return textResponse("IPCAM secrets are not configured", 500);
    }

    const upstream = await fetchIpcamFrame(target, username, password);
    if (!upstream.ok) {
      return textResponse(`IPCAM upstream failed: ${upstream.status}`, upstream.status);
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": contentType,
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("IPCAM proxy error:", message);
    return textResponse("IPCAM proxy unavailable", 502);
  }
});
