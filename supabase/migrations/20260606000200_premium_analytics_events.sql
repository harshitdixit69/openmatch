create table if not exists public.premium_analytics_events (
  id uuid default gen_random_uuid() primary key,
  profile_id uuid references public.profiles(id) on delete cascade not null,
  event_name text not null,
  surface text not null,
  context text,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists premium_analytics_events_profile_created_idx
  on public.premium_analytics_events (profile_id, created_at desc);

create index if not exists premium_analytics_events_event_created_idx
  on public.premium_analytics_events (event_name, created_at desc);

alter table public.premium_analytics_events enable row level security;

drop policy if exists "Users insert their own premium analytics events" on public.premium_analytics_events;
create policy "Users insert their own premium analytics events" on public.premium_analytics_events
  for insert to authenticated
  with check (auth.uid() = profile_id);

drop policy if exists "Users view their own premium analytics events" on public.premium_analytics_events;
create policy "Users view their own premium analytics events" on public.premium_analytics_events
  for select to authenticated
  using (auth.uid() = profile_id);
