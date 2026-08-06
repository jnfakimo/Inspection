-- The legacy database cron used an anonymous bearer. GitHub Actions now calls
-- the function with CRON_SECRET, so remove any old unauthenticated schedule.
do $$
declare v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname='error-threshold-check' limit 1;
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
end $$;
