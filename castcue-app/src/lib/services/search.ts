// ============================================================
// Search Service v3
// Improved: adaptive thresholds, LLM verification, better merging
// ============================================================

import { createAdminClient } from "@/lib/supabase/admin";
import { embedTopicQuery } from "./embedding";
import { SEARCH_CONFIG, TopicRange } from "./types";

interface SegmentRow {
  id: number;
  segment_index: number;
  text: string;
  start_ms: number;
  end_ms: number;
  embedding: number[];
}

interface SegmentWithSimilarity extends SegmentRow {
  similarity: number;
}

// ============================================================
// Vector Math Utilities
// ============================================================

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[], avg: number): number {
  const variance =
    arr.reduce((sum, v) => sum + (v - avg) ** 2, 0) / arr.length;
  return Math.sqrt(variance) || 1e-6;
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  if (vectors.length === 1) return vectors[0];

  const dims = vectors[0].length;
  const result = new Array(dims).fill(0);

  for (const vec of vectors) {
    for (let i = 0; i < dims; i++) {
      result[i] += vec[i];
    }
  }

  for (let i = 0; i < dims; i++) {
    result[i] /= vectors.length;
  }

  return result;
}

/**
 * Get the value at a given percentile from a sorted array
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ============================================================
// Alias Generation
// ============================================================

function generateAliases(topic: string): string[] {
  const normalized = topic.toLowerCase().trim();
  const words = normalized.split(/\s+/);
  const aliases = new Set([normalized]);

  for (const word of words) {
    if (word.length > 2) aliases.add(word);
  }

  if (words.length > 1) {
    aliases.add(words.map((w) => w[0]).join(""));
  }

  return [...aliases];
}

function parseEmbedding(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.filter((v): v is number => typeof v === "number");
  }
  if (typeof raw === "string") {
    const cleaned = raw.replace(/^\[|\]$/g, "");
    if (!cleaned.trim()) return [];
    return cleaned
      .split(",")
      .map((v) => Number.parseFloat(v.trim()))
      .filter((v) => Number.isFinite(v));
  }
  return [];
}

async function loadEpisodeSegments(
  episodeId: string
): Promise<SegmentRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("segments")
    .select("id, segment_index, text, start_ms, end_ms, embedding")
    .eq("episode_id", episodeId)
    .order("segment_index", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to load segments for episode ${episodeId}: ${error.message}`
    );
  }

  return (data ?? []).map((row) => ({
    id: Number(row.id),
    segment_index: Number(row.segment_index),
    text: String(row.text ?? ""),
    start_ms: Number(row.start_ms ?? 0),
    end_ms: Number(row.end_ms ?? 0),
    embedding: parseEmbedding(row.embedding),
  }));
}

// ============================================================
// LLM Verification Layer
// ============================================================

/**
 * Use a cheap LLM to verify if a text segment actually discusses the topic.
 * This kills false positives like "Iran" matching a conversation about
 * AI trust polling where Iran is mentioned once in passing.
 */
async function verifyClipsWithLLM(
  candidateRanges: Array<{
    startMs: number;
    endMs: number;
    occurrences: number;
    confidence: number;
    sampleText: string;
  }>,
  topic: string
): Promise<
  Array<{
    startMs: number;
    endMs: number;
    occurrences: number;
    confidence: number;
  }>
