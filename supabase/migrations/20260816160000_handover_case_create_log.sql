-- 建立交接簿案件時，自動寫入「建立案件」歷程。
--
-- 原本前端在 handover_cases insert 成功後另外 insert 一筆 handover_case_logs，
-- 且未接該次寫入的回傳值。兩者是獨立請求，log 失敗時案件仍會建立，歷程卻缺了
-- 起始的那一筆，而且沒有任何徵兆。
--
-- 改以 after insert trigger 在同一交易內寫入，前端不再負責這筆歷程，也就不可能
-- 遺漏。new_data 直接取整列（to_jsonb），較原本前端只放表單欄位更完整。
--
-- 與 handover_case_action 的分工：建立走本 trigger，後續的指派／狀態／重新開啟／
-- 進度說明走該函式。

begin;

create or replace function public.log_handover_case_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.handover_case_logs
    (case_id, action, content, new_data, created_by)
  values (
    new.case_id,
    'create',
    '案件建立：' || coalesce(nullif(btrim(coalesce(new.title, '')), ''), new.case_no),
    to_jsonb(new),
    new.created_by
  );
  return new;
end;
$$;

drop trigger if exists trg_log_handover_case_created on public.handover_cases;
create trigger trg_log_handover_case_created
  after insert on public.handover_cases
  for each row execute function public.log_handover_case_created();

commit;
