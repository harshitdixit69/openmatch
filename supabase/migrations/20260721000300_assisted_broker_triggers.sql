-- Migration: Update VIP outreach refund trigger and sync triggers for ASSISTED tier sessions
-- Target: hosted Supabase database

-- 1. Recreate handle_vip_outreach_refund trigger function to sync session status
CREATE OR REPLACE FUNCTION public.handle_vip_outreach_refund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Trigger activates when status changes or is inserted as a failed state
  IF (TG_OP = 'INSERT' AND NEW.status IN ('failed', 'declined', 'no_answer', 'busy')) OR
     (TG_OP = 'UPDATE' AND NEW.status IN ('failed', 'declined', 'no_answer', 'busy') AND OLD.status NOT IN ('failed', 'declined', 'no_answer', 'busy')) THEN
    
    UPDATE public.profiles
    SET unlock_credits_remaining = unlock_credits_remaining + 1
    WHERE id = NEW.vip_id;

    -- Update the assisted concierge session status to CREDIT_REFUNDED
    UPDATE public.assisted_concierge_sessions
    SET status = 'CREDIT_REFUNDED', updated_at = now()
    WHERE user_id = NEW.vip_id;

  ELSIF (TG_OP = 'INSERT' AND NEW.status = 'completed') OR
        (TG_OP = 'UPDATE' AND NEW.status = 'completed' AND COALESCE(OLD.status, '') <> 'completed') THEN

    -- Update the assisted concierge session status to AWAITING_HANDSHAKE
    UPDATE public.assisted_concierge_sessions
    SET status = 'AWAITING_HANDSHAKE', updated_at = now()
    WHERE user_id = NEW.vip_id;

  END IF;
  RETURN NEW;
END;
$$;

-- 2. Create sync function to propagate ai_broker_calls updates to vip_outreach_logs
CREATE OR REPLACE FUNCTION public.sync_broker_call_to_vip_outreach()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tier public.user_tier_type;
  v_mask text;
  v_loc text;
  v_outreach_status text;
  v_intent text;
BEGIN
  -- Get user tier of the initiator
  SELECT user_tier INTO v_tier FROM public.profiles WHERE id = NEW.sender_profile_id;
  
  -- Only sync if initiator is VIP or ASSISTED
  IF v_tier IN ('VIP'::public.user_tier_type, 'ASSISTED'::public.user_tier_type) THEN
    -- Format candidate's mask name and get location
    SELECT 
      coalesce(split_part(full_name, ' ', 1), 'Candidate') || coalesce(' ' || substring(split_part(full_name, ' ', 2) from 1 for 1) || '.', ''),
      coalesce(location, 'Unknown location')
    INTO v_mask, v_loc
    from public.profiles
    where id = NEW.target_profile_id;

    -- Map status
    IF NEW.status IN ('queued', 'dialing', 'in_progress', 'consent_required', 'consent_granted') THEN
      v_outreach_status := 'Outreach Initiated';
    ELSIF NEW.status = 'completed' then
      -- Analyze outcome / summary intent for negative indicator
      v_intent := lower(coalesce(NEW.outcome, (NEW.summary->>'intent'), ''));
      IF v_intent ~ 'decline|closed|stop|not[_\s-]?interested|pause' THEN
        v_outreach_status := 'declined';
      ELSE
        v_outreach_status := 'completed';
      END IF;
    ELSE
      -- failed, no_answer, cancelled
      v_outreach_status := 'failed';
    END IF;

    -- Insert into public.vip_outreach_logs
    INSERT INTO public.vip_outreach_logs (vip_id, candidate_id, mask, compatibility, location, status, timestamp)
    VALUES (NEW.sender_profile_id, NEW.target_profile_id, v_mask, 90, v_loc, v_outreach_status, now());
    
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Attach sync trigger to public.ai_broker_calls
DROP TRIGGER IF EXISTS sync_broker_call_trigger ON public.ai_broker_calls;
CREATE TRIGGER sync_broker_call_trigger
  AFTER INSERT OR UPDATE ON public.ai_broker_calls
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_broker_call_to_vip_outreach();
