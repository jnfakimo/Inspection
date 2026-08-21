-- 全面稽核修正（2026-08-20）
-- 對應本次掃描發現的 schema 層問題，於 SQL Editor 依序執行；全部冪等。

-- 1) repair_requests.source：app-api edge function 寫 'app-api'，放寬 CHECK 約束
alter table repair_requests drop constraint if exists repair_requests_source_check;
alter table repair_requests add constraint repair_requests_source_check check (source in ('inspection', 'direct', 'app-api'));

-- 2) repair_requests.status：補償路徑需把失敗單標記為 cancelled，加入合法值
alter table repair_requests drop constraint if exists repair_requests_status_check;
alter table repair_requests add constraint repair_requests_status_check check (status in ('pending', 'transferred', 'closed', 'cancelled'));

-- 3) handover_field_pilot_records：原本 for all 全開放，任何登入者可偽造交接內容與主管批示，
--    改為讀取全員可用、寫入限具 sys_handover 權限者（與 app-api 的 can('handover') 一致）。
alter table handover_field_pilot_records force row level security;
drop policy if exists "handover_field_pilot_authenticated" on handover_field_pilot_records;
drop policy if exists "handover_field_pilot_read" on handover_field_pilot_records;
drop policy if exists "handover_field_pilot_write" on handover_field_pilot_records;
drop policy if exists "handover_field_pilot_update" on handover_field_pilot_records;
create policy "handover_field_pilot_read" on handover_field_pilot_records for select to authenticated using (true);
create policy "handover_field_pilot_write" on handover_field_pilot_records for insert to authenticated with check (public.has_system_access('sys_handover'));
create policy "handover_field_pilot_update" on handover_field_pilot_records for update to authenticated using (public.has_system_access('sys_handover')) with check (public.has_system_access('sys_handover'));

-- 4) handover_field_pilot_audit：比照主表收緊，避免偽造稽核軌跡
alter table handover_field_pilot_audit force row level security;
drop policy if exists "handover_field_pilot_audit_authenticated" on handover_field_pilot_audit;
drop policy if exists "handover_field_pilot_audit_read" on handover_field_pilot_audit;
drop policy if exists "handover_field_pilot_audit_write" on handover_field_pilot_audit;
create policy "handover_field_pilot_audit_read" on handover_field_pilot_audit for select to authenticated using (true);
create policy "handover_field_pilot_audit_write" on handover_field_pilot_audit for insert to authenticated with check (public.has_system_access('sys_handover'));

-- 5) checkin_logs 防重複簽到兜底：同人同目標同一時間戳重複送出時由 DB 擋下
--    （應用層已有 5 分鐘檢查，此為併發重送的最後防線）
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'uq_checkin_dedup') then
    alter table checkin_logs add constraint uq_checkin_dedup unique (user_id, target_type, target_id, checkin_at);
  end if;
end $$;