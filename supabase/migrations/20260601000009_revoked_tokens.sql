-- Token revocation list
-- Stores JTI (JWT ID) of revoked access tokens so compromised tokens can be
-- rejected before their 15-minute expiry window closes.
create table if not exists public.revoked_tokens (
  jti        text        primary key,
  revoked_at timestamptz not null default now(),
  -- Automatically purge rows after the max access-token lifetime (15 min)
  expires_at timestamptz not null
);

-- Index for fast lookup on every authenticated request
create index if not exists revoked_tokens_expires_at_idx on public.revoked_tokens (expires_at);

-- RLS: only service-role can insert/delete; no row is readable by end users
alter table public.revoked_tokens enable row level security;

create policy "service role only" on public.revoked_tokens
  using (false);  -- deny all; service role bypasses RLS

-- Scheduled cleanup: remove expired entries (run via pg_cron or Supabase scheduled functions)
-- Example: select cron.schedule('purge-revoked-tokens', '*/15 * * * *',
--   $$delete from public.revoked_tokens where expires_at < now()$$);
