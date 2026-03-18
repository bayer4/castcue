import { NextResponse } from "next/server";
import { embedBatch } from "@/lib/services/embedding";
import {
  buildCompressedOutline,
  detectTopicSegments,
} from "@/lib/services/topic-segmentation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-user";

function asPgVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: episodes, error: episodesError } = await admin
    .from("episodes")
    .select("id, title")
    .eq("status", "ready");

  if (episodesError) {
    return NextResponse.json({ error: episodesError.message }, { status: 500 });
  }

  const total = (episodes ?? []).length;
  let processed = 0;
  let skipped = 0;

  for (const episode of episodes ?? []) {
    const { count: existingCount, error: countError } = await admin
      .from("topic_segments")
      .select("id", { count: "exact", head: true })
      .eq("episode_id", episode.id);

    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }

    if ((existingCount ?? 0) > 0) {
      skipped += 1;
      console.log(
        `[backfill-topic-segments] skipped episode ${episode.id} (${processed + skipped}/${total}) - already has topic segments`
      );
      continue;
    }

    const { data: segments, error: segmentsError } = await admin
      .from("segments")
      .select("segment_index, text, start_ms, end_ms, speaker")
      .eq("episode_id", episode.id)
      .order("segment_index", { ascending: true });

    if (segmentsError) {
      return NextResponse.json({ error: segmentsError.message }, { status: 500 });
    }

    if (!segments || segments.length === 0) {
      skipped += 1;
      console.log(
        `[backfill-topic-segments] skipped episode ${episode.id} (${processed + skipped}/${total}) - no segments`
      );
      continue;
    }

    const outline = buildCompressedOutline(segments);
    const detected = await detectTopicSegments(outline, episode.title ?? undefined);

    if (detected.length > 0) {
      const embeddingInputs = detected.map((item) => `${item.label}: ${item.summary}`);
      const embeddings = await embedBatch(embeddingInputs);
      if (embeddings.length !== detected.length) {
        return NextResponse.json(
          { error: `Embedding count mismatch for episode ${episode.id}` },
          { status: 500 }
        );
      }

      const rows = detected.map((item, index) => ({
        episode_id: episode.id,
        label: item.label,
        summary: item.summary,
        start_ms: item.startMs,
        end_ms: item.endMs,
        embedding: asPgVector(embeddings[index]),
      }));

      const { error: insertError } = await admin.from("topic_segments").insert(rows);
      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    processed += 1;
    console.log(
      `[backfill-topic-segments] processed episode ${episode.id} (${processed + skipped}/${total}) detected=${detected.length}`
    );
  }

  return NextResponse.json({
    processed,
    skipped,
    total,
  });
}
