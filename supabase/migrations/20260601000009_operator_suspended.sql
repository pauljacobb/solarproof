-- Migration 009: add suspended flag to cooperatives for admin management
alter table cooperatives add column suspended boolean not null default false;
