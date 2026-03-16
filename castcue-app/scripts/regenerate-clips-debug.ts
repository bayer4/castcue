import { createAdminClient } from "../src/lib/supabase/admin";
import { searchEpisodeWithTimestamps } from "../src/lib/services/search";

async function main() {
  const admin = createAdminClient();

  const { data: subscriptions, error: subsError } = await admin
    .from("subscriptions")
    .select("user_id, podcast_id");
  if (subsError) throw new Error(subsError.message);

  const { data: topics, error: topicsError } = await admin
    .from("user_topics")
    .select("user_id, name");
  if (topicsError) throw new Error(topicsError.message);

  const userIdsWithSubs = new Set((subscriptions ?? []).map((s) => s.user_id));
  const userTopicsMap = new Map<string, string[]>();
  for (const topic of topics ?? []) {
    if (!userTopicsMap.has(topic.user_id)) userTopicsMap.set(topic.user_id, []);
    userTopicsMap.get(topic.user_id)!.push(topic.name);
  }

  const targetUserId = [...userIdsWithSubs].find((id) => (userTopicsMap.get(id)?.length ?? 0) > 0);
  if (!targetUserId) {
    console.log("No user found with both subscriptions and topics.");
    return;
  }

  const podcastIds = (subscriptions ?? [])
    .filter((s) => s.user_id === targetUserId)
    .map((s) => s.podcast_id);
  const topicNames = userTopicsMap.get(targetUserId) ?? [];

  const { data: episodes, error: episodesError } = await admin
    .from("episodes")
    .select("id")
    .in("podcast_id", podcastIds)
    .eq("status", "ready");
  if (episodesError) throw new Error(episodesError.message);

  const episodeIds = (episodes ?? []).map((e) => e.id);
  if (episodeIds.length === 0) {
    console.log(`User ${targetUserId} has no ready episodes.`);
    return;
  }

  // Clear clips for these episodes before regeneration.
  const { error: clearError } = await admin.from("clips").delete().in("episode_id", episodeIds);
  if (clearError) throw new Error(clearError.message);

  let createdCount = 0;
  for (const episodeId of episodeIds) {
    for (const topic of topicNames) {
      const result = await searchEpisodeWithTimestamps(episodeId, topic);
      if (!result.ranges.length) continue;
      const rows = result.ranges.map((range) => ({
        episode_id: episodeId,
        topic,
        start_ms: range.startMs,
        end_ms: range.endMs,
        confidence: range.confidence,
      }));
      const { error: upsertError } = await admin.from("clips").upsert(rows, {
        onConflict: "episode_id,topic,start_ms",
        ignoreDuplicates: true,
      });
      if (upsertError) throw new Error(upsertError.message);
      createdCount += rows.length;
    }
  }

  console.log(
    `Regeneration complete for user ${targetUserId}: episodes=${episodeIds.length} topics=${topicNames.length} created=${createdCount}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
