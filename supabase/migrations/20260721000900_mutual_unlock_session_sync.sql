-- Migration: Auto-sync mutual unlocks to concierge session status
CREATE OR REPLACE FUNCTION public.handle_mutual_unlock_session_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Trigger when matches.is_unlocked becomes true
  IF NEW.is_unlocked = true AND (TG_OP = 'INSERT' OR OLD.is_unlocked = false OR OLD.is_unlocked IS NULL) THEN
    
    -- Update Seeker 1 session status if active
    UPDATE public.assisted_concierge_sessions
    SET status = 'MUTUAL_UNLOCKED', updated_at = now()
    WHERE user_id = NEW.user_1_id;

    -- Update Seeker 2 session status if active
    UPDATE public.assisted_concierge_sessions
    SET status = 'MUTUAL_UNLOCKED', updated_at = now()
    WHERE user_id = NEW.user_2_id;

  END IF;
  RETURN NEW;
END;
$$;

-- Attach trigger to public.matches
DROP TRIGGER IF EXISTS mutual_unlock_session_sync_trigger ON public.matches;
CREATE TRIGGER mutual_unlock_session_sync_trigger
  AFTER INSERT OR UPDATE OF is_unlocked ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_mutual_unlock_session_sync();
