-- Migration: Setup Assisted Shortlists and Sourcing Automation
-- Target: hosted Supabase database

-- 1. Enable pg_net and pg_cron if they are not already enabled
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Create assisted_shortlists table
CREATE TABLE IF NOT EXISTS public.assisted_shortlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    session_id UUID REFERENCES public.assisted_concierge_sessions(id) ON DELETE CASCADE NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT assisted_shortlists_user_session_key UNIQUE (user_id, session_id)
);

-- Enable RLS for assisted_shortlists
ALTER TABLE public.assisted_shortlists ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies for assisted_shortlists
DROP POLICY IF EXISTS "Users can view their own shortlists" ON public.assisted_shortlists;
CREATE POLICY "Users can view their own shortlists" ON public.assisted_shortlists
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can manage their own shortlists" ON public.assisted_shortlists;
CREATE POLICY "Users can manage their own shortlists" ON public.assisted_shortlists
    FOR ALL USING (user_id = auth.uid());

-- 3. Create assisted_shortlist_items table
CREATE TABLE IF NOT EXISTS public.assisted_shortlist_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shortlist_id UUID REFERENCES public.assisted_shortlists(id) ON DELETE CASCADE NOT NULL,
    candidate_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    match_score FLOAT,
    match_rationale TEXT NOT NULL,
    feedback_status TEXT NOT NULL DEFAULT 'pending' CHECK (feedback_status IN ('pending', 'liked', 'disliked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT assisted_shortlist_items_shortlist_candidate_key UNIQUE (shortlist_id, candidate_id)
);

-- Enable RLS for assisted_shortlist_items
ALTER TABLE public.assisted_shortlist_items ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies for assisted_shortlist_items
DROP POLICY IF EXISTS "Users can view items in their own shortlists" ON public.assisted_shortlist_items;
CREATE POLICY "Users can view items in their own shortlists" ON public.assisted_shortlist_items
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.assisted_shortlists s
            WHERE s.id = shortlist_id AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can update feedback status on their own shortlist items" ON public.assisted_shortlist_items;
CREATE POLICY "Users can update feedback status on their own shortlist items" ON public.assisted_shortlist_items
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.assisted_shortlists s
            WHERE s.id = shortlist_id AND s.user_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.assisted_shortlists s
            WHERE s.id = shortlist_id AND s.user_id = auth.uid()
        )
    );

-- Grant access to authenticated users and service_role
GRANT ALL ON public.assisted_shortlists TO authenticated, service_role;
GRANT ALL ON public.assisted_shortlist_items TO authenticated, service_role;

