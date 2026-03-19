// ============================================================
// Search Service v4
// Chain: Semantic Search -> Centroid Expansion -> Boundary Snap -> AI Refine
// ============================================================

import { createAdminClient } from "@/lib/supabase/admin";
import { embedTopicQuery } from "./embedding";
import { averageVectors, cosine, mean, percentile, stdDev } from "./math";
import { SEARCH_CONFIG, StructuralBoundary, TopicRange } from "./types";

const PRE_PAD_MS = 25000; // 25 seconds before
const POST_PAD_MS = 8000; // 8 seconds after — enough to finish a thought, not drag into next topic
const SNAP_WINDOW_MS = 10000; // max 10s beyond pad to find sentence boundary

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

interface TopicSegmentRow {
  id: number;
  label: string;
  summary: string;
  start_ms: number;
  end_ms: number;
  embedding: number[];
}

interface TopicSegmentCandidate extends TopicRange {
  label: string;
  summary: string;
}

// ============================================================
// Alias Generation
// ============================================================

function generateAliases(topic: string): string[] {
  const normalized = topic.toLowerCase().trim();
  const words = normalized.split(/\s+/);
  const aliases = new Set([normalized]);

  if (words.length === 1) {
    aliases.add(normalized);
  } else {
    // For multi-word topics, keep the full phrase as primary alias.
    // Individual words like "draft" are too generic and cause cross-domain
    // false positives (e.g. "nba draft" matching NFL draft content).
    // Only add well-known acronyms (all-caps words already in the topic).
    for (const word of words) {
      if (word.length >= 2 && word === word.toUpperCase()) {
        aliases.add(word.toLowerCase());
      }
    }
  }

  return [...aliases];
}

function extractDistinguishingKeywords(topic: string): string[] {
  const words = topic
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length <= 1) return [];

  const genericWords = new Set([
    "draft",
    "trade",
    "game",
    "play",
    "player",
    "team",
    "season",
    "news",
    "update",
    "report",
    "analysis",
    "discussion",
    "talk",
    "latest",
    "new",
    "big",
    "top",
    "best",
    "worst",
    "first",
    "the",
    "a",
    "an",
    "of",
    "in",
    "on",
    "for",
    "and",
    "or",
  ]);

  return words.filter((word) => word.length >= 2 && !genericWords.has(word));
}

