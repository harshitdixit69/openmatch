-- Anonymous top-of-funnel analytics.
-- Captures events that happen BEFORE (and after) signup so we can answer
-- "did anyone even open the app?" and measure the signup funnel + channel
-- attribution. No PII is stored: we use a client-generated anonymous device id.

create table if not exists public.app_events (
  id uuid default gen_random_uuid() primary key,
  anon_id text not null,                       -- client-generated device id (not PII)
  profile_id uuid references public.profiles(id) on delete set null, -- set once known
  event_name text not null,                    -- e.g. app_opened, auth_screen_viewed
  platform text,                               -- web | ios | android
  app_version text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referrer text,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

create index if not exists app_events_event_created_idx
  on public.app_events (event_name, created_at desc);
create index if not exists app_events_anon_created_idx
  on public.app_events (anon_id, created_at desc);
create index if not exists app_events_created_idx
  on public.app_events (created_at desc);

alter table public.app_events enable row level security;

-- Allow anonymous AND authenticated clients to insert their own events.
-- This is intentionally open for inserts (write-only firehose) but locked for reads.
drop policy if exists "Anyone can insert app events" on public.app_events;
create policy "Anyone can insert app events" on public.app_events
  for insert to anon, authenticated
  with check (true);

-- No public SELECT policy: only the service role (dashboards/back-office) can read.

-- Convenience view: daily funnel counts (unique devices per event per day).
create or replace view public.app_events_funnel_daily as
select
  date_trunc('day', created_at) as day,
  event_name,
  count(*) as events,
  count(distinct anon_id) as unique_devices
from public.app_events
group by 1, 2
order by 1 desc, 2;
