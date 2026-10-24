const cleanIp = (value: unknown, max = 80) => String(value ?? "")
  .replace(/[\u0000-\u001f]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

export const normalizeProxyIp = (value: unknown) => {
  const candidate = cleanIp(value);
  if (!candidate) return null;

  const bracketedIpv6 = candidate.match(/^\[([0-9a-f:.]+)\](?::\d+)?$/i);
  const unwrapped = bracketedIpv6?.[1] || candidate;

  const ipv4WithPort = unwrapped.match(/^((?:\d{1,3}\.){3}\d{1,3}):\d+$/);
  const address = ipv4WithPort?.[1] || unwrapped;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
    const octets = address.split('.').map(Number);
    return octets.every(octet => octet >= 0 && octet <= 255) ? address : null;
  }
  if (!/^[0-9a-f:]+$/i.test(address) || !address.includes(':')) return null;
  try { return new URL(`http://[${address}]/`).hostname.slice(1, -1); }
  catch { return null; }
};

export const clientIpFromRequest = (req: Request) => {
  const raw = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for") ||
    req.headers.get("fly-client-ip") ||
    "";
  // Only the first hop may represent a client. The gateway must replace any caller-supplied
  // forwarding headers; otherwise these fields are untrusted and cannot protect rate limits.
  return normalizeProxyIp(raw.split(",")[0]);
};
