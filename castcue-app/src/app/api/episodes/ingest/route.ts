import { NextResponse } from "next/server";
import { processEpisode } from "@/lib/services/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-user";

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { podcastId?: string };
  const podcastId = body.podcastId?.trim();

  const admin = createAdminClient();

  let podcastIds: string[] = [];
  if (podcastId) {
    const { data: subscription, error: subError } = await admin
      .from("subscriptions")
      .select("podcast_id")
      .eq("user_id", user.id)
      .eq("podcast_id", podcastId)
      .maybeSingle();

    if (subError) {
      return NextResponse.json({ error: subError.message }, { status: 500 });
    }
    if (!subscription) {
      return NextResponse.json({ error: "Podcast not subscribed" }, { status: 403 });
    }
    podcastIds = [podcastId];
  } else {
    const { data: subs, error: subsError } = await admin
      .from("subscriptions")
      .select("podcast_id")
      .eq("user_id", user.id);

    if (subsError) {
      return NextResponse.json({ error: subsError.message }, { status: 500 });
    }

    podcastIds = (subs ?? []).map((sub) => sub.podcast_id);
  }

  if (podcastIds.length === 0) {
    return NextResponse.json({
      processed: 0,
      failed: 0,
      pendingFound: 0,
      results: [],
    });
  }

  const { data: episodes, error: episodesError } = await admin
    .from("episodes")
    .select("id")
    .in("podcast_id", podcastIds)
    .eq("status", "pending")
    .order("published_at", { ascending: false });

  if (episodesError) {
    return NextResponse.json({ error: episodesError.message }, { status: 500 });
  }

  const results: Array<{ episodeId: string; ok: boolean; error?: string; segmentCount?: number }> = [];
  for (const episode of episodes ?? []) {
    try {
      const result = await processEpisode(episode.id);
      results.push({ episodeId: episode.id, ok: true, segmentCount: result.segmentCount });
    } catch (error) {
      results.push({
        episodeId: episode.id,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown processing error",
      });
    }
  }

  return NextResponse.json({
    pendingFound: (episodes ?? []).length,
    processed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  });
}
