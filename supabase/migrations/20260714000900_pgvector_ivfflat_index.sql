-- Migration: add HNSW index on profiles.embedding for fast ANN search.
-- HNSW is preferred over IVFFlat for this use case because:
--   1. No k-means build phase — avoids the 60MB+ maintenance_work_mem
--      requirement that exceeds Supabase free-tier limits.
--   2. Better recall at equivalent ef_search values.
--   3. Handles small datasets correctly without the "too little data" warning.
--
-- m=16, ef_construction=64 are the pgvector defaults and work well for
-- 1536-dimensional OpenAI text-embedding-3-small / text-embedding-ada-002
-- vectors at any table size.

create index if not exists profiles_embedding_hnsw_idx
  on public.profiles
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);
