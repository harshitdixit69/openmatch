-- Migration: Fix protect_profile_sensitive_columns trigger to allow SECURITY DEFINER RPCs (postgres)
-- Problem: auth.role() remains 'authenticated' when an authenticated user calls a SECURITY DEFINER RPC.
-- Solution: Also check current_user = 'postgres' so RPCs like activate_spotlight(), consume_unlock_credit(), etc.
-- can modify spotlights_remaining, spotlight_active_until, and unlock_credits_remaining without being silently reverted.

CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF auth.role() = 'service_role' OR current_user = 'postgres' THEN
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
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_sensitive_columns
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_profile_sensitive_columns();
