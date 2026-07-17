-- Migration: Secure matches and messages RLS policies against blocked users

-- 1. Matches Select Policy
drop policy if exists "Allow users to view their own matches" on public.matches;
drop policy if exists "Allow users to view their own matches unless blocked" on public.matches;

create policy "Allow users to view their own matches unless blocked" on public.matches
  for select
  using (
    (auth.uid() = user_1_id or auth.uid() = user_2_id)
    and not public.is_blocked_mutually(user_1_id, user_2_id)
  );

-- 2. Messages Select Policy
drop policy if exists "Allow participants to view match messages" on public.messages;
drop policy if exists "Allow participants to view match messages unless blocked" on public.messages;

create policy "Allow participants to view match messages unless blocked" on public.messages
  for select
  using (
    exists (
      select 1 from public.matches m
      where m.id = messages.match_id
        and (m.user_1_id = auth.uid() or m.user_2_id = auth.uid())
        and not public.is_blocked_mutually(m.user_1_id, m.user_2_id)
    )
  );

-- 3. Messages Insert Policy
drop policy if exists "Allow participants to insert match messages" on public.messages;
drop policy if exists "Allow participants to insert match messages unless blocked" on public.messages;

create policy "Allow participants to insert match messages unless blocked" on public.messages
  for insert
  with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.matches m
      where m.id = messages.match_id
        and (m.user_1_id = auth.uid() or m.user_2_id = auth.uid())
        and not public.is_blocked_mutually(m.user_1_id, m.user_2_id)
    )
  );
