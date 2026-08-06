-- Username resolution now happens inside the Auth Edge Function, so anonymous
-- clients can no longer enumerate account email addresses.
revoke all on function public.login_lookup_email(text) from public,anon;
grant execute on function public.login_lookup_email(text) to authenticated;
