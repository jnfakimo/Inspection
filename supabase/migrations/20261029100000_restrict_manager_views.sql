-- 2026-10-29 資安修正：管理報表 view 只開給 office_manager，不開給網站登入使用者。
--
-- 問題：這 11 個 view 的擁有者是 postgres（以擁有者權限執行，會繞過底層資料表的 RLS），
-- 但 Supabase 預設把新物件的 SELECT／INSERT／UPDATE／DELETE 等權限都授給 authenticated，
-- 結果任何登入的帳號（包含最低權限的報修人員）都能透過 /rest/v1/<view名稱> 讀到全部報修、
-- 巡檢、維修單與設備費用；其中 vw_manager_equipment 還是可更新的 view，可繞過 equipment 的 RLS 寫入。
-- 網站、Edge Function、資料庫函式都沒有使用這些 view（已逐一查證），它們只供 LibreOffice 以 office_manager 角色唯讀報表。
--
-- 作法：收回 anon、authenticated 與 PUBLIC 的全部權限；office_manager 的 SELECT 授權不動。
-- 只調整權限，不動資料、不刪除任何物件。若日後需要開放，必須逐一明確授權並在 PR 說明。
begin;

revoke all on table
  public.equipment_annual_cost_summary,
  public.equipment_central_monitoring_registry,
  public.equipment_lifecycle_overview,
  public.vw_manager_abnormal_inspections,
  public.vw_manager_equipment,
  public.vw_manager_inspections,
  public.vw_manager_maintenance_orders,
  public.vw_manager_monthly_kpi,
  public.vw_manager_open_repairs,
  public.vw_manager_repairs,
  public.vw_manager_today_inspections
from public, anon, authenticated;

commit;
