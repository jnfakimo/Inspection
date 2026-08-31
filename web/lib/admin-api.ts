import { getSupabase } from '@/lib/supabase';
import { emitSecurityDataRead } from '@/lib/security-audit-sink';

const nodeAppApiUrl = process.env.NEXT_PUBLIC_APP_API_URL?.trim().replace(/\/$/, '');
// Render 冷啟動或短暫故障時，後台不應無限卡住；逾時後改走 Edge Function。
const NODE_API_TIMEOUT_MS = 5000;
const REQUIRED_ADMIN_CONTRACT_VERSION = 2;
let nodeAdminContractCheck: Promise<boolean> | null = null;
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

async function nodeSupportsCurrentAdminContract(accessToken: string) {
  if (!nodeAppApiUrl) return false;
  if (!nodeAdminContractCheck) {
    nodeAdminContractCheck = (async () => {
      let timeoutId: number | undefined;
      try {
        const controller = new AbortController();
        timeoutId = window.setTimeout(() => controller.abort(), NODE_API_TIMEOUT_MS);
        const response = await fetch(`${nodeAppApiUrl}/api/admin-api`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'admin_get_contract' }),
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) return false;
        const result = await response.json().catch(() => null) as { ok?: boolean; data?: { contract_version?: number } } | null;
        return Boolean(result?.ok && Number(result.data?.contract_version || 0) >= REQUIRED_ADMIN_CONTRACT_VERSION);
      } catch {
        return false;
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      }
    })();
  }
  return nodeAdminContractCheck;
}

export async function invokeAdminApi<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}) {
  const client = getSupabase();
  // 後台清單／設定查詢直接走 Edge Function，避免 Render 冷啟動讓頁面先空等數秒。
  // 管理寫入仍保留原本的 Node-first 與 Edge 備援流程。
  if (nodeAppApiUrl && !READ_ACTION_LABELS[action]) {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    if (sessionError || !accessToken) throw new Error('登入狀態無效，請重新登入');

    if (await nodeSupportsCurrentAdminContract(accessToken)) {
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
        if (!response.ok || !result?.ok) throw new Error(result?.message || '後台管理服務回傳失敗');
        recordAdminRead(action);
        return result as T;
      }
      if (response && isTransientNodeResponse(response)) {
        console.warn(`Node.js admin API returned ${response.status}; falling back to Supabase Edge Function`);
      }
    } else {
      // 舊版 Node 會忽略 supervisor_id 等後來新增欄位。版本不符時
      // 在任何業務寫入前就改走 Edge，不會留下半套帳號資料。
      console.warn('Node.js admin API contract is outdated; falling back to Supabase Edge Function');
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
