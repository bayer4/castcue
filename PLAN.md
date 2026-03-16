# CastCue — Build Plan

> **This file is the source of truth for the build.** Read it before starting any task.
> Tasks are executed sequentially. Do NOT skip ahead.
> After completing each task, check if there's a checkpoint — if so, STOP and tell the user.

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Framework | Next.js 14 (App Router), TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Database | Supabase (Postgres + pgvector) |
| Auth | Supabase Auth (email + password) |
| Transcription | Deepgram Nova-2 |
| Embeddings | OpenAI text-embedding-3-small (1536 dims) |
| Audio | Direct MP3 links from podcast RSS (no storage) |
| Hosting | Vercel |

## Environment Variables Needed

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
DEEPGRAM_API_KEY=
```

---

## What We Keep From Existing Codebase

The following files in `backend/src/` contain working, tested logic. Port them into Next.js (adapt imports to use Supabase client):

- `services/search.ts` — Full semantic search engine (cosine similarity, sliding window, dual thresholding, range merging). This is the core IP.
- `services/segmentation.ts` — Sentence-boundary-aware transcript chunking.
- `services/embedding.ts` — OpenAI embedding wrapper with batch support.
- `types.ts` — Type definitions and SEARCH_CONFIG constants.
- `db/schema.sql` — Reference for schema design (adapted for Supabase in Phase 0).

Everything else gets rebuilt.

---

## Phase 0 — Project Setup

### Task 0.1: Initialize Next.js Project
- Create fresh Next.js 14 project with App Router and TypeScript
- `npx create-next-app@latest castcue-app --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"`
- Install dependencies:
  ```bash
  npm install @supabase/supabase-js @supabase/ssr rss-parser openai
  npm install -D @types/node
  ```

### Task 0.2: Supabase Client Setup
- Create `src/lib/supabase/client.ts` (browser client)
- Create `src/lib/supabase/server.ts` (server client using cookies)
- Create `src/lib/supabase/admin.ts` (service role client for backend operations)
- Use environment variables from `.env.local`

### Task 0.3: Port Core Services
- Copy `search.ts`, `segmentation.ts`, `embedding.ts`, `types.ts` into `src/lib/services/`
- Adapt database calls to use Supabase client instead of raw `pg` query
- Keep all algorithm logic identical — do not refactor the search engine
- Ensure TypeScript compiles cleanly

### Task 0.4: Database Schema
- The user will run the schema SQL in Supabase Dashboard SQL editor
- Create `supabase/schema.sql` with the full schema (see blueprint for reference)
- Include: podcasts, subscriptions, episodes, segments (with vector), user_topics, clips, clip_listens
- Include RLS policies for user-scoped tables
- Include pgvector extension and HNSW index

**After completing Phase 0:** Continue to Phase 1. No checkpoint needed.

---

## Phase 1 — Auth + Layout Shell

### Task 1.1: Auth Pages
- Create `/login` page with email + password form
- Create `/signup` page (or combine with login as tabs)
- Use Supabase Auth `signInWithPassword` and `signUp`
- On success, redirect to `/` (playlist)
- Simple, clean, centered card layout

### Task 1.2: Auth Middleware
- Create middleware.ts that checks for Supabase session
- Redirect unauthenticated users to `/login`
- Allow `/login` and `/signup` without auth

### Task 1.3: App Layout Shell
- Create root layout with sidebar navigation
- Sidebar items: Playlist (home), Topics, Podcasts
- Active state highlighting on current route
- Main content area takes full remaining width
- Mobile: sidebar collapses to bottom tab bar or hamburger (stretch goal)

### Task 1.4: Base Styling
- Configure Tailwind with dark theme as default
- Set up CSS variables for the design system:
  - Background: `#0a0a0a` (base), `#141414` (surface), `#1a1a1a` (elevated)
  - Border: `#262626`
  - Text: `#fafafa` (primary), `#a1a1aa` (secondary), `#52525b` (tertiary)
  - Accent: `#f97316` (orange) — used for topic pills, active states, player controls
- Import a distinctive font (Google Fonts — suggest General Sans or Satoshi via CDN, fall back to system if not available)
- Apply base styles: dark background, light text, clean spacing

**After completing Phase 1:** Continue to Phase 2. No checkpoint needed.

---

## Phase 2 — Topics Management

### Task 2.1: Topics API Routes
- `GET /api/topics` — list user's topics (from user_topics table, filtered by auth user)
- `POST /api/topics` — create topic (insert into user_topics)
- `DELETE /api/topics/[id]` — delete topic

### Task 2.2: Topics Page
- Route: `/topics`
- Show list of user's topics as cards or list items
- "Add topic" input at top — text field + enter/button to add
- Delete button (X) on each topic
- Empty state: "Add topics you care about — CastCue will find conversations about them across your podcasts."
- Show clip count per topic if clips exist

**After completing Phase 2:** Continue to Phase 3. No checkpoint needed.

---

## Phase 3 — Podcast Subscriptions

