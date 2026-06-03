-- Migration 009: performance indexes for filtered queries

create index if not exists readings_meter_id_timestamp_idx
  on readings(meter_id, timestamp);

create index if not exists certificates_status_created_at_idx
  on certificates(status, created_at);

create index if not exists audit_anchors_tx_hash_idx
  on audit_anchors(tx_hash);
