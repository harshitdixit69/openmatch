-- Migration: Discovery & safety settings
--
-- The Settings screen shipped a "Discovery & safety" section whose toggles were
-- pure client-side useState: nothing was persisted and nothing was enforced.
-- This migration adds the backing columns and wires them into the two places
-- that actually need to respect them:
--
--   1. profiles.is_discoverable  -> match_profiles() must not return the user
--   2. profiles.incognito_mode   -> upsert_profile_view() must not record a view
--
-- Both default to the permissive value so existing rows keep current behaviour.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_discoverable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS incognito_mode  boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_discoverable IS
  'When false the profile is excluded from match_profiles() feeds. Existing matches and chats are unaffected.';
COMMENT ON COLUMN public.profiles.incognito_mode IS
  'When true this user browsing a profile does not create a profile_views row, so they stay out of the other person''s visitor list.';

-- Partial index: the feed filters on is_discoverable on every call, and the
-- selective side is the small set of hidden profiles.
CREATE INDEX IF NOT EXISTS profiles_not_discoverable_idx
  ON public.profiles (id)
  WHERE is_discoverable = false;

-- ---------------------------------------------------------------------------
-- 2. Enforce incognito on view recording
-- ---------------------------------------------------------------------------
-- Enforced server-side rather than by skipping the client call, so a user who
-- flips the toggle is protected even if a stale client keeps calling the RPC.

