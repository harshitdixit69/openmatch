-- C5: Block/Report user feature - database tables

-- Blocked users table
CREATE TABLE IF NOT EXISTS blocked_users (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    blocker_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    blocked_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now() NOT NULL,
    UNIQUE (blocker_id, blocked_id)
);

ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'Users manage own blocks'
    ) THEN
        CREATE POLICY "Users manage own blocks"
            ON blocked_users
            FOR ALL
            USING (auth.uid() = blocker_id)
            WITH CHECK (auth.uid() = blocker_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON blocked_users (blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users (blocked_id);

-- User reports table
CREATE TABLE IF NOT EXISTS user_reports (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    reporter_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reported_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reason text NOT NULL CHECK (reason IN ('fake_profile', 'harassment', 'spam', 'inappropriate_content', 'underage', 'other')),
    description text,
    status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'reviewed', 'action_taken', 'dismissed')),
    created_at timestamptz DEFAULT now() NOT NULL,
    reviewed_at timestamptz
);

ALTER TABLE user_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'Users create own reports'
    ) THEN
        CREATE POLICY "Users create own reports"
            ON user_reports
            FOR INSERT
            WITH CHECK (auth.uid() = reporter_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'Users read own reports'
    ) THEN
        CREATE POLICY "Users read own reports"
            ON user_reports
            FOR SELECT
            USING (auth.uid() = reporter_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_user_reports_reporter ON user_reports (reporter_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_reported ON user_reports (reported_id);
CREATE INDEX IF NOT EXISTS idx_user_reports_status ON user_reports (status);
