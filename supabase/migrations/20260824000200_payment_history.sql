-- User-facing payment history.
--
-- Until now the only payment records were:
--   * fulfilled_payments            — webhook idempotency only (no user_id, service-only)
--   * match_unlock_payment_attempts — per-unlock Stripe intents
-- Neither gives a member a clean "here are my invoices/payments" view, and subscription
-- purchases were never recorded per-user at all. This table is the single, owner-readable
-- ledger the Settings > Payment history screen reads from. Only the service role (the
-- Stripe webhook) may write to it.

create table if not exists public.payment_history (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- subscription | unlock | spotlight | other
  kind text not null default 'subscription',
  description text,
  tier text,
  duration_months integer,
  -- amount in the smallest currency unit (paise for INR), matching Stripe's amounts
  amount_minor integer,
  currency text not null default 'INR',
  status text not null default 'succeeded',
  -- Stripe checkout session id or payment intent id (for support/reconciliation)
  stripe_reference text,
  created_at timestamptz default timezone('utc'::text, now()) not null
);

create index if not exists payment_history_user_created_idx
  on public.payment_history (user_id, created_at desc);

-- Avoid duplicate ledger rows if a webhook is retried for the same Stripe object.
create unique index if not exists payment_history_stripe_reference_key
  on public.payment_history (stripe_reference)
  where stripe_reference is not null;

alter table public.payment_history enable row level security;

-- Members can read ONLY their own payments. Writes are service-role only (no insert/
-- update/delete policy for authenticated/anon), so the ledger cannot be forged client-side.
drop policy if exists "Users read own payment history" on public.payment_history;
create policy "Users read own payment history" on public.payment_history
  for select to authenticated
  using (auth.uid() = user_id);
