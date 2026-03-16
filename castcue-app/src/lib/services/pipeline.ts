import { createAdminClient } from "@/lib/supabase/admin";
import { embedBatch } from "./embedding";
import { sliceIntoSegments } from "./segmentation";
import { transcribeEpisode } from "./transcription";

function asPgVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

export async function processEpisode(episodeId: string) {
  const admin = createAdminClient();

  const { data: episode, error: episodeError } = await admin
    .from("episodes")
    .select("id, audio_url")
    .eq("id", episodeId)
    .single();

  if (episodeError || !episode) {
    throw new Error(episodeError?.message ?? "Episode not found");
  }

  const fail = async (message: string) => {
    await admin.from("episodes").update({ status: "failed" }).eq("id", episodeId);
    throw new Error(message);
  };

  const { error: statusError } = await admin.from("episodes").update({ status: "transcribing" }).eq("id", episodeId);
  if (statusError) {
    throw new Error(statusError.message);
  }

  try {
    const words = await transcribeEpisode(String(episode.audio_url));
    if (words.length === 0) {
      await fail("No transcript words returned from Deepgram");
    }

    const rawSegments = sliceIntoSegments(words);
    const texts = rawSegments.map((segment) => segment.text);
    const embeddings = await embedBatch(texts);

    if (embeddings.length !== rawSegments.length) {
      await fail("Embedding count mismatch for transcript segments");
    }

    await admin.from("segments").delete().eq("episode_id", episodeId);

    const rows = rawSegments.map((segment, index) => ({
      episode_id: episodeId,
      segment_index: index,
      text: segment.text,
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      embedding: asPgVector(embeddings[index]),
    }));

    const { error: segmentInsertError } = await admin.from("segments").insert(rows);
    if (segmentInsertError) {
      await fail(segmentInsertError.message);
    }

    const { error: doneError } = await admin.from("episodes").update({ status: "ready" }).eq("id", episodeId);
    if (doneError) {
      throw new Error(doneError.message);
    }

    return {
      episodeId,
      segmentCount: rows.length,
    };
  } catch (error) {
    await admin.from("episodes").update({ status: "failed" }).eq("id", episodeId);
    throw error;
  }
}