### Task 3.1: Podcasts API Routes
- `POST /api/podcasts/subscribe` — accepts RSS URL, parses feed, upserts podcast, creates subscription
  - Use `rss-parser` to fetch and parse the RSS feed
  - Extract: title, description, image URL, episode list (guid, title, audio URL, published date)
  - Upsert podcast record, create subscription for user
  - Insert episodes (status: 'pending') — only the most recent 5 episodes for now
- `GET /api/podcasts` — list user's subscribed podcasts with metadata
- `DELETE /api/podcasts/[id]` — unsubscribe (delete subscription, not the podcast)

### Task 3.2: Podcasts Page
- Route: `/podcasts`
- Input to paste RSS URL + "Subscribe" button
- List of subscribed podcasts showing: artwork, title, episode count
- Unsubscribe button per podcast
- Empty state: "Subscribe to podcasts to start finding conversations."

### Task 3.3: Pre-load Popular Podcasts (optional helper)
- Create a small utility or seed data with RSS URLs for:
  - All-In Podcast
  - This Week in Startups
  - The Bill Simmons Podcast
  - This Week in AI
- These can be pre-filled suggestions on the podcasts page

---

## ⛔ CHECKPOINT 1 — STOP HERE

**Tell the user:**
> "Phases 0-3 are complete. The app has auth, layout, topics management, and podcast subscriptions working. **Now go to Claude Opus** for a design review before continuing. Opus will review the layout shell, navigation, typography, colors, spacing, and overall feel. Share your current code or a screenshot and ask Opus to do a design pass."

**Do NOT proceed to Phase 4 until the user confirms the design review is done.**

---

## Phase 4 — Ingestion Pipeline

### Task 4.1: Deepgram Integration
- Create `src/lib/services/transcription.ts`
- Function: `transcribeEpisode(audioUrl: string)` → returns word-level transcript
- Use Deepgram Nova-2 model via REST API:
  ```
  POST https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&utterances=true&punctuate=true&diarize=true
  Body: { "url": audioUrl }
  ```
- Return array of `{ text, start, end }` words (matching existing TranscriptWord type)

### Task 4.2: Episode Processing Pipeline
- Create `src/lib/services/pipeline.ts`
- Function: `processEpisode(episodeId: string)` that:
  1. Fetches episode record from Supabase
  2. Updates status to 'transcribing'
  3. Calls Deepgram transcription
  4. Runs segmentation (existing logic) to chunk transcript
  5. Batch embeds segments (existing logic)
  6. Stores segments with vectors in Supabase
  7. Updates episode status to 'ready' (or 'failed' on error)
- Include error handling and status updates at each step

### Task 4.3: Ingest API Route
- `POST /api/episodes/ingest` — triggers processing for all pending episodes of a podcast
  - Accepts: `{ podcastId: string }` or processes all pending episodes
  - Calls `processEpisode` for each pending episode
  - Returns progress info
- This will be slow (minutes per episode) — for the demo, we trigger it manually and wait

### Task 4.4: Processing Status UI
- On the Podcasts page, show episode processing status
- For each podcast: "X episodes ready, Y processing, Z pending"
- "Process Episodes" button per podcast that triggers ingestion
- Simple progress indicator (polling or just refresh)

---

## ⛔ CHECKPOINT 2 — STOP HERE

**Tell the user:**
> "Phase 4 is complete. The ingestion pipeline is working — episodes can be transcribed, segmented, and embedded. **Now go to Claude Opus** for two things: (1) Review the pipeline output — are segments clean? Are embeddings stored correctly? (2) Opus will implement search engine improvements — adaptive thresholds and an LLM verification layer to fix the false positive / threshold tuning problem from v1. Share your Supabase table data and any test results."

**Do NOT proceed to Phase 5 until the user confirms the search review is done.**

---

## Phase 5 — Playlist & Audio Player

### Task 5.1: Clip Generation API
- `POST /api/playlist/generate` — scans all ready episodes × all user topics
  - Port existing playlist generation logic (from backend/src/routes/playlist.ts)
  - For each (episode, topic) pair: run `searchEpisodeWithTimestamps()`
  - Upsert clips into clips table
  - Return: created count, scanned episodes, scanned topics

### Task 5.2: Playlist API
- `GET /api/playlist` — fetch user's clips
  - Join clips → episodes → podcasts → clip_listens
  - Return: clip data with episode title, podcast title, artwork, listen status
  - Sort by created_at DESC
  - Limit 100
- `POST /api/playlist/clips/[id]/listen` — mark clip as listened

### Task 5.3: Playlist Page
- Route: `/` (home)
- Fetch and display clip queue
- Each clip card shows:
  - Podcast artwork (left)
  - Topic tag (colored pill)
  - Episode title
  - Podcast name · start time · duration
  - NEW badge if unlistened
  - Play button (right)
- "Generate Clips" button in header
- Empty state directing user to add topics and podcasts

### Task 5.4: Audio Player
- Hidden `<audio>` element managed by React state
- Play clip: set audio src to clip's audioUrl, seek to startMs
- Auto-stop when currentTime reaches endMs
- Auto-advance: when clip ends, play next clip in the queue
- Play/pause toggle on clip cards

