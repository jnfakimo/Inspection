-- 登入圖形驗證碼：僅由 username-login Edge Function 的 service role 存取。
-- 每組驗證碼最多使用一次，逾時後即失效；前端永遠不會取得答案或雜湊值。
create table if not exists public.login_captcha_challenges (
  challenge_id uuid primary key,
  answer_hash text not null check (length(answer_hash) = 64),
  ip_address inet,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_login_captcha_ip_created
  on public.login_captcha_challenges (ip_address, created_at desc);

create index if not exists idx_login_captcha_expiry
  on public.login_captcha_challenges (expires_at)
  where consumed_at is null;

alter table public.login_captcha_challenges enable row level security;
alter table public.login_captcha_challenges force row level security;

revoke all on table public.login_captcha_challenges from public, anon, authenticated;
grant all on table public.login_captcha_challenges to service_role;

comment on table public.login_captcha_challenges is
  '伺服器端登入驗證碼挑戰；答案以伺服器祕密 HMAC 儲存，前端不可讀取。';
comment on column public.login_captcha_challenges.answer_hash is
  'HMAC-SHA256(challenge_id:normalized_answer)，不可儲存明文答案。';
