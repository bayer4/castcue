# CastCue — Full Rebuild Blueprint

## What CastCue Is

CastCue is a podcast player that listens for you. You tell it what topics you care about — NBA Finals, OpenClaw, AI regulation, whatever — and it continuously scans across every podcast you follow to find the exact conversations about those topics. It builds you a live, always-updating playlist of curated audio segments. You open the app, hit play, and hear back-to-back clips from different shows about the stuff that matters to you. No more scrubbing through 3-hour episodes.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Next.js Frontend                        │
│          (Tailwind + shadcn/ui components)                 │
│                                                            │
│   Onboarding → Topics → Podcast Feed → Playlist Player     │
└────────────────────────┬─────────────────────────────────┘
                         │ API Routes (Next.js /api)
                         ▼
┌──────────────────────────────────────────────────────────┐
│                   Backend Services                         │
│                                                            │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ RSS Poller   │  │ Transcriber  │  │ Search Engine   │  │
│  │ (cron/edge)  │  │ (Deepgram)   │  │ (existing v2)   │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬────────┘  │
│         │                │                    │            │
│         ▼                ▼                    ▼            │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Embedder     │  │ Segmenter   │  │ Clip Generator  │  │
│  │ (OpenAI)     │  │ (existing)   │  │ (existing)      │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬────────┘  │
│         └────────────────┴───────────────────┘            │
└────────────────────────┬─────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│              Supabase (Postgres + pgvector)                │
│                                                            │
│  users · user_topics · podcasts · subscriptions            │
│  episodes · segments (vector 1536) · clips · clip_listens  │
└──────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Tool | Why |
|-------|------|-----|
| Framework | Next.js 14 (App Router) | You know it, Cursor knows it, fast |
| Styling | Tailwind + shadcn/ui | Polished without custom CSS hell |
| Database | Supabase (Postgres + pgvector) | Free tier, you know it from OpenNow |
| Auth | Supabase Auth (magic link or email/pw) | Built-in, zero config |
| Transcription | Deepgram (Nova-2) | ~$0.0043/min, word-level timestamps, fast |
| Embeddings | OpenAI text-embedding-3-small | $0.02/1M tokens, 1536 dims, works great |
| Audio Storage | Podcast RSS audio URLs (no storage needed) | We link directly to the MP3s from RSS |
| Hosting | Vercel | You know it, free tier, edge functions |
| RSS Parsing | `rss-parser` npm package | Simple, reliable |

### Cost Per Episode (est. 60 min)
- Deepgram transcription: ~$0.26
- OpenAI embeddings (~240 segments × ~50 tokens each): ~$0.001
- Total: **~$0.27 per episode**

---

## What We Keep From the Existing Codebase

### ✅ KEEP (move into Next.js API routes)
- `services/search.ts` — The entire search engine. Cosine similarity, sliding window, dual thresholding, alias generation, keyword fallback, range merging. This is gold.
- `services/segmentation.ts` — Sentence-boundary-aware chunking logic.
- `services/embedding.ts` — OpenAI embedding wrapper with batch support.
- `db/schema.sql` — Schema design is solid. We'll adapt for Supabase but the structure stays.
- `types.ts` — Type definitions and SEARCH_CONFIG constants.

### 🔴 NUKE (rebuild)
- `frontend/` — Static HTML file. Replace with Next.js pages.
- `web/` — The Next.js frontend. The pages exist but the UI needs a full redesign.
- `routes/` — Express routes. Replace with Next.js API routes.
- `db/client.ts` — Replace with Supabase client.
- `middleware/auth.ts` — Replace with Supabase Auth.
- Docker setup — Not needed with Supabase.

### 🆕 BUILD NEW
- RSS ingestion pipeline (poll feeds → detect new episodes)
- Deepgram transcription integration
- Background processing (new episode → transcribe → embed → generate clips)
- Polished, modern frontend

---

## Database Schema (Supabase)

Adapted from existing schema.sql. Key changes: Supabase Auth replaces custom users table, add RSS fields.