function extractIntentKeywords(topic: string): string[] {
  const normalized = topic.toLowerCase().trim();
  const words = normalized.split(/\s+/).filter((word) => word.length > 0);
  const keywords = new Set(words);

  if (normalized.includes("draft")) {
    for (const synonym of ["prospect", "lottery", "pick", "mock", "selection"]) {
      keywords.add(synonym);
    }
  }

  if (normalized.includes("trade")) {
    for (const synonym of ["deal", "swap", "acquire", "package"]) {
      keywords.add(synonym);
    }
  }

  if (normalized.includes("free agent") || normalized.includes("free agency")) {
    for (const synonym of ["signing", "contract", "unrestricted"]) {
      keywords.add(synonym);
    }
  }

  return [...keywords];
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

async function loadEpisodeTopicSegments(
  episodeId: string
): Promise<TopicSegmentRow[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("topic_segments")
    .select("id, label, summary, start_ms, end_ms, embedding")
    .eq("episode_id", episodeId)
    .order("start_ms", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to load topic segments for episode ${episodeId}: ${error.message}`
    );
  }

  return (data ?? []).map((row) => ({
    id: Number(row.id),
    label: String(row.label ?? ""),
    summary: String(row.summary ?? ""),
    start_ms: Number(row.start_ms ?? 0),
    end_ms: Number(row.end_ms ?? 0),
    embedding: parseEmbedding(row.embedding),
  }));
}

async function loadEpisodeMetadata(episodeId: string): Promise<{
  episodeTitle?: string;
  podcastTitle?: string;
  boundaries: StructuralBoundary[];
}> {
  const supabase = createAdminClient();
  const { data: episode, error: episodeError } = await supabase
    .from("episodes")
    .select("title, podcast_id, boundaries")
    .eq("id", episodeId)
    .maybeSingle();

  if (episodeError) {
    console.warn(
      `[search:v3] failed to load episode metadata for ${episodeId}: ${episodeError.message}`
    );
    return { boundaries: [] };
  }

  if (!episode) {
    return { boundaries: [] };
  }

  let podcastTitle: string | undefined;
  if (episode.podcast_id) {
    const { data: podcast, error: podcastError } = await supabase
      .from("podcasts")
      .select("title")
      .eq("id", episode.podcast_id)
      .maybeSingle();

    if (podcastError) {
      console.warn(
        `[search:v3] failed to load podcast metadata for ${episodeId}: ${podcastError.message}`
      );
    } else if (typeof podcast?.title === "string") {
      podcastTitle = podcast.title;
    }
  }

  const boundaries: StructuralBoundary[] = Array.isArray(episode.boundaries)
    ? episode.boundaries
        .map((entry) => {
          if (
            typeof entry === "object" &&
            entry !== null &&
            "boundaryMs" in entry &&
            "velocityDrop" in entry
          ) {
            const boundaryMs = Number(
              (entry as { boundaryMs: unknown }).boundaryMs
            );
            const velocityDrop = Number(
              (entry as { velocityDrop: unknown }).velocityDrop
            );
            if (Number.isFinite(boundaryMs) && Number.isFinite(velocityDrop)) {
              return { boundaryMs, velocityDrop };
            }
          }
          return null;
        })
        .filter((entry): entry is StructuralBoundary => entry !== null)
    : [];

  return {
    episodeTitle: typeof episode.title === "string" ? episode.title : undefined,
    podcastTitle,
    boundaries,
  };
}

// ============================================================
// LLM Verification Layer
// ============================================================

/**
 * Use a cheap LLM to verify if a text segment actually discusses the topic.
 * This kills false positives like "Iran" matching a conversation about
 * AI trust polling where Iran is mentioned once in passing.
 */
async function _legacyVerifyClipsWithLLM(
  candidateRanges: Array<{
    startMs: number;
    endMs: number;
    occurrences: number;
    confidence: number;
    sampleText: string;
  }>,
  topic: string,
  episodeTitle?: string,
  podcastTitle?: string
): Promise<
  Array<{
    startMs: number;
    endMs: number;
    occurrences: number;
    confidence: number;
  }>
> {
  type AnthropicMessageResponse = {
    content?: Array<{ type?: string; text?: string }>;
  };

  if (candidateRanges.length === 0) return [];

  // Build a single batch prompt for efficiency
  const segments = candidateRanges.map((r, i) => {
    const text =
      r.sampleText.length > 600
        ? r.sampleText.substring(0, 600) + "..."
        : r.sampleText;
    return `[${i}] "${text}"`;
  });

  const prompt = `You are a podcast clip relevance judge. For each transcript segment below, determine if the conversation is PRIMARILY about "${topic}".

Rules:
- The topic must be a central subject being discussed, not just mentioned by name.
- If the topic is a person's name, the conversation must be focused on that person — not just mentioning them while discussing a team, event, or broader subject.
- Watch out for domain confusion: if the topic specifies a sport or league (e.g. "NBA draft"), content about a DIFFERENT sport or league (e.g. NFL draft) is NOT a match even though they share words like "draft".
- Respond YES only if the topic is clearly a main focus of the conversation. When in doubt, say NO.

Podcast: "${podcastTitle ?? "Unknown"}"
Episode: "${episodeTitle ?? "Unknown"}"

Segments:
${segments.join("\n\n")}

For each segment, respond with ONLY the segment number and YES or NO, one per line. Example:
[0] YES
[1] NO
[2] YES`;
  console.log(`[search:v3][llm] topic="${topic}" prompt_start`);
  console.log(prompt);
  console.log(`[search:v3][llm] topic="${topic}" prompt_end`);

  const MAX_RETRIES = 2;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
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
      console.log(`[search:v3][llm] topic="${topic}" attempt=${attempt} status=${response.status}`);
      const rawBody = await response.text();
      console.log(`[search:v3][llm] topic="${topic}" response_body_start`);
      console.log(rawBody);
      console.log(`[search:v3][llm] topic="${topic}" response_body_end`);

      if (!response.ok) {
        console.warn(
          `LLM verification failed (${response.status}), dropping all candidates to avoid false positives`
        );
        return [];
      }

      let data: AnthropicMessageResponse;
      try {
        data = JSON.parse(rawBody) as AnthropicMessageResponse;
      } catch (parseError) {
        console.warn(`[search:v3][llm] topic="${topic}" failed to parse JSON body`, parseError);
        return [];
      }
      const text =
        data.content?.[0]?.type === "text" ? data.content[0].text : "";
      const responseText = text ?? "";

      const verified: Array<{
        startMs: number;
        endMs: number;
        occurrences: number;
        confidence: number;
      }> = [];

      for (let i = 0; i < candidateRanges.length; i++) {
        const pattern = new RegExp(`\\[${i}\\]\\s*(YES|NO)`, "i");
        const match = responseText.match(pattern);
        const parsed = match?.[1]?.toUpperCase() ?? "PARSE_MISS";
        const include = match ? parsed === "YES" : false;
        console.log(
          `[search:v3][llm] topic="${topic}" segment=${i} parsed=${parsed} include=${include}`
        );

        if (include) {
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
      console.warn(
        `[search:v3][llm] topic="${topic}" attempt=${attempt}/${MAX_RETRIES} network error:`,
        err
      );
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      // All retries exhausted — return empty to avoid false positives.
      // Wrong clips are worse than missing clips.
      console.warn(
        `[search:v3][llm] topic="${topic}" all retries failed, dropping candidates to prevent false positives`
      );
      return [];
    }
  }

  return [];
}

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
  podcastTitle?: string
): Promise<
  Array<{
    startMs: number;
    endMs: number;
    occurrences: number;
    confidence: number;
  }>
> {
  type AnthropicMessageResponse = {
    content?: Array<{ type?: string; text?: string }>;
  };

  const formatTimestamp = (ms: number): string => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSec / 60);
    const seconds = String(totalSec % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  };

  if (candidateRanges.length === 0) return [];

  const refined: Array<{
    startMs: number;
    endMs: number;
    occurrences: number;
    confidence: number;
  }> = [];

  const MAX_RETRIES = 2;

  for (const range of candidateRanges) {
    const transcriptLines = segments
      .filter((segment) => segment.start_ms >= range.startMs && segment.end_ms <= range.endMs)
      .map((segment) => `[${formatTimestamp(segment.start_ms)}] ${segment.text.trim()}`)
      .filter((line) => line.length > 0);

    let transcriptText = transcriptLines.join("\n");
    if (transcriptText.length > 6000) {
      transcriptText =
        `${transcriptText.slice(0, 2500)}\n... [transcript truncated] ...\n${transcriptText.slice(-2500)}`;
    }

    const boundaryHints =
      range.nearbyBoundaries.length > 0
        ? range.nearbyBoundaries.map((ms) => formatTimestamp(ms)).join(", ")
        : "none";

    const prompt = `You are a podcast conversation boundary detector. Given a transcript excerpt and a topic, identify the precise timestamps where the conversation about this topic begins and ends.

Topic: "${topic}"
Podcast: "${podcastTitle ?? "Unknown"}"
Episode: "${episodeTitle ?? "Unknown"}"

Structural topic shifts detected near: ${boundaryHints}

Transcript:
${transcriptText}

Rules:
- The topic must be a central subject being discussed, not just mentioned in passing.
- Find where this topic STARTS being a primary focus and where it STOPS being a primary focus.
- Use the structural shift timestamps as hints, but trust the transcript content over them.
- If the topic is not actually discussed as a primary subject, set RELEVANT to NO.
- Use timestamps exactly as they appear in the transcript (m:ss or mm:ss format).

Respond in EXACTLY this format:
START: {m:ss or mm:ss timestamp from the transcript}
END: {m:ss or mm:ss timestamp from the transcript}
RELEVANT: YES or NO
SUMMARY: {one-line summary of what's discussed}`;

    let settled = false;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY || "",
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 150,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        const rawBody = await response.text();
        if (!response.ok) {
          throw new Error(`Anthropic status ${response.status}`);
        }

        const data = JSON.parse(rawBody) as AnthropicMessageResponse;
        const responseText =
          data.content?.[0]?.type === "text" ? (data.content[0].text ?? "") : "";

        const relevantMatch = responseText.match(/RELEVANT:\s*(YES|NO)/i);
        const relevant = relevantMatch?.[1]?.toUpperCase();
        if (relevant === "NO") {
          settled = true;
          break;
        }

        const parseTimestampToMs = (ts: string): number => {
          const parts = ts.split(":").map((p) => Number.parseInt(p.trim(), 10));
          if (parts.length === 2 && parts.every(Number.isFinite)) {
            return (parts[0] * 60 + parts[1]) * 1000;
          }
          if (parts.length === 3 && parts.every(Number.isFinite)) {
            return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
          }
          return NaN;
        };

        const startMatch = responseText.match(/START:\s*(\d+:\d+(?::\d+)?)/i);
        const endMatch = responseText.match(/END:\s*(\d+:\d+(?::\d+)?)/i);
        const summaryMatch = responseText.match(/SUMMARY:\s*(.*)/i);
        const parsedStart = startMatch ? parseTimestampToMs(startMatch[1]) : NaN;
        const parsedEnd = endMatch ? parseTimestampToMs(endMatch[1]) : NaN;
        const summary = summaryMatch?.[1]?.trim() ?? "";

        if (
          relevant === "YES" &&
          Number.isFinite(parsedStart) &&
          Number.isFinite(parsedEnd) &&
          parsedEnd > parsedStart
        ) {
          console.log(
            `[search:v4][llm-refine] topic="${topic}" original=${range.startMs}-${range.endMs} refined=${parsedStart}-${parsedEnd} summary="${summary}"`
          );
          refined.push({
            startMs: parsedStart,
            endMs: parsedEnd,
            occurrences: range.occurrences,
            confidence: range.confidence,
          });
          settled = true;
          break;
        }

        throw new Error("Failed to parse LLM boundary response");
      } catch (error) {
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        console.warn(
          `[search:v4][llm-refine] topic="${topic}" fallback to math boundaries for ${range.startMs}-${range.endMs}`,
          error
        );
        refined.push({
          startMs: range.startMs,
          endMs: range.endMs,
          occurrences: range.occurrences,
          confidence: range.confidence,
        });
        settled = true;
      }
    }

    if (!settled) {
      refined.push({
        startMs: range.startMs,
        endMs: range.endMs,
        occurrences: range.occurrences,
        confidence: range.confidence,
      });
    }
  }

  return refined;
}

