// ============================================================
// CastCue v2 - Core Types
// ============================================================

/**
 * A podcast episode with metadata and audio URL
 */
export interface Episode {
  id: string;
  title: string;
  audioUrl: string;
  createdAt: Date;
}

/**
 * Word-level timing from transcription
 */
export interface TranscriptWord {
  text: string;
  start: number; // milliseconds
  end: number; // milliseconds
}

/**
 * Full transcript for an episode
 */
export interface Transcript {
  episodeId: string;
  words: TranscriptWord[];
  fullText: string;
}

/**
 * A segment is a ~15-30s chunk of transcript text with timestamps
 * Unlike v1, we store everything in Postgres (no S3)
 */
export interface Segment {
  id: number;
  episodeId: string;
  segmentIndex: number;
  text: string;
  startMs: number;
  endMs: number;
  embedding?: number[]; // 1536-dim from text-embedding-3-small
}

/**
 * User-defined topic for saved searches
 */
export interface Topic {
  id: string;
  name: string;
  description?: string;
  createdAt: Date;
}

/**
 * A time range in an episode where a topic is discussed
 */
export interface TopicRange {
  startMs: number;
  endMs: number;
  occurrences: number; // How many segment hits merged into this range
  confidence: number; // Average similarity score
}

/**
 * Search result for a topic within an episode
 */
export interface SearchResult {
  episodeId: string;
  audioUrl: string;
  topic: string;
  ranges: TopicRange[];
  method: "semantic" | "keyword"; // Which search method found results
}

/**
 * Ingest request payload
 */
export interface IngestRequest {
  episodeId: string;
  title: string;
  audioUrl: string;
  transcript: {
    words: TranscriptWord[];
  };
}

// ============================================================
// Search Algorithm Constants
// ============================================================

export const SEARCH_CONFIG = {
  // Embedding model
  EMBEDDING_MODEL: "text-embedding-3-small" as const,
  EMBEDDING_DIMS: 1536,

  // Segment slicing
  SEGMENT_TARGET_MS: 15000, // Target ~15 seconds per segment
  SEGMENT_MAX_MS: 30000, // Never exceed 30 seconds

  // Similarity thresholds
  BASE_THRESHOLD_SINGLE: 0.4, // For single-word topics
  BASE_THRESHOLD_MULTI: 0.4, // For multi-word topics (aliases help)
  Z_SCORE_THRESHOLD: 0.5, // Segment must be 0.5 std dev above mean

  // Context padding
  CONTEXT_SEGMENTS_BEFORE: 1, // Include N segments before hit for context
  LEAD_PAD_MS: 10000, // 10s lead-in padding
  TRAIL_PAD_MS: 10000, // 10s trail-out padding

  // Result filtering
  MIN_RANGE_MS: 8000, // Minimum 8s for a result to be useful
} as const;
