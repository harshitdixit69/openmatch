-- F5: Shortlist / Bookmark Profiles
-- A simple junction table: one row per (viewer, saved_profile) pair.
-- Future isolation path: move to its own schema/service — the FK references
-- are intentionally to public.profiles only, no cross-feature coupling.

create table if not exists public.profile_shortlists (
  id                uuid default gen_random_uuid() primary key,
  viewer_id         uuid references public.profiles(id) on delete cascade not null,
  saved_profile_id  uuid references public.profiles(id) on delete cascade not null,
  note              text,           -- optional private note (future)
  created_at        timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint profile_shortlists_unique unique (viewer_id, saved_profile_id),
  constraint profile_shortlists_no_self_save check (viewer_id <> saved_profile_id)
);

create index if not exists profile_shortlists_viewer_created_idx
  on public.profile_shortlists (viewer_id, created_at desc);

create index if not exists profile_shortlists_saved_profile_idx
  on public.profile_shortlists (saved_profile_id);

alter table public.profile_shortlists enable row level security;

-- Only the viewer can see their own shortlist
drop policy if exists "Viewer reads own shortlist" on public.profile_shortlists;
create policy "Viewer reads own shortlist" on public.profile_shortlists
  for select using (auth.uid() = viewer_id);

-- Viewer inserts their own bookmarks
drop policy if exists "Viewer inserts own shortlist" on public.profile_shortlists;
create policy "Viewer inserts own shortlist" on public.profile_shortlists
  for insert with check (auth.uid() = viewer_id);

-- Viewer removes their own bookmarks
drop policy if exists "Viewer deletes own shortlist" on public.profile_shortlists;
create policy "Viewer deletes own shortlist" on public.profile_shortlists
  for delete using (auth.uid() = viewer_id);

-- Convenience RPC: returns all shortlisted profile IDs for the current user.
-- Used by the client to hydrate saved-state indicators across screens.
create or replace function public.get_shortlisted_profile_ids()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select saved_profile_id
  from public.profile_shortlists
  where viewer_id = auth.uid()
  order by created_at desc;
$$;

grant execute on function public.get_shortlisted_profile_ids() to authenticated;
