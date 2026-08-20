-- Add a human-readable username to app_events so the raw event log + dashboards
-- are readable at a glance (instead of only opaque anon_id / profile_id UUIDs).
-- Nullable because anonymous pre-signup events won't have a name yet.

alter table public.app_events
  add column if not exists username text;
