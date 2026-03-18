import { createAdminClient } from "@/lib/supabase/admin";
import { computeStructuralBoundaries } from "./boundaries";
import { embedBatch } from "./embedding";
import { sliceIntoSegments } from "./segmentation";
import { buildCompressedOutline, detectTopicSegments } from "./topic-segmentation";
import { transcribeEpisode } from "./transcription";

function asPgVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

function formatErrorDetails(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}

const deepgramApiKey = process.env.DEEPGRAM_API_KEY;
const deepgramKeyPreview = deepgramApiKey ? `${deepgramApiKey.slice(0, 8)}...` : "(missing)";
console.log(`[pipeline] startup: DEEPGRAM_API_KEY prefix = ${deepgramKeyPreview}`);

export async function processEpisode(episodeId: string) {
  const admin = createAdminClient();
  console.log(`[pipeline][${episodeId}] step 1/5: fetching episode record`);

  const { data: episode, error: episodeError } = await admin
    .from("episodes")
    .select("id, audio_url")
    .eq("id", episodeId)
    .single();

  if (episodeError || !episode) {
    console.log(`[pipeline][${episodeId}] failed to fetch episode record`, {
      error: episodeError?.message ?? "Episode not found",
    });
    throw new Error(episodeError?.message ?? "Episode not found");
  }

  const fail = async (message: string) => {
    console.log(`[pipeline][${episodeId}] marking episode as failed: ${message}`);
    await admin.from("episodes").update({ status: "failed" }).eq("id", episodeId);
    throw new Error(message);
  };

  const { error: statusError } = await admin.from("episodes").update({ status: "transcribing" }).eq("id", episodeId);
  if (statusError) {
    throw new Error(statusError.message);
  }

  try {
    console.log(`[pipeline][${episodeId}] step 2/5: calling Deepgram transcription`, {
      audioUrl: String(episode.audio_url),
    });
    const words = await transcribeEpisode(String(episode.audio_url));
    console.log(`[pipeline][${episodeId}] Deepgram returned ${words.length} words`);
    if (words.length === 0) {
      await fail("No transcript words returned from Deepgram");
    }

    console.log(`[pipeline][${episodeId}] step 3/5: running segmentation`);
    const rawSegments = sliceIntoSegments(words);
    console.log(`[pipeline][${episodeId}] segmentation produced ${rawSegments.length} segments`);
    const texts = rawSegments.map((segment) => segment.text);

    console.log(`[pipeline][${episodeId}] step 4/5: generating embeddings`, {
      segmentCount: texts.length,
    });
    const embeddings = await embedBatch(texts);
    console.log(`[pipeline][${episodeId}] embedding returned ${embeddings.length} vectors`);

    if (embeddings.length !== rawSegments.length) {
      await fail("Embedding count mismatch for transcript segments");
    }

    console.log(`[pipeline][${episodeId}] step 5/5: storing segments in database`);
    await admin.from("segments").delete().eq("episode_id", episodeId);

    const rows = rawSegments.map((segment, index) => ({
      episode_id: episodeId,
      segment_index: index,
      text: segment.text,
      start_ms: segment.startMs,
      end_ms: segment.endMs,
      speaker: segment.speaker ?? null,
      embedding: asPgVector(embeddings[index]),
    }));

    const { error: segmentInsertError } = await admin.from("segments").insert(rows);
    if (segmentInsertError) {
      await fail(segmentInsertError.message);
    }

    const boundaries = computeStructuralBoundaries(
      rows.map((row, index) => ({
        segment_index: row.segment_index,
        start_ms: row.start_ms,
        end_ms: row.end_ms,
        embedding: embeddings[index] ?? [],
      }))
    );
    const { error: boundariesError } = await admin
      .from("episodes")
      .update({ boundaries })
      .eq("id", episodeId);
    if (boundariesError) {
      await fail(boundariesError.message);
    }

    try {
      const outline = buildCompressedOutline(rawSegments);
      const { data: titleRow, error: titleError } = await admin
        .from("episodes")
        .select("title")
        .eq("id", episodeId)
        .maybeSingle();
      if (titleError) {
        throw new Error(`Failed to load episode title: ${titleError.message}`);
      }

      const episodeTitle =
        titleRow && typeof titleRow.title === "string" ? titleRow.title : undefined;
      const topicSegments = await detectTopicSegments(outline, episodeTitle);

      if (topicSegments.length > 0) {
        const topicTexts = topicSegments.map((segment) => `${segment.label}: ${segment.summary}`);
        const topicEmbeddings = await embedBatch(topicTexts);
        if (topicEmbeddings.length !== topicSegments.length) {
          throw new Error("Embedding count mismatch for topic segments");
        }

        await admin.from("topic_segments").delete().eq("episode_id", episodeId);

        const topicRows = topicSegments.map((segment, index) => ({
          episode_id: episodeId,
          label: segment.label,
          summary: segment.summary,
          start_ms: segment.startMs,
          end_ms: segment.endMs,
          embedding: asPgVector(topicEmbeddings[index]),
        }));
        const { error: topicInsertError } = await admin.from("topic_segments").insert(topicRows);
        if (topicInsertError) {
          throw new Error(`Failed to insert topic segments: ${topicInsertError.message}`);
        }
      }

      console.log(
        `[pipeline][${episodeId}] topic segmentation produced ${topicSegments.length} segments`
      );
    } catch (topicSegmentationError) {
      console.warn(
        `[pipeline][${episodeId}] topic segmentation skipped due to error`,
        topicSegmentationError
      );
    }

    const { error: doneError } = await admin.from("episodes").update({ status: "ready" }).eq("id", episodeId);
    if (doneError) {
      throw new Error(doneError.message);
    }

    console.log(`[pipeline][${episodeId}] done: episode marked ready with ${rows.length} segments`);
    return {
      episodeId,
      segmentCount: rows.length,
    };
  } catch (error) {
    const details = formatErrorDetails(error);
    console.log(`[pipeline][${episodeId}] error message: ${details.message}`);
    if (details.stack) {
      console.log(`[pipeline][${episodeId}] error stack:\n${details.stack}`);
    }
    await admin.from("episodes").update({ status: "failed" }).eq("id", episodeId);
    throw error;
  }
}
