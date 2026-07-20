do $$
declare existing_job_id bigint;
begin
  select jobid into existing_job_id from cron.job where jobname='patrol-timeout-line-check' limit 1;
  if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;
end $$;

select cron.schedule(
  'patrol-timeout-line-check',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://qztffronusdhgxhjjubt.supabase.co/functions/v1/patrol-timeout-check',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dGZmcm9udXNkaGd4aGpqdWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTI1MzgsImV4cCI6MjA5NzI2ODUzOH0.FnUxot5YXI3yKCUCmJA5P4ysEJhmtaQQA6rM7MRy3oA'
    ),
    body := '{"scheduled":true}'::jsonb
  );
  $job$
);
