-- Fix: array_length('{}', 1) returns NULL in PostgreSQL, not 0.
-- Replace with cardinality() which correctly returns 0 for empty arrays.
-- This was silently blocking all candidates when pref_marital_status = '{}'.

drop function if exists public.match_profiles(integer, uuid, integer, integer, integer, integer, text, text[], text, text, text, text, text);
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
  p_location_flexibility    text     default null
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
  similarity                double precision
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
    end as similarity
  from public.profiles c, viewer
  where c.id <> coalesce(p_viewer_id, auth.uid())
    and c.onboarding_completed_at is not null
    and public.is_partner_gender_match(c.gender, viewer.partner_gender_preference)
    and (viewer.eff_age_min   is null or date_part('year', age(c.dob)) >= viewer.eff_age_min)
    and (viewer.eff_age_max   is null or date_part('year', age(c.dob)) <= viewer.eff_age_max)
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
  order by similarity desc, c.created_at desc
  limit result_limit;
$$;
grant execute on function public.match_profiles(
  integer, uuid, integer, integer, integer, integer,
  text, text[], text, text, text, text, text
) to authenticated;
