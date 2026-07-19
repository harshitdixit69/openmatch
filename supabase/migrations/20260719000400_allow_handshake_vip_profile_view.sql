-- Migration: Allow standard users to view VIP profile metadata during active match or handshake interest request
-- This fixes the issue where standard users cannot see VIP profile details to complete handshakes.

-- 1. Drop existing policy
drop policy if exists "Allow read access to profiles unless blocked" on public.profiles;

-- 2. Recreate select policy on profiles allowing bypass for active matches or interest requests
create policy "Allow read access to profiles unless blocked" on public.profiles
  for select
  using (
    -- Block list check
    (not exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = auth.uid() and ub.blocked_id = id)
         or (ub.blocker_id = id and ub.blocked_id = auth.uid())
    ))
    and
    -- VIP isolation check
    (
      -- Standard profiles are visible to everyone
      (user_tier != 'VIP'::public.user_tier_type)
      or
      -- VIP profiles are visible to self, other VIPs, or standard users with active matches/requests
      (user_tier = 'VIP'::public.user_tier_type and (
        id = auth.uid()
        or
        public.is_vip(auth.uid())
        or
        -- Match bypass: standard user is matched with this VIP
        exists (
          select 1 from public.matches m
          where (m.user_1_id = auth.uid() and m.user_2_id = id)
             or (m.user_1_id = id and m.user_2_id = auth.uid())
        )
        or
        -- Interest request bypass: standard user has an active interest request with this VIP
        exists (
          select 1 from public.interest_requests ir
          where (ir.sender_id = auth.uid() and ir.receiver_id = id)
             or (ir.sender_id = id and ir.receiver_id = auth.uid())
        )
      ))
    )
  );
