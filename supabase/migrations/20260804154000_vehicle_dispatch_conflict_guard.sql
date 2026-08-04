-- 同日重疊時段只允許一張有效派車申請，避免多人同時占用公務車時段。
begin;

alter table vehicle_dispatch_requests
  drop constraint if exists vehicle_dispatch_no_time_overlap;

alter table vehicle_dispatch_requests
  add constraint vehicle_dispatch_no_time_overlap
  exclude using gist (
    tsrange(
      trip_date + planned_departure_time,
      trip_date + planned_return_time,
      '[)'
    ) with &&
  )
  where (status in ('pending_approval','approved','assigned','completed'));

commit;
