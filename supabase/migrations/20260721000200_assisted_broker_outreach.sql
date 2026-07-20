-- Migration: Update VIP outreach credit consume RPC and Telemetry RLS to support ASSISTED tier
-- Target: hosted Supabase database

-- 1. Recreate consume_vip_outreach_credit to support both VIP and ASSISTED tiers
CREATE OR REPLACE FUNCTION public.consume_vip_outreach_credit()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET unlock_credits_remaining = unlock_credits_remaining - 1
  WHERE id = auth.uid() 
    AND user_tier IN ('VIP'::public.user_tier_type, 'ASSISTED'::public.user_tier_type)
    AND unlock_credits_remaining > 0;
  
  RETURN found;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_vip_outreach_credit() TO authenticated;

-- 2. Update RLS policies on public.vip_bot_sessions to allow both VIP and ASSISTED tiers
DROP POLICY IF EXISTS "VIP users can view their own bot session" ON public.vip_bot_sessions;
DROP POLICY IF EXISTS "VIP users can view and edit their own bot session" ON public.vip_bot_sessions;
DROP POLICY IF EXISTS "VIP and ASSISTED users can view and edit their own bot session" ON public.vip_bot_sessions;

CREATE POLICY "VIP and ASSISTED users can view and edit their own bot session"
  ON public.vip_bot_sessions
  FOR ALL
  USING (
    vip_id = auth.uid()
    AND public.is_premium_isolated(auth.uid())
  )
  WITH CHECK (
    vip_id = auth.uid()
    AND public.is_premium_isolated(auth.uid())
  );

-- 3. Update RLS policies on public.vip_outreach_logs to allow both VIP and ASSISTED tiers
DROP POLICY IF EXISTS "VIP users can view their own outreach logs" ON public.vip_outreach_logs;
DROP POLICY IF EXISTS "VIP users can view and edit their own outreach logs" ON public.vip_outreach_logs;
DROP POLICY IF EXISTS "VIP and ASSISTED users can view and edit their own outreach logs" ON public.vip_outreach_logs;

CREATE POLICY "VIP and ASSISTED users can view and edit their own outreach logs"
  ON public.vip_outreach_logs
  FOR ALL
  USING (
    vip_id = auth.uid()
    AND public.is_premium_isolated(auth.uid())
  )
  WITH CHECK (
    vip_id = auth.uid()
    AND public.is_premium_isolated(auth.uid())
  );
