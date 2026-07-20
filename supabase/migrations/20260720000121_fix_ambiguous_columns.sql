-- Migration: Fix ambiguous column references in get_sourcing_candidates function
-- Target: hosted Supabase database

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
#variable_conflict use_column
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
