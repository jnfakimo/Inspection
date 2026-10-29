-- 2026-10-29 資安加固：收回 anon 在 10 張資料表上多餘的權限，並讓日後新建的資料表預設不再授權給 anon。
--
-- 問題：Supabase 預設把 public 新物件的全部權限授給 anon，這 10 張表目前靠 RLS「沒有任何 anon policy」擋住（已用 anon 金鑰實打確認讀不到資料），
-- 但權限本身還在：account_applications 含姓名、Email、電話、來源 IP，official_documents 系列是公文資料。
-- 一旦某次維護誤把 RLS 關掉、或加了寬鬆的 policy，未登入者就能直接讀寫。網站、Edge Function 都不以 anon 身分存取這些表（無 anon policy 即證明沒有 anon 流程）。
--
-- 作法：只收回 anon 與 PUBLIC 的權限，authenticated／service_role 完全不動；
-- 並把 postgres（migration 的執行者）在 public schema 新建資料表時對 anon 的預設授權收回，日後要開放給 anon 必須明確 grant 並寫 policy。
-- 不刪資料表、不動資料。
begin;

revoke all on table
  public.account_applications,
  public.market_analysis_templates,
  public.market_data_points,
  public.market_data_sources,
  public.market_simulation_runs,
  public.official_document_events,
  public.official_document_notifications,
  public.official_document_steps,
  public.official_documents,
  public.weather_api_cache
from public, anon;

alter default privileges for role postgres in schema public revoke all on tables from anon;

commit;
