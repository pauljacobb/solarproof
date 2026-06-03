-- Migration: multi-meter support (grouping and labeling)
-- Closes #138

alter table meters
  add column if not exists meter_group text,
  add column if not exists tags text[] default '{}';

-- Index for tags to allow efficient filtering if needed later
create index if not exists idx_meters_tags on meters using gin (tags);
create index if not exists idx_meters_group on meters (meter_group);
