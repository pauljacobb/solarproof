-- Migration 005: certificate retirement enhancements
-- Adds retire_tx_hash to certificates and a retirement_events audit table

alter table certificates
  add column if not exists retire_tx_hash text;

create table if not exists retirement_events (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null references certificates(id) on delete cascade,
  beneficiary text not null,
  retire_tx_hash text not null,
  kwh numeric(12,4) not null,
  retired_at timestamptz not null default now()
);

create index if not exists retirement_events_certificate_id_idx on retirement_events(certificate_id);
