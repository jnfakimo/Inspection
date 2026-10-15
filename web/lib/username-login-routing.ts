const IPV4_HOSTNAME = /^(?:\d{1,3}\.){3}\d{1,3}$/u;
const IPV4_LOOPBACK = /^127(?:\.\d{1,3}){3}$/u;

// A non-loopback IPv4 host may be a self-hosted reverse proxy. Local development
// loopback hosts must use the configured Supabase Functions client instead.
export function shouldUseSameOriginUsernameLogin(hostname: string): boolean {
  return IPV4_HOSTNAME.test(hostname) && !IPV4_LOOPBACK.test(hostname);
}
