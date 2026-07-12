-- Migration: in-app notifications
-- Lightweight feed of events surfaced to the user (new match, request accepted,
-- message received, contact unlocked, profile viewed, etc.)

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_type') then
    create type public.notification_type as enum (
      'new_match',
      'request_received',
      'request_accepted',
      'request_declined',
      'request_ghosted',
      'message_received',
      'contact_unlocked',
      'profile_viewed',
      'reliability_badge',
      'system'
    );
  end if;
end
$$;

create table if not exists public.notifications (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  type public.notification_type not null,
  title text not null,
  body text not null,
  -- Optional deep-link metadata (match_id, request_id, profile_id, etc.)
  metadata jsonb default '{}'::jsonb not null,
  is_read boolean default false not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists notifications_user_id_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_user_id_unread_idx
  on public.notifications (user_id, is_read)
  where is_read = false;

alter table public.notifications enable row level security;

drop policy if exists "Users read own notifications" on public.notifications;
create policy "Users read own notifications" on public.notifications
  for select using (auth.uid() = user_id);

drop policy if exists "Users update own notifications" on public.notifications;
create policy "Users update own notifications" on public.notifications
  for update using (auth.uid() = user_id);

-- Service-role Edge Functions own inserts; no client insert policy.

-- Helper: count unread for a user
create or replace function public.get_unread_notification_count(p_user_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.notifications
  where user_id = p_user_id
    and is_read = false;
$$;

grant execute on function public.get_unread_notification_count(uuid) to authenticated;

-- Helper: mark all as read for a user
create or replace function public.mark_all_notifications_read(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  update public.notifications
  set is_read = true
  where user_id = p_user_id
    and is_read = false;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

grant execute on function public.mark_all_notifications_read(uuid) to authenticated;

-- Seed helper used by Edge Functions: insert a notification row from service role
-- (no direct client insert policy; all writes go through service role)
