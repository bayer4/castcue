type SegmentLike = {
  text: string;
  speaker?: number | null;
  startMs?: number;
  endMs?: number;
  start_ms?: number;
  end_ms?: number;
};

export interface DetectedTopicSegment {
  label: string;
  summary: string;
  startMs: number;
  endMs: number;
}

type AnthropicMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
};

function formatMsToMinuteSecond(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function parseTimestampToMs(timestamp: string): number {
  const parts = timestamp.split(":").map((value) => Number.parseInt(value.trim(), 10));
  if (parts.length === 2 && parts.every(Number.isFinite)) {
    return (parts[0] * 60 + parts[1]) * 1000;
  }
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  }
  return NaN;
}

function normalizeSegmentTimes(segment: SegmentLike): { startMs: number; endMs: number } {
  const startMs = Number(segment.startMs ?? segment.start_ms ?? 0);
  const endMs = Number(segment.endMs ?? segment.end_ms ?? 0);
  return { startMs, endMs };
}

function truncateText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...`;
}

function parseJsonArrayFromText(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Empty Anthropic response");
  }

  try {
    const direct = JSON.parse(trimmed);
    if (Array.isArray(direct)) return direct;
  } catch {
    // Fall through to bracket extraction.
  }

  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    throw new Error("No JSON array found in Anthropic response");
  }

  const candidate = trimmed.slice(firstBracket, lastBracket + 1);
  const parsed = JSON.parse(candidate);
  if (!Array.isArray(parsed)) {
    throw new Error("Anthropic response is not a JSON array");
  }
  return parsed;
}

export function buildCompressedOutline(segments: SegmentLike[]): string {
  return segments
    .map((segment) => {
      const { startMs } = normalizeSegmentTimes(segment);
      const timestamp = formatMsToMinuteSecond(startMs);
      const speakerText =
        typeof segment.speaker === "number" ? ` (Speaker ${segment.speaker})` : "";
      const text = truncateText(segment.text ?? "", 100);
      return `[${timestamp}]${speakerText} ${text}`.trim();
    })
    .join("\n");
}

export async function detectTopicSegments(
  outline: string,
  episodeTitle?: string
): Promise<DetectedTopicSegment[]> {
  if (!outline.trim()) {
    return [];
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[topic-segmentation] ANTHROPIC_API_KEY missing; skipping topic detection");
    return [];
  }

  const prompt = `You are a podcast episode analyzer. Given a compressed transcript outline, identify every distinct topic or conversation segment.

Episode: "${episodeTitle ?? "Unknown"}"

Rules:
- A "topic segment" is a stretch of conversation focused on one subject.
- Conversations can be short (1-2 minutes) or very long (30+ minutes).
- When the hosts shift to a new subject, that's a new segment.
- Brief tangents (under 1 minute) within a larger conversation should NOT be separate segments.
- Use the timestamps exactly as they appear in the outline.
- Speaker changes can signal topic shifts but not always.

Transcript outline:
${outline}

Respond with a JSON array. Each element:
{"label": "short topic name", "summary": "one sentence description", "start": "mm:ss", "end": "mm:ss"}

Return ONLY the JSON array, no other text.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const rawBody = await response.text();
    if (!response.ok) {
      console.warn(
        `[topic-segmentation] Anthropic request failed (${response.status}); skipping topic detection`
      );
      return [];
    }

    const data = JSON.parse(rawBody) as AnthropicMessageResponse;
    const contentText =
      data.content?.find((entry) => entry.type === "text")?.text ??
      data.content?.[0]?.text ??
      "";
    const rawSegments = parseJsonArrayFromText(contentText);

    const parsed = rawSegments
      .map((entry) => {
        if (typeof entry !== "object" || entry === null) {
          return null;
        }
        const label = String((entry as { label?: unknown }).label ?? "").trim();
        const summary = String((entry as { summary?: unknown }).summary ?? "").trim();
        const startRaw = String((entry as { start?: unknown }).start ?? "").trim();
        const endRaw = String((entry as { end?: unknown }).end ?? "").trim();
        const startMs = parseTimestampToMs(startRaw);
        const endMs = parseTimestampToMs(endRaw);

        if (!label || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
          return null;
        }

        return {
          label,
          summary,
          startMs,
          endMs,
        };
      })
      .filter((segment): segment is DetectedTopicSegment => segment !== null);

    return parsed;
  } catch (error) {
    console.warn("[topic-segmentation] Failed to detect topic segments; skipping", error);
    return [];
  }
}
