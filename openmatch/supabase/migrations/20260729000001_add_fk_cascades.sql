-- H9: Add missing foreign key cascades
-- Ensures orphaned rows are cleaned up when a profile is deleted

-- profile_contact_details → profiles
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'profile_contact_details_profile_id_fkey'
    ) THEN
        ALTER TABLE profile_contact_details DROP CONSTRAINT profile_contact_details_profile_id_fkey;
    END IF;
END $$;
ALTER TABLE profile_contact_details
    ADD CONSTRAINT profile_contact_details_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- shortlists → profiles (shortlister)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'shortlists_user_id_fkey'
    ) THEN
        ALTER TABLE shortlists DROP CONSTRAINT shortlists_user_id_fkey;
    END IF;
END $$;
ALTER TABLE shortlists
    ADD CONSTRAINT shortlists_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- shortlists → profiles (shortlisted profile)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'shortlists_shortlisted_id_fkey'
    ) THEN
        ALTER TABLE shortlists DROP CONSTRAINT shortlists_shortlisted_id_fkey;
    END IF;
END $$;
ALTER TABLE shortlists
    ADD CONSTRAINT shortlists_shortlisted_id_fkey
    FOREIGN KEY (shortlisted_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- profile_views → profiles (viewer)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'profile_views_viewer_id_fkey'
    ) THEN
        ALTER TABLE profile_views DROP CONSTRAINT profile_views_viewer_id_fkey;
    END IF;
END $$;
ALTER TABLE profile_views
    ADD CONSTRAINT profile_views_viewer_id_fkey
    FOREIGN KEY (viewer_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- profile_views → profiles (viewed profile)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'profile_views_viewed_id_fkey'
    ) THEN
        ALTER TABLE profile_views DROP CONSTRAINT profile_views_viewed_id_fkey;
    END IF;
END $$;
ALTER TABLE profile_views
    ADD CONSTRAINT profile_views_viewed_id_fkey
    FOREIGN KEY (viewed_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- profile_locations → profiles
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'profile_locations_profile_id_fkey'
    ) THEN
        ALTER TABLE profile_locations DROP CONSTRAINT profile_locations_profile_id_fkey;
    END IF;
END $$;
ALTER TABLE profile_locations
    ADD CONSTRAINT profile_locations_profile_id_fkey
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
