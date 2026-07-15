-- Migration: Optimize match_profiles for hybrid B-tree + pgvector search and exclude active matches

-- 1. Create B-Tree indexes on dealbreaker columns for fast pre-filtering
create index if not exists profiles_onboarding_completed_at_idx
  on public.profiles (onboarding_completed_at)
  where onboarding_completed_at is not null;

create index if not exists profiles_gender_idx
  on public.profiles (gender);

create index if not exists profiles_dob_idx
  on public.profiles (dob);

create index if not exists profiles_religion_idx
  on public.profiles (religion);

create index if not exists profiles_diet_idx
  on public.profiles (diet);

create index if not exists profiles_marital_status_idx
  on public.profiles (marital_status);

-- 2. Drop the existing match_profiles function to overwrite signature safely
drop function if exists public.match_profiles(
  integer, uuid, integer, integer, integer, integer, text, text[], text, text, text, text, text, integer
);

-- 3. Create the optimized match_profiles function
create or replace function public.match_profiles(
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
  p_max_distance_km         integer  default null
)
returns table (
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
  distance_km               double precision
)
language sql
security definer
set search_path = public
as $$
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
      -- Compute direct date ranges for index-optimized age filtering
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
    (st_distance(loc_v.geog, loc_c.geog) / 1000.0) as distance_km
  from public.profiles c
  join viewer on c.id <> viewer.id
  left join public.profile_locations loc_v on loc_v.profile_id = viewer.id
  left join public.profile_locations loc_c on loc_c.profile_id = c.id
  where c.onboarding_completed_at is not null
    and public.is_partner_gender_match(c.gender, viewer.partner_gender_preference)
    -- index-optimized direct B-Tree checks on date of birth range
    and (viewer.dob_max is null or c.dob <= viewer.dob_max)
    and (viewer.dob_min is null or c.dob >= viewer.dob_min)
    and (viewer.eff_height_min is null or c.height_cm is null or c.height_cm >= viewer.eff_height_min)
    and (viewer.eff_height_max is null or c.height_cm is null or c.height_cm <= viewer.eff_height_max)
    and (
      viewer.eff_religion is null
      or lower(viewer.eff_religion) = 'any'
      or lower(coalesce(c.religion, '')) = lower(viewer.eff_religion)
      or (c.religion is null and lower(coalesce(c.preferences, '')) like '%' || lower(viewer.eff_religion) || '%')
    )
    and (
      viewer.eff_diet is null
      or lower(viewer.eff_diet) = 'any'
      or lower(coalesce(c.diet, '')) = lower(viewer.eff_diet)
      or (c.diet is null and lower(coalesce(c.preferences, '')) like '%' || lower(viewer.eff_diet) || '%')
    )
    and (
      viewer.eff_marital_status is null
      or cardinality(viewer.eff_marital_status) = 0
      or c.marital_status = any(viewer.eff_marital_status)
      or (
           c.marital_status is null
           and lower(coalesce(c.preferences, '')) like any(
                 select '%' || lower(s) || '%' from unnest(viewer.eff_marital_status) as s
               )
         )
    )
    -- block filter: exclude blocked or blocking relationships
    and not public.is_blocked_mutually(viewer.id, c.id)
    -- distance filter
    and (
      p_max_distance_km is null
      or (
        loc_v.geog is not null 
        and loc_c.geog is not null 
        and st_dwithin(loc_v.geog, loc_c.geog, p_max_distance_km * 1000.0)
      )
    )
    -- exclude profiles that have already been matched or match requested
    and not exists (
      select 1 from public.matches m
      where (
        (m.user_1_id = viewer.id and m.user_2_id = c.id)
        or (m.user_1_id = c.id and m.user_2_id = viewer.id)
      )
      and m.status in ('connected', 'pending')
    )
  order by similarity desc, c.created_at desc
  limit result_limit;
$$;

grant execute on function public.match_profiles(
  integer, uuid, integer, integer, integer, integer,
  text, text[], text, text, text, text, text, integer
) to authenticated;
