import { NextResponse } from "next/server";
import { searchEpisodeWithTimestamps } from "@/lib/services/search";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-user";

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let scopePodcastId: string | null = null;
  try {
    const body = (await request.json()) as { podcastId?: string };
    if (body.podcastId) scopePodcastId = body.podcastId;
  } catch { /* no body = generate for all */ }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      void (async () => {
        const runId = crypto.randomUUID().slice(0, 8);
        console.log(`=== GENERATE START ${runId} === scope=${scopePodcastId ?? "all"}`);
        try {
          const admin = createAdminClient();

          const { data: topics, error: topicsError } = await admin
            .from("user_topics")
            .select("name")
            .eq("user_id", user.id);

          if (topicsError) {
            sendEvent({ type: "error", message: topicsError.message });
            return;
          }

          const topicNames = (topics ?? []).map((topic) => topic.name).filter(Boolean);
          if (topicNames.length === 0) {
            sendEvent({ type: "done", totalClips: 0, scannedEpisodes: 0, scannedTopics: 0, scannedPairs: 0 });
            return;
          }

          let podcastIds: string[];
          if (scopePodcastId) {
            podcastIds = [scopePodcastId];
          } else {
            const { data: subscriptions, error: subsError } = await admin
              .from("subscriptions")
              .select("podcast_id")
              .eq("user_id", user.id);

            if (subsError) {
              sendEvent({ type: "error", message: subsError.message });
              return;
            }

            podcastIds = (subscriptions ?? []).map((subscription) => subscription.podcast_id);
          }

          if (podcastIds.length === 0) {
            sendEvent({
              type: "done",
              totalClips: 0,
              scannedEpisodes: 0,
              scannedTopics: topicNames.length,
              scannedPairs: 0,
            });
            return;
          }

          const { data: episodes, error: episodesError } = await admin
            .from("episodes")
            .select("id")
            .in("podcast_id", podcastIds)
            .eq("status", "ready")
            .order("published_at", { ascending: false })
            .limit(3 * podcastIds.length);

          if (episodesError) {
            sendEvent({ type: "error", message: episodesError.message });
            return;
          }

          const readyEpisodes = episodes ?? [];
          sendEvent({ type: "start", total: readyEpisodes.length });

          let createdCount = 0;
          let scannedPairs = 0;
          let processedEpisodes = 0;

          for (const episode of readyEpisodes) {
            for (const topic of topicNames) {
              scannedPairs += 1;
              const result = await searchEpisodeWithTimestamps(episode.id, topic);
              if (result.ranges.length === 0) continue;

              const rows = result.ranges.map((range) => ({
                episode_id: episode.id,
                topic,
                start_ms: range.startMs,
                end_ms: range.endMs,
                confidence: range.confidence,
              }));

              const { error: insertError } = await admin.from("clips").upsert(rows, {
                onConflict: "episode_id,topic,start_ms",
                ignoreDuplicates: true,
              });

              if (insertError) {
                sendEvent({ type: "error", message: insertError.message });
                return;
              }

              createdCount += rows.length;
            }

            processedEpisodes += 1;
            sendEvent({
              type: "progress",
              current: processedEpisodes,
              total: readyEpisodes.length,
              clipsFound: createdCount,
            });
          }

          console.log(`=== GENERATE END ${runId} === clips=${createdCount} episodes=${readyEpisodes.length} topics=${topicNames.length} pairs=${scannedPairs}`);
          sendEvent({
            type: "done",
            totalClips: createdCount,
            scannedEpisodes: readyEpisodes.length,
            scannedTopics: topicNames.length,
            scannedPairs,
          });
        } catch {
          console.log(`=== GENERATE END ${runId} === error`);
          try {
            sendEvent({ type: "error", message: "Generation failed. Please try again." });
          } catch { /* stream already closed */ }
        } finally {
          try { controller.close(); } catch { /* already closed */ }
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