CREATE OR REPLACE FUNCTION public.upsert_profile_view(
  p_viewed_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_viewer_id uuid := auth.uid();
  v_incognito boolean;
begin
  if v_viewer_id is null then
    return; -- unauthenticated — silently no-op
  end if;

  if v_viewer_id = p_viewed_id then
    return; -- no self-views
  end if;

  select p.incognito_mode into v_incognito
  from public.profiles p
  where p.id = v_viewer_id;

  if coalesce(v_incognito, false) then
    return; -- incognito browsing leaves no trace
  end if;

  insert into public.profile_views (viewer_id, viewed_id, view_date, viewed_at)
  values (v_viewer_id, p_viewed_id, (timezone('utc'::text, now()))::date, timezone('utc'::text, now()))
  on conflict (viewer_id, viewed_id, view_date)
  do update set viewed_at = excluded.viewed_at;
end;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_profile_view(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Enforce profile visibility in the feed
-- ---------------------------------------------------------------------------
-- Body is carried over verbatim from 20260718023500_add_subscription_tier_to_match_profiles.sql
-- with a single added predicate: `and c.is_discoverable`.

DROP FUNCTION IF EXISTS public.match_profiles(integer, uuid, integer, integer, integer, integer, text, text[], text, text, text, text, text, integer, integer);

CREATE OR REPLACE FUNCTION public.match_profiles(
  result_limit              integer  default 20,
  p_viewer_id               uuid     default null,
  p_age_min                 integer  default null,
  p_age_max                 integer  default null,
  p_height_min              integer  default null,
  p_height_max              integer  default null,
  p_religion                text     default null,
  p_marital_status          text[]   default null,
  p_education               text     default null,
  p_income_band             text     default null,
  p_diet                    text     default null,
  p_mother_tongue           text     default null,
  p_location_flexibility    text     default null,
  p_max_distance_km         integer  default null,
  p_offset                  integer  default 0
)
RETURNS TABLE (
  id                        uuid,
  full_name                 text,
  gender                    text,
  dob                       date,
  location                  text,
  bio                       text,
  preferences               text,
  photo_urls                text[],
  height_cm                 integer,
  profile_owner             public.profile_owner_type,
  partner_gender_preference text,
  similarity                double precision,
  distance_km               double precision,
  verification_status       text,
  subscription_tier         text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  with viewer as (
    select
      v.id,
      v.embedding,
      v.gender,
      coalesce(
        nullif(v.partner_gender_preference, ''),
        public.default_partner_gender_preference(v.gender)
      ) as partner_gender_preference,
      coalesce(p_age_min,              v.pref_age_min)             as eff_age_min,
      coalesce(p_age_max,              v.pref_age_max)             as eff_age_max,
      case
        when coalesce(p_age_min, v.pref_age_min) is not null
          then (now() - (coalesce(p_age_min, v.pref_age_min) * interval '1 year'))::date
        else null
      end as dob_max,
      case
        when coalesce(p_age_max, v.pref_age_max) is not null
          then (now() - ((coalesce(p_age_max, v.pref_age_max) + 1) * interval '1 year') + interval '1 day')::date
        else null
      end as dob_min,
      coalesce(p_height_min,           v.pref_height_min)          as eff_height_min,
      coalesce(p_height_max,           v.pref_height_max)          as eff_height_max,
      coalesce(p_religion,             v.pref_religion)            as eff_religion,
      coalesce(p_marital_status,       v.pref_marital_status)      as eff_marital_status,
      coalesce(p_education,            v.pref_education)           as eff_education,
      coalesce(p_income_band,          v.pref_income_band)         as eff_income_band,
      coalesce(p_diet,                 v.pref_diet)                as eff_diet,
      coalesce(p_mother_tongue,        v.pref_mother_tongue)       as eff_mother_tongue,
      coalesce(p_location_flexibility, v.pref_location_flexibility) as eff_location_flexibility
    from public.profiles v
    where v.id = coalesce(p_viewer_id, auth.uid())
  )
  select
    c.id,
    c.full_name,
    c.gender,
    c.dob,
    c.location,
    c.bio,
    c.preferences,
    c.photo_urls,
    c.height_cm,
    c.profile_owner,
    coalesce(
      nullif(c.partner_gender_preference, ''),
      public.default_partner_gender_preference(c.gender)
    ) as partner_gender_preference,
    case
      when viewer.embedding is not null and c.embedding is not null
        then 1 - (c.embedding <=> viewer.embedding)
      else 0
    end as similarity,
    (st_distance(loc_v.geog, loc_c.geog) / 1000.0) as distance_km,
    c.verification_status,
    c.subscription_tier
  from public.profiles c
  join viewer on c.id <> viewer.id
  left join public.profile_locations loc_v on loc_v.profile_id = viewer.id
  left join public.profile_locations loc_c on loc_c.profile_id = c.id
  where c.onboarding_completed_at is not null
    -- Discovery & safety: hidden profiles never enter anyone's feed.
    and c.is_discoverable
    and public.is_partner_gender_match(c.gender, viewer.partner_gender_preference)
    and (viewer.dob_max is null or c.dob <= viewer.dob_max)
    and (viewer.dob_min is null or c.dob >= viewer.dob_min)
    and (viewer.eff_height_min is null or c.height_cm is null or c.height_cm >= viewer.eff_height_min)
    and (viewer.eff_height_max is null or c.height_cm is null or c.height_cm <= viewer.eff_height_max)
    -- Religion check
    and (
      viewer.eff_religion is null
      or lower(viewer.eff_religion) = 'any'
      or c.religion is null
      or lower(c.religion) = lower(viewer.eff_religion)
    )
    -- Diet check
    and (
      viewer.eff_diet is null
      or lower(viewer.eff_diet) = 'any'
      or c.diet is null
      or lower(c.diet) = lower(viewer.eff_diet)
    )
    -- Marital status check
    and (
      viewer.eff_marital_status is null
      or cardinality(viewer.eff_marital_status) = 0
      or c.marital_status is null
      or c.marital_status = any(viewer.eff_marital_status)
    )
    and not public.is_blocked_mutually(viewer.id, c.id)
    and (
      p_max_distance_km is null
      or (
        loc_v.geog is not null
        and loc_c.geog is not null
        and st_dwithin(loc_v.geog, loc_c.geog, p_max_distance_km * 1000.0)
      )
    )
    -- Exclusion logic
    and not exists (
      select 1 from public.matches m
      where (
        (m.user_1_id = viewer.id and m.user_2_id = c.id)
        or (m.user_1_id = c.id and m.user_2_id = viewer.id)
      )
      and (
        m.status in ('connected', 'pending', 'rejected')
        or (
          m.status = 'passed'
          and m.passed_at is not null
          and m.passed_at > (now() - interval '30 days')
        )
      )
    )
  -- PRIORITIZE active spotlights, then sort by vector similarity
  order by (c.spotlight_active_until is not null and c.spotlight_active_until > now()) desc, similarity desc, c.created_at desc
  limit result_limit
  offset p_offset;
$$;

grant execute on function public.match_profiles(integer, uuid, integer, integer, integer, integer, text, text[], text, text, text, text, text, integer, integer) to authenticated;