> {
  type VerificationRange = {
    startMs: number;
    endMs: number;
    occurrences: number;
    confidence: number;
  };
  type AnthropicMessageResponse = {
    content?: Array<{ type?: string; text?: string }>;
  };
  const stripSampleText = (
    ranges: Array<{
      startMs: number;
      endMs: number;
      occurrences: number;
      confidence: number;
      sampleText: string;
    }>
  ): VerificationRange[] =>
    ranges.map((range) => ({
      startMs: range.startMs,
      endMs: range.endMs,
      occurrences: range.occurrences,
      confidence: range.confidence,
    }));

  if (candidateRanges.length === 0) return [];

  // Build a single batch prompt for efficiency
  const segments = candidateRanges.map((r, i) => {
    // Truncate to ~300 chars to keep costs minimal
    const text =
      r.sampleText.length > 300
        ? r.sampleText.substring(0, 300) + "..."
        : r.sampleText;
    return `[${i}] "${text}"`;
  });

  const prompt = `You are a podcast clip relevance judge. For each transcript segment below, determine if it contains a SUBSTANTIVE discussion about "${topic}". 

A substantive discussion means the topic is a main subject being actively discussed, debated, or explained - not just mentioned in passing, used as a metaphor, or referenced briefly while discussing something else.

Segments:
${segments.join("\n\n")}

For each segment, respond with ONLY the segment number and YES or NO, one per line. Example:
[0] YES
[1] NO
[2] YES`;
  console.log(`[search:v3][llm] topic="${topic}" prompt_start`);
  console.log(prompt);
  console.log(`[search:v3][llm] topic="${topic}" prompt_end`);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    console.log(`[search:v3][llm] topic="${topic}" status=${response.status}`);
    const rawBody = await response.text();
    console.log(`[search:v3][llm] topic="${topic}" response_body_start`);
    console.log(rawBody);
    console.log(`[search:v3][llm] topic="${topic}" response_body_end`);

    if (!response.ok) {
      // If LLM verification fails, fall back to returning all candidates
      console.warn(
        `LLM verification failed (${response.status}), returning all candidates`
      );
      return stripSampleText(candidateRanges);
    }

    let data: AnthropicMessageResponse;
    try {
      data = JSON.parse(rawBody) as AnthropicMessageResponse;
    } catch (parseError) {
      console.warn(`[search:v3][llm] topic="${topic}" failed to parse JSON body`, parseError);
      return stripSampleText(candidateRanges);
    }
    const text =
      data.content?.[0]?.type === "text" ? data.content[0].text : "";

    // Parse YES/NO responses
    const verified: Array<{
      startMs: number;
      endMs: number;
      occurrences: number;
      confidence: number;
    }> = [];

    for (let i = 0; i < candidateRanges.length; i++) {
      const pattern = new RegExp(`\\[${i}\\]\\s*(YES|NO)`, "i");
      const match = text.match(pattern);
      const parsed = match?.[1]?.toUpperCase() ?? "PARSE_MISS";
      const include = !match || parsed === "YES";
      console.log(
        `[search:v3][llm] topic="${topic}" segment=${i} parsed=${parsed} include=${include}`
      );

      if (!match || match[1].toUpperCase() === "YES") {
        // If we can't parse the response for this segment, include it (safe default)
        verified.push({
          startMs: candidateRanges[i].startMs,
          endMs: candidateRanges[i].endMs,
          occurrences: candidateRanges[i].occurrences,
          confidence: candidateRanges[i].confidence,
        });
      }
    }

    return verified;
  } catch (err) {
    // On any error, fall back to returning all candidates
    console.warn("LLM verification error, returning all candidates:", err);
    return stripSampleText(candidateRanges);
  }
}

// ============================================================
// Main Search Function
// ============================================================

/**
 * Search for topic discussions in an episode using:
 * 1. Sliding window similarity
 * 2. Adaptive thresholds (percentile-based)
 * 3. Aggressive merging (60s gap tolerance)
 * 4. Minimum hit density filtering
 * 5. LLM verification to kill false positives
 */
