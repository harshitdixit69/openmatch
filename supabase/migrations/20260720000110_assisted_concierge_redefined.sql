-- Migration: Redefine Assisted Concierge Schema to match precise requirements
-- Target: hosted Supabase database

-- 1. Ensure profiles table has membership_tier column
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS membership_tier text DEFAULT 'free';

-- 2. Alter status column type on assisted_concierge_sessions to text
ALTER TABLE public.assisted_concierge_sessions ALTER COLUMN status DROP DEFAULT;
ALTER TABLE public.assisted_concierge_sessions ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE public.assisted_concierge_sessions ALTER COLUMN status SET DEFAULT 'INTAKE_IN_PROGRESS';

-- 3. Ensure profiles has embedding column
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS embedding vector(1536);
