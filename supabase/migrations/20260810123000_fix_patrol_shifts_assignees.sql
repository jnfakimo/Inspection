-- V2 巡檢排班需要讀取指派人員；既有正式表可能早於此欄位建立。
alter table public.patrol_shifts
  add column if not exists assigned_user_ids uuid[] not null default '{}';

comment on column public.patrol_shifts.assigned_user_ids is '巡檢班別指派人員編號清單';
