-- Database Migration: Phase 9 Premium Subscriptions Schema
-- Alters the public.profiles table to support multi-month subscription tiers and credits.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free' NOT NULL
    CONSTRAINT profiles_subscription_tier_check CHECK (subscription_tier IN ('free', 'plus', 'vip')),
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS manual_unlock_credits INTEGER DEFAULT 0 NOT NULL
    CONSTRAINT profiles_manual_unlock_credits_check CHECK (manual_unlock_credits >= 0),
  ADD COLUMN IF NOT EXISTS ai_call_credits INTEGER DEFAULT 0 NOT NULL
    CONSTRAINT profiles_ai_call_credits_check CHECK (ai_call_credits >= 0);