```sql
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Podcasts (RSS feeds the user can subscribe to)
CREATE TABLE podcasts (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    rss_url         TEXT NOT NULL UNIQUE,
    title           TEXT,
    description     TEXT,
    image_url       TEXT,
    last_polled_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Subscriptions (user follows a podcast)
CREATE TABLE subscriptions (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    podcast_id  UUID NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, podcast_id)
);

-- Episodes (individual podcast episodes)
CREATE TABLE episodes (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    podcast_id      UUID NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
    guid            TEXT NOT NULL,              -- RSS guid for dedup
    title           TEXT NOT NULL,
    audio_url       TEXT NOT NULL,
    published_at    TIMESTAMPTZ,
    duration_ms     INTEGER,
    status          TEXT DEFAULT 'pending',     -- pending | transcribing | ready | failed
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(podcast_id, guid)
);

-- Segments (~15-30s chunks with embeddings)
CREATE TABLE segments (
    id              SERIAL PRIMARY KEY,
    episode_id      UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    segment_index   INTEGER NOT NULL,
    text            TEXT NOT NULL,
    start_ms        INTEGER NOT NULL,
    end_ms          INTEGER NOT NULL,
    embedding       vector(1536),
    UNIQUE(episode_id, segment_index)
);

CREATE INDEX idx_segments_episode ON segments(episode_id);
CREATE INDEX idx_segments_embedding ON segments USING hnsw (embedding vector_cosine_ops);

-- User Topics (what the user cares about)
CREATE TABLE user_topics (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, name)
);

-- Clips (matched segments: episode × topic = time range)
CREATE TABLE clips (
    id              SERIAL PRIMARY KEY,
    episode_id      UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    topic           TEXT NOT NULL,
    start_ms        INTEGER NOT NULL,
    end_ms          INTEGER NOT NULL,
    confidence      FLOAT NOT NULL DEFAULT 0.5,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(episode_id, topic, start_ms)
);

-- Clip Listens (track what user has heard)
CREATE TABLE clip_listens (
    id          SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    clip_id     INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    listened_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, clip_id)
);

-- RLS Policies (Supabase row-level security)
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE clip_listens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own subscriptions" ON subscriptions
    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own topics" ON user_topics
    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own listens" ON clip_listens
    FOR ALL USING (auth.uid() = user_id);
```

---

## Data Pipeline (New Episode Flow)

```
1. RSS Poll (cron or manual trigger)
   │  Parse RSS feed → compare guids → insert new episodes (status: 'pending')
   │
2. Transcribe (Deepgram Nova-2)
   │  Download audio URL → send to Deepgram → get word-level timestamps
   │  Update episode status: 'transcribing' → 'ready'
   │
3. Segment (existing logic)
   │  Split transcript into ~15-30s chunks at sentence boundaries
   │  Each segment gets: text, start_ms, end_ms
   │
4. Embed (existing logic)
   │  Batch embed all segments via OpenAI text-embedding-3-small
   │  Store vector(1536) in segments table
   │
5. Generate Clips (existing logic)
   │  For each user subscribed to this podcast:
   │    For each of their topics:
   │      Run searchEpisodeWithTimestamps() → upsert clips
   │
6. Playlist Updated
   │  User opens app → sees new clips with "NEW" badge
   │  Hits play → hears curated segments back to back
```

---

## Pages & UI Flow

### 1. Login / Sign Up
- Supabase Auth magic link or email/password
- Clean, minimal — just get in

### 2. Onboarding (first-time only)
- Step 1: "What topics do you care about?" — text input, add multiple
- Step 2: "What podcasts do you follow?" — search/add RSS URLs or browse popular
- Step 3: "We're scanning your podcasts now" — progress indicator

### 3. Playlist (HOME — main screen)
- Queue of clips sorted by recency
- Each clip shows: podcast artwork, episode title, topic tag, duration, confidence
- NEW badge for unlistened clips
- Tap to play — audio starts at clip's startMs, auto-advances to next clip
- Bottom player bar with play/pause, progress, skip

### 4. Topics
- List of user's topics with add/remove
- Each topic shows how many clips it's generated

### 5. Podcasts
- List of subscribed podcasts
- Add new via RSS URL or search
- Shows episode count, last polled

### 6. Settings
- Account, logout, clear data

---

## Design Direction

**Aesthetic: Dark, editorial, podcast-native.** Think Spotify meets Pocket Casts meets a news reader. Dark background, clean typography, accent color for topic tags. The playlist should feel like a curated feed, not a file browser.

