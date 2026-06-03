-- audit_logs: append-only audit trail for sensitive operations
-- Retention: minimum 2 years (enforced via Supabase retention policy or pg_cron)

create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  timestamp   timestamptz not null default now(),
  actor       text not null,
  action      text not null,
  resource    text not null,
  resource_id text,
  ip          text,
  metadata    jsonb
);

-- Append-only: revoke UPDATE and DELETE from all roles
revoke update on public.audit_logs from anon, authenticated, service_role;
revoke delete on public.audit_logs from anon, authenticated, service_role;

-- Only service_role may insert
revoke insert on public.audit_logs from anon, authenticated;
grant insert on public.audit_logs to service_role;
grant select on public.audit_logs to service_role;

-- Index for time-range queries
create index if not exists audit_logs_timestamp_idx on public.audit_logs (timestamp desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor);
create index if not exists audit_logs_action_idx on public.audit_logs (action);
