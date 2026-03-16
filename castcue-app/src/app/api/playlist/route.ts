import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-user";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: subscriptions, error: subsError } = await admin
    .from("subscriptions")
    .select("podcast_id")
    .eq("user_id", user.id);

  if (subsError) {
    return NextResponse.json({ error: subsError.message }, { status: 500 });
  }

  const podcastIds = (subscriptions ?? []).map((sub) => sub.podcast_id);
  if (podcastIds.length === 0) {
    return NextResponse.json([]);
  }

  const { data: podcasts, error: podcastsError } = await admin
    .from("podcasts")
    .select("id, title, image_url")
    .in("id", podcastIds);

  if (podcastsError) {
    return NextResponse.json({ error: podcastsError.message }, { status: 500 });
  }

  const { data: episodes, error: episodesError } = await admin
    .from("episodes")
    .select("id, podcast_id, title, audio_url")
    .in("podcast_id", podcastIds)
    .eq("status", "ready");

  if (episodesError) {
    return NextResponse.json({ error: episodesError.message }, { status: 500 });
  }

  const episodeIds = (episodes ?? []).map((episode) => episode.id);
  if (episodeIds.length === 0) {
    return NextResponse.json([]);
  }

  const { data: clips, error: clipsError } = await admin
    .from("clips")
    .select("id, episode_id, topic, start_ms, end_ms, confidence, created_at")
    .in("episode_id", episodeIds)
    .order("created_at", { ascending: false })
    .limit(100);

  if (clipsError) {
    return NextResponse.json({ error: clipsError.message }, { status: 500 });
  }

  const clipIds = (clips ?? []).map((clip) => clip.id);
  const { data: listens, error: listensError } = clipIds.length
    ? await admin
        .from("clip_listens")
        .select("clip_id")
        .eq("user_id", user.id)
        .in("clip_id", clipIds)
    : { data: [], error: null as { message: string } | null };

  if (listensError) {
    return NextResponse.json({ error: listensError.message }, { status: 500 });
  }

  const episodesMap = new Map((episodes ?? []).map((episode) => [episode.id, episode]));
  const podcastsMap = new Map((podcasts ?? []).map((podcast) => [podcast.id, podcast]));
  const listenedSet = new Set((listens ?? []).map((listen) => listen.clip_id));

  const payload = (clips ?? [])
    .map((clip) => {
      const episode = episodesMap.get(clip.episode_id);
      if (!episode) return null;
      const podcast = podcastsMap.get(episode.podcast_id);
      return {
        id: clip.id,
        topic: clip.topic,
        startMs: clip.start_ms,
        endMs: clip.end_ms,
        confidence: clip.confidence,
        createdAt: clip.created_at,
        episodeId: episode.id,
        episodeTitle: episode.title,
        audioUrl: episode.audio_url,
        podcastId: episode.podcast_id,
        podcastTitle: podcast?.title ?? "Podcast",
        artworkUrl: podcast?.image_url ?? null,
        listened: listenedSet.has(clip.id),
      };
    })
    .filter((clip): clip is NonNullable<typeof clip> => Boolean(clip));

  return NextResponse.json(payload);
}

export async function DELETE() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: subscriptions, error: subsError } = await admin
    .from("subscriptions")
    .select("podcast_id")
    .eq("user_id", user.id);

  if (subsError) {
    return NextResponse.json({ error: subsError.message }, { status: 500 });
  }

  const podcastIds = (subscriptions ?? []).map((sub) => sub.podcast_id);
  if (podcastIds.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  const { data: episodes, error: episodesError } = await admin
    .from("episodes")
    .select("id")
    .in("podcast_id", podcastIds);

  if (episodesError) {
    return NextResponse.json({ error: episodesError.message }, { status: 500 });
  }

  const episodeIds = (episodes ?? []).map((episode) => episode.id);
  if (episodeIds.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }

  // Remove user listen markers first so clip FK deletes cleanly.
  const { data: clips, error: clipsFetchError } = await admin
    .from("clips")
    .select("id")
    .in("episode_id", episodeIds);

  if (clipsFetchError) {
    return NextResponse.json({ error: clipsFetchError.message }, { status: 500 });
  }

  const clipIds = (clips ?? []).map((clip) => clip.id);
  if (clipIds.length > 0) {
    const { error: listensDeleteError } = await admin
      .from("clip_listens")
      .delete()
      .eq("user_id", user.id)
      .in("clip_id", clipIds);
    if (listensDeleteError) {
      return NextResponse.json({ error: listensDeleteError.message }, { status: 500 });
    }
  }

  const { data: deletedRows, error: deleteError } = await admin
    .from("clips")
    .delete()
    .in("episode_id", episodeIds)
    .select("id");

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ deleted: deletedRows?.length ?? 0 });
}
