import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-user";

type VerifyClip = {
  clipId: number;
  topic: string;
  episodeId: string;
  episodeTitle: string;
  startMs: number;
  endMs: number;
  confidence: number;
  transcriptText: string;
};

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  const { data: subscriptions, error: subsError } = await admin
    .from("subscriptions")
    .select("podcast_id")
    .eq("user_id", user.id);
  if (subsError) return NextResponse.json({ error: subsError.message }, { status: 500 });

  const podcastIds = (subscriptions ?? []).map((sub) => sub.podcast_id);
  if (podcastIds.length === 0) return NextResponse.json([] as VerifyClip[]);

  const { data: episodes, error: episodesError } = await admin
    .from("episodes")
    .select("id, title, podcast_id")
    .in("podcast_id", podcastIds);
  if (episodesError) return NextResponse.json({ error: episodesError.message }, { status: 500 });

  const episodeIds = (episodes ?? []).map((episode) => episode.id);
  if (episodeIds.length === 0) return NextResponse.json([] as VerifyClip[]);

  const { data: clips, error: clipsError } = await admin
    .from("clips")
    .select("id, episode_id, topic, start_ms, end_ms, confidence")
    .in("episode_id", episodeIds)
    .order("created_at", { ascending: false });
  if (clipsError) return NextResponse.json({ error: clipsError.message }, { status: 500 });

  if (!clips?.length) return NextResponse.json([] as VerifyClip[]);

  const { data: segments, error: segmentsError } = await admin
    .from("segments")
    .select("episode_id, segment_index, text, start_ms, end_ms")
    .in("episode_id", episodeIds)
    .order("episode_id", { ascending: true })
    .order("segment_index", { ascending: true });
  if (segmentsError) return NextResponse.json({ error: segmentsError.message }, { status: 500 });

  const episodeTitleMap = new Map((episodes ?? []).map((episode) => [episode.id, episode.title ?? "Untitled Episode"]));

  const segmentsByEpisode = new Map<
    string,
    Array<{ start_ms: number; end_ms: number; text: string; segment_index: number }>
  >();
  for (const segment of segments ?? []) {
    if (!segmentsByEpisode.has(segment.episode_id)) {
      segmentsByEpisode.set(segment.episode_id, []);
    }
    segmentsByEpisode.get(segment.episode_id)!.push({
      start_ms: segment.start_ms,
      end_ms: segment.end_ms,
      text: segment.text,
      segment_index: segment.segment_index,
    });
  }

  const payload: VerifyClip[] = clips.map((clip) => {
    const episodeSegments = segmentsByEpisode.get(clip.episode_id) ?? [];
    const minSegmentStart = episodeSegments.length
      ? Math.min(...episodeSegments.map((segment) => segment.start_ms))
      : null;
    const maxSegmentEnd = episodeSegments.length
      ? Math.max(...episodeSegments.map((segment) => segment.end_ms))
      : null;
    const overlapping = episodeSegments
      .filter((segment) => segment.start_ms <= clip.end_ms && segment.end_ms >= clip.start_ms)
      .sort((a, b) => a.segment_index - b.segment_index);

    // Temporary debug for investigating empty transcriptText reports.
    if (clip.id === 48 || overlapping.length === 0) {
      console.log(
        `[playlist.verify] clipId=${clip.id} episodeId=${clip.episode_id} clipRange=[${clip.start_ms},${clip.end_ms}] segmentRange=[${minSegmentStart},${maxSegmentEnd}] segmentCount=${episodeSegments.length} overlapCount=${overlapping.length} overlapCondition=\"segment.start_ms <= clip.end_ms && segment.end_ms >= clip.start_ms\"`,
      );
    }

    return {
      clipId: clip.id,
      topic: clip.topic,
      episodeId: clip.episode_id,
      episodeTitle: episodeTitleMap.get(clip.episode_id) ?? "Untitled Episode",
      startMs: clip.start_ms,
      endMs: clip.end_ms,
      confidence: clip.confidence,
      transcriptText: overlapping.map((segment) => segment.text).join(" ").trim(),
    };
  });

  return NextResponse.json(payload);
}
