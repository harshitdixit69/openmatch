-- Migration: Add ASSISTED to user_tier_type enum
-- Target: hosted Supabase database

ALTER TYPE public.user_tier_type ADD VALUE IF NOT EXISTS 'ASSISTED';
