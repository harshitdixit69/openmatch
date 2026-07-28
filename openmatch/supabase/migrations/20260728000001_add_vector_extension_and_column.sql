-- C9: Ensure vector extension and embedding column exist in version-controlled migrations
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'profiles' AND column_name = 'embedding'
    ) THEN
        ALTER TABLE profiles ADD COLUMN embedding vector(1536);
    END IF;
END $$;

-- H8: Create HNSW index for fast similarity search
CREATE INDEX IF NOT EXISTS profiles_embedding_hnsw_idx
    ON profiles USING hnsw (embedding vector_cosine_ops);

-- H7: Add B-tree indexes on frequently filtered columns
CREATE INDEX IF NOT EXISTS idx_profiles_gender ON profiles (gender);
CREATE INDEX IF NOT EXISTS idx_profiles_location ON profiles (location);
CREATE INDEX IF NOT EXISTS idx_profiles_religion ON profiles (religion);
CREATE INDEX IF NOT EXISTS idx_profiles_marital_status ON profiles (marital_status);
