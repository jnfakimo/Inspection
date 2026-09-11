begin;

-- 補強 20260911150000：狀態機 trigger 原本只在 UPDATE 檢查「當日已主管簽核」，INSERT
-- 沒有檢查，已簽核的值班日仍能新建一筆交接草稿。app-api 的 guard_save 會先擋，但這張表
-- 的設計原則是「app-api 算錯或被繞過時資料庫仍要拒絕」，所以 INSERT 也要鎖。
-- 2026-09-11 以自動回滾的 DO 區塊實測狀態機時發現；除 INSERT 分支多一項檢查外，邏輯不變。

create or replace function public.protect_guard_handover_log()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  content_keys text[] := array['status','handover_by','handover_at','takeover_by','takeover_at','patrol_snapshot','updated_by','updated_at'];
begin
  if tg_op='INSERT' then
    if exists(select 1 from public.guard_handover_daily_approvals a where a.duty_date=new.duty_date) then
      raise exception using errcode='23514',message='guard handover day has been approved and is locked';
    end if;
    if new.status<>'draft' then raise exception using errcode='23514',message='guard handover must start as draft'; end if;
    new.handover_by:=null; new.handover_at:=null; new.takeover_by:=null; new.takeover_at:=null; new.patrol_snapshot:=null;
    new.updated_by:=new.created_by; new.created_at:=now(); new.updated_at:=now();
    return new;
  end if;

  if new.log_id is distinct from old.log_id or new.duty_date is distinct from old.duty_date or new.shift_name is distinct from old.shift_name
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception using errcode='23514',message='guard handover identity fields are immutable';
  end if;
  if exists(select 1 from public.guard_handover_daily_approvals a where a.duty_date=old.duty_date) then
    raise exception using errcode='23514',message='guard handover day has been approved and is locked';
  end if;
  if old.status='received' then
    raise exception using errcode='23514',message='received guard handover is immutable';
  end if;
  if old.status='submitted' and (to_jsonb(new)-content_keys) is distinct from (to_jsonb(old)-content_keys) then
    raise exception using errcode='23514',message='submitted guard handover content is locked';
  end if;

  if old.status='draft' and new.status='draft' then
    new.handover_by:=null; new.handover_at:=null; new.takeover_by:=null; new.takeover_at:=null; new.patrol_snapshot:=null;
  elsif old.status='draft' and new.status='submitted' then
    if new.handover_by is distinct from new.updated_by then
      raise exception using errcode='23514',message='handover signer must be the acting user';
    end if;
    new.handover_at:=now(); new.takeover_by:=null; new.takeover_at:=null;
  elsif old.status='submitted' and new.status='draft' then
    if new.updated_by is distinct from old.handover_by then
      raise exception using errcode='23514',message='only the handover signer can withdraw';
    end if;
    new.handover_by:=null; new.handover_at:=null; new.takeover_by:=null; new.takeover_at:=null; new.patrol_snapshot:=null;
  elsif old.status='submitted' and new.status='received' then
    if new.takeover_by is distinct from new.updated_by or new.takeover_by=old.handover_by then
      raise exception using errcode='23514',message='takeover signer must be the acting user and differ from the handover signer';
    end if;
    new.handover_by:=old.handover_by; new.handover_at:=old.handover_at; new.patrol_snapshot:=old.patrol_snapshot; new.takeover_at:=now();
  else
    raise exception using errcode='23514',message='invalid guard handover status transition';
  end if;
  new.updated_at:=now();
  return new;
end
$$;
revoke all on function public.protect_guard_handover_log() from public,anon,authenticated;

notify pgrst, 'reload schema';

commit;
