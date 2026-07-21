-- The database pg_cron/pg_net worker repeatedly restarted on the Nano
-- instance. GitHub Actions now invokes the Edge Function every five minutes.
do $$
declare
  old_job_id bigint;
begin
  select jobid into old_job_id
  from cron.job
  where jobname = 'patrol-timeout-line-check'
  limit 1;

  if old_job_id is not null then
    perform cron.unschedule(old_job_id);
  end if;
end $$;
