-- Migration 003: Row Level Security for multi-tenant isolation
-- Users carry their cooperative_id in JWT app_metadata.
-- The service role key (used by the API) bypasses RLS automatically.

-- Helper: extract cooperative_id from the current user's JWT app_metadata
create or replace function auth.cooperative_id() returns uuid
  language sql stable
  as $$
    select nullif(
      auth.jwt() -> 'app_metadata' ->> 'cooperative_id',
      ''
    )::uuid
  $$;

-- Helper: resolve cooperative_id for a reading via its meter
create or replace function auth.reading_cooperative_id(reading_id uuid) returns uuid
  language sql stable
  as $$
    select m.cooperative_id
    from readings r
    join meters m on m.id = r.meter_id
    where r.id = reading_id
  $$;

-- ── cooperatives ────────────────────────────────────────────────────────────
alter table cooperatives enable row level security;

-- Members see only their own cooperative
create policy "members_select_own_cooperative" on cooperatives
  for select using (id = auth.cooperative_id());

-- Admins (role = 'admin') can do anything
create policy "admin_all_cooperatives" on cooperatives
  for all using (auth.jwt() ->> 'role' = 'admin');

-- ── meters ──────────────────────────────────────────────────────────────────
alter table meters enable row level security;

create policy "members_select_own_meters" on meters
  for select using (cooperative_id = auth.cooperative_id());

create policy "admin_all_meters" on meters
  for all using (auth.jwt() ->> 'role' = 'admin');

-- ── readings ─────────────────────────────────────────────────────────────────
alter table readings enable row level security;

-- Readings belong to a cooperative via their meter
create policy "members_select_own_readings" on readings
  for select using (
    exists (
      select 1 from meters m
      where m.id = readings.meter_id
        and m.cooperative_id = auth.cooperative_id()
    )
  );

create policy "admin_all_readings" on readings
  for all using (auth.jwt() ->> 'role' = 'admin');

-- ── certificates ─────────────────────────────────────────────────────────────
alter table certificates enable row level security;

create policy "members_select_own_certificates" on certificates
  for select using (cooperative_id = auth.cooperative_id());

create policy "admin_all_certificates" on certificates
  for all using (auth.jwt() ->> 'role' = 'admin');