- Dark mode primary (bg: #0a0a0a, surface: #141414, border: #222)
- Accent: warm orange or electric blue (TBD — something that pops on dark)
- Font: something with character — not Inter. Consider Satoshi, General Sans, or Cabinet Grotesk
- Podcast artwork as the primary visual anchor in the playlist
- Topic tags as colored pills
- Smooth transitions, subtle hover states
- The player bar should feel premium — like a real audio app

---

## Task List (Ordered for Cursor/Codex Execution)

### Phase 0: Project Setup (30 min)
- [ ] **T0.1** Init fresh Next.js 14 project with App Router, TypeScript, Tailwind
- [ ] **T0.2** Install deps: `@supabase/supabase-js`, `@supabase/ssr`, `rss-parser`, `pgvector`, `openai`
- [ ] **T0.3** Set up Supabase project, enable pgvector extension, run schema SQL
- [ ] **T0.4** Configure environment variables (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, OPENAI_API_KEY, DEEPGRAM_API_KEY)
- [ ] **T0.5** Set up Supabase client utilities (browser + server)
- [ ] **T0.6** Copy over core services from existing repo: search.ts, segmentation.ts, embedding.ts, types.ts — adapt imports to use Supabase client instead of raw pg

### Phase 1: Auth + Layout Shell (1 hr)
- [ ] **T1.1** Supabase Auth: login/signup page (email + password for demo simplicity)
- [ ] **T1.2** Auth middleware (protect all routes except /login)
- [ ] **T1.3** App layout shell: sidebar nav (Playlist, Topics, Podcasts) + main content area
- [ ] **T1.4** Apply design system: dark theme, font imports, CSS variables, Tailwind config

### Phase 2: Topics Management (45 min)
- [ ] **T2.1** Topics page: list user's topics, add new topic (text input), delete
- [ ] **T2.2** API route: POST /api/topics (create), GET /api/topics (list), DELETE /api/topics/:id

### Phase 3: Podcast Subscriptions (1 hr)
- [ ] **T3.1** Podcasts page: list subscribed podcasts with artwork + metadata
- [ ] **T3.2** Add podcast flow: paste RSS URL → parse feed → show preview → subscribe
- [ ] **T3.3** API routes: POST /api/podcasts/subscribe, GET /api/podcasts, DELETE /api/podcasts/:id
- [ ] **T3.4** RSS parsing: extract title, description, image, episodes list

### Phase 4: Ingestion Pipeline (2 hrs) ← This is the critical new piece
- [ ] **T4.1** API route: POST /api/episodes/ingest — trigger processing for a podcast's episodes
- [ ] **T4.2** Deepgram integration: send audio URL → receive word-level transcript
- [ ] **T4.3** Segmentation: run existing chunking logic on Deepgram output
- [ ] **T4.4** Embedding: batch embed segments via OpenAI
- [ ] **T4.5** Store segments with vectors in Supabase
- [ ] **T4.6** Episode status tracking (pending → transcribing → ready → failed)
- [ ] **T4.7** Progress indicator on frontend (show processing status)

### Phase 5: Playlist & Player (2 hrs) ← This is the money shot
- [ ] **T5.1** Playlist page: fetch clips for user's subscriptions × topics
- [ ] **T5.2** Clip cards: podcast artwork, episode title, topic pill, time range, duration, NEW badge
- [ ] **T5.3** Audio player: HTML5 audio with seek to startMs, auto-stop at endMs
- [ ] **T5.4** Auto-advance: when clip ends, play next clip in queue
- [ ] **T5.5** Player bar (bottom): artwork, title, play/pause, progress bar, skip
- [ ] **T5.6** Mark as listened (fire on play, update clip_listens)
- [ ] **T5.7** Generate clips button: trigger search across all episodes × all topics

### Phase 6: Polish & Demo Prep (1-2 hrs)
- [ ] **T6.1** Onboarding flow: first-time user walks through topics → podcasts → first scan
- [ ] **T6.2** Loading states, error handling, empty states
- [ ] **T6.3** Responsive design (looks good on desktop for Loom)
- [ ] **T6.4** Pre-load demo data: subscribe to All In, TWIST, Bill Simmons — ingest a few recent episodes
- [ ] **T6.5** Final UI polish pass: animations, transitions, spacing
- [ ] **T6.6** Deploy to Vercel

---

## Demo Script (Loom)

1. Open CastCue → show empty playlist
2. Add topics: "OpenClaw", "NBA Playoffs", "AI agents"
3. Subscribe to podcasts: All In, This Week in Startups, Bill Simmons
4. Trigger scan → show clips appearing
5. Hit play → REAL audio plays from a real podcast episode, starting at the exact moment they discuss the topic
6. Show auto-advance to next clip (different podcast, same topic)
7. Show topic filtering — switch to "NBA Playoffs" and see only basketball clips
8. Close with: "This is what I've been building. Let's talk."

---

## API Keys Needed

1. **Supabase** — create project at supabase.com (free)
2. **OpenAI** — you likely already have this from other projects
3. **Deepgram** — sign up at deepgram.com (free $200 credit)

---

## Notes

- For the demo, we only need to ingest 2-3 recent episodes per podcast. We're not building a full crawler yet.
- Audio plays directly from the podcast's MP3 URLs (no storage needed). HTML5 audio supports seeking to specific timestamps.
- The search engine is the real IP here. Everything else is plumbing.
- Vercel edge functions have a 10s timeout on free tier. Transcription will need to run as a background job or use Vercel's serverless functions (60s timeout) or Supabase Edge Functions.
