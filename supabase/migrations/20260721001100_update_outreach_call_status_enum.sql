-- Migration: Add 'queued' and 'initiated' enum values to outreach_call_status
-- Fixes PostgreSQL error 22P02: invalid input value for enum outreach_call_status: "queued"

ALTER TYPE outreach_call_status ADD VALUE IF NOT EXISTS 'queued';
ALTER TYPE outreach_call_status ADD VALUE IF NOT EXISTS 'initiated';
ALTER TYPE outreach_call_status ADD VALUE IF NOT EXISTS 'calling';
ALTER TYPE outreach_call_status ADD VALUE IF NOT EXISTS 'completed_accepted';
ALTER TYPE outreach_call_status ADD VALUE IF NOT EXISTS 'completed_declined';
ALTER TYPE outreach_call_status ADD VALUE IF NOT EXISTS 'voicemail';
ALTER TYPE outreach_call_status ADD VALUE IF NOT EXISTS 'failed';
