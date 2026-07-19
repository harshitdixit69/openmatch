-- Migration: Drop temporary debug helper functions
drop function if exists public.inspect_db_data();
drop function if exists public.inspect_riya_auth();
