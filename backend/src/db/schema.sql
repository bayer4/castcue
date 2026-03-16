-- ============================================================
-- CastCue v2 Schema
-- Requires: PostgreSQL 15+ with pgvector extension
-- ============================================================

-- Enable pgvector for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- Episodes: Podcast episodes with metadata
-- ============================================================
CREATE TABLE IF NOT EXISTS episodes (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    audio_url   TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Segments: ~15-30s chunks with embeddings
-- Key improvement: embeddings stored as native vector type, not JSON
-- ============================================================
CREATE TABLE IF NOT EXISTS segments (
    id              SERIAL PRIMARY KEY,
    episode_id      TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    segment_index   INTEGER NOT NULL,
    text            TEXT NOT NULL,
    start_ms        INTEGER NOT NULL,
    end_ms          INTEGER NOT NULL,
    embedding       vector(1536),  -- pgvector native type!
    
    UNIQUE(episode_id, segment_index)
);

-- Index for fast vector similarity search per episode
CREATE INDEX IF NOT EXISTS idx_segments_episode 
    ON segments(episode_id);

-- HNSW index for approximate nearest neighbor search
-- This makes similarity search O(log n) instead of O(n)
CREATE INDEX IF NOT EXISTS idx_segments_embedding 
    ON segments USING hnsw (embedding vector_cosine_ops);

-- ============================================================
-- Topics: User-saved topics for quick access (legacy, kept for compatibility)
-- ============================================================
CREATE TABLE IF NOT EXISTS topics (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Users (stub auth - email only for local dev)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    email       TEXT NOT NULL UNIQUE,
    name        TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- User Topics: topics a user wants to track
-- ============================================================
CREATE TABLE IF NOT EXISTS user_topics (
    id          SERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_user_topics_user ON user_topics(user_id);

-- ============================================================
-- Podcasts: RSS feeds
-- ============================================================
CREATE TABLE IF NOT EXISTS podcasts (
    id              TEXT PRIMARY KEY,
    rss_url         TEXT NOT NULL UNIQUE,
    title           TEXT,
    description     TEXT,
    image_url       TEXT,
    last_polled_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Subscriptions: user subscribes to podcasts
-- ============================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    id          SERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    podcast_id  TEXT NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, podcast_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

-- ============================================================
-- Link episodes to podcasts
-- ============================================================
ALTER TABLE episodes 
    ADD COLUMN IF NOT EXISTS podcast_id TEXT REFERENCES podcasts(id) ON DELETE SET NULL;

-- ============================================================
-- Clips: matched time ranges from (episode × topic)
-- ============================================================
CREATE TABLE IF NOT EXISTS clips (
    id              SERIAL PRIMARY KEY,
    episode_id      TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    topic           TEXT NOT NULL,
    start_ms        INTEGER NOT NULL,
    end_ms          INTEGER NOT NULL,
    confidence      FLOAT NOT NULL DEFAULT 0.5,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(episode_id, topic, start_ms)
);

CREATE INDEX IF NOT EXISTS idx_clips_episode ON clips(episode_id);

-- ============================================================
-- Clip Listens: track which clips a user has played
-- ============================================================
CREATE TABLE IF NOT EXISTS clip_listens (
    id          SERIAL PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    clip_id     INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    listened_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, clip_id)
);

CREATE INDEX IF NOT EXISTS idx_clip_listens_user ON clip_listens(user_id);

-- ============================================================
-- Helpful functions
-- ============================================================

-- Function to compute cosine similarity (pgvector provides operators, but this is explicit)
CREATE OR REPLACE FUNCTION cosine_similarity(a vector, b vector)
RETURNS FLOAT AS $$
    SELECT 1 - (a <=> b);
$$ LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE;

