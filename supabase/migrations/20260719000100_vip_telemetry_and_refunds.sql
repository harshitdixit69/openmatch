-- Migration: Create VIP Telemetry tables and atomic refund trigger
-- Target: hosted Supabase database

-- 1. Create vip_bot_sessions table
create table if not exists public.vip_bot_sessions (
  vip_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null check (status in ('sourcing', 'target_selection', 'call_active', 'handshake')),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- 2. Create vip_outreach_logs table
create table if not exists public.vip_outreach_logs (
  id uuid primary key default gen_random_uuid(),
  vip_id uuid references public.profiles(id) on delete cascade not null,
  mask text not null,
  compatibility integer not null,
  location text not null,
  status text not null,
  timestamp timestamptz default now() not null,
  created_at timestamptz default now() not null
);

-- 3. Enable RLS on both tables
alter table public.vip_bot_sessions enable row level security;
alter table public.vip_outreach_logs enable row level security;

-- 4. Recreate policies to ensure only authenticated users with VIP tier can read their own telemetry
drop policy if exists "VIP users can view their own bot session" on public.vip_bot_sessions;
create policy "VIP users can view their own bot session"
  on public.vip_bot_sessions
  for select
  using (
    vip_id = auth.uid()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and user_tier = 'VIP'
    )
  );

drop policy if exists "VIP users can view their own outreach logs" on public.vip_outreach_logs;
create policy "VIP users can view their own outreach logs"
  on public.vip_outreach_logs
  for select
  using (
    vip_id = auth.uid()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and user_tier = 'VIP'
    )
  );

-- 5. Create atomic refund trigger function
create or replace function public.handle_vip_outreach_refund()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Trigger activates when status changes or is inserted as a failed state
  if (TG_OP = 'INSERT' and NEW.status in ('failed', 'declined', 'no_answer', 'busy')) or
     (TG_OP = 'UPDATE' and NEW.status in ('failed', 'declined', 'no_answer', 'busy') and OLD.status not in ('failed', 'declined', 'no_answer', 'busy')) then
    update public.profiles
    set unlock_credits_remaining = unlock_credits_remaining + 1
    where id = NEW.vip_id;
  end if;
  return NEW;
end;
$$;

-- 6. Create trigger on vip_outreach_logs
drop trigger if exists refund_vip_outreach_trigger on public.vip_outreach_logs;
create trigger refund_vip_outreach_trigger
  before insert or update on public.vip_outreach_logs
  for each row
  execute function public.handle_vip_outreach_refund();
