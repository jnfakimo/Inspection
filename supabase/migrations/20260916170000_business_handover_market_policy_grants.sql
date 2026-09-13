begin;

-- 20260916132000 將業管組交接表的 RLS 規則改為呼叫 business_market_allowed()，卻把該函式從
-- authenticated 收回執行權而未再授權。RLS 規則以查詢者身分呼叫函式，因此所有登入使用者（含系統管理員）
-- 直接讀寫業管組交接紀錄、交班、完成與批核時一律得到 permission denied for function，
-- 頁面顯示「目前帳號沒有執行此操作的權限」。
--
-- 1. business_market_allowed(市場) 只回答「目前使用者」能否使用該市場，授權給 authenticated 不外洩他人資訊。
-- 2. business_market_approval_allowed(使用者, 市場, 階段) 可傳入任意使用者，不開放給 authenticated；
--    批核規則原本就要求 approver_id = 目前使用者，改用只判斷自己的 business_market_can_approve()，結果相同。

grant execute on function public.business_market_allowed(text) to authenticated;

drop policy if exists business_handover_approvals_insert on public.business_handover_approvals;
create policy business_handover_approvals_insert on public.business_handover_approvals
  for insert to authenticated
  with check (approver_id = public.active_user_id() and public.business_market_can_approve(market_code, stage));

drop policy if exists business_handover_approvals_update on public.business_handover_approvals;
create policy business_handover_approvals_update on public.business_handover_approvals
  for update to authenticated
  using (public.business_market_allowed(market_code))
  with check (approver_id = public.active_user_id() and public.business_market_can_approve(market_code, stage));

notify pgrst, 'reload schema';

commit;
