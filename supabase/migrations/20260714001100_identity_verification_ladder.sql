-- Migration: Identity Verification Ladder
alter table public.profiles
  add column if not exists verification_status text check (verification_status in ('unverified', 'pending', 'verified', 'rejected')) default 'unverified' not null,
  add column if not exists verification_id_url text,
  add column if not exists verification_selfie_url text;

create table if not exists public.verification_attempts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  id_photo_url text not null,
  selfie_photo_url text not null,
  similarity_score double precision,
  status text check (status in ('pending', 'approved', 'rejected')) default 'pending' not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table public.verification_attempts enable row level security;

create policy "Users can view their own verification attempts"
  on public.verification_attempts for select
  using (auth.uid() = user_id or exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true
  ));

create policy "Users can insert verification attempts"
  on public.verification_attempts for insert
  with check (auth.uid() = user_id);

create policy "Admins can update verification attempts"
  on public.verification_attempts for update
  using (exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true
  ));
