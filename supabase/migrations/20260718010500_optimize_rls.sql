-- Migration: Add RLS performance optimizations, messages UPDATE policy, and composite indexing

-- 1. Re-create mutual block function as STABLE to allow PostgreSQL caching
create or replace function public.is_blocked_mutually(user_a uuid, user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = user_a and blocked_id = user_b)
       or (blocker_id = user_b and blocked_id = user_a)
  );
$$;

-- 2. Messages Update Policy
drop policy if exists "Allow participants to update match messages" on public.messages;
drop policy if exists "Allow participants to update match messages unless blocked" on public.messages;

create policy "Allow participants to update match messages unless blocked" on public.messages
  for update
  using (
    exists (
      select 1 from public.matches m
      where m.id = messages.match_id
        and (m.user_1_id = auth.uid() or m.user_2_id = auth.uid())
        and not public.is_blocked_mutually(m.user_1_id, m.user_2_id)
    )
  )
  with check (
    exists (
      select 1 from public.matches m
      where m.id = messages.match_id
        and (m.user_1_id = auth.uid() or m.user_2_id = auth.uid())
        and not public.is_blocked_mutually(m.user_1_id, m.user_2_id)
    )
  );

-- 3. Composite index to speed up mutual block checks
create index if not exists user_blocks_blocker_blocked_idx
  on public.user_blocks (blocker_id, blocked_id);
