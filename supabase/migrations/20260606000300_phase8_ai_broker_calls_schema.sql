do $$
begin
  if not exists (select 1 from pg_type where typname = 'broker_call_status_type') then
    create type public.broker_call_status_type as enum (
      'queued',
      'consent_required',
      'consent_granted',
      'dialing',
      'in_progress',
      'completed',
      'declined',
      'no_answer',
      'failed',
      'cancelled'
    );
  end if;
end
$$;
create table if not exists public.ai_broker_calls (
  id uuid default gen_random_uuid() primary key,

  request_id uuid references public.interest_requests(id) on delete cascade not null,
  match_id uuid references public.matches(id) on delete cascade not null,

  sender_profile_id uuid references public.profiles(id) on delete cascade not null,
  receiver_profile_id uuid references public.profiles(id) on delete cascade not null,
  target_profile_id uuid references public.profiles(id) on delete cascade not null,
  triggered_by_profile_id uuid references public.profiles(id) on delete set null,

  provider text not null check (provider in ('vapi', 'retell', 'twilio')),
  channel text not null check (channel in ('voice', 'sms_whatsapp')),
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),

  status public.broker_call_status_type default 'queued' not null,
  consent_required boolean default true not null,
  consent_granted boolean,
  consent_recorded_at timestamp with time zone,

  attempt_number integer default 1 not null check (attempt_number >= 1),
  scheduled_for timestamp with time zone,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,

  provider_call_id text,
  provider_message_id text,
  outcome text,
  transcript text,
  summary jsonb default '{}'::jsonb not null,
  metadata jsonb default '{}'::jsonb not null,
  last_error text,

  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,

  constraint ai_broker_calls_sender_receiver_check check (sender_profile_id <> receiver_profile_id),
  constraint ai_broker_calls_target_participant_check check (target_profile_id = sender_profile_id or target_profile_id = receiver_profile_id)
);
create unique index if not exists ai_broker_calls_active_attempt_idx
  on public.ai_broker_calls (request_id, target_profile_id, channel)
  where status in ('queued', 'consent_required', 'consent_granted', 'dialing', 'in_progress');
create index if not exists ai_broker_calls_request_created_idx
  on public.ai_broker_calls (request_id, created_at desc);
create index if not exists ai_broker_calls_match_created_idx
  on public.ai_broker_calls (match_id, created_at desc);
create index if not exists ai_broker_calls_target_status_scheduled_idx
  on public.ai_broker_calls (target_profile_id, status, scheduled_for);
create index if not exists ai_broker_calls_status_scheduled_idx
  on public.ai_broker_calls (status, scheduled_for);
create unique index if not exists ai_broker_calls_provider_call_id_idx
  on public.ai_broker_calls (provider_call_id)
  where provider_call_id is not null;
create unique index if not exists ai_broker_calls_provider_message_id_idx
  on public.ai_broker_calls (provider_message_id)
  where provider_message_id is not null;
drop trigger if exists set_ai_broker_calls_updated_at on public.ai_broker_calls;
create trigger set_ai_broker_calls_updated_at
before update on public.ai_broker_calls
for each row execute function public.touch_updated_at();
alter table public.ai_broker_calls enable row level security;
