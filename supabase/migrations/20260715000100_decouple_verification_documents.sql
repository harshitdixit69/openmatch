-- Migration: Decouple sensitive verification documents from public.profiles table
alter table public.profiles
  drop column if exists verification_id_url,
  drop column if exists verification_selfie_url;
