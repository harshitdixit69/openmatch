create table if not exists public.match_unlocks (
    match_id uuid primary key references public.matches(id) on delete cascade,
    requested_by uuid references public.profiles(id) on delete cascade not null,
    status text not null default 'awaiting_response' check (status in ('awaiting_response', 'awaiting_payment', 'declined', 'completed')),
    user_1_accepted_at timestamp with time zone,
    user_2_accepted_at timestamp with time zone,
    user_1_paid_at timestamp with time zone,
    user_2_paid_at timestamp with time zone,
    declined_by uuid references public.profiles(id) on delete set null,
    declined_at timestamp with time zone,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index if not exists match_unlocks_requested_by_idx
    on public.match_unlocks (requested_by);
create table if not exists public.match_unlock_payment_attempts (
    id uuid default gen_random_uuid() primary key,
    match_id uuid references public.matches(id) on delete cascade not null,
    payer_user_id uuid references public.profiles(id) on delete cascade not null,
    stripe_payment_intent_id text not null unique,
    client_secret text,
    amount integer not null,
    currency text not null,
    status text not null,
    confirmed_at timestamp with time zone,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);
create index if not exists match_unlock_payment_attempts_match_payer_idx
    on public.match_unlock_payment_attempts (match_id, payer_user_id, created_at desc);
alter table public.match_unlocks enable row level security;
alter table public.match_unlock_payment_attempts enable row level security;
drop policy if exists "Allow participants to view match unlocks" on public.match_unlocks;
create policy "Allow participants to view match unlocks" on public.match_unlocks
    for select using (
        exists (
            select 1 from public.matches
            where id = match_unlocks.match_id
              and (user_1_id = auth.uid() or user_2_id = auth.uid())
        )
    );
drop policy if exists "Allow participants to view their unlock payments" on public.match_unlock_payment_attempts;
create policy "Allow participants to view their unlock payments" on public.match_unlock_payment_attempts
    for select using (
        payer_user_id = auth.uid()
        or exists (
            select 1 from public.matches
            where id = match_unlock_payment_attempts.match_id
              and (user_1_id = auth.uid() or user_2_id = auth.uid())
        )
    );
