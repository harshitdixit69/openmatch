-- Migration: push notifications transport
--
-- Adds device push-token storage and a trigger that fans out a push message
-- every time an in-app `notifications` row is inserted. Because every existing
-- feature already writes to `notifications` (via service-role Edge Functions),
-- this single trigger gives us background/killed-app push with zero changes to
-- the existing call sites.
--
-- Delivery path:
--   notifications INSERT
--     -> trg_notifications_push (AFTER INSERT)
--     -> pg_net async POST to the `send-push` Edge Function
--     -> Expo Push API -> APNs / FCM
--
-- One-time project setup (run once, values from the Supabase dashboard):
--   alter database postgres set app.settings.functions_base_url =
--     'https://<project-ref>.functions.supabase.co';
--   alter database postgres set app.settings.service_role_key = '<service-role-key>';
-- (Or store them in Vault and adapt the trigger to read from there.)

-- ---------------------------------------------------------------------------
-- Device token storage
-- ---------------------------------------------------------------------------
create table if not exists public.push_tokens (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  token text not null unique,
  platform text not null default 'unknown',
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists push_tokens_user_id_idx
  on public.push_tokens (user_id) where enabled;

alter table public.push_tokens enable row level security;

-- Users manage only their own device tokens.
drop policy if exists "Users manage own push tokens" on public.push_tokens;
create policy "Users manage own push tokens" on public.push_tokens
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.push_tokens to authenticated;

-- ---------------------------------------------------------------------------
-- Fan-out trigger: on notification insert, POST to the send-push function
-- ---------------------------------------------------------------------------
create extension if not exists pg_net with schema extensions;

create or replace function public.dispatch_push_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base_url text;
  service_key text;
begin
  -- Read project config set once via `alter database ... set app.settings.*`.
  base_url := current_setting('app.settings.functions_base_url', true);
  service_key := current_setting('app.settings.service_role_key', true);

  -- If the project hasn't been configured yet, skip silently so notification
  -- inserts never fail because of push wiring.
  if base_url is null or service_key is null then
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

drop trigger if exists trg_notifications_push on public.notifications;
create trigger trg_notifications_push
  after insert on public.notifications
  for each row
  execute function public.dispatch_push_on_notification();
