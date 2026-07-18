-- One-off repair: terminate backends stuck in atlas_save_workspace (or idle
-- in transaction) from before statement/lock timeouts existed. Safe to
-- re-run; only touches sessions older than 60 seconds.
do $$
declare r record;
begin
  for r in
    select pid from pg_stat_activity
    where pid <> pg_backend_pid()
      and (
        (query like '%atlas_save_workspace%' and state = 'active' and query_start < now() - interval '60 seconds')
        or (state = 'idle in transaction' and xact_start < now() - interval '60 seconds')
      )
  loop
    perform pg_terminate_backend(r.pid);
  end loop;
end $$;
