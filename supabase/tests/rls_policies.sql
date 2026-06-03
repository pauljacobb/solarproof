-- RLS Policy Tests for issue #274
-- Run in Supabase SQL editor or via psql.
-- Uses set_config to simulate JWT claims without a real auth session.
--
-- Seed UUIDs (from seed.sql):
--   cooperative A: 00000000-0000-0000-0000-000000000001
--   cooperative B: 00000000-0000-0000-0000-000000000002  (created below)
--   meter A:       00000000-0000-0000-0000-000000000010

-- ── Setup: second cooperative + meter for isolation tests ────────────────────
insert into cooperatives (id, name, admin_address) values
  ('00000000-0000-0000-0000-000000000002', 'Other Cooperative',
   'GOTHER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX')
  on conflict (id) do nothing;

insert into meters (id, cooperative_id, serial_number, pubkey_hex) values
  ('00000000-0000-0000-0000-000000000020',
   '00000000-0000-0000-0000-000000000002',
   'METER-002',
   '0000000000000000000000000000000000000000000000000000000000000001')
  on conflict (id) do nothing;

-- ── Helper: simulate a JWT for a cooperative member ──────────────────────────
-- Usage: call set_claim('<cooperative_id>') then run your query.
create or replace function tests.set_claim(coop_id text, role text default 'authenticated')
  returns void language plpgsql as $$
  begin
    perform set_config(
      'request.jwt.claims',
      json_build_object(
        'sub',          'test-user',
        'role',         role,
        'app_metadata', json_build_object('cooperative_id', coop_id)
      )::text,
      true  -- local to transaction
    );
  end;
$$;

-- ── Test 1: member of coop A sees only coop A's cooperative row ──────────────
do $$
declare
  cnt int;
begin
  perform tests.set_claim('00000000-0000-0000-0000-000000000001');
  select count(*) into cnt from cooperatives;
  assert cnt = 1, format('Test 1 FAIL: expected 1 cooperative, got %s', cnt);
  raise notice 'Test 1 PASS: member sees only own cooperative';
end $$;

-- ── Test 2: member of coop A sees only coop A's meters ──────────────────────
do $$
declare
  cnt int;
begin
  perform tests.set_claim('00000000-0000-0000-0000-000000000001');
  select count(*) into cnt from meters;
  assert cnt = 1, format('Test 2 FAIL: expected 1 meter, got %s', cnt);
  raise notice 'Test 2 PASS: member sees only own meters';
end $$;

-- ── Test 3: member of coop A cannot see coop B's meters ─────────────────────
do $$
declare
  cnt int;
begin
  perform tests.set_claim('00000000-0000-0000-0000-000000000001');
  select count(*) into cnt from meters
  where cooperative_id = '00000000-0000-0000-0000-000000000002';
  assert cnt = 0, format('Test 3 FAIL: expected 0 cross-tenant meters, got %s', cnt);
  raise notice 'Test 3 PASS: member cannot see other cooperative meters';
end $$;

-- ── Test 4: admin role sees all cooperatives ─────────────────────────────────
do $$
declare
  cnt int;
begin
  perform tests.set_claim('00000000-0000-0000-0000-000000000001', 'admin');
  select count(*) into cnt from cooperatives;
  assert cnt >= 2, format('Test 4 FAIL: admin expected >= 2 cooperatives, got %s', cnt);
  raise notice 'Test 4 PASS: admin sees all cooperatives';
end $$;

-- ── Test 5: admin role sees all meters ───────────────────────────────────────
do $$
declare
  cnt int;
begin
  perform tests.set_claim('00000000-0000-0000-0000-000000000001', 'admin');
  select count(*) into cnt from meters;
  assert cnt >= 2, format('Test 5 FAIL: admin expected >= 2 meters, got %s', cnt);
  raise notice 'Test 5 PASS: admin sees all meters';
end $$;

-- ── Cleanup ──────────────────────────────────────────────────────────────────
drop function if exists tests.set_claim(text, text);
