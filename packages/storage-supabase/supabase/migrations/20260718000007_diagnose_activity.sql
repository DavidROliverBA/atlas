-- Diagnostic (no schema change): surface who is connected and what they run,
-- via notices in the migration output.
do $$
declare r record;
begin
  for r in
    select coalesce(client_addr::text, 'local') as addr,
           usename,
           application_name,
           state,
           count(*) as n,
           left(max(query), 60) as sample_query
    from pg_stat_activity
    where pid <> pg_backend_pid()
    group by 1, 2, 3, 4
    order by n desc
    limit 12
  loop
    raise notice 'ACTIVITY % conns | addr=% user=% app=% state=% | %',
      r.n, r.addr, r.usename, r.application_name, r.state, r.sample_query;
  end loop;
end $$;
