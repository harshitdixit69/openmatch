alter table public.profiles
add column if not exists partner_gender_preference text;
create or replace function public.normalize_match_gender(value text)
returns text
language sql
immutable
as $$
    select case
        when value is null or btrim(value) = '' then null
        when lower(btrim(value)) in ('man', 'male') then 'man'
        when lower(btrim(value)) in ('woman', 'female') then 'woman'
        when lower(btrim(value)) in ('non-binary', 'non binary', 'nonbinary') then 'non-binary'
        when lower(btrim(value)) in ('everyone', 'all', 'any', 'anyone', 'open to all', 'no preference') then 'everyone'
        else lower(btrim(value))
    end
$$;
create or replace function public.default_partner_gender_preference(profile_gender text)
returns text
language sql
immutable
as $$
    select case public.normalize_match_gender(profile_gender)
        when 'man' then 'Woman'
        when 'woman' then 'Man'
        else 'Everyone'
    end
$$;
create or replace function public.is_partner_gender_match(candidate_gender text, preference text)
returns boolean
language sql
immutable
as $$
    select case
        when public.normalize_match_gender(preference) is null then true
        when public.normalize_match_gender(preference) = 'everyone' then true
        else public.normalize_match_gender(candidate_gender) = public.normalize_match_gender(preference)
    end
$$;
update public.profiles
set partner_gender_preference = public.default_partner_gender_preference(gender)
where partner_gender_preference is null
   or btrim(partner_gender_preference) = '';
drop function if exists public.match_profiles(integer);
create function public.match_profiles(result_limit integer default 20)
returns table (
    id uuid,
    full_name text,
    gender text,
    dob date,
    location text,
    bio text,
    preferences text,
    height_cm integer,
    profile_owner public.profile_owner_type,
    partner_gender_preference text,
    similarity double precision
)
language sql
security definer
set search_path = public
as $$
    with viewer as (
        select
            id,
            embedding,
            gender,
            coalesce(
                nullif(partner_gender_preference, ''),
                public.default_partner_gender_preference(gender)
            ) as partner_gender_preference
        from public.profiles
        where id = auth.uid()
    )
    select
        candidate.id,
        candidate.full_name,
        candidate.gender,
        candidate.dob,
        candidate.location,
        candidate.bio,
        candidate.preferences,
        candidate.height_cm,
        candidate.profile_owner,
        coalesce(
            nullif(candidate.partner_gender_preference, ''),
            public.default_partner_gender_preference(candidate.gender)
        ) as partner_gender_preference,
        1 - (candidate.embedding <=> viewer.embedding) as similarity
    from viewer
    join public.profiles as candidate
        on candidate.id <> viewer.id
    where viewer.embedding is not null
      and candidate.embedding is not null
      and public.is_partner_gender_match(candidate.gender, viewer.partner_gender_preference)
      and public.is_partner_gender_match(
          viewer.gender,
          coalesce(
              nullif(candidate.partner_gender_preference, ''),
              public.default_partner_gender_preference(candidate.gender)
          )
      )
    order by candidate.embedding <=> viewer.embedding
    limit greatest(coalesce(result_limit, 20), 1)
$$;
grant execute on function public.match_profiles(integer) to authenticated;
