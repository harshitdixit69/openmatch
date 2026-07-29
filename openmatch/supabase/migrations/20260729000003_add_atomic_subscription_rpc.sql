-- H21: Atomic subscription processing function
-- Prevents race conditions from concurrent Stripe webhooks by performing
-- credit additions and subscription updates in a single atomic SQL operation.

CREATE OR REPLACE FUNCTION atomic_process_subscription(
    p_user_id UUID,
    p_tier TEXT,
    p_months INT,
    p_new_credits INT,
    p_new_ai_calls INT
) RETURNS VOID AS $$
DECLARE
    v_current_expiry TIMESTAMPTZ;
BEGIN
    -- Get current expiry (use NOW() if null or in the past)
    SELECT GREATEST(COALESCE(subscription_expires_at, NOW()), NOW())
    INTO v_current_expiry
    FROM profiles
    WHERE id = p_user_id;

    -- Atomic update: increment credits and extend subscription
    UPDATE profiles
    SET
        subscription_tier = p_tier,
        subscription_expires_at = v_current_expiry + (p_months || ' months')::INTERVAL,
        unlock_credits_remaining = COALESCE(unlock_credits_remaining, 0) + p_new_credits,
        ai_call_credits = COALESCE(ai_call_credits, 0) + p_new_ai_calls,
        updated_at = NOW()
    WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
