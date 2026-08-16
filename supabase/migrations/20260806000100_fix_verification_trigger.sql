-- Fix: prevent_client_verification_change() referenced columns
-- (verification_id_url, verification_selfie_url) that were dropped
-- in 20260715000100_decouple_verification_documents.sql.
-- This caused ERROR 42703 on any profiles UPDATE.
--
-- Fix: remove the two dead column assignments, keep verification_status lock.

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

  -- For any non-service-role update, force verification_status back to old value.
  new.verification_status := old.verification_status;
  return new;
end;
$$;
