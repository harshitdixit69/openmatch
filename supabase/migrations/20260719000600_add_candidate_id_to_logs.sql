-- Migration: Add candidate_id to vip_outreach_logs
ALTER TABLE public.vip_outreach_logs ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