export async function searchEpisodeWithTimestamps(
  episodeId: string,
  topic: string
): Promise<{ ranges: TopicRange[]; method: "semantic" | "keyword" }> {
  // 1. Load all segments
  const segments = await loadEpisodeSegments(episodeId);
  console.log(`[search:v3] topic="${topic}" step=segments_loaded count=${segments.length}`);
  if (segments.length === 0) {
    return { ranges: [], method: "semantic" };
  }

  // 2. Get aliases
  const aliases = generateAliases(topic);

  // 3. Compute similarities
  const similarities = await computeSlidingWindowSimilarities(
    segments,
    aliases
  );
  const similarityValues = [...similarities.values()];
  const sortedSimilarities = [...similarityValues].sort((a, b) => a - b);
  const similarityMin = sortedSimilarities[0] ?? 0;
  const similarityMax = sortedSimilarities[sortedSimilarities.length - 1] ?? 0;
  const similarityMean = similarityValues.length ? mean(similarityValues) : 0;
  const similarityP85 = similarityValues.length ? percentile(sortedSimilarities, 85) : 0;
  console.log(
    `[search:v3] topic="${topic}" step=similarity_distribution min=${similarityMin.toFixed(4)} max=${similarityMax.toFixed(4)} mean=${similarityMean.toFixed(4)} p85=${similarityP85.toFixed(4)}`
  );

  // 4. Apply ADAPTIVE dual threshold
  let hits = applyAdaptiveThreshold(segments, similarities);
  let method: "semantic" | "keyword" = "semantic";
  console.log(`[search:v3] topic="${topic}" step=after_adaptive_threshold hits=${hits.length}`);

  // 5. Keyword fallback
  if (hits.length === 0) {
    hits = keywordFallback(segments, aliases);
    method = "keyword";
    if (hits.length === 0) {
      return { ranges: [], method };
    }
  }

  // 6. Build ranges with actual timestamps
  const rawRanges = buildTimestampRanges(segments, hits);

  // 7. Aggressive merge - combine ranges within 60s of each other
  const merged = aggressiveMerge(rawRanges, 60000);
  console.log(`[search:v3] topic="${topic}" step=after_merging ranges=${merged.length}`);

  // 8. Filter by minimum hit density (at least 2 hits per range)
  const dense = merged.filter((r) => r.occurrences >= 2);
  console.log(`[search:v3] topic="${topic}" step=after_density_filter ranges=${dense.length}`);

  // 9. Filter by minimum duration
  const filtered = dense.filter(
    (r) => r.endMs - r.startMs >= SEARCH_CONFIG.MIN_RANGE_MS
  );

  // 10. LLM verification - collect sample text for each range
  const rangesWithText = filtered.map((range) => {
    // Use original hit segments (not padded context) within this range.
    // Then take highest-similarity hits to focus Claude on the core topic discussion.
    const topRangeHits = hits
      .filter(
        (h) =>
          h.start_ms >= range.startMs &&
          h.end_ms <= range.endMs &&
          h.similarity > 0
      )
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);

    const sampleText = topRangeHits
      .map((hit) =>
        hit.text.length > 800 ? `${hit.text.substring(0, 800)}...` : hit.text
      )
      .join(" ");
    return { ...range, sampleText };
  });

  // Only run LLM verification if we have an API key and candidates
  if (process.env.ANTHROPIC_API_KEY && rangesWithText.length > 0) {
    const verified = await verifyClipsWithLLM(rangesWithText, topic);
    console.log(`[search:v3] topic="${topic}" step=after_llm_verification ranges=${verified.length}`);
    return { ranges: verified, method };
  }

  // No API key - return without LLM verification
  console.log(`[search:v3] topic="${topic}" step=after_llm_verification ranges=${filtered.length} skipped=true`);
  return { ranges: filtered, method };
}

// Keep the old searchEpisode for backward compatibility
export async function searchEpisode(
  episodeId: string,
  topic: string
): Promise<{ ranges: TopicRange[]; method: "semantic" | "keyword" }> {
  return searchEpisodeWithTimestamps(episodeId, topic);
}

// ============================================================
// Similarity Computation
// ============================================================

async function computeSlidingWindowSimilarities(
  segments: SegmentRow[],
  aliases: string[]
): Promise<Map<number, number>> {
  const similarities = new Map<number, number>();

  const aliasEmbeddings: number[][] = [];
  for (const alias of aliases) {
    const emb = await embedTopicQuery(alias);
    aliasEmbeddings.push(emb);
  }

  for (let i = 0; i < segments.length; i++) {
    const windowEmbeddings: number[][] = [];
    if (segments[i - 1]?.embedding?.length)
      windowEmbeddings.push(segments[i - 1].embedding);
    if (segments[i].embedding?.length)
      windowEmbeddings.push(segments[i].embedding);
    if (segments[i + 1]?.embedding?.length)
      windowEmbeddings.push(segments[i + 1].embedding);

    if (windowEmbeddings.length === 0) continue;

    const avgEmbedding = averageVectors(windowEmbeddings);

    let maxSim = 0;
    for (const aliasEmb of aliasEmbeddings) {
      const sim = cosine(avgEmbedding, aliasEmb);
      if (sim > maxSim) maxSim = sim;
    }

    similarities.set(i, maxSim);
  }

  return similarities;
}

// ============================================================
// Adaptive Thresholding
// ============================================================

/**
 * Instead of fixed thresholds, use percentile-based cutoffs:
 * - Only keep segments in the top 15% of similarity scores
 * - AND above a minimum absolute floor (0.35)
 * - AND at least 0.75 z-scores above the mean
 *
 * This adapts to each episode's similarity distribution automatically.
 */
