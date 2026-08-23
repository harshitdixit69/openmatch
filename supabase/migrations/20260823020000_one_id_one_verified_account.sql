-- Migration: One Govt ID → one verified account
--
-- The name/face checks in verify-identity-ai stop the "Sam verifies as Sam using
-- Harshit's ID" case, but not the "Sam registers AS Harshit and verifies with Harshit's
-- real ID + photo" impersonation case. To blunt that, we bind each government ID to a
-- single verified account: the Edge Function stores a salted SHA-256 hash of the ID
-- number and refuses to grant a second badge if the same hash is already bound to a
-- different user.
--
-- Privacy: we store ONLY the salted hash (id_hash), never the raw Aadhaar/PAN/etc number.
-- The salt lives in the VERIFICATION_ID_SALT secret (or the service role key fallback),
-- so the table alone cannot be reversed into ID numbers.

create table if not exists public.verified_identities (
  id_hash    text primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  doc_type   text,
  created_at timestamptz not null default now()
);

-- Fast reverse lookup (which IDs has this user bound?) for audits and support.
create index if not exists verified_identities_user_id_idx
  on public.verified_identities (user_id);

-- Lock the table down: it holds sensitive KYC-derived data and must be writable and
-- readable ONLY by the service role (the Edge Function). No client access at all.
alter table public.verified_identities enable row level security;

drop policy if exists "Service role manages verified identities" on public.verified_identities;
create policy "Service role manages verified identities"
  on public.verified_identities for all
  using (
    current_user = 'service_role'
    or current_role = 'service_role'
    or coalesce(auth.role(), '') = 'service_role'
  )
  with check (
    current_user = 'service_role'
    or current_role = 'service_role'
    or coalesce(auth.role(), '') = 'service_role'
  );
