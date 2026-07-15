-- Add Busy Mode / Snooze columns to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS busy_mode boolean DEFAULT false NOT NULL,
ADD COLUMN IF NOT EXISTS busy_mode_changed_at timestamp with time zone DEFAULT now() NOT NULL;

-- Add SLA Extended flag to interest_requests
ALTER TABLE public.interest_requests
ADD COLUMN IF NOT EXISTS sla_extended boolean DEFAULT false NOT NULL;
