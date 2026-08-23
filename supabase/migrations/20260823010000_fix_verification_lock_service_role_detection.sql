-- Migration: Make the verification-lock trigger detect the service role reliably
--            under the new Supabase API keys (secret keys `sb_secret_...`).
--
-- Background
-- ----------
-- `prevent_client_verification_change()` lets the verify-identity-ai Edge Function
-- (which uses the service role key) write the trust columns, and silently reverts
-- any other session. It decided "is this the service role?" with:
--
--     if coalesce(auth.role(), '') = 'service_role' then return new;
--
-- `auth.role()` reads the `role` claim out of the request JWT. That worked with the
-- legacy anon/service_role JWT keys. After migrating to the new publishable/secret
-- API keys, the secret key is NOT a JWT, so there is no `role` claim and
-- `auth.role()` returns NULL. The bypass therefore failed and the Edge Function's
-- `UPDATE profiles SET verification_status = 'verified'` was silently reverted to the
-- old value — the UPDATE still affected 1 row with no error, so the function reported
-- success while the badge never actually persisted. On refresh the profile read back
-- as 'unverified'.
--
-- Fix
-- ---
-- Detect the service role from the effective PostgreSQL role instead. PostgREST issues
-- `SET ROLE service_role` for service-role requests regardless of key format, so
-- `current_user` / `current_role` reliably equals 'service_role'. For that to be
-- visible inside the trigger the function must NOT be SECURITY DEFINER (otherwise
-- `current_user` would be the function owner). The function only mutates NEW and reads
-- no tables, so it needs no elevated privileges. We keep the legacy `auth.role()` check
-- too so pre-migration (JWT-key) environments continue to work.

create or replace function public.prevent_client_verification_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Service role (Edge Function) is allowed to change verification fields.
  -- New API keys: PostgREST SET ROLE service_role -> current_user = 'service_role'.
  -- Legacy JWT keys: role claim is readable via auth.role().
  if current_user = 'service_role'
     or current_role = 'service_role'
     or coalesce(auth.role(), '') = 'service_role'
  then
    return new;
  end if;

  -- For any non-service-role update, force the trust columns back to their old values.
  new.verification_status := old.verification_status;
  new.verification_id_url := old.verification_id_url;
  new.verification_selfie_url := old.verification_selfie_url;
  return new;
end;
$$;

-- Trigger definition is unchanged; recreate defensively in case it was dropped.
drop trigger if exists trg_prevent_client_verification_change on public.profiles;
create trigger trg_prevent_client_verification_change
  before update on public.profiles
  for each row
  execute function public.prevent_client_verification_change();

-- Same root cause affects the verification_attempts RLS policy, which also gates on
-- auth.role() = 'service_role'. Widen it to accept the effective Postgres role so the
-- Edge Function can keep logging attempts under the new keys.
drop policy if exists "Service role manages verification attempts" on public.verification_attempts;
create policy "Service role manages verification attempts"
  on public.verification_attempts for all
  using (
    current_user = 'service_role'
    or current_role = 'service_role'
    or coalesce(auth.role(), '') = 'service_role'
  )
  with check (
    current_user = 'service_role'
    or current_role = 'service_role'
    or coalesce(auth.role(), '') = 'service_role'
  );
