-- Migration: F10 + F11 - Typing Indicator and Online Presence
-- Real-time ephemeral state for chat UX enhancements

-- 1. TYPING INDICATOR TABLE
-- Ephemeral table that auto-expires entries after 5 seconds of inactivity
-- No RLS needed - data is transient and low-sensitivity

create table if not exists public.typing_indicators (
    id uuid default gen_random_uuid() primary key,
    match_id uuid references public.matches(id) on delete cascade not null,
    user_id uuid references public.profiles(id) on delete cascade not null,
    started_at timestamp with time zone default timezone('utc'::text, now()) not null,
    expires_at timestamp with time zone default timezone('utc'::text, now() + interval '5 seconds') not null,
    
    -- Ensure one typing indicator per user per match
    unique(match_id, user_id)
);
-- Auto-cleanup expired entries
-- create index if not exists typing_indicators_expires_idx 
--     on public.typing_indicators (expires_at) 
--     where expires_at < timezone('utc'::text, now());

-- 2. ONLINE PRESENCE TABLE
-- Tracks user last-seen timestamps for "online now" / "last seen X min ago" UX

create table if not exists public.user_presence (
    user_id uuid references public.profiles(id) on delete cascade primary key,
    status text not null default 'offline' check (status in ('online', 'away', 'offline')),
    last_seen_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
-- Fast lookup: who's online in a match?
create index if not exists user_presence_status_seen_idx 
    on public.user_presence (status, last_seen_at desc);
-- 3. EDGE FUNCTION HELPERS

-- Update typing indicator (call this from client when user starts typing)
create or replace function public.set_typing_indicator(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        return;
    end if;

    insert into public.typing_indicators (match_id, user_id, started_at, expires_at)
    values (p_match_id, v_user_id, timezone('utc'::text, now()), timezone('utc'::text, now() + interval '5 seconds'))
    on conflict (match_id, user_id)
    do update set 
        started_at = timezone('utc'::text, now()),
        expires_at = timezone('utc'::text, now() + interval '5 seconds');
end;
$$;
-- Clear typing indicator (call when user stops typing or sends message)
create or replace function public.clear_typing_indicator(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        return;
    end if;

    delete from public.typing_indicators 
    where match_id = p_match_id and user_id = v_user_id;
end;
$$;
-- Get typing users for a match (excluding self)
create or replace function public.get_typing_users(p_match_id uuid)
returns table (user_id uuid, started_at timestamp with time zone)
language sql
security definer
set search_path = public
as $$
    select ti.user_id, ti.started_at
    from public.typing_indicators ti
    where ti.match_id = p_match_id
      and ti.expires_at > timezone('utc'::text, now())
      and ti.user_id <> auth.uid()
    order by ti.started_at desc;
$$;
-- Update user presence (call on app foreground, heartbeat every 30s, disconnect on background)
create or replace function public.update_user_presence(p_status text default 'online')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        return;
    end if;

    insert into public.user_presence (user_id, status, last_seen_at, updated_at)
    values (v_user_id, p_status, timezone('utc'::text, now()), timezone('utc'::text, now()))
    on conflict (user_id)
    do update set 
        status = p_status,
        last_seen_at = timezone('utc'::text, now()),
        updated_at = timezone('utc'::text, now());
end;
$$;
-- Get presence for users in a match
create or replace function public.get_match_presence(p_match_id uuid)
returns table (
    user_id uuid, 
    status text, 
    last_seen_at timestamp with time zone,
    is_online boolean
)
language sql
security definer
set search_path = public
as $$
    select 
        p.user_id,
        coalesce(up.status, 'offline') as status,
        coalesce(up.last_seen_at, timezone('utc'::text, now()) - interval '1 year') as last_seen_at,
        (up.status = 'online' and up.last_seen_at > timezone('utc'::text, now() - interval '2 minutes')) as is_online
    from (
        select user_1_id as user_id from public.matches where id = p_match_id
        union
        select user_2_id from public.matches where id = p_match_id
    ) p
    left join public.user_presence up on up.user_id = p.user_id
    where p.user_id <> auth.uid();
$$;
-- 4. REALTIME PUBLICATIONS
-- Enable realtime for typing indicators (ephemeral - clients subscribe then unsubscribe)
alter publication supabase_realtime add table public.typing_indicators;
alter publication supabase_realtime add table public.user_presence;
-- 5. RLS POLICIES

-- Typing indicators: anyone in the match can see who's typing
alter table public.typing_indicators enable row level security;
create policy "Match participants can view typing indicators" 
    on public.typing_indicators
    for select
    using (
        exists (
            select 1 from public.matches m
            where m.id = typing_indicators.match_id
            and (m.user_1_id = auth.uid() or m.user_2_id = auth.uid())
        )
    );
-- Only the typing user can insert/update/delete their own indicator
create policy "Users can manage their own typing indicator"
    on public.typing_indicators
    for all
    using (user_id = auth.uid())
    with check (user_id = auth.uid());
-- User presence: anyone can see (low sensitivity), only self can update
alter table public.user_presence enable row level security;
create policy "Anyone can view user presence"
    on public.user_presence
    for select
    using (true);
create policy "Users can update own presence"
    on public.user_presence
    for all
    using (user_id = auth.uid())
    with check (user_id = auth.uid());
-- 6. GRANTS
grant execute on function public.set_typing_indicator(uuid) to authenticated;
grant execute on function public.clear_typing_indicator(uuid) to authenticated;
grant execute on function public.get_typing_users(uuid) to authenticated;
grant execute on function public.update_user_presence(text) to authenticated;
grant execute on function public.get_match_presence(uuid) to authenticated;
-- 7. AUTO-CLEANUP FUNCTION (optional - run via cron or edge function)
-- Cleans up stale typing indicators older than 5 minutes
create or replace function public.cleanup_stale_typing_indicators()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    deleted_count integer;
begin
    delete from public.typing_indicators
    where expires_at < timezone('utc'::text, now() - interval '5 minutes');
    
    get diagnostics deleted_count = row_count;
    return deleted_count;
end;
$$;
