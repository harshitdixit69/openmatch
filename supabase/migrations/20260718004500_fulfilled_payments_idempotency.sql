-- Migration: Create fulfilled_payments table for Stripe webhook idempotency

create table if not exists public.fulfilled_payments (
  stripe_event_id text primary key,
  checkout_session_id text,
  payment_intent_id text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  
  constraint uq_checkout_session_id unique (checkout_session_id),
  constraint uq_payment_intent_id unique (payment_intent_id)
);

-- Enable RLS
alter table public.fulfilled_payments enable row level security;

-- Policies: only service role can read/write (authenticated/anonymous blocked)
create policy "Allow service role read write on fulfilled_payments" on public.fulfilled_payments
  for all using (false) with check (false);
