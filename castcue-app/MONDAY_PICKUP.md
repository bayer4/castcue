# Monday Pickup — Clip Extraction Pipeline

## Where We Left Off (Thursday night)

### Current Metrics (from `/api/test/clip-boundaries`)
- **Recall: 100%** — all 5 should-find clips are found (was 60% before overhaul)
- **Precision: 71%** — 2 of 4 should-reject cases correctly rejected (2 false positives remain)
- **Boundary Accuracy: 40%** — 2 of 5 found clips have boundaries within tolerance

### What's Working
- Multi-signal candidate retrieval (3 paths: embedding, label keyword, raw transcript)
- Structured LLM scoring (relevance 1-10 instead of binary YES/NO)
- Quality gates (45s min duration, 3 clips max per episode/topic)
- Ad filtering
- Test Cases 4 and 5 correctly rejected (short LeBron mentions)

### What Still Needs Work

#### 1. END boundary too aggressive (Test Cases 1, 3, 6)
- BCI/AI: ends at 6:35, should be 7:39 (64s too early)
- Crypto: now finding wrong section entirely (12:03 instead of 47:52)
- Prompt 2 fix (loosen density falloff) was deployed but didn't move metrics
- **Next step:** Run the diagnostics endpoint to see what's happening stage by stage. Use: `fetch('/api/test/clip-diagnostics?episodeId=<ID>&topic=crypto').then(r=>r.json()).then(d=>console.log(JSON.stringify(d,null,2)))`

#### 2. Test Case 7 finding wrong section
- Expected crypto/tokenization discussion at 8:15–12:22
- System finding 6:31–7:39 instead (the intro section)
- **Next step:** Send Prompt 3 (from the conversation) to Codex — adds debug logging and a secondary scoring pass for candidates scoring 5-6

#### 3. Two false positives remaining (Test Cases 8, 9)
- Test Case 8: crypto broad discussion at 13:17–15:29 — system produces overlapping clip
- Test Case 9: crypto intro at 6:40–8:14 — system produces overlapping clip
- **Next step:** After fixing scoring/boundaries, these may resolve naturally. If not, the structured scoring threshold might need tuning.

#### 4. START still ~24s early on Test Case 2
- LeBron clip starts at 50:01, ideal is 50:25
- Low priority — 24s of lead-in is acceptable for a demo

## Prompt 3 (Ready to Send to Codex Monday)

**Investigate and fix Test Case 7 finding wrong section**

File: `castcue-app/src/lib/services/search.ts`

Problem: Test Case 7 expects a crypto/tokenization clip at 8:15–12:22 but the system found 6:31–7:39 instead. The main 4-minute discussion was missed; only the intro was caught.

Fix:
1. Add permanent logging at each pipeline stage in `searchEpisodeWithTimestamps`. For each candidate, log:
   - Source path (A=embedding, B=label keyword, C=raw transcript keyword)
   - Time range (startMs–endMs)
   - Whether it passed/failed scoring (and the score)
   - Whether it passed/failed quality gates
   Format: `[search:v5:debug] topic="${topic}" stage=<stage> range=<start>-<end> result=<pass/fail> detail=<info>`

2. Check if the structured LLM scoring threshold (relevance >= 7) is too strict for longer segments where crypto is a major part but not the only topic. If the 8:15–12:22 segment scores 5-6, add a secondary pass: candidates scoring 5-6 with sustained=YES get included as lower-confidence clips.

Constraints:
- Only modify `search.ts`
- Keep logging permanent (prefix `[search:v5:debug]`)
- `npx tsc --noEmit` must pass

## Key Files
- `castcue-app/src/lib/services/search.ts` — main pipeline
- `castcue-app/src/lib/services/types.ts` — thresholds/config
- `castcue-app/src/app/api/test/clip-boundaries/route.ts` — test suite (9 cases)
- `castcue-app/src/app/api/test/clip-diagnostics/route.ts` — diagnostics endpoint
- `castcue-app/CLIP_TEST_CASES.md` — ground truth documentation
- `.cursor/plans/clip_extraction_overhaul_8aff6bc9.plan.md` — full architecture plan

## How to Test
```
fetch('/api/test/clip-boundaries').then(r=>r.json()).then(d=>console.log(JSON.stringify(d.summary)))
```

## Friday Todo
Record Loom demo for Jason using existing clips. Don't wait for perfection — the product works.