async function verifyTopicSegmentsWithLLM(
  topic: string,
  candidates: TopicSegmentCandidate[],
  episodeSegments: SegmentRow[]
): Promise<TopicRange[]> {
  type AnthropicMessageResponse = {
    content?: Array<{ type?: string; text?: string }>;
  };

  if (candidates.length === 0) return [];

  const adIndicators: Array<{ key: string; pattern: RegExp; isUrl?: boolean }> = [
    { key: ".com", pattern: /\.com\b/i, isUrl: true },
    { key: ".co/", pattern: /\.co\//i, isUrl: true },
    { key: "https://", pattern: /https:\/\//i, isUrl: true },
    { key: "http://", pattern: /http:\/\//i, isUrl: true },
    { key: "promo code", pattern: /\bpromo code\b/i },
    { key: "discount", pattern: /\bdiscount\b/i },
    { key: "listeners get", pattern: /\blisteners get\b/i },
    { key: "sign up at", pattern: /\bsign up at\b/i },
    { key: "go to", pattern: /\bgo to\b/i },
    { key: "use code", pattern: /\buse code\b/i },
    { key: "special offer", pattern: /\bspecial offer\b/i },
    { key: "free trial", pattern: /\bfree trial\b/i },
    { key: "made possible by", pattern: /\bmade possible by\b/i },
    { key: "brought to you by", pattern: /\bbrought to you by\b/i },
    { key: "sponsored by", pattern: /\bsponsored by\b/i },
  ];

  const preparedCandidates: Array<{
    candidate: TopicSegmentCandidate;
    transcriptSnippet: string;
  }> = [];

  for (const candidate of candidates) {
    const overlappingText = episodeSegments
      .filter(
        (segment) =>
          segment.start_ms <= candidate.endMs && segment.end_ms >= candidate.startMs
      )
      .map((segment) => segment.text.trim())
      .filter((text) => text.length > 0)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const overlappingLower = overlappingText.toLowerCase();
    const matchedIndicators = adIndicators.filter((indicator) =>
      indicator.pattern.test(overlappingLower)
    );
    const distinctMatchCount = matchedIndicators.length;
    const hasUrlIndicator = matchedIndicators.some((indicator) => indicator.isUrl);
    const shouldRejectAdLike =
      distinctMatchCount >= 3 || (distinctMatchCount >= 2 && hasUrlIndicator);

    if (shouldRejectAdLike) {
      console.log(
        `[search:v5] topic="${topic}" rejected ad segment: "${candidate.label}"`
      );
      continue;
    }

    const transcriptSnippet =
      overlappingText.length > 800
        ? `${overlappingText.slice(0, 800)}...`
        : overlappingText;
    preparedCandidates.push({
      candidate,
      transcriptSnippet,
    });
  }

  if (preparedCandidates.length === 0) return [];

  if (!process.env.ANTHROPIC_API_KEY) {
    return preparedCandidates.map(
      ({ candidate: { startMs, endMs, occurrences, confidence } }) => ({
        startMs,
        endMs,
        occurrences,
        confidence,
      })
    );
  }

  const segments = preparedCandidates.map(
    ({ candidate, transcriptSnippet }, index) =>
      `[${index}] Label: "${candidate.label}" | Summary: "${candidate.summary}"
    Transcript: "${transcriptSnippet}"`
  );
  const prompt = `You are a podcast topic relevance judge. For each segment below, determine if it is PRIMARILY focused on "${topic}" as a core topic with sustained discussion (multiple sentences or turns), rather than a brief mention, tangential reference, or a segment that merely relates to the same broad domain. Use the transcript text as ground truth when it contradicts the label/summary.

Segments:
${segments.join("\n")}

For each segment, respond with ONLY the segment number and YES or NO:
[0] YES
[1] NO`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      console.warn(
        `[search:v5][llm] topic="${topic}" relevance check failed with status ${response.status}; falling back to unverified candidates`
      );
      return preparedCandidates.map(
        ({ candidate: { startMs, endMs, occurrences, confidence } }) => ({
          startMs,
          endMs,
          occurrences,
          confidence,
        })
      );
    }

    const rawBody = await response.text();
    const data = JSON.parse(rawBody) as AnthropicMessageResponse;
    const responseText =
      data.content?.[0]?.type === "text" ? (data.content[0].text ?? "") : "";

    const verified: TopicRange[] = [];
    for (let i = 0; i < preparedCandidates.length; i++) {
      const pattern = new RegExp(`\\[${i}\\]\\s*(YES|NO)`, "i");
      const match = responseText.match(pattern);
      const include = match?.[1]?.toUpperCase() === "YES";
      if (include) {
        const candidate = preparedCandidates[i].candidate;
        verified.push({
          startMs: candidate.startMs,
          endMs: candidate.endMs,
          occurrences: candidate.occurrences,
          confidence: candidate.confidence,
        });
      }
    }

    return verified;
  } catch (error) {
    console.warn(
      `[search:v5][llm] topic="${topic}" relevance check errored; falling back to unverified candidates`,
      error
    );
    return preparedCandidates.map(
      ({ candidate: { startMs, endMs, occurrences, confidence } }) => ({
        startMs,
        endMs,
        occurrences,
        confidence,
      })
    );
  }
}

// ============================================================
// Boundary Refinement (post-verification)
// ============================================================

async function refineBoundariesWithLLM(
  topic: string,
  ranges: TopicRange[],
  episodeSegments: SegmentRow[]
): Promise<TopicRange[]> {
  if (ranges.length === 0) return [];
  if (!process.env.ANTHROPIC_API_KEY) return ranges;

  const refined: TopicRange[] = [];

  for (const range of ranges) {
    const overlapping = episodeSegments.filter(
      (seg) => seg.start_ms < range.endMs && seg.end_ms > range.startMs
    );

    if (overlapping.length < 4) {
      refined.push(range);
      continue;
    }

    const formatted = overlapping.map((seg, i) => {
      const totalSec = Math.floor(seg.start_ms / 1000);
      const mm = Math.floor(totalSec / 60);
      const ss = totalSec % 60;
      return `[${i}] (${mm}:${ss.toString().padStart(2, "0")}) ${seg.text.trim()}`;
    });

    const topicWords = topic
      .toLowerCase()
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 0);
    const keywordSet = new Set(topicWords);
    if (keywordSet.has("ai")) {
      keywordSet.add("artificial intelligence");
      keywordSet.add("language model");
      keywordSet.add("machine learning");
    }
    const keywords = [...keywordSet];
    const keywordRegexes = keywords.map((keyword) => {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i");
    });
    const firstMentionIdx = overlapping.findIndex((segment) => {
      const text = segment.text.toLowerCase();
      return keywordRegexes.some((regex) => regex.test(text));
    });
    console.log(
      `[search:v5] topic="${topic}" keyword anchor: firstMentionIdx=${firstMentionIdx}, matched="${overlapping[firstMentionIdx]?.text?.slice(0, 80)}"`
    );
    const deterministicStartIdx =
      firstMentionIdx >= 0 ? Math.max(0, firstMentionIdx - 1) : null;

    if (deterministicStartIdx !== null) {
      const prompt = `You are editing a podcast clip about "${topic}".

The clip starts at segment [${deterministicStartIdx}]. Find where the discussion of "${topic}" naturally resolves. Include the complete concluding thought. Stop before the conversation moves to a new question or tangent. If ambiguous, bias later.

Transcript:
${formatted.join("\n")}

Respond with ONLY:
END: [index]`;

      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY || "",
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-haiku-4-5-20251001",
            max_tokens: 50,
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (!response.ok) {
          refined.push({
            ...range,
            startMs: overlapping[deterministicStartIdx].start_ms,
            endMs: range.endMs,
          });
          continue;
        }

        const data = (await response.json()) as {
          content?: Array<{ type?: string; text?: string }>;
        };
        const text = data.content?.[0]?.text ?? "";
        const endMatch = text.match(/END:\s*\[?(\d+)\]?/i);

        if (endMatch) {
          const endIdx = parseInt(endMatch[1], 10);
          if (endIdx < overlapping.length && endIdx >= deterministicStartIdx) {
            console.log(
              `[search:v5] topic="${topic}" refined boundaries: [${deterministicStartIdx}]-[${endIdx}] of ${overlapping.length} segments`
            );
            refined.push({
              ...range,
              startMs: overlapping[deterministicStartIdx].start_ms,
              endMs: overlapping[endIdx].end_ms,
            });
            continue;
          }
        }

        refined.push({
          ...range,
          startMs: overlapping[deterministicStartIdx].start_ms,
          endMs: range.endMs,
        });
      } catch {
        refined.push({
          ...range,
          startMs: overlapping[deterministicStartIdx].start_ms,
          endMs: range.endMs,
        });
      }
      continue;
    }

    const prompt = `You are editing a podcast clip about "${topic}". Below is the transcript of a candidate segment. Choose start and end indices that create a natural clip with context and a complete resolution.

Rules:
- START: Find the FIRST sentence in the transcript where "${topic}" is explicitly mentioned by name or clearly referenced.
- START: Then set START to 1 sentence before that sentence (for listener context).
- START: If the topic mention IS the first sentence, use index 0.
- START: Do NOT choose START from the middle where explanation gets dense; anchor to first-mention context.
- END: anchor to where the speaker finishes their core answer/explanation about "${topic}".
- END: include the complete resolution of the point being made.
- END: stop before the conversation moves to a new question, tangent, or different subtopic.
- END: if ambiguous, bias LATER.

Transcript:
${formatted.join("\n")}

Respond with ONLY:
START: [index]
END: [index]`;

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY || "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 50,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!response.ok) {
        refined.push(range);
        continue;
      }

      const data = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = data.content?.[0]?.text ?? "";

      const startMatch = text.match(/START:\s*\[?(\d+)\]?/i);
      const endMatch = text.match(/END:\s*\[?(\d+)\]?/i);

      if (startMatch && endMatch) {
        const startIdx = parseInt(startMatch[1], 10);
        const endIdx = parseInt(endMatch[1], 10);

        if (
          startIdx >= 0 &&
          endIdx < overlapping.length &&
          startIdx <= endIdx
        ) {
          console.log(
            `[search:v5] topic="${topic}" refined boundaries: [${startIdx}]-[${endIdx}] of ${overlapping.length} segments`
          );
          refined.push({
            ...range,
            startMs: overlapping[startIdx].start_ms,
            endMs: overlapping[endIdx].end_ms,
          });
          continue;
        }
      }

      refined.push(range);
    } catch {
      refined.push(range);
    }
  }

  return refined;
}

