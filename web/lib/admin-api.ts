import { getSupabase } from '@/lib/supabase';

export async function invokeAdminApi<T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}) {
  const client = getSupabase();
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
  return data as T;
}
