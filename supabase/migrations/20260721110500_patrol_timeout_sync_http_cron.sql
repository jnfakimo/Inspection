-- pg_net repeatedly restarted on the Nano instance. The synchronous http
-- extension is lightweight for this single request and lets pg_cron record a
-- definitive success/failure result.
create extension if not exists http with schema extensions;

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

select cron.schedule(
  'patrol-timeout-line-check',
  '*/5 * * * *',
  $job$
  select status
  from extensions.http((
    'POST',
    'https://qztffronusdhgxhjjubt.supabase.co/functions/v1/patrol-timeout-check',
    array[
      extensions.http_header(
        'Authorization',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6dGZmcm9udXNkaGd4aGpqdWJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2OTI1MzgsImV4cCI6MjA5NzI2ODUzOH0.FnUxot5YXI3yKCUCmJA5P4ysEJhmtaQQA6rM7MRy3oA'
      )
    ],
    'application/json',
    jsonb_build_object('scheduled', true)::text
  )::extensions.http_request);
  $job$
);
