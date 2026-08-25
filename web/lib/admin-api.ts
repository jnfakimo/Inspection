import { getSupabase } from '@/lib/supabase';
import { emitSecurityDataRead } from '@/lib/security-audit-sink';

const nodeAppApiUrl = process.env.NEXT_PUBLIC_APP_API_URL?.trim().replace(/\/$/, '');
// Render 冷啟動或短暫故障時，後台不應無限卡住；逾時後改走 Edge Function。
const NODE_API_TIMEOUT_MS = 5000;
const READ_ACTION_LABELS: Record<string, string> = {
  admin_get_settings: '讀取系統設定',
  admin_list_account_applications: '讀取帳號申請清單',
};

const recordAdminRead = (action: string) => {
  const label = READ_ACTION_LABELS[action];
  if (label) emitSecurityDataRead(label);
};

const isTransientNodeResponse = (response: Response) => (
  response.status === 408 || response.status === 429 || response.status >= 500
);

export async function invokeAdminApi<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}) {
  const client = getSupabase();
  if (nodeAppApiUrl) {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (sessionError || !accessToken) throw new Error('登入狀態無效，請重新登入');

    let response: Response | undefined;
    let timeoutId: number | undefined;
    try {
      const controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), NODE_API_TIMEOUT_MS);
      response = await fetch(`${nodeAppApiUrl}/api/admin-api`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, ...payload }),
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch {
      console.warn('Node.js admin API connection timed out or failed; falling back to Supabase Edge Function');
    } finally {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    }

    if (response && !isTransientNodeResponse(response)) {
      const result = await response.json().catch(() => null) as { ok?: boolean; message?: string } | null;
      const actionNotAvailableDuringRollout = response.status === 400
        && result?.message === '不支援的後台管理動作';
      if (!actionNotAvailableDuringRollout) {
        if (!response.ok || !result?.ok) throw new Error(result?.message || '後台管理服務回傳失敗');
        recordAdminRead(action);
        return result as T;
      }
      // Render 與 Edge Function 是兩條獨立部署線。新前端在 Node API 尚未
      // 完成滾動更新時，只針對「未知動作」改走已部署的 Edge 版本；該
      // 回覆發生於任何業務寫入之前，因此不會造成同一動作重複執行。
      console.warn('Node.js admin API does not support this action yet; falling back to Supabase Edge Function');
    }
    if (response && isTransientNodeResponse(response)) {
      console.warn(`Node.js admin API returned ${response.status}; falling back to Supabase Edge Function`);
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
