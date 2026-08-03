-- ============================================================================
-- 20260804000200_profiles_authenticated_only.sql
--
-- The "Allow read access to profiles unless blocked" SELECT policy had no role
-- clause, so it applied to PUBLIC — anyone with the anon key could read profiles
-- (name, DOB, city, bio, photos) without logging in, enabling mass scraping.
--
-- Recreate the SAME policy logic (block-list + VIP/ASSISTED isolation) but scope
-- it TO authenticated so a valid user session is required. Browsing already
-- happens logged-in, so this does not change app behaviour for real users.
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow read access to profiles unless blocked" ON public.profiles;

CREATE POLICY "Allow read access to profiles unless blocked" ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    -- Block list check (qualified with profiles.id)
    (NOT EXISTS (
      SELECT 1 FROM public.user_blocks ub
      WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = profiles.id)
         OR (ub.blocker_id = profiles.id AND ub.blocked_id = auth.uid())
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
