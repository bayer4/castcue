// ============================================================
// Segmentation Service
// Slices transcripts into semantic chunks
// ============================================================

import { SEARCH_CONFIG, TranscriptWord } from "./types";

interface RawSegment {
  text: string;
  startMs: number;
  endMs: number;
  speaker?: number;
}

function getDominantSpeaker(words: TranscriptWord[]): number | undefined {
  const speakerCounts = new Map<number, number>();
  for (const word of words) {
    if (typeof word.speaker !== "number") continue;
    speakerCounts.set(word.speaker, (speakerCounts.get(word.speaker) ?? 0) + 1);
  }

  let dominantSpeaker: number | undefined;
  let maxCount = 0;
  for (const [speaker, count] of speakerCounts.entries()) {
    if (count > maxCount) {
      dominantSpeaker = speaker;
      maxCount = count;
    }
  }

  return dominantSpeaker;
}

/**
 * Slice transcript words into segments of ~15-30 seconds
 *
 * Improvement over v1: We try to break at sentence boundaries
 * when possible, rather than hard-cutting at 15s exactly.
 */
export function sliceIntoSegments(words: TranscriptWord[]): RawSegment[] {
  if (words.length === 0) return [];

  const segments: RawSegment[] = [];
  let segmentWords: TranscriptWord[] = [];
  let segmentStart = words[0].start;

  const SENTENCE_ENDERS = new Set([".", "!", "?"]);

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    segmentWords.push(word);

    const duration = word.end - segmentStart;
    const lastChar = word.text.trim().slice(-1);
    const isSentenceEnd = SENTENCE_ENDERS.has(lastChar);

    // Conditions to finalize segment:
    // 1. Hit max duration (hard cut)
    // 2. Past target duration AND at sentence boundary (soft cut)
    const shouldCut =
      duration >= SEARCH_CONFIG.SEGMENT_MAX_MS ||
      (duration >= SEARCH_CONFIG.SEGMENT_TARGET_MS && isSentenceEnd);

    if (shouldCut && segmentWords.length > 0) {
      segments.push({
        text: segmentWords.map((w) => w.text).join(" ").trim(),
        startMs: segmentStart,
        endMs: word.end,
        speaker: getDominantSpeaker(segmentWords),
      });

      // Reset for next segment
      segmentWords = [];
      if (i + 1 < words.length) {
        segmentStart = words[i + 1].start;
      }
    }
  }

  // Don't forget the last segment
  if (segmentWords.length > 0) {
    segments.push({
      text: segmentWords.map((w) => w.text).join(" ").trim(),
      startMs: segmentStart,
      endMs: segmentWords[segmentWords.length - 1].end,
      speaker: getDominantSpeaker(segmentWords),
    });
  }

  return segments;
}
