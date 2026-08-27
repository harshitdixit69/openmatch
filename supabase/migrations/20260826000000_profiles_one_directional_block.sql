-- ============================================================================
-- 20260826000000_profiles_one_directional_block.sql
--
-- Make blocking ONE-DIRECTIONAL for profile visibility.
--
-- Previous behaviour (bidirectional): if harshit blocked sam, BOTH lost sight of
-- each other's profile — so the chat disappeared for harshit (the blocker) too.
--
-- New behaviour (one-directional): when harshit blocks sam, only SAM (the blocked
-- user) loses visibility of harshit. Harshit (the blocker) keeps seeing sam's
-- profile and their existing conversation.
--
-- Implementation: the block-list clause now only hides a profile when the OTHER
-- user is the blocker and the current viewer is the one who was blocked. The
-- reverse case (viewer is the blocker) no longer hides the profile.
--
-- Everything else (Premium/VIP isolation) is preserved verbatim from
-- 20260804000200_profiles_authenticated_only.sql.
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to profiles unless blocked" ON public.profiles;

CREATE POLICY "Allow read access to profiles unless blocked" ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    -- One-directional block: only hide the profile from the user who was blocked.
    -- (The blocker keeps visibility of the person they blocked.)
    (NOT EXISTS (
      SELECT 1 FROM public.user_blocks ub
      WHERE ub.blocker_id = profiles.id AND ub.blocked_id = auth.uid()
    ))
    AND
    -- Premium isolation check
    (
      -- Non-isolated profiles are visible to everyone (authenticated)
      (user_tier NOT IN ('VIP'::public.user_tier_type, 'ASSISTED'::public.user_tier_type))
      OR
      -- VIP/ASSISTED profiles: visible to self, other premium-isolated users, or matched users
      (user_tier IN ('VIP'::public.user_tier_type, 'ASSISTED'::public.user_tier_type) AND (
        profiles.id = auth.uid()
        OR
        public.is_premium_isolated(auth.uid())
        OR
        EXISTS (
          SELECT 1 FROM public.matches m
          WHERE (m.user_1_id = auth.uid() AND m.user_2_id = profiles.id)
             OR (m.user_1_id = profiles.id AND m.user_2_id = auth.uid())
        )
        OR
        EXISTS (
          SELECT 1 FROM public.interest_requests ir
          WHERE (ir.sender_id = auth.uid() AND ir.receiver_id = profiles.id)
             OR (ir.sender_id = profiles.id AND ir.receiver_id = auth.uid())
        )
      ))
    )
  );
