// ============================================================
// Search Service
// Core semantic search with all the smart algorithms from v1
// ============================================================

import { query } from '../db/client.js';
import { embedTopicQuery, embed } from './embedding.js';
import { TopicRange, SEARCH_CONFIG } from '../types.js';
import pgvector from 'pgvector';

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
  let dot = 0, normA = 0, normB = 0;
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
  const variance = arr.reduce((sum, v) => sum + (v - avg) ** 2, 0) / arr.length;
  return Math.sqrt(variance) || 1e-6; // Avoid division by zero
}

/**
 * Average multiple vectors element-wise (for sliding window smoothing)
 */
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

// ============================================================
// Alias Generation
// ============================================================

/**
 * Generate aliases for a topic to improve recall
 * e.g., "machine learning" → ["machine learning", "machine", "learning", "ml"]
 */
function generateAliases(topic: string): string[] {
  const normalized = topic.toLowerCase().trim();
  const words = normalized.split(/\s+/);
  const aliases = new Set([normalized]);

  // Add individual words
  for (const word of words) {
    if (word.length > 2) aliases.add(word);
  }

  // Add acronym for multi-word topics
  if (words.length > 1) {
    aliases.add(words.map(w => w[0]).join(''));
  }

  return [...aliases];
}

// ============================================================
// Main Search Functions
// ============================================================

/**
 * Search for topic discussions in an episode
 * Returns merged time ranges where the topic is substantively discussed
 */
export async function searchEpisode(
  episodeId: string,
  topic: string
): Promise<{ ranges: TopicRange[]; method: 'semantic' | 'keyword' }> {
  // 1. Load all segments with embeddings for this episode
  const result = await query<SegmentRow>(
    `SELECT id, segment_index, text, start_ms, end_ms, embedding
     FROM segments
     WHERE episode_id = $1
     ORDER BY segment_index`,
    [episodeId]
  );

  const segments = result.rows;
  if (segments.length === 0) {
    return { ranges: [], method: 'semantic' };
  }

  // 2. Generate topic aliases and determine threshold
  const aliases = generateAliases(topic);
  const baseThreshold = aliases.length > 1
    ? SEARCH_CONFIG.BASE_THRESHOLD_MULTI
    : SEARCH_CONFIG.BASE_THRESHOLD_SINGLE;

  // 3. Compute similarity for each segment using sliding window
  const segmentSimilarities = await computeSlidingWindowSimilarities(
    segments,
    aliases
  );

  // 4. Apply dual thresholding (absolute + z-score)
  const hits = applyDualThreshold(
    segments,
    segmentSimilarities,
    baseThreshold
  );

  // 5. If no semantic hits, try keyword fallback
  if (hits.length === 0) {
    const keywordHits = keywordFallback(segments, aliases);
    if (keywordHits.length === 0) {
      return { ranges: [], method: 'keyword' };
    }
    const ranges = buildRanges(keywordHits, segments.length);
    return { ranges, method: 'keyword' };
  }

  // 6. Build and merge ranges
  const ranges = buildRanges(hits, segments.length);
  return { ranges, method: 'semantic' };
}

/**
 * Compute similarity scores using 3-segment sliding window averaging
 * This smooths out noise from segment boundaries
 */
async function computeSlidingWindowSimilarities(
  segments: SegmentRow[],
  aliases: string[]
): Promise<Map<number, number>> {
  const similarities = new Map<number, number>();

  // Get embeddings for all aliases
  const aliasEmbeddings: number[][] = [];
  for (const alias of aliases) {
    const emb = await embedTopicQuery(alias);
    aliasEmbeddings.push(emb);
  }

  for (let i = 0; i < segments.length; i++) {
    // Build 3-segment window
    const windowEmbeddings: number[][] = [];
    if (segments[i - 1]?.embedding) windowEmbeddings.push(segments[i - 1].embedding);
    if (segments[i].embedding) windowEmbeddings.push(segments[i].embedding);
    if (segments[i + 1]?.embedding) windowEmbeddings.push(segments[i + 1].embedding);

    if (windowEmbeddings.length === 0) continue;

    // Average the window embeddings
    const avgEmbedding = averageVectors(windowEmbeddings);

    // Take max similarity across all aliases
    let maxSim = 0;
    for (const aliasEmb of aliasEmbeddings) {
      const sim = cosine(avgEmbedding, aliasEmb);
      if (sim > maxSim) maxSim = sim;
    }

    similarities.set(i, maxSim);
  }

  return similarities;
}