-- 4. Create Sourcing RPC Function
CREATE OR REPLACE FUNCTION public.get_sourcing_candidates(
  p_user_id UUID,
  p_limit INT DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  full_name TEXT,
  gender TEXT,
  dob DATE,
  location TEXT,
  bio TEXT,
  preferences TEXT,
  photo_urls TEXT[],
  height_cm INTEGER,
  occupation TEXT,
  education TEXT,
  diet TEXT,
  smokes BOOLEAN,
  drinks_alcohol BOOLEAN,
  match_score FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gender TEXT;
  v_pref_gender TEXT;
  v_age_min INT;
  v_age_max INT;
  v_embedding vector(1536);
  v_candidates_count INT;
BEGIN
  -- Fetch query user profile details
  SELECT 
    gender, 
    coalesce(nullif(partner_gender_preference, ''), public.default_partner_gender_preference(gender)),
    pref_age_min,
    pref_age_max,
    embedding
  INTO v_gender, v_pref_gender, v_age_min, v_age_max, v_embedding
  FROM public.profiles
  WHERE profiles.id = p_user_id;

  -- Ensure we have an embedding
  IF v_embedding IS NULL THEN
    RETURN;
  END IF;

  -- 1. Try to query with strict criteria
  RETURN QUERY
  SELECT 
    c.id,
    c.full_name,
    c.gender,
    c.dob,
    c.location,
    c.bio,
    c.preferences,
    c.photo_urls,
    c.height_cm,
    c.occupation,
    c.education,
    c.diet,
    c.smokes,
    c.drinks_alcohol,
    (1 - (c.embedding <=> v_embedding))::FLOAT AS match_score
  FROM public.profiles c
  WHERE c.id <> p_user_id
    and c.embedding IS NOT NULL
    and c.onboarding_completed_at IS NOT NULL
    and public.is_partner_gender_match(c.gender, v_pref_gender)
    and public.is_partner_gender_match(v_gender, coalesce(nullif(c.partner_gender_preference, ''), public.default_partner_gender_preference(c.gender)))
    -- Exclude candidates already in assisted_shortlist_items for this user
    and not exists (
      SELECT 1 FROM public.assisted_shortlist_items search_asi
      JOIN public.assisted_shortlists search_asl ON search_asi.shortlist_id = search_asl.id
      WHERE search_asl.user_id = p_user_id AND search_asi.candidate_id = c.id
    )
    and (v_age_min is null or date_part('year', age(c.dob)) >= v_age_min)
    and (v_age_max is null or date_part('year', age(c.dob)) <= v_age_max)
  ORDER BY c.embedding <=> v_embedding ASC
  LIMIT p_limit;

  -- Count rows returned
  GET DIAGNOSTICS v_candidates_count = ROW_COUNT;

  -- 2. Fallback: if we didn't find enough, relax age bounds by +/- 5 years
  IF v_candidates_count < p_limit THEN
    RETURN QUERY
    SELECT 
      c.id,
      c.full_name,
      c.gender,
      c.dob,
      c.location,
      c.bio,
      c.preferences,
      c.photo_urls,
      c.height_cm,
      c.occupation,
      c.education,
      c.diet,
      c.smokes,
      c.drinks_alcohol,
      (1 - (c.embedding <=> v_embedding))::FLOAT AS match_score
    FROM public.profiles c
    WHERE c.id <> p_user_id
      and c.embedding IS NOT NULL
      and c.onboarding_completed_at IS NOT NULL
      and public.is_partner_gender_match(c.gender, v_pref_gender)
      and public.is_partner_gender_match(v_gender, coalesce(nullif(c.partner_gender_preference, ''), public.default_partner_gender_preference(c.gender)))
      and not exists (
        SELECT 1 FROM public.assisted_shortlist_items search_asi2
        JOIN public.assisted_shortlists search_asl2 ON search_asi2.shortlist_id = search_asl2.id
        WHERE search_asl2.user_id = p_user_id AND search_asi2.candidate_id = c.id
      )
      -- Exclude those already selected in strict step to avoid duplicates
      and c.id not in (
        SELECT res.id FROM (
          SELECT c2.id
          FROM public.profiles c2
          WHERE c2.id <> p_user_id
            and c2.embedding IS NOT NULL
            and c2.onboarding_completed_at IS NOT NULL
            and public.is_partner_gender_match(c2.gender, v_pref_gender)
            and public.is_partner_gender_match(v_gender, coalesce(nullif(c2.partner_gender_preference, ''), public.default_partner_gender_preference(c2.gender)))
            and not exists (
              SELECT 1 FROM public.assisted_shortlist_items search_asi3
              JOIN public.assisted_shortlists search_asl3 ON search_asi3.shortlist_id = search_asl3.id
              WHERE search_asl3.user_id = p_user_id AND search_asi3.candidate_id = c2.id
            )
            and (v_age_min is null or date_part('year', age(c2.dob)) >= v_age_min)
            and (v_age_max is null or date_part('year', age(c2.dob)) <= v_age_max)
          ORDER BY c2.embedding <=> v_embedding ASC
          LIMIT p_limit
        ) res
      )
      and (v_age_min is null or date_part('year', age(c.dob)) >= (v_age_min - 5))
      and (v_age_max is null or date_part('year', age(c.dob)) <= (v_age_max + 5))
    ORDER BY c.embedding <=> v_embedding ASC
    LIMIT (p_limit - v_candidates_count);
  END IF;
END;
$$;

-- Grant execute to authenticated users and service_role
GRANT EXECUTE ON FUNCTION public.get_sourcing_candidates(UUID, INT) TO authenticated, service_role;

-- 5. Create trigger_assisted_sourcing RPC Function using pg_net
CREATE OR REPLACE FUNCTION public.trigger_assisted_sourcing(p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_service_key TEXT;
  v_url TEXT;
  v_session_id UUID;
BEGIN
  -- Get active session
  SELECT id INTO v_session_id 
  FROM public.assisted_concierge_sessions 
  WHERE user_id = p_user_id AND status = 'AWAITING_SHORTLIST'
  LIMIT 1;

  IF v_session_id IS NULL THEN
    RETURN;
  END IF;

  -- Look up the service role key from vault decrypted secrets if present
  SELECT decrypted_secret INTO v_service_key 
  FROM vault.decrypted_secrets 
  WHERE name = 'service_role_key' 
  LIMIT 1;

  -- Fallback: if not in vault, check if we can read it from GUC
  IF v_service_key IS NULL THEN
    v_service_key := current_setting('private.service_role_key', true);
  END IF;

  v_url := 'https://oxdhkjernhpkscrideby.supabase.co/functions/v1/generate-assisted-shortlist';

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', COALESCE('Bearer ' || v_service_key, '')
    ),
    body := jsonb_build_object(
      'user_id', p_user_id,
      'session_id', v_session_id
    )
  );
END;
$$;

-- Grant execute to service_role and cron
GRANT EXECUTE ON FUNCTION public.trigger_assisted_sourcing(UUID) TO service_role;

-- 6. Setup pg_cron job automation
-- Deletes existing schedule if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'assisted-sourcing-cron') THEN
    PERFORM cron.unschedule('assisted-sourcing-cron');
  END IF;
END
$$;

-- Schedule a daily check at midnight UTC (or run every hour for responsive testing)
SELECT cron.schedule(
  'assisted-sourcing-cron',
  '0 * * * *', -- every hour
  $$
  SELECT public.trigger_assisted_sourcing(session.user_id)
  FROM public.assisted_concierge_sessions session
  WHERE session.status = 'AWAITING_SHORTLIST';
  $$
);
