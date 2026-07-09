do $$
begin
  if not exists (select 1 from pg_type where typname = 'request_status_type') then
    create type public.request_status_type as enum ('sent', 'accepted', 'declined', 'expired', 'ghosted', 'closed');
  end if;

  if not exists (select 1 from pg_type where typname = 'request_media_type') then
    create type public.request_media_type as enum ('none', 'voice', 'video');
  end if;
end
$$;

create table if not exists public.interest_requests (
  id uuid default gen_random_uuid() primary key,
  match_id uuid references public.matches(id) on delete cascade not null,
  sender_id uuid references public.profiles(id) on delete cascade not null,
  receiver_id uuid references public.profiles(id) on delete cascade not null,
  status public.request_status_type default 'sent' not null,
  personalized_reason text not null,
  ai_reason_summary text,
  media_type public.request_media_type default 'none' not null,
  media_url text,
  request_quality_score integer default 0 not null,
  sender_ghost_risk_score integer default 0 not null,
  accepted_at timestamp with time zone,
  first_reply_due_at timestamp with time zone,
  first_reply_at timestamp with time zone,
  ghosted_at timestamp with time zone,
  reminder_count integer default 0 not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  constraint interest_requests_sender_receiver_check check (sender_id <> receiver_id)
);

create unique index if not exists interest_requests_match_sender_receiver_active_idx
  on public.interest_requests (match_id, sender_id, receiver_id)
  where status in ('sent', 'accepted');

create index if not exists interest_requests_receiver_status_created_idx
  on public.interest_requests (receiver_id, status, created_at desc);

create index if not exists interest_requests_sender_status_created_idx
  on public.interest_requests (sender_id, status, created_at desc);

create index if not exists interest_requests_due_at_idx
  on public.interest_requests (first_reply_due_at)
  where status = 'accepted' and first_reply_at is null;

create table if not exists public.interest_request_events (
  id uuid default gen_random_uuid() primary key,
  request_id uuid references public.interest_requests(id) on delete cascade not null,
  actor_id uuid references public.profiles(id) on delete cascade,
  event_type text not null,
  payload jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists interest_request_events_request_created_idx
  on public.interest_request_events (request_id, created_at desc);

create table if not exists public.profile_reliability_scores (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  response_reliability_score integer default 100 not null,
  ghost_risk_score integer default 0 not null,
  active_request_limit integer default 10 not null,
  accepted_requests integer default 0 not null,
  replied_within_sla_count integer default 0 not null,
  ghosted_request_count integer default 0 not null,
  median_first_reply_minutes integer,
  recalculated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create table if not exists public.ai_followup_jobs (
  id uuid default gen_random_uuid() primary key,
  request_id uuid references public.interest_requests(id) on delete cascade not null,
  provider text not null,
  channel text not null,
  status text default 'queued' not null,
  payload jsonb default '{}'::jsonb not null,
  executed_at timestamp with time zone,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

create index if not exists ai_followup_jobs_request_status_idx
  on public.ai_followup_jobs (request_id, status, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists set_interest_requests_updated_at on public.interest_requests;
create trigger set_interest_requests_updated_at
before update on public.interest_requests
for each row execute function public.touch_updated_at();

alter table public.interest_requests enable row level security;
alter table public.interest_request_events enable row level security;
alter table public.profile_reliability_scores enable row level security;
alter table public.ai_followup_jobs enable row level security;