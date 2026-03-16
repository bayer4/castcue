import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-user";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: topics, error: topicsError } = await admin
    .from("user_topics")
    .select("id, name, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (topicsError) {
    return NextResponse.json({ error: topicsError.message }, { status: 500 });
  }

  const { data: subscriptions, error: subsError } = await admin
    .from("subscriptions")
    .select("podcast_id")
    .eq("user_id", user.id);

  if (subsError) {
    return NextResponse.json({ error: subsError.message }, { status: 500 });
  }

  const podcastIds = (subscriptions ?? []).map((row) => row.podcast_id);

  let topicCounts = new Map<string, number>();
  if (podcastIds.length > 0) {
    const { data: episodes, error: episodesError } = await admin
      .from("episodes")
      .select("id")
      .in("podcast_id", podcastIds);

    if (episodesError) {
      return NextResponse.json({ error: episodesError.message }, { status: 500 });
    }

    const episodeIds = (episodes ?? []).map((row) => row.id);
    if (episodeIds.length > 0) {
      const { data: clips, error: clipsError } = await admin
        .from("clips")
        .select("topic")
        .in("episode_id", episodeIds);

      if (clipsError) {
        return NextResponse.json({ error: clipsError.message }, { status: 500 });
      }

      topicCounts = (clips ?? []).reduce((acc, clip) => {
        acc.set(clip.topic, (acc.get(clip.topic) ?? 0) + 1);
        return acc;
      }, new Map<string, number>());
    }
  }

  const payload = (topics ?? []).map((topic) => ({
    ...topic,
    clipCount: topicCounts.get(topic.name) ?? 0,
  }));

  return NextResponse.json(payload);
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { name?: string };
  const name = body?.name?.trim();

  if (!name) {
    return NextResponse.json({ error: "Topic name is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_topics")
    .insert({ user_id: user.id, name })
    .select("id, name, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json(data, { status: 201 });
}
