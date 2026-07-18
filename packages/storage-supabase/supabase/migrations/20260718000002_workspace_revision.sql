-- Optimistic concurrency for whole-workspace saves (API load-modify-write).
-- Writers bump the revision with a guarded UPDATE; a stale writer matches no
-- row and must reload and reapply.
alter table workspaces add column if not exists revision bigint not null default 0;
