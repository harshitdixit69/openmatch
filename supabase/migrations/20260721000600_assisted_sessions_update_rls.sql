-- Migration: Allow users to update their own concierge sessions
DROP POLICY IF EXISTS "Users can update own concierge session" ON public.assisted_concierge_sessions;

CREATE POLICY "Users can update own concierge session"
    ON public.assisted_concierge_sessions
    FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
