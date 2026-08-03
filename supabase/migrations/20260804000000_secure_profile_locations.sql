-- ============================================================================
-- 20260804000000_secure_profile_locations.sql
--
-- CRITICAL FIX: profile_locations had RLS disabled, so anyone with the public
-- anon key could read EVERY user's latitude/longitude (a stalking/scraping risk
-- for a matchmaking app).
--
-- The app only ever writes a user's OWN location (saveProfileCoordinates upserts
-- with profile_id = the current user). Distance/geo matching is done server-side
-- via SECURITY DEFINER RPCs, which bypass RLS — so restricting this table to
-- own-row access does NOT break matching.
-- ============================================================================

ALTER TABLE public.profile_locations ENABLE ROW LEVEL SECURITY;

-- Drop EVERY existing policy on the table (some were created in the dashboard and
-- are not in version control — one of them grants public/anon read, which is the
-- leak). We then recreate only the strict own-row policies below.
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

DROP POLICY IF EXISTS "profile_locations_select_own" ON public.profile_locations;
CREATE POLICY "profile_locations_select_own"
    ON public.profile_locations FOR SELECT
    TO authenticated
    USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "profile_locations_write_own" ON public.profile_locations;
CREATE POLICY "profile_locations_write_own"
    ON public.profile_locations FOR ALL
    TO authenticated
    USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());
