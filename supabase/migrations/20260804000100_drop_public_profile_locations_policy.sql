-- ============================================================================
-- 20260804000100_drop_public_profile_locations_policy.sql
--
-- Follow-up: 20260804000000 enabled RLS + added own-row policies, but anon reads
-- STILL returned rows — meaning a permissive policy created in the Supabase
-- dashboard (not in version control) grants public/anon SELECT.
--
-- Dynamically drop EVERY policy on profile_locations, then recreate only the
-- strict own-row policies. (Geo matching is server-side via SECURITY DEFINER
-- RPCs, which bypass RLS, so this does not break matching.)
-- ============================================================================

ALTER TABLE public.profile_locations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'profile_locations'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.profile_locations', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "profile_locations_select_own"
    ON public.profile_locations FOR SELECT
    TO authenticated
    USING (profile_id = auth.uid());

CREATE POLICY "profile_locations_write_own"
    ON public.profile_locations FOR ALL
    TO authenticated
    USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());
