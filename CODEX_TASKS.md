# CastCue — Conversation Boundary Detection Upgrade

> **Instructions for Codex**: Execute each task sequentially. After completing each task, STOP and say:
> "Task N is complete. Please let me know when you'd like me to proceed to Task N+1."
> Do NOT proceed to the next task until the user confirms.

---

## Context

CastCue is a podcast player that finds specific topic conversations across podcast episodes. The user adds topics (e.g., "anthropic", "AI agents") and subscribes to podcasts. The system transcribes episodes, embeds transcript segments, and uses semantic search to find where topics are discussed — then creates audio clips with precise start/end timestamps.

**The problem**: Clips are getting cut off early. A 19-minute conversation about "Anthropic" on All-In Podcast gets clipped to ~4 minutes because the search engine only captures segments that embed closely to the query. Once the hosts shift from saying "Anthropic" to discussing specifics (Claude, revenue, LLM J-curve, PR), segment similarity drops below threshold and the clip ends prematurely.

**The fix**: A 4-step chain that replaces heuristic padding with mathematically precise boundary detection + AI refinement.

### Tech Stack
- Next.js 14 (App Router), TypeScript, Tailwind
- Supabase (Postgres + pgvector)
- OpenAI text-embedding-3-small (1536 dims)
- Anthropic Claude API for LLM steps
- The Anthropic API key is in `process.env.ANTHROPIC_API_KEY`

### Key Files (all paths relative to `castcue-app/`)
- `src/lib/services/types.ts` — Type definitions and SEARCH_CONFIG constants
- `src/lib/services/search.ts` — Full search engine (the main file being modified)
- `src/lib/services/pipeline.ts` — Episode ingestion pipeline (transcribe → segment → embed → store)
- `src/lib/services/segmentation.ts` — Transcript chunking
- `src/lib/services/embedding.ts` — OpenAI embedding wrapper
- `src/lib/supabase/admin.ts` — Supabase admin client (service role)

### The New Search Pipeline (what we're building)

```
Step 1: Semantic Search (existing, unchanged)
  → Embeddings find the needle: "minute 27 discusses Anthropic"

Step 2: Centroid Expansion (new, pure math, free)
  → Compute centroid of hit embeddings, walk outward while segments
    stay similar to the centroid (not the query)
  → Expands 4-min hit zone to rough 15-20 min candidate window

Step 3: Structural Boundary Snapping (new, pure math, pre-computed)
  → During ingestion, pre-compute topic transition points by measuring
    embedding velocity (cosine sim between consecutive segments)
  → At search time, snap candidate window edges to nearest structural boundary

Step 4: AI Boundary Refinement (replaces current LLM verification)
  → Send the candidate window transcript + structural landmarks to Claude Haiku
  → Ask for precise start/end timestamps instead of YES/NO
  → Same cost as current verification, but returns exact boundaries
```

---

## Task 1: Update Constants and Types

**Files to edit**: `src/lib/services/types.ts`

### Changes to SEARCH_CONFIG:

1. **Add** these new constants:
```typescript
CENTROID_FLOOR: 0.3,          // Min cosine similarity to conversation centroid during expansion
VELOCITY_Z_THRESHOLD: 1.0,   // Std devs below mean velocity to qualify as structural boundary
```

