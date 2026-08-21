// app-api 走 Deno、從 esm.sh 取模組；tsc 看不懂網址型的 specifier，靠這份墊片把它
// 對回本機的 @supabase/supabase-js 型別。**app-api 第一行 import 了什麼，這裡就要
// 有什麼**——少一個名字就是 TS2305，而且只有 CI 的 typecheck:api 會發現。
declare module 'https://esm.sh/@supabase/supabase-js@2.112.2' {
  export { createClient, type SupabaseClient } from '@supabase/supabase-js';
}

