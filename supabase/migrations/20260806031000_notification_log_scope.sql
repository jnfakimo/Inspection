-- Notification delivery logs contain recipient and upstream response details;
-- browsers may not create or alter them. Edge Functions use service_role.
do $$ declare t text; p record; begin
  foreach t in array array['patrol_timeout_notifications','meeting_booking_notifications'] loop
    if to_regclass('public.'||t) is not null then
      for p in select policyname from pg_policies where schemaname='public' and tablename=t
      loop execute format('drop policy if exists %I on public.%I',p.policyname,t); end loop;
      execute format('alter table public.%I enable row level security',t);
      execute format('alter table public.%I force row level security',t);
      execute format('revoke all on public.%I from anon,authenticated',t);
      execute format('grant select on public.%I to authenticated',t);
      execute format('create policy %I on public.%I for select to authenticated using(public.is_admin())',t||'_admin_read',t);
    end if;
  end loop;
  if to_regclass('public.fcm_subscriptions') is not null then
    alter table public.fcm_subscriptions force row level security;
    revoke all on public.fcm_subscriptions from anon;
  end if;
end $$;
