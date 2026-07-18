-- Ops: PostgREST wedged itself in a failing schema-cache reload loop after
-- the day's migration churn. Signal a clean reload of both schema and config.
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
