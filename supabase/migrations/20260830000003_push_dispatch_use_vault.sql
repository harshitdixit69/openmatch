-- Migration: use Vault for push dispatch config (Supabase Cloud compatible)
--
-- The previous approach relied on `alter database postgres set app.settings.*`,
-- which fails on Supabase Cloud (the `postgres` role is not a superuser →
-- ERROR 42501 permission denied). Instead we:
--   * hardcode the (non-secret) Edge Function base URL, and
--   * read the service-role key from Supabase Vault at trigger time.
--
-- One-time setup (run once in the SQL editor, with your real key):
--   select vault.create_secret(
--     '<YOUR_SERVICE_ROLE_KEY>', 'push_service_role_key', 'service-role key for send-push');
--
-- If the secret is missing, the trigger no-ops so notification inserts never
-- fail because of push wiring.

create or replace function public.dispatch_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base_url text := 'https://oxdhkjernhpkscrideby.functions.supabase.co';
  service_key text;
begin
  -- Pull the service-role key from Vault (returns null if not configured yet).
  select decrypted_secret
    into service_key
    from vault.decrypted_secrets
    where name = 'push_service_role_key'
    limit 1;

  if service_key is null then
    return new;
  end if;

  perform net.http_post(
    url := base_url || '/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := jsonb_build_object(
      'notification_id', new.id,
      'user_id', new.user_id,
      'type', new.type,
      'title', new.title,
      'body', new.body,
      'metadata', new.metadata
    )
  );

  return new;
end;
$$;
