# CastCue v2

Find where topics are substantively discussed in podcast episodes.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Static HTML)                    │
│                     Ingest Form │ Search UI │ Audio Player       │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Backend (Express.js)                      │
├─────────────────────────────────────────────────────────────────┤
│  POST /episodes/ingest   │  GET /search?episodeId=&topic=       │
│  ─────────────────────   │  ──────────────────────────────      │
│  1. Slice into segments  │  1. Load segment embeddings          │
│  2. Generate embeddings  │  2. Embed topic query                │
│  3. Store in Postgres    │  3. Sliding-window similarity        │
│                          │  4. Dual threshold (abs + z-score)   │
│                          │  5. Context padding & merge          │
└─────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                PostgreSQL + pgvector                             │
│  ┌─────────────┐  ┌─────────────────────────────────────────┐   │
│  │  episodes   │  │              segments                   │   │
│  │  ─────────  │  │  ─────────────────────────────────────  │   │
│  │  id         │  │  episode_id, segment_index              │   │
│  │  title      │  │  text, start_ms, end_ms                 │   │
│  │  audio_url  │  │  embedding vector(1536)  ← pgvector!    │   │
│  └─────────────┘  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Start PostgreSQL with pgvector

```bash
cd castcue-v2
docker compose up -d
```

### 2. Install dependencies

```bash
cd backend
npm install
```

### 3. Configure environment

Create `backend/.env`:

```env
DATABASE_URL=postgresql://castcue:castcue@localhost:5432/castcue
OPENAI_API_KEY=sk-your-key-here
PORT=3001
```

### 4. Run migrations

```bash
npm run db:migrate
```

### 5. Start the backend

```bash
npm run dev
```

### 6. Open the frontend

Open `frontend/index.html` in your browser (or serve it with any static file server).

## API Reference

### Health Check

```http
GET /health
```

### Topics CRUD

```http
GET    /topics              # List all topics
GET    /topics/:id          # Get single topic
POST   /topics              # Create topic
PUT    /topics/:id          # Update topic
DELETE /topics/:id          # Delete topic
```

### Episodes

```http
GET    /episodes            # List all episodes
GET    /episodes/:id        # Get single episode
POST   /episodes/ingest     # Ingest new episode
DELETE /episodes/:id        # Delete episode
```

**Ingest Request Body:**

```json
{
  "episodeId": "my-podcast-ep-1",
  "title": "Episode 1: Introduction",
  "audioUrl": "https://example.com/ep1.mp3",
  "transcript": {
    "words": [
      { "text": "Hello", "start": 0, "end": 500 },
      { "text": "world", "start": 510, "end": 900 }
    ]
  }
}
```

### Search

```http
GET /search?episodeId=my-podcast-ep-1&topic=artificial%20intelligence
```

**Response:**

```json
{
  "episodeId": "my-podcast-ep-1",
  "audioUrl": "https://example.com/ep1.mp3",
  "topic": "artificial intelligence",
  "method": "semantic",
  "ranges": [
    {
      "startMs": 120000,
      "endMs": 180000,
      "startFormatted": "2:00",
      "endFormatted": "3:00",
      "durationMs": 60000,
      "occurrences": 3,
      "confidence": 0.72
    }
  ],
  "totalRanges": 1,
  "totalDurationMs": 60000
}
```

## Search Algorithm

The search uses a sophisticated multi-step algorithm:

1. **Alias Generation**: Topic "machine learning" → ["machine learning", "machine", "learning", "ml"]

2. **Sliding Window Smoothing**: Average embeddings over 3-segment windows to reduce boundary noise

3. **Dual Thresholding**:
   - Absolute: similarity ≥ 0.50-0.55
   - Relative: z-score ≥ 1.0 (1 std dev above episode mean)

4. **Context Padding**: Include 3 segments before each hit for listener context

5. **Time Padding**: Add 30s lead-in, 10s trail-out

6. **Range Merging**: Consolidate overlapping ranges, sum occurrence counts

7. **Keyword Fallback**: If semantic search returns nothing, try whole-word regex matching

## Key Improvements Over v1

| v1 Problem | v2 Solution |
|------------|-------------|
| Embeddings as JSON strings | Native pgvector `vector(1536)` type |
| No vector index (O(n) scans) | HNSW index for O(log n) search |
| Split storage (S3 + SQLite) | Everything in Postgres |
| Fixed 15s segments | Sentence-boundary-aware chunking |
| BullMQ/Redis complexity | Simple synchronous pipeline |
| Mixed JS/TS with `@ts-nocheck` | Clean TypeScript throughout |
| Duplicated helpers | Single-source utilities |

## Development

```bash
# Run backend with hot reload
npm run dev

# Build for production
npm run build
npm start

# Run migrations
npm run db:migrate
```

## Testing with Sample Data

See `sample-transcript.json` for a test transcript you can paste into the frontend.

