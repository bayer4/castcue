import { NextResponse } from "next/server";
import { searchEpisodeWithTimestamps } from "@/lib/services/search";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-user";

export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: topics, error: topicsError } = await admin
    .from("user_topics")
    .select("name")
    .eq("user_id", user.id);

  if (topicsError) {
    return NextResponse.json({ error: topicsError.message }, { status: 500 });
  }

  const topicNames = (topics ?? []).map((topic) => topic.name).filter(Boolean);
  if (topicNames.length === 0) {
    return NextResponse.json({ createdCount: 0, scannedEpisodes: 0, scannedTopics: 0 });
  }

  const { data: subscriptions, error: subsError } = await admin
    .from("subscriptions")
    .select("podcast_id")
    .eq("user_id", user.id);

  if (subsError) {
    return NextResponse.json({ error: subsError.message }, { status: 500 });
  }

  const podcastIds = (subscriptions ?? []).map((subscription) => subscription.podcast_id);
  if (podcastIds.length === 0) {
    return NextResponse.json({ createdCount: 0, scannedEpisodes: 0, scannedTopics: topicNames.length });
  }

  const { data: episodes, error: episodesError } = await admin
    .from("episodes")
    .select("id")
    .in("podcast_id", podcastIds)
    .eq("status", "ready");

  if (episodesError) {
    return NextResponse.json({ error: episodesError.message }, { status: 500 });
  }

  const readyEpisodes = episodes ?? [];
  let createdCount = 0;
  let scannedPairs = 0;

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
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }

      createdCount += rows.length;
    }
  }

  return NextResponse.json({
    createdCount,
    scannedEpisodes: readyEpisodes.length,
    scannedTopics: topicNames.length,
    scannedPairs,
  });
}
