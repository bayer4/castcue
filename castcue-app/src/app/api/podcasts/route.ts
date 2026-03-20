import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-user";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: subscriptions, error } = await admin
    .from("subscriptions")
    .select("podcast_id, podcasts(id, title, description, image_url, rss_url)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const podcastIds = (subscriptions ?? []).map((sub) => sub.podcast_id);
  const { data: episodes, error: episodesError } = podcastIds.length
    ? await admin.from("episodes").select("podcast_id, status").in("podcast_id", podcastIds)
    : { data: [], error: null as { message: string } | null };

  if (episodesError) {
    return NextResponse.json({ error: episodesError.message }, { status: 500 });
  }

  const totals = (episodes ?? []).reduce<
    Record<
      string,
      { episodeCount: number; readyCount: number; processingCount: number; pendingCount: number; failedCount: number }
    >
  >((acc, episode) => {
    const key = episode.podcast_id;
    if (!acc[key]) {
      acc[key] = { episodeCount: 0, readyCount: 0, processingCount: 0, pendingCount: 0, failedCount: 0 };
    }
    acc[key].episodeCount += 1;
    const status = String(episode.status ?? "");
    if (status === "ready") acc[key].readyCount += 1;
    else if (status === "transcribing") acc[key].processingCount += 1;
    else if (status === "pending") acc[key].pendingCount += 1;
    else if (status === "failed") acc[key].failedCount += 1;
    return acc;
  }, {});

  const payload = (subscriptions ?? [])
    .map((sub) => {
      const podcast = Array.isArray(sub.podcasts) ? sub.podcasts[0] : sub.podcasts;
      if (!podcast) return null;
      return {
        id: String(podcast.id),
        title: (podcast.title as string | null) ?? null,
        description: (podcast.description as string | null) ?? null,
        image_url: (podcast.image_url as string | null) ?? null,
        rss_url: String(podcast.rss_url),
        episodeCount: totals[sub.podcast_id]?.episodeCount ?? 0,
        readyCount: totals[sub.podcast_id]?.readyCount ?? 0,
        processingCount: totals[sub.podcast_id]?.processingCount ?? 0,
        pendingCount: totals[sub.podcast_id]?.pendingCount ?? 0,
        failedCount: totals[sub.podcast_id]?.failedCount ?? 0,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return NextResponse.json(payload);
}
