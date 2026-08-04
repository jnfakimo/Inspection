-- 公務車派車第二階段：聯絡電話、加油／異常紀錄與照片附件。
begin;

alter table vehicle_dispatch_requests add column if not exists applicant_phone text;
alter table vehicle_dispatch_requests add column if not exists last_refuel_odometer numeric(12,1);
alter table vehicle_dispatch_requests add column if not exists last_refuel_cost numeric(12,2);
alter table vehicle_dispatch_requests add column if not exists refuel_cost numeric(12,2);
alter table vehicle_dispatch_requests add column if not exists has_abnormality boolean default false;
alter table vehicle_dispatch_requests add column if not exists abnormality_note text;

update vehicle_dispatch_requests set has_abnormality=false where has_abnormality is null;
-- 舊版「有加油」資料沒有費用欄，使用 0 保留為歷史未記錄值；新版前端會強制填寫。
update vehicle_dispatch_requests set refuel_cost=0 where refueled and refuel_cost is null;
alter table vehicle_dispatch_requests alter column has_abnormality set default false;

alter table vehicle_dispatch_requests drop constraint if exists vehicle_dispatch_mileage_check;
alter table vehicle_dispatch_requests add constraint vehicle_dispatch_mileage_check
  check ((odometer_start is null or odometer_start >= 0) and
    (odometer_end is null or odometer_end >= odometer_start) and
    (last_refuel_odometer is null or last_refuel_odometer >= 0) and
    (last_refuel_cost is null or last_refuel_cost >= 0) and
    (not refueled or (refuel_odometer is not null and refuel_cost is not null)) and
    (refuel_odometer is null or odometer_start is null or refuel_odometer >= odometer_start) and
    (refuel_odometer is null or odometer_end is null or refuel_odometer <= odometer_end) and
    (refuel_cost is null or refuel_cost >= 0));

alter table vehicle_dispatch_requests drop constraint if exists vehicle_dispatch_abnormality_check;
alter table vehicle_dispatch_requests add constraint vehicle_dispatch_abnormality_check
  check (not has_abnormality or nullif(trim(abnormality_note),'') is not null);

create table if not exists vehicle_dispatch_attachments (
  attachment_id uuid primary key default gen_random_uuid(),
  request_id uuid not null references vehicle_dispatch_requests(request_id),
  stage text not null default 'application',
  file_path text not null,
  file_name text not null,
  mime_type text,
  file_size bigint,
  uploaded_by uuid references users(user_id),
  uploaded_by_name text,
  created_at timestamptz not null default now()
);

alter table vehicle_dispatch_attachments drop constraint if exists vehicle_dispatch_attachment_stage_check;
alter table vehicle_dispatch_attachments add constraint vehicle_dispatch_attachment_stage_check
  check (stage in ('application','driver','abnormality'));
create index if not exists idx_vehicle_dispatch_attachments_request
  on vehicle_dispatch_attachments(request_id,created_at);

alter table vehicle_dispatch_attachments enable row level security;
drop policy if exists "vehicle_dispatch_attachments_authenticated" on vehicle_dispatch_attachments;
create policy "vehicle_dispatch_attachments_authenticated" on vehicle_dispatch_attachments
  for all to authenticated using (true) with check (true);

insert into storage.buckets(id,name,public)
values ('vehicle-dispatch-files','vehicle-dispatch-files',true)
on conflict (id) do update set public=true;

drop policy if exists "vehicle_dispatch_files_read" on storage.objects;
drop policy if exists "vehicle_dispatch_files_insert" on storage.objects;
create policy "vehicle_dispatch_files_read" on storage.objects
  for select to authenticated using (bucket_id='vehicle-dispatch-files');
create policy "vehicle_dispatch_files_insert" on storage.objects
  for insert to authenticated with check (bucket_id='vehicle-dispatch-files');

do $$
begin
  if to_regprocedure('public.reject_physical_data_removal()') is not null then
    drop trigger if exists trg_prevent_removal on public.vehicle_dispatch_attachments;
    create trigger trg_prevent_removal before delete or truncate
      on public.vehicle_dispatch_attachments for each statement
      execute function public.reject_physical_data_removal();
  end if;
end $$;

commit;
