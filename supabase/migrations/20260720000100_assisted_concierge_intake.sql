-- Migration: Create Assisted Concierge Intake and Isolation Schema
-- Target: hosted Supabase database

-- 1. Update subscription_tier CHECK constraint on profiles to include 'assisted'
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_subscription_tier_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_subscription_tier_check
  CHECK (subscription_tier IN ('free', 'plus', 'vip', 'pro', 'pro_max', 'pro_supreme', 'assisted'));

-- 2. Create concierge_session_status enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'concierge_session_status') THEN
    CREATE TYPE public.concierge_session_status AS ENUM (
      'INTAKE_IN_PROGRESS',
      'INTAKE_COMPLETE',
      'SOURCING',
      'ACTIVE',
      'PAUSED',
      'CLOSED'
    );
  END IF;
END
$$;

-- 3. Create assisted_concierge_sessions table
CREATE TABLE IF NOT EXISTS public.assisted_concierge_sessions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    status              public.concierge_session_status NOT NULL DEFAULT 'INTAKE_IN_PROGRESS',
    intake_notes        text,
    intake_embedding    vector(1536),
    intake_completed_at timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT one_active_session_per_user UNIQUE (user_id)
);

-- 4. Enable RLS and create select policy
ALTER TABLE public.assisted_concierge_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own concierge session" ON public.assisted_concierge_sessions;
CREATE POLICY "Users can view own concierge session"
    ON public.assisted_concierge_sessions
    FOR SELECT
    USING (user_id = auth.uid());

-- 5. Create is_premium_isolated helper function (SECURITY DEFINER, stable, sql)
CREATE OR REPLACE FUNCTION public.is_premium_isolated(p_uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_uid AND user_tier IN ('VIP'::public.user_tier_type, 'ASSISTED'::public.user_tier_type)
  );
$$;

-- 6. Create initialize_assisted_session RPC
CREATE OR REPLACE FUNCTION public.initialize_assisted_session(p_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_session_id uuid;
BEGIN
    -- Update profile tiers to assisted
    UPDATE public.profiles
    SET subscription_tier = 'assisted',
        user_tier = 'ASSISTED'::public.user_tier_type
    WHERE id = p_user_id;

    -- Insert or reset the concierge session to INTAKE_IN_PROGRESS
    INSERT INTO public.assisted_concierge_sessions (user_id, status)
    VALUES (p_user_id, 'INTAKE_IN_PROGRESS')
    ON CONFLICT (user_id) DO UPDATE
    SET status = 'INTAKE_IN_PROGRESS',
        intake_notes = NULL,
        intake_embedding = NULL,
        intake_completed_at = NULL,
        updated_at = now()
    RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$$;

-- 7. Update profiles RLS select policy to handle ASSISTED isolation
DROP POLICY IF EXISTS "Allow read access to profiles unless blocked" ON public.profiles;

CREATE POLICY "Allow read access to profiles unless blocked" ON public.profiles
  FOR SELECT
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
      -- Non-isolated profiles are visible to everyone
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
