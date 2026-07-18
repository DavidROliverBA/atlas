-- A save that cannot finish promptly must abort rather than queue behind the
-- workspace row lock indefinitely (prevents pool-starvation pile-ups).
alter function atlas_save_workspace(uuid, bigint, jsonb) set statement_timeout = '10s';
alter function atlas_save_workspace(uuid, bigint, jsonb) set lock_timeout = '8s';
