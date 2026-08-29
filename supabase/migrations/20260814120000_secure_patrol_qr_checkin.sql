-- 巡檢 QR 簽到安全強化
-- QR 只作為巡檢點定位；實際寫入一律由 patrol-checkin Edge Function
-- 在驗證登入、MFA AAL2、巡檢點狀態後，以 service role 寫入。

begin;

alter table public.checkin_logs add column if not exists auth_level text;
alter table public.checkin_logs add column if not exists verification_method text;
alter table public.checkin_logs add column if not exists source_ip text;
alter table public.checkin_logs add column if not exists user_agent text;
alter table public.checkin_logs add column if not exists checkin_source text;

create index if not exists idx_checkin_logs_user_time
  on public.checkin_logs (user_id, checkin_at desc);
create index if not exists idx_checkin_logs_target_time
  on public.checkin_logs (target_type, target_id, checkin_at desc);

alter table public.checkin_logs enable row level security;
drop policy if exists "authenticated_only" on public.checkin_logs;
drop policy if exists "allow_all_for_now" on public.checkin_logs;
drop policy if exists "checkin_logs_select_authenticated" on public.checkin_logs;

-- 使用者只能讀取已完成的巡檢歷史；新增／修改／刪除只能由 Edge Function
-- service role 執行，避免竄改 QR 參數或繞過 MFA 直接寫入。
create policy "checkin_logs_select_authenticated"
  on public.checkin_logs for select to authenticated
  using (auth.uid() is not null);

revoke insert, update, delete on public.checkin_logs from anon, authenticated;
grant select on public.checkin_logs to authenticated;

comment on table public.checkin_logs is
  '巡檢 QR／NFC 簽到紀錄；寫入僅允許 patrol-checkin Edge Function，必須通過登入與 MFA AAL2。';
comment on column public.checkin_logs.auth_level is 'Supabase Authenticator Assurance Level，巡檢簽到應為 aal2';
comment on column public.checkin_logs.verification_method is 'MFA 驗證方式，例如 totp 或 passkey';
comment on column public.checkin_logs.source_ip is '後端取得的來源 IP（不信任瀏覽器提供值）';
comment on column public.checkin_logs.user_agent is '後端取得的瀏覽器／裝置識別資訊';
comment on column public.checkin_logs.checkin_source is '簽到來源，例如 qr 或 nfc';

commit;
