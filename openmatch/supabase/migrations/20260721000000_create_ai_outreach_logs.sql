-- Migration: Create ai_outreach_logs table for Retell AI call tracking
-- Phase 3: AI Broker Outreach

CREATE TYPE outreach_call_status AS ENUM (
    'pending',
    'calling',
    'voicemail',
    'completed_accepted',
    'completed_declined',
    'failed'
);

CREATE TABLE IF NOT EXISTS ai_outreach_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    retell_call_id TEXT UNIQUE,
    match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
    candidate_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    requested_by UUID REFERENCES profiles(id) ON DELETE CASCADE,
    call_status outreach_call_status NOT NULL DEFAULT 'pending',
    call_summary JSONB DEFAULT '[]'::jsonb,
    candidate_sentiment TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookup by retell_call_id during webhook processing
CREATE INDEX IF NOT EXISTS idx_ai_outreach_retell_id ON ai_outreach_logs(retell_call_id);
CREATE INDEX IF NOT EXISTS idx_ai_outreach_match_id ON ai_outreach_logs(match_id);

-- Enable RLS
ALTER TABLE ai_outreach_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can view outreach logs for matches they are part of
CREATE POLICY "Users can view own outreach logs" ON ai_outreach_logs
    FOR SELECT USING (
        auth.uid() = requested_by OR auth.uid() = candidate_id
    );

-- Trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_ai_outreach_logs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_ai_outreach_timestamp
    BEFORE UPDATE ON ai_outreach_logs
    FOR EACH ROW EXECUTE FUNCTION update_ai_outreach_logs_timestamp();