function applyAdaptiveThreshold(
  segments: SegmentRow[],
  similarities: Map<number, number>
): SegmentWithSimilarity[] {
  const simValues = [...similarities.values()];
  if (simValues.length === 0) return [];

  const sorted = [...simValues].sort((a, b) => a - b);
  const p85 = percentile(sorted, 85); // Top 15% cutoff
  const avg = mean(simValues);
  const std = stdDev(simValues, avg);

  const ABSOLUTE_FLOOR = 0.35;
  const MIN_Z_SCORE = 0.75;

  const hits: SegmentWithSimilarity[] = [];

  for (const [idx, sim] of similarities) {
    const zScore = (sim - avg) / std;

    // Must pass ALL three conditions:
    // 1. Above the 85th percentile for this episode
    // 2. Above an absolute minimum (prevents noisy episodes from returning everything)
    // 3. Above a z-score floor (must be meaningfully above average)
    if (sim >= p85 && sim >= ABSOLUTE_FLOOR && zScore >= MIN_Z_SCORE) {
      hits.push({
        ...segments[idx],
        similarity: sim,
      });
    }
  }

  return hits;
}

// ============================================================
// Keyword Fallback
// ============================================================

function keywordFallback(
  segments: SegmentRow[],
  aliases: string[]
): SegmentWithSimilarity[] {
  const regexes = aliases.map(
    (a) => new RegExp(`\\b${escapeRegex(a)}\\b`, "i")
  );
  const hits: SegmentWithSimilarity[] = [];

  for (const seg of segments) {
    const text = seg.text.toLowerCase();
    if (regexes.some((re) => re.test(text))) {
      hits.push({ ...seg, similarity: 0.5 });
    }
  }

  return hits;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ============================================================
// Range Building
// ============================================================

/**
 * Build ranges using actual segment timestamps with context padding
 */
function buildTimestampRanges(
  segments: SegmentRow[],
  hits: SegmentWithSimilarity[]
): TopicRange[] {
  if (hits.length === 0) return [];

  // Expand hits with context
  const hitIndices = new Set(hits.map((h) => h.segment_index));
  const expandedSegments: SegmentWithSimilarity[] = [];

  for (const seg of segments) {
    let includeForContext = false;
    for (const hitIdx of hitIndices) {
      if (
        seg.segment_index >= hitIdx - SEARCH_CONFIG.CONTEXT_SEGMENTS_BEFORE &&
        seg.segment_index <= hitIdx
      ) {
        includeForContext = true;
        break;
      }
    }

    if (includeForContext) {
      const isDirectHit = hitIndices.has(seg.segment_index);
      expandedSegments.push({
        ...seg,
        similarity: isDirectHit
          ? (hits.find((h) => h.segment_index === seg.segment_index)
              ?.similarity ?? 0)
          : 0,
      });
    }
  }

  // Merge into continuous ranges
  expandedSegments.sort((a, b) => a.segment_index - b.segment_index);

  const rawRanges: Array<{
    startMs: number;
    endMs: number;
    hitCount: number;
    totalSimilarity: number;
  }> = [];

  let currentRange: (typeof rawRanges)[number] | null = null;

  for (let i = 0; i < expandedSegments.length; i++) {
    const seg = expandedSegments[i];
    const isConsecutive =
      i > 0 &&
      seg.segment_index === expandedSegments[i - 1].segment_index + 1;

    if (!currentRange || !isConsecutive) {
      if (currentRange) rawRanges.push(currentRange);
      currentRange = {
        startMs: seg.start_ms,
        endMs: seg.end_ms,
        hitCount: seg.similarity > 0 ? 1 : 0,
        totalSimilarity: seg.similarity,
      };
    } else {
      currentRange.endMs = seg.end_ms;
      if (seg.similarity > 0) {
        currentRange.hitCount++;
        currentRange.totalSimilarity += seg.similarity;
      }
    }
  }

  if (currentRange) rawRanges.push(currentRange);

  // Apply time padding
  return rawRanges.map((r) => ({
    startMs: Math.max(0, r.startMs - SEARCH_CONFIG.LEAD_PAD_MS),
    endMs: r.endMs + SEARCH_CONFIG.TRAIL_PAD_MS,
    occurrences: r.hitCount,
    confidence: r.hitCount > 0 ? r.totalSimilarity / r.hitCount : 0.5,
  }));
}

// ============================================================
// Aggressive Merging
// ============================================================

/**
 * Merge ranges that are within `gapMs` of each other.
 * This stitches together parts of the same conversation that had
 * a brief tangent in between (e.g., they discussed AI agents,
 * went on a 30s tangent, then came back to AI agents).
 */
function aggressiveMerge(ranges: TopicRange[], gapMs: number): TopicRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs);
  const merged: TopicRange[] = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];

    // Merge if overlapping OR within gap tolerance
    if (current.startMs <= last.endMs + gapMs) {
      last.endMs = Math.max(last.endMs, current.endMs);
      last.occurrences += current.occurrences;
      last.confidence = (last.confidence + current.confidence) / 2;
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}
