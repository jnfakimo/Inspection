import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';

/**
 * app-api 各業務 handler 共用的請求內容。index.ts 驗證身分、算完權限後建立一次，
 * 以參數傳給 handlers/*.ts，業務程式因此不再依賴 index.ts 裡的閉包變數，也能單獨測試。
 */
export type AppApiContext = {
  req: Request;
  // body 來自 req.json()、profile 來自未帶資料庫型別的查詢，在 index.ts 內本來就是 any；
  // 這裡維持相同寬度，搬移前後的型別檢查結果才會完全一致。
  // deno-lint-ignore no-explicit-any
  body: any;
  // deno-lint-ignore no-explicit-any
  profile: any;
  admin: SupabaseClient;
  userDb: SupabaseClient;
  reply: (req: Request, body: unknown, status?: number) => Response;
  can: (system: string) => boolean;
  // 注意：子系統權限表查詢失敗時，index.ts 的 canModule 會回傳錯誤物件（真值）而非 boolean，
  // 效果是沿用大系統權限放行。這是四層授權導入時的過渡期降級行為，型別照實保留，不在拆檔時更動。
  canModule: (systemKey: string, moduleKey: string) => boolean | { message: string };
  isAdmin: boolean;
  isSysadmin: boolean;
};
