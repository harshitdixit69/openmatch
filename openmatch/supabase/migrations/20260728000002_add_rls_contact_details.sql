-- C2: Enable RLS on profile_contact_details to protect phone/WhatsApp data
ALTER TABLE profile_contact_details ENABLE ROW LEVEL SECURITY;

-- Users can only read their own contact details
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'Users read own contact details'
    ) THEN
        CREATE POLICY "Users read own contact details"
            ON profile_contact_details
            FOR SELECT
            USING (auth.uid() = profile_id);
    END IF;
END $$;

-- Users can only insert/update their own contact details
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'Users write own contact details'
    ) THEN
        CREATE POLICY "Users write own contact details"
            ON profile_contact_details
            FOR ALL
            USING (auth.uid() = profile_id)
            WITH CHECK (auth.uid() = profile_id);
    END IF;
END $$;
