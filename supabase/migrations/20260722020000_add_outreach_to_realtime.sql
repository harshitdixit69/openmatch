-- Enable Realtime for AI outreach logs and broker calls
ALTER PUBLICATION supabase_realtime ADD TABLE ai_outreach_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE ai_broker_calls;
