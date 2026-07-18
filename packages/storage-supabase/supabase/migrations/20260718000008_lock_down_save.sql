-- SECURITY: atlas_save_workspace is security definer, and Postgres grants
-- EXECUTE on new functions to PUBLIC by default — meaning the public anon key
-- could invoke it via PostgREST and rewrite the workspace, bypassing RLS.
-- Only the service role (held server-side by the API) may save.
revoke execute on function atlas_save_workspace(uuid, bigint, jsonb) from public;
revoke execute on function atlas_save_workspace(uuid, bigint, jsonb) from anon;
revoke execute on function atlas_save_workspace(uuid, bigint, jsonb) from authenticated;
grant execute on function atlas_save_workspace(uuid, bigint, jsonb) to service_role;

-- Same hygiene for the membership helper (read-only, but no reason for PUBLIC).
revoke execute on function is_member(uuid, text) from public;
grant execute on function is_member(uuid, text) to anon, authenticated, service_role;
