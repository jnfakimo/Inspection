import type { Session, SupabaseClient } from '@supabase/supabase-js';

const CHANNEL = 'inspection-patrol-session-v2';
type Identity = { user_id: string } | null;
export function installSessionResponder(client: SupabaseClient, current: () => Identity) {
  let channel: BroadcastChannel;
  try { channel = new BroadcastChannel(CHANNEL); } catch { return () => {}; }
  channel.onmessage = async ({ data }) => {
    if (data?.type !== 'request' || typeof data.id !== 'string' || data.user_id !== current()?.user_id) return;
    try {
      const { data: result, error } = await client.auth.getSession();
      const session = result.session;
      if (error || !session || session.user.id !== data.user_id || current()?.user_id !== data.user_id) return;
      channel.postMessage({ type:'response', id:data.id, user_id:data.user_id, access_token:session.access_token, refresh_token:session.refresh_token });
    } catch { /* A closed page or unavailable Auth must not transfer credentials. */ }
  };
  return () => channel.close();
}
export function requestSessionCredentials(userId: string): Promise<Pick<Session, 'access_token' | 'refresh_token'> | null> {
  return new Promise(resolve => {
    let channel: BroadcastChannel;
    let id: string;
    try { channel = new BroadcastChannel(CHANNEL); id = crypto.randomUUID(); } catch { resolve(null); return; }
    const finish = (value: Pick<Session, 'access_token' | 'refresh_token'> | null) => { clearTimeout(timer); channel.close(); resolve(value); };
    channel.onmessage = ({ data }) => {
      if (data?.type !== 'response' || data.id !== id || data.user_id !== userId) return;
      if (typeof data.access_token === 'string' && data.access_token && typeof data.refresh_token === 'string' && data.refresh_token) finish({access_token:data.access_token,refresh_token:data.refresh_token});
    };
    const timer = setTimeout(() => finish(null), 1500);
    channel.postMessage({type:'request',id,user_id:userId});
  });
}
