const cleanIp = (value: unknown, max = 80) => String(value ?? "")
  .replace(/[\u0000-\u001f]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

export const normalizeProxyIp = (value: unknown) => {
  const candidate = cleanIp(value);
  if (!candidate) return null;

  const bracketedIpv6 = candidate.match(/^\[([0-9a-f:.]+)\](?::\d+)?$/i);
  if (bracketedIpv6) return bracketedIpv6[1];

  const ipv4WithPort = candidate.match(/^((?:\d{1,3}\.){3}\d{1,3}):\d+$/);
  if (ipv4WithPort) return ipv4WithPort[1];

  return candidate;
};

export const clientIpFromRequest = (req: Request) => {
  const raw = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for") ||
    req.headers.get("fly-client-ip") ||
    "";
  return normalizeProxyIp(raw.split(",")[0]);
};
