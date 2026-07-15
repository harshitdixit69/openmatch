-- Phase: Partner Preferences
-- Adds structured partner preference columns to public.profiles.
-- Columns live inline on profiles so embedding + preference reads
-- stay in a single query. Future isolation path: extract to a
-- partner_preferences table (profile_id PK + FK) and replace
-- usages here with a materialized view or JOIN.

alter table public.profiles
  add column if not exists pref_age_min               integer,
  add column if not exists pref_age_max               integer,
  add column if not exists pref_height_min            integer,
  add column if not exists pref_height_max            integer,
  add column if not exists pref_religion              text,
  add column if not exists pref_marital_status        text[]   not null default '{}'::text[],
  add column if not exists pref_education             text,
  add column if not exists pref_income_band           text,
  add column if not exists pref_diet                  text,
  add column if not exists pref_mother_tongue         text,
  add column if not exists pref_location_flexibility  text,
  add column if not exists pref_profile_owner         text[];
-- Cross-column sanity constraints
alter table public.profiles
  drop constraint if exists pref_age_range_order,
  drop constraint if exists pref_height_range_order,
  drop constraint if exists pref_age_min_bounds,
  drop constraint if exists pref_age_max_bounds,
  drop constraint if exists pref_height_min_bounds,
  drop constraint if exists pref_height_max_bounds;
alter table public.profiles
  add constraint pref_age_min_bounds     check (pref_age_min    is null or (pref_age_min    between 18 and 99)),
  add constraint pref_age_max_bounds     check (pref_age_max    is null or (pref_age_max    between 18 and 99)),
  add constraint pref_age_range_order    check (pref_age_min    is null or pref_age_max    is null or pref_age_min    <= pref_age_max),
  add constraint pref_height_min_bounds  check (pref_height_min is null or (pref_height_min between 100 and 250)),
  add constraint pref_height_max_bounds  check (pref_height_max is null or (pref_height_max between 100 and 250)),
  add constraint pref_height_range_order check (pref_height_min is null or pref_height_max is null or pref_height_min <= pref_height_max);
-- Replace match_profiles() to accept per-call filter overrides.
-- When an override param is null the viewer's stored pref is used
-- as the default; when that is also null the filter is skipped entirely.
-- This lets both the Discovery feed (no overrides) and the Search page
-- (explicit overrides) share one function.

drop function if exists public.match_profiles(integer);
create or replace function public.match_profiles(
  result_limit              integer  default 20,
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
      coalesce(p_age_min,             v.pref_age_min)            as eff_age_min,
      coalesce(p_age_max,             v.pref_age_max)            as eff_age_max,
      coalesce(p_height_min,          v.pref_height_min)         as eff_height_min,
      coalesce(p_height_max,          v.pref_height_max)         as eff_height_max,
      coalesce(p_religion,            v.pref_religion)           as eff_religion,
      coalesce(p_marital_status,      v.pref_marital_status)     as eff_marital_status,
      coalesce(p_education,           v.pref_education)          as eff_education,
      coalesce(p_income_band,         v.pref_income_band)        as eff_income_band,
      coalesce(p_diet,                v.pref_diet)               as eff_diet,
      coalesce(p_mother_tongue,       v.pref_mother_tongue)      as eff_mother_tongue,
      coalesce(p_location_flexibility, v.pref_location_flexibility) as eff_location_flexibility
    from public.profiles v
    where v.id = auth.uid()
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
  where c.id <> auth.uid()
    and c.onboarding_completed_at is not null
    and public.is_partner_gender_match(c.gender, viewer.partner_gender_preference)
    -- age range (skip if no effective preference)
    and (viewer.eff_age_min  is null or date_part('year', age(c.dob)) >= viewer.eff_age_min)
    and (viewer.eff_age_max  is null or date_part('year', age(c.dob)) <= viewer.eff_age_max)
    -- height range (skip if candidate has no height on file)
    and (viewer.eff_height_min is null or c.height_cm is null or c.height_cm >= viewer.eff_height_min)
    and (viewer.eff_height_max is null or c.height_cm is null or c.height_cm <= viewer.eff_height_max)
    -- religion: null or 'Any' skips filter; otherwise LIKE bridge until structured profile col lands
    and (
      viewer.eff_religion is null
      or lower(viewer.eff_religion) = 'any'
      or lower(coalesce(c.preferences, '')) like '%' || lower(viewer.eff_religion) || '%'
    )
    -- diet: same LIKE bridge
    and (
      viewer.eff_diet is null
      or lower(viewer.eff_diet) = 'any'
      or lower(coalesce(c.preferences, '')) like '%' || lower(viewer.eff_diet) || '%'
    )
    -- marital status: empty array = no filter
    and (
      viewer.eff_marital_status is null
      or array_length(viewer.eff_marital_status, 1) = 0
      or lower(coalesce(c.preferences, '')) like any(
           select '%' || lower(s) || '%' from unnest(viewer.eff_marital_status) as s
         )
    )
  order by similarity desc, c.created_at desc
  limit result_limit;
$$;
grant execute on function public.match_profiles(
  integer, integer, integer, integer, integer,
  text, text[], text, text, text, text, text
) to authenticated;
