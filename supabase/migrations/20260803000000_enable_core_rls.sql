-- ============================================================================
-- 20260803000000_enable_core_rls.sql
-- Enable Row-Level Security on core user-facing tables and lock sensitive
-- columns so the shipped anon key cannot be abused by end users.
--
-- ⚠️  REVIEW BEFORE PRODUCTION:
--   These tables were originally created outside version control (dashboard).
--   Test this migration against a staging branch first. Enabling RLS without
--   the right policies can make queries silently return zero rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helper: is the current user a participant in a given match?
-- SECURITY DEFINER so it can read `matches` regardless of caller policies.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_match_participant(p_match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.id = p_match_id
          AND (m.user_1_id = auth.uid() OR m.user_2_id = auth.uid())
    );
$$;

-- ============================================================================
-- profiles
-- NOTE: SELECT is already governed by the existing policy
--   "Allow read access to profiles unless blocked"
--   (see 20260720000100_assisted_concierge_intake.sql).
-- We intentionally do NOT add another permissive SELECT policy here, because
-- permissive policies are OR-combined and a `USING (true)` would defeat the
-- existing block-list filtering. We only add the missing own-row write rules
-- and the monetised-column lock.
-- ============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- Protect monetised / trust columns: only the service role (backend, webhooks)
-- may change them. A user updating their own row keeps the old values.
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF auth.role() = 'service_role' THEN
        RETURN NEW;
    END IF;

    NEW.subscription_tier        := OLD.subscription_tier;
    NEW.subscription_expires_at  := OLD.subscription_expires_at;
    NEW.manual_unlock_credits    := OLD.manual_unlock_credits;
    NEW.ai_call_credits          := OLD.ai_call_credits;
    NEW.unlock_credits_remaining := OLD.unlock_credits_remaining;
    NEW.super_interest_remaining := OLD.super_interest_remaining;
    NEW.spotlights_remaining     := OLD.spotlights_remaining;
    NEW.spotlight_active_until   := OLD.spotlight_active_until;
    -- NOTE: verification_status / verification_id_url / verification_selfie_url are
    -- locked separately by 20260803000100_harden_identity_verification.sql
    -- (trg_prevent_client_verification_change) to avoid a redundant second revert here.
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_sensitive_columns
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_profile_sensitive_columns();

-- ============================================================================
-- matches  — participants may read. Writes are done by RPC / service role.
-- ============================================================================
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matches_select_participant" ON public.matches;
CREATE POLICY "matches_select_participant"
    ON public.matches FOR SELECT
    TO authenticated
    USING (user_1_id = auth.uid() OR user_2_id = auth.uid());

-- ============================================================================
-- messages — participants read; a user may only send as themselves.
-- ============================================================================
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_select_participant" ON public.messages;
CREATE POLICY "messages_select_participant"
    ON public.messages FOR SELECT
    TO authenticated
    USING (public.is_match_participant(match_id));

DROP POLICY IF EXISTS "messages_insert_sender" ON public.messages;
CREATE POLICY "messages_insert_sender"
    ON public.messages FOR INSERT
    TO authenticated
    WITH CHECK (sender_id = auth.uid() AND public.is_match_participant(match_id));

DROP POLICY IF EXISTS "messages_update_participant" ON public.messages;
CREATE POLICY "messages_update_participant"
    ON public.messages FOR UPDATE
    TO authenticated
    USING (public.is_match_participant(match_id))
    WITH CHECK (public.is_match_participant(match_id));

-- ============================================================================
-- match_unlocks — participants read.
-- ============================================================================
ALTER TABLE public.match_unlocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "match_unlocks_select_participant" ON public.match_unlocks;
CREATE POLICY "match_unlocks_select_participant"
    ON public.match_unlocks FOR SELECT
    TO authenticated
    USING (public.is_match_participant(match_id));

-- ============================================================================
-- interest_requests — sender or receiver read; sender creates.
-- ============================================================================
ALTER TABLE public.interest_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "interest_requests_select_party" ON public.interest_requests;
CREATE POLICY "interest_requests_select_party"
    ON public.interest_requests FOR SELECT
    TO authenticated
    USING (sender_id = auth.uid() OR receiver_id = auth.uid());

DROP POLICY IF EXISTS "interest_requests_insert_sender" ON public.interest_requests;
CREATE POLICY "interest_requests_insert_sender"
    ON public.interest_requests FOR INSERT
    TO authenticated
    WITH CHECK (sender_id = auth.uid());

DROP POLICY IF EXISTS "interest_requests_update_party" ON public.interest_requests;
CREATE POLICY "interest_requests_update_party"
    ON public.interest_requests FOR UPDATE
    TO authenticated
    USING (sender_id = auth.uid() OR receiver_id = auth.uid())
    WITH CHECK (sender_id = auth.uid() OR receiver_id = auth.uid());

-- ============================================================================
-- notifications — a user only sees / updates their own.
-- Inserts are performed by the service role (triggers / edge functions).
-- ============================================================================
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
CREATE POLICY "notifications_select_own"
    ON public.notifications FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
CREATE POLICY "notifications_update_own"
    ON public.notifications FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- ============================================================================
-- profile_shortlists — a user fully manages their own saved profiles.
-- ============================================================================
ALTER TABLE public.profile_shortlists ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_shortlists_all_own" ON public.profile_shortlists;
CREATE POLICY "profile_shortlists_all_own"
    ON public.profile_shortlists FOR ALL
    TO authenticated
    USING (viewer_id = auth.uid())
    WITH CHECK (viewer_id = auth.uid());

-- ============================================================================
-- user_blocks — a user fully manages blocks they created.
-- Also allow the blocked party to READ (so the app can filter both directions).
-- ============================================================================
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_blocks_select_party" ON public.user_blocks;
CREATE POLICY "user_blocks_select_party"
    ON public.user_blocks FOR SELECT
    TO authenticated
    USING (blocker_id = auth.uid() OR blocked_id = auth.uid());

DROP POLICY IF EXISTS "user_blocks_write_own" ON public.user_blocks;
CREATE POLICY "user_blocks_write_own"
    ON public.user_blocks FOR ALL
    TO authenticated
    USING (blocker_id = auth.uid())
    WITH CHECK (blocker_id = auth.uid());
