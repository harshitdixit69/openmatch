-- Migration: profile_views
-- Records when one user views another user's profile detail screen.
-- One row per (viewer, viewed) per day to avoid runaway insert volume.

create table if not exists public.profile_views (
  id uuid default gen_random_uuid() primary key,
  viewer_id uuid references public.profiles(id) on delete cascade not null,
  viewed_id uuid references public.profiles(id) on delete cascade not null,
  view_date date not null default (current_date at time zone 'utc')::date,
  viewed_at timestamp with time zone default timezone('utc'::text, now()) not null,
  -- Prevent self-views
  constraint profile_views_no_self_view check (viewer_id <> viewed_id)
);
-- One row per (viewer, viewed) per calendar day (UTC). On conflict we just
-- update viewed_at so the latest visit is surfaced.
create unique index if not exists profile_views_viewer_viewed_day_idx
  on public.profile_views (viewer_id, viewed_id, view_date);
-- Fast lookup: "who viewed me?" ordered by recency
create index if not exists profile_views_viewed_id_at_idx
  on public.profile_views (viewed_id, viewed_at desc);
-- Fast lookup: "whose profiles did I view?"
create index if not exists profile_views_viewer_id_at_idx
  on public.profile_views (viewer_id, viewed_at desc);
alter table public.profile_views enable row level security;
-- Viewed user can see who viewed them
drop policy if exists "Viewed user sees their own view events" on public.profile_views;
create policy "Viewed user sees their own view events" on public.profile_views
  for select using (auth.uid() = viewed_id);
-- Any authenticated user can record a view (write goes through RLS insert policy)
drop policy if exists "Authenticated users can record views" on public.profile_views;
create policy "Authenticated users can record views" on public.profile_views
  for insert with check (auth.uid() = viewer_id);
-- Helper: upsert a profile view, deduped per day
create or replace function public.upsert_profile_view(
  p_viewer_id uuid,
  p_viewed_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_viewer_id = p_viewed_id then
    return;
  end if;

  insert into public.profile_views (viewer_id, viewed_id, view_date, viewed_at)
  values (p_viewer_id, p_viewed_id, (timezone('utc'::text, now()))::date, timezone('utc'::text, now()))
  on conflict (viewer_id, viewed_id, view_date)
  do update set viewed_at = excluded.viewed_at;
end;
$$;
grant execute on function public.upsert_profile_view(uuid, uuid) to authenticated;
-- Helper: fetch recent viewers of a given profile (limit 50)
create or replace function public.get_profile_viewers(
  p_viewed_id uuid,
  p_limit integer default 50
)
returns table (
  viewer_id uuid,
  viewed_at timestamp with time zone
)
language sql
security definer
set search_path = public
as $$
  select distinct on (pv.viewer_id)
    pv.viewer_id,
    pv.viewed_at
  from public.profile_views pv
  where pv.viewed_id = p_viewed_id
  order by pv.viewer_id, pv.viewed_at desc
  limit p_limit;
$$;
grant execute on function public.get_profile_viewers(uuid, integer) to authenticated;
