-- H20: Add missing indexes on ai_outreach_logs
-- Prevents full table scans during RLS policy checks

CREATE INDEX IF NOT EXISTS idx_ai_outreach_logs_candidate_id
    ON ai_outreach_logs (candidate_id);

CREATE INDEX IF NOT EXISTS idx_ai_outreach_logs_requested_by
    ON ai_outreach_logs (requested_by);

CREATE INDEX IF NOT EXISTS idx_ai_outreach_logs_status
    ON ai_outreach_logs (status);
