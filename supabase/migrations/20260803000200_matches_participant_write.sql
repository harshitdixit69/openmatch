-- ============================================================================
-- 20260803000200_matches_participant_write.sql
-- Follow-up to 20260803000000_enable_core_rls.sql.
--
-- That migration enabled RLS on `matches` with a SELECT-only policy, which
-- broke the one legitimate client-side write path:
--   VipConciergeDashboard.handleDeclineCandidate() upserts a `matches` row
--   (status='rejected') to exclude a candidate from the feed. The acting user
--   is always one of the two participants.
--
-- Allow a signed-in user to INSERT/UPDATE a match row ONLY when they are one of
-- the two participants. Real mutual-match creation still happens server-side
-- (RPC / edge functions with the service role, which bypass RLS).
-- ============================================================================

DROP POLICY IF EXISTS "matches_insert_participant" ON public.matches;
CREATE POLICY "matches_insert_participant"
    ON public.matches FOR INSERT
    TO authenticated
    WITH CHECK (user_1_id = auth.uid() OR user_2_id = auth.uid());

DROP POLICY IF EXISTS "matches_update_participant" ON public.matches;
CREATE POLICY "matches_update_participant"
    ON public.matches FOR UPDATE
    TO authenticated
    USING (user_1_id = auth.uid() OR user_2_id = auth.uid())
    WITH CHECK (user_1_id = auth.uid() OR user_2_id = auth.uid());
