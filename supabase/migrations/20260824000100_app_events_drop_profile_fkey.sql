-- app_events is a write-only analytics firehose. Its profile_id is best-effort
-- (attached only when we happen to know the authenticated user). Early in the
-- lifecycle the auth user exists before a public.profiles row is created, so a
-- hard foreign key causes inserts to fail with 23503
-- ("Key is not present in table \"profiles\""), breaking analytics.
--
-- Analytics must never break the app, so we drop the FK constraint and keep
-- profile_id as a soft reference (still indexed/queryable, just not enforced).

alter table public.app_events
  drop constraint if exists app_events_profile_id_fkey;