2. **Remove** these constants (they'll be replaced by centroid expansion):
```typescript
CONTINUATION_THRESHOLD: 0.25,   // DELETE
MAX_CONTINUATION_MS: 300000,    // DELETE
```

3. **Keep everything else** as-is (LEAD_PAD_MS, TRAIL_PAD_MS, MERGE_GAP_MS, etc.)

### Add a new exported type:

```typescript
export interface StructuralBoundary {
  boundaryMs: number;
  velocityDrop: number;
}
```

**Verify**: `npx tsc --noEmit` compiles cleanly. The removal of CONTINUATION_THRESHOLD and MAX_CONTINUATION_MS will cause errors in search.ts — that's expected and will be fixed in Task 6.

---

## Task 2: Structural Boundary Detection (Ingestion-Time)

**Files to create**: `src/lib/services/boundaries.ts`
**Files to edit**: `src/lib/services/pipeline.ts`

### New file: `boundaries.ts`

Create `src/lib/services/boundaries.ts` that exports one function:

```typescript
export function computeStructuralBoundaries(
  segments: Array<{ segment_index: number; start_ms: number; end_ms: number; embedding: number[] }>
): StructuralBoundary[]
```

Import `StructuralBoundary` and `SEARCH_CONFIG` from `./types`.

**Algorithm**:
1. For each consecutive pair of segments (i, i+1), compute the cosine similarity between their embeddings. This is the "embedding velocity" — high values mean same topic, low values mean topic shift.
2. Skip any segment pairs where either embedding is missing or empty.
3. Compute the mean and standard deviation of all velocity values.
4. Find valleys: velocity values where `(meanVelocity - velocity) / stdDevVelocity > SEARCH_CONFIG.VELOCITY_Z_THRESHOLD`. These are points where the topic changed significantly.
5. Return those as `{ boundaryMs: segment[i+1].start_ms, velocityDrop: velocity }` sorted by boundaryMs.

You'll need `cosine`, `mean`, and `stdDev` helper functions. These already exist in `search.ts` as private functions. **Extract them** into a new shared file `src/lib/services/math.ts` and import from there in both `search.ts` and `boundaries.ts`. Also extract `averageVectors` and `percentile` — they'll be needed later. Make sure to update imports in `search.ts` so nothing breaks.

### Edit: `pipeline.ts`

After the step that stores segments in the database (after the `admin.from("segments").insert(rows)` call), add:

1. Import `computeStructuralBoundaries` from `./boundaries`.
2. Build the segments array with embeddings (you already have `rawSegments` and `embeddings` at this point).
3. Call `computeStructuralBoundaries(...)`.
4. Update the episode record with the boundaries:
```typescript
await admin.from("episodes")
  .update({ boundaries: JSON.stringify(boundaries) })
  .eq("id", episodeId);
```

This requires a `boundaries` JSONB column on the episodes table. Add a comment at the top of `boundaries.ts`:
```typescript
// PREREQUISITE: Run in Supabase SQL editor:
// ALTER TABLE episodes ADD COLUMN boundaries JSONB DEFAULT '[]';
```

**Verify**: `npx tsc --noEmit` compiles cleanly (ignoring search.ts errors from Task 1).

---

## Task 3: Centroid Expansion (Search-Time)

**File to edit**: `src/lib/services/search.ts`

### Add new function:

```typescript
function centroidExpansion(
  segments: SegmentRow[],
  hits: SegmentWithSimilarity[],
): Array<{ startIdx: number; endIdx: number; centroid: number[]; occurrences: number; confidence: number }>
```

Import `averageVectors` and `cosine` from `./math` (extracted in Task 2).

**Algorithm**:

1. Group hits into contiguous clusters. Two hits are in the same cluster if their segment_index values are within 5 of each other. (This handles the case where there are multiple separate topic discussions in one episode — e.g., they mention Anthropic at minute 10 and again at minute 45.)

2. For each cluster:
   a. Collect the embeddings of all hit segments in this cluster.
   b. Compute their centroid using `averageVectors`.
   c. **Walk forward** from the highest segment_index in the cluster. For each subsequent segment, compute `cosine(segment.embedding, centroid)`. Keep extending while similarity >= `SEARCH_CONFIG.CENTROID_FLOOR` (0.3). Stop on the first segment that drops below.
   d. **Walk backward** from the lowest segment_index in the cluster. Same logic.
   e. Record the expanded `startIdx`, `endIdx`, the centroid, total occurrences (number of original hits), and average confidence.

3. Return the array of expanded ranges (one per cluster).

**Do NOT wire this into the main search function yet** — that happens in Task 6.

**Verify**: `npx tsc --noEmit` compiles cleanly (the function exists but isn't called yet).

---

## Task 4: Boundary Snapping (Search-Time)

**File to edit**: `src/lib/services/search.ts`

### Add new function:

```typescript
function snapToBoundaries(
  candidateStartMs: number,
  candidateEndMs: number,
  boundaries: StructuralBoundary[],
): { startMs: number; endMs: number }
```

Import `StructuralBoundary` from `./types`.

**Algorithm**:

1. If `boundaries` is empty, return `{ startMs: candidateStartMs, endMs: candidateEndMs }` unchanged.

2. **Snap the start**: Find the nearest structural boundary that falls at or before `candidateStartMs`. If one exists within 90 seconds before the candidate start (`candidateStartMs - boundary.boundaryMs <= 90000`), snap the start to that boundary's timestamp. Otherwise keep candidateStartMs.

3. **Snap the end**: Find the nearest structural boundary that falls at or after `candidateEndMs`. If one exists within 90 seconds after the candidate end (`boundary.boundaryMs - candidateEndMs <= 90000`), snap the end to that boundary's timestamp. Otherwise keep candidateEndMs.

4. Apply padding: subtract `SEARCH_CONFIG.LEAD_PAD_MS` from the start (floor at 0), add `SEARCH_CONFIG.TRAIL_PAD_MS` to the end.

5. Return the snapped + padded range.

**Do NOT wire this into the main search function yet** — that happens in Task 6.

**Verify**: `npx tsc --noEmit` compiles cleanly.

---

## Task 5: AI Boundary Refinement (Search-Time)

**File to edit**: `src/lib/services/search.ts`

### Replace `verifyClipsWithLLM` with a new function:

```typescript
async function refineClipBoundariesWithLLM(
  candidateRanges: Array<{
    startMs: number;
    endMs: number;
    occurrences: number;
    confidence: number;
    nearbyBoundaries: number[];
  }>,
  segments: SegmentRow[],
  topic: string,
  episodeTitle?: string,
  podcastTitle?: string,
): Promise<Array<{
  startMs: number;
  endMs: number;
  occurrences: number;
  confidence: number;
}>>
```

**Keep the old `verifyClipsWithLLM` function in the file** (just in case), but rename it to `_legacyVerifyClipsWithLLM`. The new function replaces it.

**Algorithm**:

For each candidate range:

1. Collect all segments whose `start_ms >= range.startMs` and `end_ms <= range.endMs`. Format them as a timestamped transcript:
```
[27:05] So the big news this week is Anthropic's revenue numbers...
[27:22] They're reporting nearly two billion in ARR which is...
...
```
Format timestamps as `mm:ss` from milliseconds.

2. If the total formatted transcript exceeds 6000 characters, truncate from the middle (keep first 2500 chars + last 2500 chars with "... [transcript truncated] ..." in between). We want the AI to see the beginning and end of the candidate window.

3. Format the nearby structural boundaries as timestamps: e.g., "Structural topic shifts detected near: 26:05, 46:12"

4. Build the prompt:
```
You are a podcast conversation boundary detector. Given a transcript excerpt and a topic, identify the precise timestamps where the conversation about this topic begins and ends.

Topic: "{topic}"
Podcast: "{podcastTitle ?? "Unknown"}"
Episode: "{episodeTitle ?? "Unknown"}"

Structural topic shifts detected near: {formatted boundary timestamps}

Transcript:
{formatted segments}

Rules:
- The topic must be a central subject being discussed, not just mentioned in passing.
- Find where this topic STARTS being a primary focus and where it STOPS being a primary focus.
- Use the structural shift timestamps as hints, but trust the transcript content over them.
- If the topic is not actually discussed as a primary subject, set RELEVANT to NO.

Respond in EXACTLY this format (timestamps as total milliseconds):
START_MS: {number}
END_MS: {number}
RELEVANT: YES or NO
SUMMARY: {one-line summary of what's discussed}
```

5. Call the Anthropic API:
   - **Model**: `claude-haiku-4-5-20251001` (cheaper than Sonnet, fast enough for this task)
   - **max_tokens**: 150
   - Same retry logic as the existing `verifyClipsWithLLM` (2 retries with backoff)

6. Parse the response:
   - Extract `START_MS`, `END_MS`, `RELEVANT`, and `SUMMARY` using regex patterns like `/START_MS:\s*(\d+)/`
   - If `RELEVANT` is `NO`, exclude this range from results.
   - If `RELEVANT` is `YES`, use the parsed `START_MS` and `END_MS` as the refined clip boundaries.
   - If parsing fails or the API call fails, **fall back to the unrefined candidate range** (don't drop clips on failure — the math-based boundaries are good enough as fallback).

7. Log the refinement: `console.log([search:v4][llm-refine] topic="${topic}" original=${range.startMs}-${range.endMs} refined=${parsedStart}-${parsedEnd})`

**Verify**: `npx tsc --noEmit` compiles cleanly.

---

## Task 6: Wire the New Pipeline into searchEpisodeWithTimestamps

**File to edit**: `src/lib/services/search.ts`

This is the integration task. Replace the current search pipeline (steps 6-11) with the new chain.

### Update `loadEpisodeMetadata`

Change the function to also fetch the episode's `boundaries` column:

```typescript
async function loadEpisodeMetadata(episodeId: string): Promise<{
  episodeTitle?: string;
  podcastTitle?: string;
  boundaries: StructuralBoundary[];
}>
```

In the Supabase query, add `boundaries` to the `.select()`. Parse the JSONB:
```typescript
const boundaries: StructuralBoundary[] = Array.isArray(episode.boundaries)
  ? episode.boundaries
  : [];
```

Return `boundaries` alongside the existing fields.

### Rewrite the main search flow

Update the `searchEpisodeWithTimestamps` function. The new flow after step 5 (keyword fallback):

```
Step 6:  [CHANGED] Centroid expansion — call centroidExpansion(segments, hits)
         Returns expanded index ranges per hit cluster.

Step 7:  Convert expanded index ranges to millisecond ranges using segment timestamps.

Step 8:  [existing] Aggressive merge — aggressiveMerge(ranges, SEARCH_CONFIG.MERGE_GAP_MS)

Step 9:  [existing] Density filter (>= 2 occurrences per range)

Step 10: [existing] Min duration filter (>= MIN_RANGE_MS)

Step 11: [existing] Keyword validation for multi-word topics

Step 12: [NEW] Boundary snapping — for each surviving range, call
         snapToBoundaries(range.startMs, range.endMs, boundaries)

Step 13: [NEW] AI boundary refinement — call refineClipBoundariesWithLLM(...)
         replaces the old verifyClipsWithLLM call.
         For each range, include the nearby structural boundaries
         (boundaries within 120s of the range start or end).
```

### Delete the `trailingContinuation` function entirely.

It was added as an interim fix and is now fully replaced by centroid expansion + boundary snapping.

### Delete the `buildTimestampRanges` function.

The centroid expansion (Task 3) now handles range building. In step 7 above, converting expanded index ranges to ms ranges is straightforward:
```typescript
const range = {
  startMs: segments[expanded.startIdx].start_ms,
  endMs: segments[expanded.endIdx].end_ms,
  occurrences: expanded.occurrences,
  confidence: expanded.confidence,
};
```

No more LEAD_PAD_MS / TRAIL_PAD_MS at this stage — padding is applied in `snapToBoundaries` (Task 4).

### Update the comment at the top of the file:

```typescript
// ============================================================
// Search Service v4
// Chain: Semantic Search → Centroid Expansion → Boundary Snap → AI Refine
// ============================================================
```

**Verify**: `npx tsc --noEmit` compiles cleanly. The full pipeline should work end-to-end. Run the linter to check for any issues.

---

## Task 7: Backfill Boundaries for Existing Episodes

**File to create**: `src/app/api/episodes/backfill-boundaries/route.ts`

### POST endpoint:

1. Authenticate the user (use `getAuthenticatedUser` from `@/lib/supabase/auth-user`).
2. Load all episodes with `status = 'ready'` where `boundaries` is NULL or `'[]'`.
3. For each episode:
   a. Load its segments (with embeddings) from the segments table, ordered by segment_index.
   b. Call `computeStructuralBoundaries(segments)` from `@/lib/services/boundaries`.
   c. Update the episode record: `UPDATE episodes SET boundaries = $jsonValue WHERE id = $episodeId`.
4. Return `{ processed: count, total: totalEligible }`.

Add logging: `console.log([backfill] processed ${count}/${total} episodes)`

**Verify**: `npx tsc --noEmit` compiles cleanly.

---

## Pre-Requisite (Manual Step — tell the user)

Before testing, the user needs to run this SQL in the Supabase SQL editor:

```sql
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS boundaries JSONB DEFAULT '[]';
```

---

## Post-Completion Testing Steps (tell the user)

1. Run the SQL ALTER above in Supabase.
2. Hit `POST /api/episodes/backfill-boundaries` to populate boundaries for existing episodes.
3. Clear existing clips (use the Clear button in the UI).
4. Hit Generate to re-run the search engine with the new pipeline.
5. Check the "anthropic" clips — they should now capture the full conversation length.