### Task 5.5: Player Bar (Bottom)
- Fixed bottom bar across all pages
- Shows: current clip artwork, episode title, topic, podcast name
- Controls: play/pause, skip to next clip
- Progress bar showing position within current clip (startMs to endMs)
- Time display: current position / clip duration

### Task 5.6: Mark as Listened
- When a clip starts playing, mark it as listened (optimistic UI update)
- Remove NEW badge
- Fire POST to /api/playlist/clips/[id]/listen

---

## ⛔ CHECKPOINT 3 — STOP HERE (MOST IMPORTANT)

**Tell the user:**
> "Phase 5 is complete. The playlist and audio player are functional. **Now go to Claude Opus for the full design pass.** This is the most important checkpoint — this is what Jason sees on the Loom. Opus will overhaul the playlist UI, player bar, clip cards, animations, typography, and overall polish to make it look like a real product, not a developer project. Share your current code and/or screenshots."

**Do NOT proceed to Phase 6 until the user confirms the design pass is done.**

---

## Phase 6 — Demo Prep & Polish

### Task 6.1: Onboarding Flow
- First-time user detection (no topics + no subscriptions)
- Redirect to `/onboarding` with stepped flow:
  1. "What do you care about?" → add 3+ topics
  2. "What podcasts do you follow?" → add 2+ podcasts (pre-fill popular ones)
  3. "Scanning your podcasts..." → trigger ingestion → show progress
  4. Redirect to playlist when first clips are ready

### Task 6.2: Pre-load Demo Data
- Subscribe to 2-3 podcasts (All-In, TWIST, or others with public RSS)
- Ingest at least 2 recent episodes per podcast
- Add demo topics: "OpenClaw", "AI agents", "NBA Playoffs" (or whatever's relevant)
- Generate clips so the playlist has content

### Task 6.3: Error Handling & Edge Cases
- Loading spinners on all async operations
- Error toasts or inline error messages
- Handle: no topics, no podcasts, no clips, failed transcription, audio load failure
- Graceful fallbacks everywhere

### Task 6.4: Deploy to Vercel
- Connect GitHub repo to Vercel
- Set environment variables in Vercel dashboard
- Test the full flow on the deployed URL
- Note: Transcription is slow — for the demo, pre-process episodes before recording the Loom

### Task 6.5: Final Polish
- Test the full demo script (see below)
- Fix any visual or functional issues
- Ensure audio playback works smoothly
- Test on desktop Chrome (primary Loom recording target)

---

## Demo Script (for the Loom)

1. Open CastCue → show the clean login → sign in
2. Show empty playlist → "Let me set up what I care about"
3. Go to Topics → add "OpenClaw", "AI agents", "NBA Playoffs"
4. Go to Podcasts → subscribe to All-In and TWIST (show the RSS parsing working)
5. Show episodes appearing → trigger processing (or show pre-processed status)
6. Go to Playlist → hit "Generate Clips" → clips appear with topic tags and NEW badges
7. **Hit play** → REAL audio plays from a real podcast, starting at the exact timestamp where they discuss the topic
8. Show auto-advance to next clip (different podcast, same topic)
9. Show the player bar, progress, skip functionality
10. Close: "This is CastCue. You tell it what you care about, and it builds you a playlist of just the conversations that matter. Let's talk."

---

## API Keys Checklist

- [ ] Supabase project created (supabase.com — free tier)
- [ ] OpenAI API key (you likely have this)
- [ ] Deepgram API key (deepgram.com — $200 free credit)

---

## File Structure (Target)

```
castcue-app/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with sidebar
│   │   ├── page.tsx                # Playlist (home)
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   ├── onboarding/page.tsx
│   │   ├── topics/page.tsx
│   │   ├── podcasts/page.tsx
│   │   └── api/
│   │       ├── topics/route.ts
│   │       ├── podcasts/
│   │       │   ├── route.ts
│   │       │   └── subscribe/route.ts
│   │       ├── episodes/
│   │       │   └── ingest/route.ts
│   │       └── playlist/
│   │           ├── route.ts
│   │           ├── generate/route.ts
│   │           └── clips/[id]/listen/route.ts
│   ├── components/
│   │   ├── Sidebar.tsx
│   │   ├── PlayerBar.tsx
│   │   ├── ClipCard.tsx
│   │   ├── TopicPill.tsx
│   │   └── AudioProvider.tsx       # Context for audio state
│   └── lib/
│       ├── supabase/
│       │   ├── client.ts
│       │   ├── server.ts
│       │   └── admin.ts
│       └── services/
│           ├── search.ts           # Ported from existing
│           ├── segmentation.ts     # Ported from existing
│           ├── embedding.ts        # Ported from existing
│           ├── transcription.ts    # NEW — Deepgram
│           ├── pipeline.ts         # NEW — orchestration
│           └── types.ts            # Ported from existing
├── supabase/
│   └── schema.sql
├── PLAN.md                         # This file
├── .env.local
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```
