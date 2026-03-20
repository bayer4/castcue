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
  shouldFind: boolean;
  shouldReject: boolean;
};

function msToTimestamp(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function rangesOverlap(
  range: { startMs: number; endMs: number },
  expected: { startMs: number; endMs: number }
): boolean {
  return range.startMs < expected.endMs && range.endMs > expected.startMs;
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

  const { data: rollickingEpisode, error: rollickingEpisodeError } = await admin
    .from("episodes")
    .select("id, title, published_at")
    .ilike("title", "%Rollicking NBA Mailbag%")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (rollickingEpisodeError) {
    return NextResponse.json(
      { error: rollickingEpisodeError.message },
      { status: 500 }
    );
  }
  if (!rollickingEpisode?.id) {
    return NextResponse.json(
      { error: 'Could not find episode with title containing "Rollicking NBA Mailbag"' },
      { status: 404 }
    );
  }

  const { data: secEpisode, error: secEpisodeError } = await admin
    .from("episodes")
    .select("id, title, published_at")
    .ilike("title", "%SEC & CFTC on Crypto%")
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (secEpisodeError) {
    return NextResponse.json({ error: secEpisodeError.message }, { status: 500 });
  }
  if (!secEpisode?.id) {
    return NextResponse.json(
      { error: 'Could not find episode with title containing "SEC & CFTC on Crypto"' },
      { status: 404 }
    );
  }

  const testCases: BoundaryTestCase[] = [
    {
      name: "Test Case 1: BCI / AI",
      episodeId: bciEpisode.id,
      topic: "AI",
      expectedStartMs: 336000,
      expectedEndMs: 459000,
      toleranceMs: 20000,
      shouldFind: true,
      shouldReject: false,
    },
    {
      name: "Test Case 2: LeBron / Rollicking (existing clip)",
      episodeId: rollickingEpisode.id,
      topic: "lebron",
      expectedStartMs: 3025000,
      expectedEndMs: 3290000,
      toleranceMs: 20000,
      shouldFind: true,
      shouldReject: false,
    },
    {
      name: "Test Case 3: LeBron / Rollicking (proposed should find)",
      episodeId: rollickingEpisode.id,
      topic: "lebron",
      expectedStartMs: 343000,
      expectedEndMs: 454000,
      toleranceMs: 20000,
      shouldFind: true,
      shouldReject: false,
    },
    {
      name: "Test Case 4: LeBron / Rollicking (reject short)",
      episodeId: rollickingEpisode.id,
      topic: "lebron",
      expectedStartMs: 985000,
      expectedEndMs: 1018000,
      toleranceMs: 20000,
      shouldFind: false,
      shouldReject: true,
    },
    {
      name: "Test Case 5: LeBron / Rollicking (borderline reject)",
      episodeId: rollickingEpisode.id,
      topic: "lebron",
      expectedStartMs: 1068000,
      expectedEndMs: 1103000,
      toleranceMs: 20000,
      shouldFind: false,
      shouldReject: true,
    },
    {
      name: "Test Case 6: Crypto / SEC & CFTC (system-found)",
      episodeId: secEpisode.id,
      topic: "crypto",
      expectedStartMs: 2878000,
      expectedEndMs: 3134000,
      toleranceMs: 20000,
      shouldFind: true,
      shouldReject: false,
    },
    {
      name: "Test Case 7: Crypto / SEC & CFTC (tokenization should find)",
      episodeId: secEpisode.id,
      topic: "crypto",
      expectedStartMs: 495000,
      expectedEndMs: 742000,
      toleranceMs: 20000,
      shouldFind: true,
      shouldReject: false,
    },
    {
      name: "Test Case 8: Crypto / SEC & CFTC (broad reject)",
      episodeId: secEpisode.id,
      topic: "crypto",
      expectedStartMs: 797000,
      expectedEndMs: 929000,
      toleranceMs: 20000,
      shouldFind: false,
      shouldReject: true,
    },
    {
      name: "Test Case 9: Crypto / SEC & CFTC (intro reject)",
      episodeId: secEpisode.id,
      topic: "crypto",
      expectedStartMs: 400000,
      expectedEndMs: 494000,
      toleranceMs: 20000,
      shouldFind: false,
      shouldReject: true,
    },
  ];

  const results: Array<{
    name: string;
    topic: string;
    shouldFind: boolean;
    shouldReject: boolean;
    expected: { startMs: number; endMs: number };
    expectedFormatted: { start: string; end: string };
    matched: boolean;
    rejectedCorrectly: boolean;
    bestMatch: { startMs: number; endMs: number } | null;
    bestMatchFormatted: { start: string; end: string } | null;
    bestDelta: { startMs: number; endMs: number } | null;
    boundaryAccurate: boolean;
    transcriptPreview: string;
    method: "semantic" | "keyword";
    matchedRangeIndex?: number;
  }> = [];

  for (const testCase of testCases) {
    const searchResult = await searchEpisodeWithTimestamps(
      testCase.episodeId,
      testCase.topic
    );

    let bestMatch: { startMs: number; endMs: number } | null = null;
    let bestMatchIndex: number | null = null;
    let bestDelta: { startMs: number; endMs: number } | null = null;
    let smallestStartDistance = Number.POSITIVE_INFINITY;

    let overlapMatch: { startMs: number; endMs: number } | null = null;
    let overlapMatchIndex: number | null = null;

    for (let i = 0; i < searchResult.ranges.length; i++) {
      const range = searchResult.ranges[i];

      // shouldFind logic: choose best range by closest start time.
      const startDistance = Math.abs(range.startMs - testCase.expectedStartMs);
      if (startDistance < smallestStartDistance) {
        smallestStartDistance = startDistance;
        bestMatch = { startMs: range.startMs, endMs: range.endMs };
        bestMatchIndex = i;
        bestDelta = {
          startMs: range.startMs - testCase.expectedStartMs,
          endMs: range.endMs - testCase.expectedEndMs,
        };
      }

      // shouldReject logic: check overlap with rejected time window.
      if (
        overlapMatch === null &&
        rangesOverlap(
          { startMs: range.startMs, endMs: range.endMs },
          { startMs: testCase.expectedStartMs, endMs: testCase.expectedEndMs }
        )
      ) {
        overlapMatch = { startMs: range.startMs, endMs: range.endMs };
        overlapMatchIndex = i;
      }
    }

    const matched = testCase.shouldReject ? overlapMatch !== null : bestMatch !== null;
    const rejectedCorrectly = testCase.shouldReject ? overlapMatch === null : false;
    const boundaryAccurate =
      testCase.shouldFind &&
      bestMatch !== null &&
      bestDelta !== null &&
      Math.abs(bestDelta.startMs) <= testCase.toleranceMs &&
      Math.abs(bestDelta.endMs) <= testCase.toleranceMs;

    const resultMatch = testCase.shouldReject ? overlapMatch : bestMatch;
    const resultMatchIndex = testCase.shouldReject ? overlapMatchIndex : bestMatchIndex;

    let transcriptPreview = "";
    if (resultMatch) {
      const { data: overlapSegments, error: overlapError } = await admin
        .from("segments")
        .select("text, segment_index")
        .eq("episode_id", testCase.episodeId)
        .lte("start_ms", resultMatch.endMs)
        .gte("end_ms", resultMatch.startMs)
        .order("segment_index", { ascending: true });

      if (overlapError) {
        return NextResponse.json({ error: overlapError.message }, { status: 500 });
      }

      transcriptPreview = (overlapSegments ?? [])
        .map((segment) => segment.text ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
    }

    results.push({
      name: testCase.name,
      topic: testCase.topic,
      shouldFind: testCase.shouldFind,
      shouldReject: testCase.shouldReject,
      expected: {
        startMs: testCase.expectedStartMs,
        endMs: testCase.expectedEndMs,
      },
      expectedFormatted: {
        start: msToTimestamp(testCase.expectedStartMs),
        end: msToTimestamp(testCase.expectedEndMs),
      },
      matched,
      rejectedCorrectly,
      bestMatch: resultMatch,
      bestMatchFormatted: resultMatch
        ? {
            start: msToTimestamp(resultMatch.startMs),
            end: msToTimestamp(resultMatch.endMs),
          }
        : null,
      bestDelta: testCase.shouldFind ? bestDelta : null,
      boundaryAccurate,
      transcriptPreview,
      method: searchResult.method,
      matchedRangeIndex: resultMatchIndex ?? undefined,
    });
  }

  const shouldFindCases = results.filter((result) => result.shouldFind);
  const shouldRejectCases = results.filter((result) => result.shouldReject);
  const truePositive = shouldFindCases.filter((result) => result.matched).length;
  const falseNegative = shouldFindCases.length - truePositive;
  const falsePositive = shouldRejectCases.filter((result) => result.matched).length;
  const trueNegative = shouldRejectCases.length - falsePositive;

  const recall =
    shouldFindCases.length > 0 ? truePositive / shouldFindCases.length : 0;
  const precision =
    truePositive + falsePositive > 0
      ? truePositive / (truePositive + falsePositive)
      : 0;
  const boundaryAccuracy =
    shouldFindCases.length > 0
      ? shouldFindCases.filter((result) => result.boundaryAccurate).length /
        shouldFindCases.length
      : 0;

  return NextResponse.json({
    results,
    summary: {
      total: results.length,
      expectedFind: shouldFindCases.length,
      expectedReject: shouldRejectCases.length,
      truePositive,
      falseNegative,
      falsePositive,
      trueNegative,
      recall,
      precision,
      boundaryAccuracy,
    },
  });
}