// ============================================================
// Main Search Function
// ============================================================

/**
 * Legacy v4 chain:
 * 1. Sliding window similarity
 * 2. Adaptive thresholds (percentile-based)
 * 3. Aggressive merging (60s gap tolerance)
 * 4. Minimum hit density filtering
 * 5. LLM verification to kill false positives
 */
async function _legacySearchV4(
  episodeId: string,
  topic: string
): Promise<{ ranges: TopicRange[]; method: "semantic" | "keyword" }> {
  const { episodeTitle, podcastTitle, boundaries } = await loadEpisodeMetadata(
    episodeId
  );

  // 1. Load all segments
  const segments = await loadEpisodeSegments(episodeId);
  console.log(
    `[search:v4] topic="${topic}" step=segments_loaded count=${segments.length}`
  );
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
    `[search:v4] topic="${topic}" step=similarity_distribution min=${similarityMin.toFixed(4)} max=${similarityMax.toFixed(4)} mean=${similarityMean.toFixed(4)} p85=${similarityP85.toFixed(4)}`
  );

  // 4. Apply ADAPTIVE dual threshold
  let hits = applyAdaptiveThreshold(segments, similarities);
  let method: "semantic" | "keyword" = "semantic";
  console.log(
    `[search:v4] topic="${topic}" step=after_adaptive_threshold hits=${hits.length}`
  );

  // 5. Keyword fallback
  if (hits.length === 0) {
    hits = keywordFallback(segments, aliases);
    method = "keyword";
    if (hits.length === 0) {
      return { ranges: [], method };
    }
  }

  // 6. Centroid expansion - grow hit clusters into candidate conversation windows
  const expanded = centroidExpansion(segments, hits);
  const segmentByIndex = new Map(segments.map((segment) => [segment.segment_index, segment]));
  const candidateRanges: TopicRange[] = expanded
    .map((cluster) => {
      const startSegment = segmentByIndex.get(cluster.startIdx);
      const endSegment = segmentByIndex.get(cluster.endIdx);
      if (!startSegment || !endSegment) return null;
      return {
        startMs: startSegment.start_ms,
        endMs: endSegment.end_ms,
        occurrences: cluster.occurrences,
        confidence: cluster.confidence,
      };
    })
    .filter((range): range is TopicRange => range !== null);
  console.log(
    `[search:v4] topic="${topic}" step=after_centroid_expansion ranges=${candidateRanges.length}`
  );

  // 7. Aggressive merge - combine ranges within gap tolerance of each other
  const merged = aggressiveMerge(candidateRanges, SEARCH_CONFIG.MERGE_GAP_MS);
  console.log(`[search:v4] topic="${topic}" step=after_merging ranges=${merged.length}`);

  // 8. Filter by minimum hit density (at least 2 hits per range)
  const dense = merged.filter((r) => r.occurrences >= 2);
  console.log(
    `[search:v4] topic="${topic}" step=after_density_filter ranges=${dense.length}`
  );

  // 9. Filter by minimum duration
  const filtered = dense.filter(
    (r) => r.endMs - r.startMs >= SEARCH_CONFIG.MIN_RANGE_MS
  );

  // 10. Hard keyword validation for multi-word topics.
  const distinguishingKeywords = extractDistinguishingKeywords(topic);
  const keywordValidated =
    distinguishingKeywords.length === 0
      ? filtered
      : filtered.filter((range) => {
          const rangeHits = hits.filter(
            (h) => h.start_ms >= range.startMs && h.end_ms <= range.endMs
          );
          const rangeText = rangeHits.map((h) => h.text).join(" ").toLowerCase();
          return distinguishingKeywords.some((kw) => rangeText.includes(kw));
        });
  console.log(
    `[search:v4] topic="${topic}" step=after_keyword_validation ranges=${keywordValidated.length} keywords=${JSON.stringify(distinguishingKeywords)}`
  );

  // 11. Snap each range to precomputed structural boundaries.
  const snapped = keywordValidated.map((range) => {
    const snappedRange = snapToBoundaries(range.startMs, range.endMs, boundaries);
    return {
      ...range,
      startMs: snappedRange.startMs,
      endMs: snappedRange.endMs,
    };
  });
  console.log(`[search:v4] topic="${topic}" step=after_boundary_snap ranges=${snapped.length}`);

  // 12. LLM refinement for precise start/end boundaries.
  if (process.env.ANTHROPIC_API_KEY && snapped.length > 0) {
    const rangesWithBoundaryHints = snapped.map((range) => ({
      ...range,
      nearbyBoundaries: boundaries
        .filter(
          (boundary) =>
            Math.abs(boundary.boundaryMs - range.startMs) <= 120000 ||
            Math.abs(boundary.boundaryMs - range.endMs) <= 120000
        )
        .map((boundary) => boundary.boundaryMs),
    }));

    const verified = await refineClipBoundariesWithLLM(
      rangesWithBoundaryHints,
      segments,
      topic,
      episodeTitle,
      podcastTitle
    );
    console.log(`[search:v4] topic="${topic}" step=after_llm_refine ranges=${verified.length}`);

    // 13. Post-LLM merge — the LLM narrows ranges independently, so previously
    //     adjacent ranges can end up close together again. Re-merge with a
    //     generous gap since these are already verified as relevant.
    const POST_LLM_MERGE_GAP_MS = 180000; // 3 minutes
    const remerged = aggressiveMerge(verified, POST_LLM_MERGE_GAP_MS);
    console.log(`[search:v4] topic="${topic}" step=after_post_llm_merge ranges=${remerged.length}`);

    // 14. Post-LLM minimum duration — drop micro-clips the LLM trimmed to
    //     a passing mention rather than a real conversation.
    const POST_LLM_MIN_MS = 60000; // 1 minute
    const final = remerged.filter((r) => r.endMs - r.startMs >= POST_LLM_MIN_MS);
    console.log(`[search:v4] topic="${topic}" step=after_post_llm_min_duration ranges=${final.length}`);

    return { ranges: final, method };
  }

  // No API key - return snapped math boundaries without LLM refinement.
  console.log(
    `[search:v4] topic="${topic}" step=after_llm_refine ranges=${snapped.length} skipped=true`
  );
  return { ranges: snapped, method };
}