/**
 * Apply dual thresholding:
 * 1. Absolute threshold (segment must be at least X similar)
 * 2. Z-score threshold (segment must be 1 std dev above episode mean)
 */
function applyDualThreshold(
  segments: SegmentRow[],
  similarities: Map<number, number>,
  baseThreshold: number
): SegmentWithSimilarity[] {
  const simValues = [...similarities.values()];
  if (simValues.length === 0) return [];

  const avg = mean(simValues);
  const std = stdDev(simValues, avg);

  const hits: SegmentWithSimilarity[] = [];

  for (const [idx, sim] of similarities) {
    const zScore = (sim - avg) / std;

    // Must pass BOTH thresholds
    if (sim >= baseThreshold && zScore >= SEARCH_CONFIG.Z_SCORE_THRESHOLD) {
      hits.push({
        ...segments[idx],
        similarity: sim,
      });
    }
  }

  return hits;
}

/**
 * Keyword fallback: whole-word regex matching
 */
function keywordFallback(
  segments: SegmentRow[],
  aliases: string[]
): SegmentWithSimilarity[] {
  const regexes = aliases.map(a => new RegExp(`\\b${escapeRegex(a)}\\b`, 'i'));
  const hits: SegmentWithSimilarity[] = [];

  for (const seg of segments) {
    const text = seg.text.toLowerCase();
    if (regexes.some(re => re.test(text))) {
      hits.push({ ...seg, similarity: 0.5 }); // Arbitrary confidence for keyword hits
    }
  }

  return hits;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build final ranges from hits:
 * 1. Add context (preceding segments)
 * 2. Pad times
 * 3. Merge overlapping ranges
 * 4. Filter out too-short ranges
 */
function buildRanges(
  hits: SegmentWithSimilarity[],
  totalSegments: number
): TopicRange[] {
  if (hits.length === 0) return [];

  // Dedupe and add context segments
  const hitIndices = new Set(hits.map(h => h.segment_index));
  const expandedIndices = new Set<number>();

  for (const idx of hitIndices) {
    // Add context before the hit
    for (let i = SEARCH_CONFIG.CONTEXT_SEGMENTS_BEFORE; i >= 0; i--) {
      const ctxIdx = idx - i;
      if (ctxIdx >= 0) expandedIndices.add(ctxIdx);
    }
  }

  // Group consecutive indices into ranges
  const sortedIndices = [...expandedIndices].sort((a, b) => a - b);
  const indexGroups: number[][] = [];
  let currentGroup: number[] = [];

  for (const idx of sortedIndices) {
    if (currentGroup.length === 0 || idx === currentGroup[currentGroup.length - 1] + 1) {
      currentGroup.push(idx);
    } else {
      indexGroups.push(currentGroup);
      currentGroup = [idx];
    }
  }
  if (currentGroup.length > 0) {
    indexGroups.push(currentGroup);
  }

  // Convert index groups to time ranges
  const ranges: TopicRange[] = [];

  for (const group of indexGroups) {
    const groupHits = hits.filter(h => group.includes(h.segment_index));
    const occurrences = groupHits.length;
    const avgConfidence = occurrences > 0
      ? groupHits.reduce((sum, h) => sum + h.similarity, 0) / occurrences
      : 0.5;

    // Get first and last segment in group
    const firstIdx = group[0];
    const lastIdx = group[group.length - 1];

    // We need to query the actual start/end times
    // For now, estimate based on segment index (will be refined in route)
    ranges.push({
      startMs: firstIdx * SEARCH_CONFIG.SEGMENT_TARGET_MS,
      endMs: (lastIdx + 1) * SEARCH_CONFIG.SEGMENT_TARGET_MS,
      occurrences,
      confidence: avgConfidence,
    });
  }

  return ranges;
}

/**
 * Refined range building that uses actual segment timestamps
 */
export async function searchEpisodeWithTimestamps(
  episodeId: string,
  topic: string
): Promise<{ ranges: TopicRange[]; method: 'semantic' | 'keyword' }> {
  // 1. Load all segments
  const result = await query<SegmentRow>(
    `SELECT id, segment_index, text, start_ms, end_ms, embedding
     FROM segments
     WHERE episode_id = $1
     ORDER BY segment_index`,
    [episodeId]
  );

  const segments = result.rows;
  if (segments.length === 0) {
    return { ranges: [], method: 'semantic' };
  }

  // 2. Get aliases and threshold
  const aliases = generateAliases(topic);
  const baseThreshold = aliases.length > 1
    ? SEARCH_CONFIG.BASE_THRESHOLD_MULTI
    : SEARCH_CONFIG.BASE_THRESHOLD_SINGLE;

  // 3. Compute similarities
  const similarities = await computeSlidingWindowSimilarities(segments, aliases);

  // 4. Apply dual threshold
  let hits = applyDualThreshold(segments, similarities, baseThreshold);
  let method: 'semantic' | 'keyword' = 'semantic';

  // 5. Keyword fallback
  if (hits.length === 0) {
    hits = keywordFallback(segments, aliases);
    method = 'keyword';
    if (hits.length === 0) {
      return { ranges: [], method };
    }
  }

  // 6. Expand hits with context
  const hitIndices = new Set(hits.map(h => h.segment_index));
  const expandedSegments: SegmentWithSimilarity[] = [];

  for (const seg of segments) {
    // Include if it's a hit or within context range of a hit
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
          ? (hits.find(h => h.segment_index === seg.segment_index)?.similarity ?? 0)
          : 0,
      });
    }
  }

  // 7. Merge into continuous ranges
  expandedSegments.sort((a, b) => a.segment_index - b.segment_index);

  const rawRanges: Array<{
    startMs: number;
    endMs: number;
    hitCount: number;
    totalSimilarity: number;
  }> = [];

  let currentRange: typeof rawRanges[0] | null = null;

  for (let i = 0; i < expandedSegments.length; i++) {
    const seg = expandedSegments[i];
    const isConsecutive = i > 0 &&
      seg.segment_index === expandedSegments[i - 1].segment_index + 1;

    if (!currentRange || !isConsecutive) {
      // Start new range
      if (currentRange) rawRanges.push(currentRange);
      currentRange = {
        startMs: seg.start_ms,
        endMs: seg.end_ms,
        hitCount: seg.similarity > 0 ? 1 : 0,
        totalSimilarity: seg.similarity,
      };
    } else {
      // Extend current range
      currentRange.endMs = seg.end_ms;
      if (seg.similarity > 0) {
        currentRange.hitCount++;
        currentRange.totalSimilarity += seg.similarity;
      }
    }
  }

  if (currentRange) rawRanges.push(currentRange);

  // 8. Apply padding
  const paddedRanges = rawRanges.map(r => ({
    startMs: Math.max(0, r.startMs - SEARCH_CONFIG.LEAD_PAD_MS),
    endMs: r.endMs + SEARCH_CONFIG.TRAIL_PAD_MS,
    occurrences: r.hitCount,
    confidence: r.hitCount > 0 ? r.totalSimilarity / r.hitCount : 0.5,
  }));

  // 9. Merge overlapping ranges
  const merged = mergeOverlappingRanges(paddedRanges);

  // 10. Filter by minimum duration
  const filtered = merged.filter(
    r => (r.endMs - r.startMs) >= SEARCH_CONFIG.MIN_RANGE_MS
  );

  return { ranges: filtered, method };
}

/**
 * Merge overlapping time ranges
 */
function mergeOverlappingRanges(ranges: TopicRange[]): TopicRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs);
  const merged: TopicRange[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];

    if (current.startMs <= last.endMs) {
      // Overlapping - merge
      last.endMs = Math.max(last.endMs, current.endMs);
      last.occurrences += current.occurrences;
      last.confidence = (last.confidence + current.confidence) / 2; // Average confidence
    } else {
      // Non-overlapping - add new
      merged.push(current);
    }
  }

  return merged;
}

