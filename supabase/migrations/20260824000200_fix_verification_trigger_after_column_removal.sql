-- The verification document URLs were moved out of profiles into the private
-- verification_attempts flow. The later service-role detection migration
-- accidentally reintroduced assignments to those removed columns, causing
-- every profiles UPDATE to fail with undefined-column errors.
create or replace function public.prevent_client_verification_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Service-role requests are the only requests allowed to change the
  -- verification status. Support both legacy JWT keys and the newer secret
  -- keys, where the effective Postgres role is the reliable signal.
  if current_user = 'service_role'
     or current_role = 'service_role'
     or coalesce(auth.role(), '') = 'service_role'
  then
    return new;
  end if;

  -- verification_id_url and verification_selfie_url no longer exist on
  -- profiles, so only lock the remaining verification column here.
  new.verification_status := old.verification_status;
  return new;
end;
$$;

drop trigger if exists trg_prevent_client_verification_change on public.profiles;
create trigger trg_prevent_client_verification_change
  before update on public.profiles
  for each row
  execute function public.prevent_client_verification_change();
