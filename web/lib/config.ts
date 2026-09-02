const CLOUD_SUPABASE_URL = 'https://qztffronusdhgxhjjubt.supabase.co';
const CLOUD_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dGZmcm9udXNkaGd4aGpqdWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTI1MzgsImV4cCI6MjA5NzI2ODUzOH0.FnUxot5YXI3yKCUCmJA5P4ysEJhmtaQQA6rM7MRy3oA';

// Local/self-hosted builds inject these two public values at build time. Keeping
// the cloud defaults preserves the existing GitHub Pages build and rollback path.
const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || CLOUD_SUPABASE_URL;
// 本機站台可能透過路由器以不同外部埠（例如 5443）提供服務；瀏覽器端
// 必須沿用目前頁面的 origin，否則手機 4G/5G 會把 API 呼叫送到內網 IP。
const isLocalBuild = /^https?:\/\/(?:192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(configuredSupabaseUrl);
export const SUPABASE_URL = typeof window !== 'undefined' && isLocalBuild
  ? window.location.origin
  : configuredSupabaseUrl;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || CLOUD_SUPABASE_ANON_KEY;
export const LEGACY_BASE = '/Inspection/system';
// 第一果菜市場。markets 只有 market1／market2 兩列（system/sql/locations_schema.sql:66），
// floor_spaces 與 locations 的 market_id 都是 references markets(market_id)。
export const MARKET_ID = 'market1';
