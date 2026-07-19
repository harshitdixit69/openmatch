-- Migration: Fix RLS scoping ambiguity in profiles select policy by qualifying profiles.id
drop policy if exists "Allow read access to profiles unless blocked" on public.profiles;

create policy "Allow read access to profiles unless blocked" on public.profiles
  for select
  using (
    -- Block list check (qualified with profiles.id)
    (not exists (
      select 1 from public.user_blocks ub
      where (ub.blocker_id = auth.uid() and ub.blocked_id = profiles.id)
         or (ub.blocker_id = profiles.id and ub.blocked_id = auth.uid())
    ))
    and
    -- VIP isolation check
    (
      -- Standard profiles are visible to everyone
      (user_tier != 'VIP'::public.user_tier_type)
      or
      -- VIP profiles are visible to self, other VIPs, or standard users with active matches/requests
      (user_tier = 'VIP'::public.user_tier_type and (
        profiles.id = auth.uid()
        or
        public.is_vip(auth.uid())
        or
        -- Match bypass: standard user is matched with this VIP (qualified with profiles.id)
        exists (
          select 1 from public.matches m
          where (m.user_1_id = auth.uid() and m.user_2_id = profiles.id)
             or (m.user_1_id = profiles.id and m.user_2_id = auth.uid())
        )
        or
        -- Interest request bypass: standard user has an active interest request with this VIP (qualified with profiles.id)
        exists (
          select 1 from public.interest_requests ir
          where (ir.sender_id = auth.uid() and ir.receiver_id = profiles.id)
             or (ir.sender_id = profiles.id and ir.receiver_id = auth.uid())
        )
      ))
    )
  );
