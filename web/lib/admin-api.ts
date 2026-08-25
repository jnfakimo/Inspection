import { getSupabase } from '@/lib/supabase';
import { emitSecurityDataRead } from '@/lib/security-audit-sink';

const nodeAppApiUrl = process.env.NEXT_PUBLIC_APP_API_URL?.trim().replace(/\/$/, '');
const READ_ACTION_LABELS: Record<string, string> = {
  admin_get_settings: '讀取系統設定',
  admin_list_account_applications: '讀取帳號申請清單',
};

const recordAdminRead = (action: string) => {
  const label = READ_ACTION_LABELS[action];
  if (label) emitSecurityDataRead(label);
};

export async function invokeAdminApi<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}) {
  const client = getSupabase();
  if (nodeAppApiUrl) {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (sessionError || !accessToken) throw new Error('登入狀態無效，請重新登入');

    let response: Response | undefined;
    try {
      response = await fetch(`${nodeAppApiUrl}/api/admin-api`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, ...payload }),
        cache: 'no-store',
      });
    } catch {
      console.warn('Node.js admin API connection failed, falling back to Supabase Edge Function');
    }

    if (response) {
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) throw new Error(result?.message || '後台管理服務回傳失敗');
      recordAdminRead(action);
      return result as T;
    }
  }

  const { data, error } = await client.functions.invoke('admin-api', { body: { action, ...payload } });
  if (error) {
    let detail = '';
    const response = (error as unknown as { context?: Response }).context;
    if (response?.clone) {
      try {
        const body = await response.clone().json() as { message?: string; error?: string };
        detail = body.message || body.error || '';
      } catch { /* use the SDK message below */ }
    }
    throw new Error(detail || error.message || '後台管理服務連線失敗');
  }
  recordAdminRead(action);
  return data as T;
}
