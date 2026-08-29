-- Guest browsing (Phase 1): let logged-out visitors preview a sanitized,
-- opt-in-only set of profiles so they can browse before signing up.
--
-- Privacy design:
--   * Members are only shown to guests if they explicitly opt in
--     (guest_visible = true). Default is FALSE — nobody is exposed silently.
--   * The RPC is SECURITY DEFINER so we never loosen RLS on `profiles`.
--     It returns ONLY sanitized fields: first name, age, city, one photo,
--     a short bio, and a verified flag. No contact info, no exact DOB,
--     no exact location, no email/phone.

-- 1) Opt-in flag ------------------------------------------------------------
alter table public.profiles
    add column if not exists guest_visible boolean not null default false;

comment on column public.profiles.guest_visible is
    'When true, a sanitized version of this profile may be shown to logged-out guest users.';

-- 2) Sanitized guest feed RPC ----------------------------------------------
create or replace function public.guest_feed(feed_limit integer default 12)
returns table (
    id uuid,
    first_name text,
    age integer,
    city text,
    photo_url text,
    short_bio text,
    verified boolean
)
language sql
security definer
set search_path = public
stable
as $$
    select
        p.id,
        -- first name only
        nullif(split_part(coalesce(p.full_name, ''), ' ', 1), '') as first_name,
        -- age derived from dob (no exact DOB exposed)
        case
            when p.dob is not null then date_part('year', age(p.dob::date))::integer
            else null
        end as age,
        -- city-level location only (strip everything after the first comma)
        nullif(trim(split_part(coalesce(p.location, ''), ',', 1)), '') as city,
        -- first photo only
        case
            when array_length(p.photo_urls, 1) >= 1 then p.photo_urls[1]
            else null
        end as photo_url,
        -- trimmed bio preview
        left(coalesce(p.bio, ''), 160) as short_bio,
        coalesce(p.verification_status = 'verified', false) as verified
    from public.profiles p
    where p.guest_visible = true
      and p.onboarding_completed_at is not null
      and array_length(p.photo_urls, 1) >= 1
      and coalesce(p.busy_mode, false) = false
    order by random()
    limit greatest(1, least(feed_limit, 30));
$$;

comment on function public.guest_feed(integer) is
    'Returns a sanitized, opt-in-only set of profiles for logged-out guest browsing.';

-- 3) Allow anonymous (logged-out) callers to execute -----------------------
grant execute on function public.guest_feed(integer) to anon, authenticated;
