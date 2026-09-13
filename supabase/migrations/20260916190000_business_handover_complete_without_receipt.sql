begin;

-- 業管組「登記事項完成」規則調整（使用者 2026-09-16 決定）：
-- 原規則要求上一班已交班且由本班指定接班人本人確認接班後，才能由該接班人登記完成；
-- 改為該市場具業管組交接權限者，在目前當班即可登記完成，不必等待接班確認。
-- 仍保留：市場授權、只能在目前台灣當班登記、本班已交班後改由下一班處理、事項須屬本市場且未刪除，
-- 完成者與完成時間照常永久記錄。交班、接班確認規則不變。
-- 函式本體取自正式環境 pg_get_functiondef，僅移除上述兩項完成前檢查。

CREATE OR REPLACE FUNCTION public.business_market_action(p_market text, p_action text, p_date date, p_shift text, p_entry uuid DEFAULT NULL::uuid, p_receiver uuid DEFAULT NULL::uuid, p_revision text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=public.active_user_id(); actor_name text; receiver_name text;
  items jsonb; t public.business_handover_transfers; prev public.business_handover_transfers;
  target_date date; target_shift text; e public.business_handover_entries;
  taipei timestamp:=now() at time zone 'Asia/Taipei'; current_date_tw date; current_shift text;
begin
  if actor is null or not public.business_market_allowed(p_market) then raise exception using errcode='42501',message='目前帳號未開放所選市場的業管組交接簿'; end if;
  if p_date is null or p_shift not in ('01-09','09-17','17-01') then raise exception '交接班別無效'; end if;
  if public.business_shift_start(p_date,p_shift)>now() then raise exception '尚未開始的班別不可交接或完成事項'; end if;
  perform pg_advisory_xact_lock(6091613,hashtext(p_market));
  select name into actor_name from public.users where user_id=actor;
  select * into t from public.business_handover_transfers where market_code=p_market and handover_date=p_date and shift_code=p_shift;
  select * into prev from public.business_handover_transfers where market_code=p_market and next_date=p_date and next_shift=p_shift;
  if p_action='receive' then
    if prev.transfer_id is null then raise exception '上一班尚未送出交班，無法確認接班'; end if;
    if prev.receiver_id<>actor then raise exception using errcode='42501',message='僅指定接班人本人可確認接班'; end if;
    if p_revision is distinct from prev.revision then raise exception '交班內容已變更，請重新載入後確認'; end if;
    if prev.received_at is not null then return to_jsonb(prev); end if;
    update public.business_handover_transfers set received_by=actor,received_name=actor_name,received_at=now()
      where transfer_id=prev.transfer_id and market_code=p_market returning * into prev;
    return to_jsonb(prev);
  elsif p_action='submit' then
    if t.transfer_id is not null then raise exception '本班已交班，不可重複送出'; end if;
    if prev.transfer_id is null and exists(select 1 from public.business_handover_transfers where market_code=p_market and (handover_date,shift_code)<(p_date,p_shift)) then raise exception '上一班尚未交班，請先完成上一班交接，不能跳過班別勾稽'; end if;
    if prev.transfer_id is not null and prev.received_at is null then raise exception '請先由指定接班人完成上一班的接班確認'; end if;
    if prev.transfer_id is not null and prev.received_by<>actor then raise exception using errcode='42501',message='本班須由已確認接班的人員送出交班'; end if;
    if p_receiver is null or p_receiver=actor then raise exception '請指定另一位人員接班，交班與接班不可為同一人'; end if;
    select name into receiver_name from public.users where user_id=p_receiver and public.business_market_receiver_allowed(user_id,p_market);
    if receiver_name is null then raise exception '指定接班人必須是同一市場、在職且具業管組交接權限的人員'; end if;
    items:=public.business_market_shift_items(p_market,p_date,p_shift);
    if p_revision is distinct from md5(items::text) then raise exception '交接事項剛被修改，請重新載入並重新確認'; end if;
    target_date:=p_date+case when p_shift='17-01' then 1 else 0 end;
    target_shift:=case p_shift when '01-09' then '09-17' when '09-17' then '17-01' else '01-09' end;
    insert into public.business_handover_transfers(market_code,handover_date,shift_code,next_date,next_shift,items,revision,handed_by,handed_name,receiver_id,receiver_name)
      values(p_market,p_date,p_shift,target_date,target_shift,items,p_revision,actor,actor_name,p_receiver,receiver_name) returning * into t;
    return to_jsonb(t);
  elsif p_action='complete' then
    current_date_tw:=taipei::date-case when taipei::time<time '01:00' then 1 else 0 end;
    current_shift:=case when taipei::time<time '01:00' or taipei::time>=time '17:00' then '17-01' when taipei::time<time '09:00' then '01-09' else '09-17' end;
    if (p_date,p_shift)<>(current_date_tw,current_shift) then raise exception '請在目前當班紀錄完成事項，不可回填其他班別'; end if;
    if t.transfer_id is not null then raise exception '本班已交班，請由下一班接續處理'; end if;
    select * into e from public.business_handover_entries where entry_id=p_entry and market_code=p_market;
    if e.entry_id is null or e.is_deleted or position('【崗位勤務點檢紀錄】' in e.description)>0 or (e.handover_date,e.shift_code)>(p_date,p_shift) then raise exception '找不到本班可完成的交接事項'; end if;
    if exists(select 1 from public.business_handover_completions where entry_id=p_entry) then return (select to_jsonb(c) from public.business_handover_completions c where entry_id=p_entry); end if;
    insert into public.business_handover_completions(entry_id,completed_date,completed_shift,completed_by,completed_name) values(p_entry,p_date,p_shift,actor,actor_name);
    return (select to_jsonb(c) from public.business_handover_completions c where entry_id=p_entry);
  end if;
  raise exception '不支援的交接動作';
end $function$;

notify pgrst, 'reload schema';

commit;
