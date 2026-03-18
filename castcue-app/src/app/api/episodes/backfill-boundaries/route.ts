import { NextResponse } from "next/server";
import { computeStructuralBoundaries } from "@/lib/services/boundaries";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-user";

function parseEmbedding(raw: unknown): number[] {
  if (Array.isArray(raw)) {
    return raw.filter((value): value is number => typeof value === "number");
  }
  if (typeof raw === "string") {
    const cleaned = raw.replace(/^\[|\]$/g, "");
    if (!cleaned.trim()) return [];
    return cleaned
      .split(",")
      .map((value) => Number.parseFloat(value.trim()))
      .filter((value) => Number.isFinite(value));
  }
  return [];
}

function needsBackfill(boundaries: unknown): boolean {
  if (boundaries == null) return true;
  if (Array.isArray(boundaries)) return boundaries.length === 0;
  return false;
}

export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: episodes, error: episodesError } = await admin
    .from("episodes")
    .select("id, status, boundaries")
    .eq("status", "ready");

  if (episodesError) {
    return NextResponse.json({ error: episodesError.message }, { status: 500 });
  }

  const eligibleEpisodes = (episodes ?? []).filter((episode) =>
    needsBackfill(episode.boundaries)
  );
  const totalEligible = eligibleEpisodes.length;

  let processed = 0;
  for (const episode of eligibleEpisodes) {
    const { data: segments, error: segmentsError } = await admin
      .from("segments")
      .select("segment_index, start_ms, end_ms, embedding")
      .eq("episode_id", episode.id)
      .order("segment_index", { ascending: true });

    if (segmentsError) {
      return NextResponse.json({ error: segmentsError.message }, { status: 500 });
    }

    const boundaries = computeStructuralBoundaries(
      (segments ?? []).map((segment) => ({
        segment_index: Number(segment.segment_index ?? 0),
        start_ms: Number(segment.start_ms ?? 0),
        end_ms: Number(segment.end_ms ?? 0),
        embedding: parseEmbedding(segment.embedding),
      }))
    );

    const { error: updateError } = await admin
      .from("episodes")
      .update({ boundaries })
      .eq("id", episode.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    processed += 1;
    console.log(`[backfill] processed ${processed}/${totalEligible} episodes`);
  }

  return NextResponse.json({
    processed,
    total: totalEligible,
  });
}
