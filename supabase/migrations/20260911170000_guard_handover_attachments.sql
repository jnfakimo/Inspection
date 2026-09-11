begin;

-- 駐衛警交接簿異常事件附件（2026-09-11）。
-- * 格式不限（使用者需求），但瀏覽器預覽只開放圖片／影片／音訊／PDF，其餘一律下載；
--   html、svg、xml、js 等可在瀏覽器執行的型別由 app-api 改存為 application/octet-stream。
-- * 影片在瀏覽器端壓縮後才上傳（web/lib/video-compress.ts）；單檔上限 50 MB、每件事件 10 個。
-- * 桶為私有且沒有任何 authenticated 的 storage 政策：上傳只能用 app-api 簽發的一次性上傳網址，
--   讀取只能用 app-api 簽發的限時網址，存放路徑由伺服器決定，前端無法寫入或列出其他檔案。
-- * 索引表只能追加或軟刪除；交班簽名後、或當日主管簽核後即不可新增或移除附件。

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('guard-handover-files','guard-handover-files',false,52428800,null)
on conflict (id) do update set public=false,file_size_limit=52428800,allowed_mime_types=null;

create table if not exists public.guard_handover_attachments (
  attachment_id uuid primary key default gen_random_uuid(),
  duty_date date not null,
  shift_name text not null,
  incident_id uuid not null,
  file_name text not null,
  content_type text not null default 'application/octet-stream',
  file_size bigint not null,
  original_size bigint,
  compressed boolean not null default false,
  storage_path text not null,
  uploaded_by uuid not null references public.users(user_id),
  uploaded_at timestamptz not null default now(),
  is_deleted boolean not null default false,
  deleted_by uuid references public.users(user_id),
  deleted_at timestamptz
);
create unique index if not exists idx_guard_handover_attachments_path on public.guard_handover_attachments(storage_path);
create index if not exists idx_guard_handover_attachments_shift on public.guard_handover_attachments(duty_date,shift_name,incident_id) where not is_deleted;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='guard_attachment_payload_check' and conrelid='public.guard_handover_attachments'::regclass) then
    alter table public.guard_handover_attachments add constraint guard_attachment_payload_check check(
      file_size between 1 and 52428800 and char_length(file_name) between 1 and 200
      and char_length(storage_path) between 1 and 300 and (original_size is null or original_size>0)
    );
  end if;
  if not exists(select 1 from pg_constraint where conname='guard_attachment_delete_metadata_check' and conrelid='public.guard_handover_attachments'::regclass) then
    alter table public.guard_handover_attachments add constraint guard_attachment_delete_metadata_check check(
      (not is_deleted and deleted_by is null and deleted_at is null) or (is_deleted and deleted_by is not null and deleted_at is not null)
    );
  end if;
end $$;

-- 附件跟著交接內容一起鎖：交班簽名後或當日已主管簽核即不可新增、移除；除軟刪除外一律不可改。
create or replace function public.protect_guard_handover_attachment()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if exists(select 1 from public.guard_handover_daily_approvals a where a.duty_date=new.duty_date) then
    raise exception using errcode='23514',message='guard handover day has been approved and is locked';
  end if;
  if exists(select 1 from public.guard_handover_logs l where l.duty_date=new.duty_date and l.shift_name=new.shift_name and l.status<>'draft') then
    raise exception using errcode='23514',message='guard handover attachments are locked after the handover is signed';
  end if;
  if tg_op='INSERT' then
    new.is_deleted:=false; new.deleted_by:=null; new.deleted_at:=null; new.uploaded_at:=now();
    return new;
  end if;
  if old.is_deleted then
    raise exception using errcode='23514',message='deleted guard handover attachment is immutable';
  end if;
  if not new.is_deleted or (to_jsonb(new)-array['is_deleted','deleted_by','deleted_at']) is distinct from (to_jsonb(old)-array['is_deleted','deleted_by','deleted_at']) then
    raise exception using errcode='23514',message='guard handover attachment can only be soft-deleted';
  end if;
  new.deleted_at:=now();
  return new;
end
$$;
revoke all on function public.protect_guard_handover_attachment() from public,anon,authenticated;
drop trigger if exists trg_protect_guard_handover_attachment on public.guard_handover_attachments;
create trigger trg_protect_guard_handover_attachment before insert or update on public.guard_handover_attachments
  for each row execute function public.protect_guard_handover_attachment();

drop trigger if exists trg_prevent_removal on public.guard_handover_attachments;
create trigger trg_prevent_removal before delete or truncate on public.guard_handover_attachments
  for each statement execute function public.reject_physical_data_removal();

alter table public.guard_handover_attachments enable row level security;
alter table public.guard_handover_attachments force row level security;
revoke all on public.guard_handover_attachments from anon,authenticated;
grant select on public.guard_handover_attachments to authenticated;
grant select,insert,update on public.guard_handover_attachments to service_role;
drop policy if exists guard_handover_attachments_read on public.guard_handover_attachments;
create policy guard_handover_attachments_read on public.guard_handover_attachments for select to authenticated
  using(public.has_handover_module_access('guard') or public.has_handover_module_access('guard-approve'));

comment on table public.guard_handover_attachments is '駐衛警交接簿異常事件附件索引；檔案存於私有桶 guard-handover-files，只能經 app-api 限時網址讀取';

notify pgrst, 'reload schema';

commit;
