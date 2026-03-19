import { NextResponse } from "next/server";
import { searchEpisodeWithTimestamps } from "@/lib/services/search";
import { createAdminClient } from "@/lib/supabase/admin";

type BoundaryTestCase = {
  name: string;
  episodeId: string;
  topic: string;
  expectedStartMs: number;
  expectedEndMs: number;
  toleranceMs: number;
};

function msToTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export async function GET(request: Request) {
  // Debug endpoint: intentionally unauthenticated for local/dev testing.
  // Protect or remove this route before production exposure.
  void request;

  const admin = createAdminClient();

  const { data: bciEpisode, error: bciEpisodeError } = await admin
    .from("episodes")
    .select("id, title, published_at")
    .ilike("title", "%Brain-Computer Interfaces%")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (bciEpisodeError) {
    return NextResponse.json({ error: bciEpisodeError.message }, { status: 500 });
  }

  if (!bciEpisode?.id) {
    return NextResponse.json(
      { error: 'Could not find episode with title containing "Brain-Computer Interfaces"' },
      { status: 404 }
    );
  }

  const testCases: BoundaryTestCase[] = [
    {
      name: "BCI episode - AI discussion",
      episodeId: bciEpisode.id,
      topic: "AI",
      expectedStartMs: 292000,
      expectedEndMs: 407000,
      toleranceMs: 15000,
    },
  ];

  const results: Array<{
    name: string;
    topic: string;
    expected: { startMs: number; endMs: number };
    expectedFormatted: { start: string; end: string };
    actual: { startMs: number; endMs: number } | null;
    actualFormatted: { start: string; end: string } | null;
    delta: { startMs: number; endMs: number } | null;
    pass: { start: boolean; end: boolean };
    overallPass: boolean;
    transcriptPreview: string;
    method: "semantic" | "keyword";
    rangeIndex?: number;
  }> = [];

  for (const testCase of testCases) {
    const searchResult = await searchEpisodeWithTimestamps(
      testCase.episodeId,
      testCase.topic
    );

    if (searchResult.ranges.length === 0) {
      results.push({
        name: testCase.name,
        topic: testCase.topic,
        expected: {
          startMs: testCase.expectedStartMs,
          endMs: testCase.expectedEndMs,
        },
        expectedFormatted: {
          start: msToTimestamp(testCase.expectedStartMs),
          end: msToTimestamp(testCase.expectedEndMs),
        },
        actual: null,
        actualFormatted: null,
        delta: null,
        pass: { start: false, end: false },
        overallPass: false,
        transcriptPreview: "",
        method: searchResult.method,
      });
      continue;
    }

    for (let i = 0; i < searchResult.ranges.length; i++) {
      const range = searchResult.ranges[i];
      const startDelta = range.startMs - testCase.expectedStartMs;
      const endDelta = range.endMs - testCase.expectedEndMs;
      const startPass = Math.abs(startDelta) <= testCase.toleranceMs;
      const endPass = Math.abs(endDelta) <= testCase.toleranceMs;

      const { data: overlapSegments, error: overlapError } = await admin
        .from("segments")
        .select("text, segment_index")
        .eq("episode_id", testCase.episodeId)
        .lte("start_ms", range.endMs)
        .gte("end_ms", range.startMs)
        .order("segment_index", { ascending: true });

      if (overlapError) {
        return NextResponse.json({ error: overlapError.message }, { status: 500 });
      }

      const transcriptPreview = (overlapSegments ?? [])
        .map((segment) => segment.text ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);

      results.push({
        name: testCase.name,
        topic: testCase.topic,
        expected: {
          startMs: testCase.expectedStartMs,
          endMs: testCase.expectedEndMs,
        },
        expectedFormatted: {
          start: msToTimestamp(testCase.expectedStartMs),
          end: msToTimestamp(testCase.expectedEndMs),
        },
        actual: {
          startMs: range.startMs,
          endMs: range.endMs,
        },
        actualFormatted: {
          start: msToTimestamp(range.startMs),
          end: msToTimestamp(range.endMs),
        },
        delta: { startMs: startDelta, endMs: endDelta },
        pass: { start: startPass, end: endPass },
        overallPass: startPass && endPass,
        transcriptPreview,
        method: searchResult.method,
        rangeIndex: i,
      });
    }
  }

  const total = results.length;
  const passed = results.filter((result) => result.overallPass).length;
  const failed = total - passed;

  return NextResponse.json({
    results,
    summary: { total, passed, failed },
  });
}
