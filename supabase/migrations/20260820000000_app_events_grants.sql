-- The RLS policy alone isn't enough: Postgres also requires table-level GRANTs
-- before a role can INSERT. Without this, anon/authenticated clients get
-- "42501: permission denied for table app_events" even though the policy allows it.

grant insert on table public.app_events to anon, authenticated;

-- (No SELECT/UPDATE/DELETE grants: this stays a write-only firehose for clients.
--  Dashboards read it via the service-role key, which bypasses grants + RLS.)
