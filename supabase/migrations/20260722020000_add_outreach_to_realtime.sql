-- Enable Realtime for AI outreach logs and broker calls
-- Idempotent: only add each table to the publication if it is not already a member
-- (avoids SQLSTATE 42710 when the table was already added via the dashboard/earlier).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ai_outreach_logs'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE ai_outreach_logs;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ai_broker_calls'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE ai_broker_calls;
    END IF;
END $$;
