alter table public.profiles
add column if not exists photo_urls text[] not null default '{}'::text[];
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'profile-photos',
    'profile-photos',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Profile photos are public" on storage.objects;
create policy "Profile photos are public" on storage.objects
    for select using (bucket_id = 'profile-photos');
drop policy if exists "Users can upload their profile photos" on storage.objects;
create policy "Users can upload their profile photos" on storage.objects
    for insert to authenticated with check (
        bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
drop policy if exists "Users can update their profile photos" on storage.objects;
create policy "Users can update their profile photos" on storage.objects
    for update to authenticated
    using (
        bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    )
    with check (
        bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
drop policy if exists "Users can delete their profile photos" on storage.objects;
create policy "Users can delete their profile photos" on storage.objects
    for delete to authenticated using (
        bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
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
    photo_urls text[],
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
        coalesce(candidate.photo_urls, '{}'::text[]) as photo_urls,
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
