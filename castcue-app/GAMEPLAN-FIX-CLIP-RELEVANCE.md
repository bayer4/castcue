# Gameplan: Fix Clip Relevance (NFL content matching "NBA Draft")

> **Problem**: Clips tagged "nba draft" contain NFL draft content (e.g. Todd McShay talking about the NFL). The semantic search engine finds NFL draft segments because embeddings for "draft" concepts are similar across sports. The LLM verification layer is supposed to catch this but it's not enough on its own — it can fail (network errors), and we can't rely on a single network call as the only defense against cross-domain false positives.

> **Read `PLAN.md` and `BLUEPRINT.md` first for full project context.**

---

## Step 1: Clean up stale clips in the database

The clips table likely has bad data from previous generation runs. Run this in Supabase SQL Editor:

```sql
-- See what's in there
SELECT c.id, c.topic, c.start_ms, c.end_ms, c.confidence,
       e.title as episode_title, p.title as podcast_title
FROM clips c
JOIN episodes e ON c.episode_id = e.id
JOIN podcasts p ON e.podcast_id = p.id
WHERE c.topic = 'nba draft'
ORDER BY c.created_at DESC;

-- Delete the bad clips
DELETE FROM clip_listens WHERE clip_id IN (SELECT id FROM clips WHERE topic = 'nba draft');
DELETE FROM clips WHERE topic = 'nba draft';
```

---

## Step 2: Add keyword validation as a HARD filter in search.ts

**File**: `src/lib/services/search.ts`

**Why**: The LLM verification is a soft defense (network call that can fail). We need a hard, deterministic filter that runs BEFORE the LLM. For multi-word topics like "nba draft", require that at least one segment in a candidate range contains a **distinguishing keyword** from the topic in the actual transcript text.

For "nba draft" → the word "nba" or "basketball" must appear somewhere in the segments that make up the range. NFL draft content will never contain "nba", so it gets killed instantly with zero network calls.

**Where to add it**: Between step 8 (density filter) and step 10 (LLM verification) in `searchEpisodeWithTimestamps()`. Around line 380.

**Logic**:

```typescript
// Step 9b: Keyword presence validation for multi-word topics.
// At least one hit segment in the range must contain a distinguishing
// keyword from the topic. This is a hard filter that prevents cross-domain
// false positives (e.g. NFL draft matching "nba draft") without relying
// on the LLM network call.
function extractDistinguishingKeywords(topic: string): string[] {
  const words = topic.toLowerCase().trim().split(/\s+/);
  if (words.length <= 1) return []; // Single-word topics skip this filter
  
  // Generic/ambiguous words that appear across domains
  const GENERIC_WORDS = new Set([
    "draft", "trade", "game", "play", "player", "team", "season",
    "news", "update", "report", "analysis", "discussion", "talk",
    "latest", "new", "big", "top", "best", "worst", "first",
    "the", "a", "an", "of", "in", "on", "for", "and", "or",
  ]);
  
  // Return non-generic words — these are the distinguishing ones
  return words.filter(w => w.length >= 2 && !GENERIC_WORDS.has(w));
}
```

Then in `searchEpisodeWithTimestamps`, after the density filter and before LLM verification:

```typescript
const distinguishingKeywords = extractDistinguishingKeywords(topic);

const keywordValidated = distinguishingKeywords.length === 0
  ? filtered  // Single-word topics or no distinguishing keywords → skip
  : filtered.filter((range) => {
      // Check if ANY hit segment in this range contains at least one distinguishing keyword
      const rangeHits = hits.filter(
        (h) => h.start_ms >= range.startMs && h.end_ms <= range.endMs
      );
      const rangeText = rangeHits.map((h) => h.text).join(" ").toLowerCase();
      return distinguishingKeywords.some((kw) => rangeText.includes(kw));
    });

console.log(`[search:v3] topic="${topic}" step=after_keyword_validation ranges=${keywordValidated.length} keywords=${JSON.stringify(distinguishingKeywords)}`);
```

Then pass `keywordValidated` (instead of `filtered`) into the LLM verification step (step 10).

**Key examples of how this works:**
- Topic "nba draft" → distinguishing keywords: `["nba"]` → NFL draft segments don't contain "nba" → filtered out
- Topic "philadelphia eagles" → distinguishing keywords: `["philadelphia", "eagles"]` → segments must mention "philadelphia" or "eagles"
- Topic "ai agents" → distinguishing keywords: `["ai", "agents"]` → works correctly
- Topic "iran" → single word → filter skipped (handled by LLM)
- Topic "anthropic" → single word → filter skipped

---

## Step 3: Expand context in the LLM prompt

**File**: `src/lib/services/search.ts`, in `verifyClipsWithLLM()`

The LLM prompt currently only gets the transcript text. Add the **episode title** and **podcast name** as context so the LLM can use that information for its judgment.

**Change the function signature** to accept episode metadata:

```typescript
async function verifyClipsWithLLM(
  candidateRanges: Array<{
    startMs: number;
    endMs: number;
    occurrences: number;
    confidence: number;
    sampleText: string;
  }>,
  topic: string,
  episodeTitle?: string,
  podcastTitle?: string,
): Promise<...>
```

**Add context to the prompt** (before the "Segments:" section):

```
Podcast: "${podcastTitle ?? "Unknown"}"
Episode: "${episodeTitle ?? "Unknown"}"
```

**Pass the metadata from `searchEpisodeWithTimestamps`**: Load the episode title/podcast title from the episode record and pass them through. The episode record is already fetched in `loadEpisodeSegments` — either extend that function to also return metadata, or do a separate lightweight query for just the episode+podcast title at the top of `searchEpisodeWithTimestamps`.

---

## Step 4: Test

1. Delete existing bad clips (Step 1 SQL)
2. Run "Generate Clips" from the UI
3. Check terminal logs for:
   - `step=after_keyword_validation` — confirm it's filtering correctly
   - `step=after_llm_verification` — confirm LLM is getting episode context
4. Check the playlist — there should be ZERO "nba draft" clips unless one of the subscribed podcasts actually discusses the NBA draft
5. If clips appear under "nba draft", check if the transcript text actually mentions the NBA (it should, thanks to the keyword filter)

---

## Files to modify

| File | Changes |
|------|---------|
| `src/lib/services/search.ts` | Add `extractDistinguishingKeywords()`, add keyword validation step between density filter and LLM verification, expand LLM prompt with episode/podcast metadata, update `verifyClipsWithLLM` signature |
| Database (Supabase SQL) | Delete stale "nba draft" clips |

## DO NOT change

- The adaptive threshold logic (it works correctly)
- The embedding model or embedding approach
- The LLM fallback behavior (already fixed to return empty on failure)
- The clip generation route (`playlist/generate/route.ts`)
