-- Migration: Extend ai_outreach_logs to store full call details
ALTER TABLE ai_outreach_logs ADD COLUMN IF NOT EXISTS recording_url TEXT;
ALTER TABLE ai_outreach_logs ADD COLUMN IF NOT EXISTS disconnection_reason TEXT;
ALTER TABLE ai_outreach_logs ADD COLUMN IF NOT EXISTS call_duration_ms INTEGER;
ALTER TABLE ai_outreach_logs ADD COLUMN IF NOT EXISTS transcript TEXT;
ALTER TABLE ai_outreach_logs ADD COLUMN IF NOT EXISTS call_analysis_data JSONB DEFAULT '{}'::jsonb;
