-- Follow-up to 20260824000300_payment_history.sql.
--
-- The initial migration created the table + RLS policy but relied on Supabase's default
-- privileges to expose it to the `authenticated` role. On this project that grant was not
-- present, so members hit "permission denied for table payment_history" (SQLSTATE 42501)
-- BEFORE row-level security is even evaluated, which surfaced as
-- "You do not have permission to perform this action" on the Manage Subscription screen.
--
-- Explicitly grant SELECT (RLS still restricts the visible rows to auth.uid() = user_id).

grant select on public.payment_history to authenticated;
