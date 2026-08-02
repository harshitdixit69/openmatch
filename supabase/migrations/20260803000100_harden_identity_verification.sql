-- Migration: Harden identity verification (server-only trust + private ID storage)
-- Addresses:
--   * Client-controlled verification badge (users could self-set verification_status = 'verified')
--   * Government IDs stored in a PUBLIC bucket (privacy/compliance violation)
--
-- After this migration, verification_status / verification_id_url / verification_selfie_url
-- can only be changed by the service role (the verify-identity-ai Edge Function). Any attempt
-- to change them from a normal user session is silently reverted to the previous value.

-- 1. Private bucket for raw KYC documents (Aadhaar/PAN/Passport + verification selfie).
--    public = false → objects are NOT reachable via getPublicUrl; only signed URLs / service role.
insert into storage.buckets (id, name, public)
values ('verification-docs', 'verification-docs', false)
on conflict (id) do update set public = false;

-- 1a. Owners may read their own verification objects (path is prefixed with their user id).
drop policy if exists "Users read own verification docs" on storage.objects;
create policy "Users read own verification docs"
  on storage.objects for select
  using (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Note: inserts/updates/deletes on this bucket are intentionally NOT granted to users.
-- Only the service role (which bypasses RLS) writes here, from the Edge Function.

-- 2. Lock the trust columns on public.profiles against client mutation.
create or replace function public.prevent_client_verification_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role (Edge Function) is allowed to change verification fields.
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  -- For any non-service-role update, force the trust columns back to their old values.
  new.verification_status := old.verification_status;
  new.verification_id_url := old.verification_id_url;
  new.verification_selfie_url := old.verification_selfie_url;
  return new;
end;
$$;

drop trigger if exists trg_prevent_client_verification_change on public.profiles;
create trigger trg_prevent_client_verification_change
  before update on public.profiles
  for each row
  execute function public.prevent_client_verification_change();

-- 3. Allow the service role to write verification attempts (Edge Function logs the outcome).
drop policy if exists "Service role manages verification attempts" on public.verification_attempts;
create policy "Service role manages verification attempts"
  on public.verification_attempts for all
  using (coalesce(auth.role(), '') = 'service_role')
  with check (coalesce(auth.role(), '') = 'service_role');
