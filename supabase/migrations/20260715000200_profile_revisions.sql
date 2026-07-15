-- Migration: Step 12 — AI Profile Builder revision history
-- Stores AI-generated and manual profile revisions for undo + history

create table if not exists public.profile_revisions (
    id uuid default gen_random_uuid() primary key,
    profile_id uuid references public.profiles(id) on delete cascade not null,
    tone text not null default 'balanced' check (tone in ('witty', 'sincere', 'balanced', 'manual')),
    bio text not null default '',
    preferences text not null default '',
    source text not null default 'ai' check (source in ('ai', 'manual')),
    refinement text,
    revision_number integer not null default 1,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Fast history lookups: most recent revisions first
create index if not exists profile_revisions_profile_created_idx
    on public.profile_revisions (profile_id, created_at desc);

-- RLS: users can only access their own revisions
alter table public.profile_revisions enable row level security;

create policy "Users can view their own revisions"
    on public.profile_revisions
    for select
    using (profile_id = auth.uid());

create policy "Users can insert their own revisions"
    on public.profile_revisions
    for insert
    with check (profile_id = auth.uid());

create policy "Users can delete their own revisions"
    on public.profile_revisions
    for delete
    using (profile_id = auth.uid());