export async function searchEpisodeWithTimestamps(
  episodeId: string,
  topic: string
): Promise<{ ranges: TopicRange[]; method: "semantic" | "keyword" }> {
  const topicSegments = await loadEpisodeTopicSegments(episodeId);
  if (topicSegments.length === 0) {
    return _legacySearchV4(episodeId, topic);
  }

  const episodeSegments = await loadEpisodeSegments(episodeId);
  const topicEmbedding = await embedTopicQuery(topic);
  const candidates: TopicSegmentCandidate[] = [];

  for (const segment of topicSegments) {
    if (segment.embedding.length === 0) {
      continue;
    }

    const similarity = cosine(topicEmbedding, segment.embedding);
    if (similarity < SEARCH_CONFIG.TOPIC_SEGMENT_THRESHOLD) {
      continue;
    }

    candidates.push({
      startMs: segment.start_ms,
      endMs: segment.end_ms,
      occurrences: 1,
      confidence: similarity,
      label: segment.label,
      summary: segment.summary,
    });
  }

  const llmFiltered = await verifyTopicSegmentsWithLLM(
    topic,
    candidates,
    episodeSegments
  );
  const refined = await refineBoundariesWithLLM(
    topic,
    llmFiltered,
    episodeSegments
  );
  const merged = aggressiveMerge(refined, SEARCH_CONFIG.MERGE_GAP_MS);
  const paddedAndSnapped = merged.map((range) =>
    padAndSnapToSentence(range, episodeSegments, {
      prePadMs: 5000,
      postPadMs: 3000,
    })
  );
  return { ranges: paddedAndSnapped, method: "semantic" };
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

function centroidExpansion(
  segments: SegmentRow[],
  hits: SegmentWithSimilarity[]
): Array<{
  startIdx: number;
  endIdx: number;
  centroid: number[];
  occurrences: number;
  confidence: number;
}> {
  if (segments.length === 0 || hits.length === 0) return [];

  const sortedHits = [...hits].sort((a, b) => a.segment_index - b.segment_index);
  const clusters: SegmentWithSimilarity[][] = [];
  let currentCluster: SegmentWithSimilarity[] = [];

  for (const hit of sortedHits) {
    if (currentCluster.length === 0) {
      currentCluster.push(hit);
      continue;
    }

    const prev = currentCluster[currentCluster.length - 1];
    if (hit.segment_index - prev.segment_index <= 5) {
      currentCluster.push(hit);
    } else {
      clusters.push(currentCluster);
      currentCluster = [hit];
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  const segmentByIndex = new Map(segments.map((s) => [s.segment_index, s]));
  const minSegIndex = Math.min(...segments.map((s) => s.segment_index));
  const maxSegIndex = Math.max(...segments.map((s) => s.segment_index));

  const expanded = clusters
    .map((cluster) => {
      const hitEmbeddings = cluster
        .map((h) => h.embedding)
        .filter((embedding) => Array.isArray(embedding) && embedding.length > 0);
      if (hitEmbeddings.length === 0) return null;

      const centroid = averageVectors(hitEmbeddings);
      const clusterStart = Math.min(...cluster.map((h) => h.segment_index));
      const clusterEnd = Math.max(...cluster.map((h) => h.segment_index));

      let startIdx = clusterStart;
      let endIdx = clusterEnd;

      for (let idx = clusterEnd + 1; idx <= maxSegIndex; idx++) {
        const seg = segmentByIndex.get(idx);
        if (!seg?.embedding?.length) break;
        const simToCentroid = cosine(seg.embedding, centroid);
        if (simToCentroid < SEARCH_CONFIG.CENTROID_FLOOR) break;
        endIdx = idx;
      }

      for (let idx = clusterStart - 1; idx >= minSegIndex; idx--) {
        const seg = segmentByIndex.get(idx);
        if (!seg?.embedding?.length) break;
        const simToCentroid = cosine(seg.embedding, centroid);
        if (simToCentroid < SEARCH_CONFIG.CENTROID_FLOOR) break;
        startIdx = idx;
      }

      const occurrences = cluster.length;
      const confidence =
        cluster.reduce((sum, hit) => sum + hit.similarity, 0) / occurrences;

      return {
        startIdx,
        endIdx,
        centroid,
        occurrences,
        confidence,
      };
    })
    .filter(
      (
        value
      ): value is {
        startIdx: number;
        endIdx: number;
        centroid: number[];
        occurrences: number;
        confidence: number;
      } => value !== null
    );

  return expanded;
}

function snapToBoundaries(
  candidateStartMs: number,
  candidateEndMs: number,
  boundaries: StructuralBoundary[]
): { startMs: number; endMs: number } {
  if (boundaries.length === 0) {
    return { startMs: candidateStartMs, endMs: candidateEndMs };
  }

  const sorted = [...boundaries].sort((a, b) => a.boundaryMs - b.boundaryMs);

  let snappedStartMs = candidateStartMs;
  const before = [...sorted]
    .reverse()
    .find((b) => b.boundaryMs <= candidateStartMs);
  if (before && candidateStartMs - before.boundaryMs <= 90000) {
    snappedStartMs = before.boundaryMs;
  }

  let snappedEndMs = candidateEndMs;
  const after = sorted.find((b) => b.boundaryMs >= candidateEndMs);
  if (after && after.boundaryMs - candidateEndMs <= 90000) {
    snappedEndMs = after.boundaryMs;
  }

  return {
    startMs: Math.max(0, snappedStartMs - SEARCH_CONFIG.LEAD_PAD_MS),
    endMs: snappedEndMs + SEARCH_CONFIG.TRAIL_PAD_MS,
  };
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

function padAndSnapToSentence(
  range: TopicRange,
  segments: SegmentRow[],
  opts?: { prePadMs?: number; postPadMs?: number }
): TopicRange {
  const paddedStart = Math.max(0, range.startMs - (opts?.prePadMs ?? PRE_PAD_MS));
  const paddedEnd = range.endMs + (opts?.postPadMs ?? POST_PAD_MS);

  const startCandidates = segments.map((segment) => segment.start_ms);
  const endCandidates = segments.map((segment) => segment.end_ms);

  const snapStart = (target: number, candidates: number[]): number => {
    let best = target;
    let bestDist = Infinity;
    for (const c of candidates) {
      if (c > target) continue; // only snap to boundaries at or before target
      const dist = target - c;
      if (dist <= SNAP_WINDOW_MS && dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    return best;
  };

  const snapEnd = (target: number, candidates: number[]): number => {
    let best = target;
    let bestDist = Infinity;
    for (const c of candidates) {
      if (c < target) continue; // only snap to boundaries at or after target
      const dist = c - target;
      if (dist <= SNAP_WINDOW_MS && dist < bestDist) {
        bestDist = dist;
        best = c;
      }
    }
    return best;
  };

  const snappedStart = snapStart(paddedStart, startCandidates);
  const snappedEnd = snapEnd(paddedEnd, endCandidates);

  return {
    ...range,
    startMs: Math.max(0, snappedStart),
    endMs: Math.max(Math.max(0, snappedStart), snappedEnd),
  };
}
