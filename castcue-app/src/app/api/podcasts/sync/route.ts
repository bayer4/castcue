import { NextResponse } from "next/server";
import Parser from "rss-parser";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/supabase/auth-user";

type FeedCustom = {
  image?: { url?: string };
  itunes?: { image?: string };
  title?: string;
  description?: string;
};

const parser = new Parser<Record<string, never>, FeedCustom>();

/**
 * Re-polls RSS feeds for followed podcasts and inserts any new episodes.
 * Pass { podcastId } to sync one podcast, or omit to sync all followed.
 * New episodes are inserted as "pending" — call /api/episodes/ingest after.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { podcastId?: string };
  const admin = createAdminClient();

  let podcasts: Array<{ id: string; rss_url: string; title: string }>;

  if (body.podcastId) {
    const { data: sub } = await admin
      .from("subscriptions")
      .select("podcast_id")
      .eq("user_id", user.id)
      .eq("podcast_id", body.podcastId)
      .maybeSingle();

    if (!sub) {
      return NextResponse.json({ error: "Podcast not followed" }, { status: 403 });
    }

    const { data: pod } = await admin
      .from("podcasts")
      .select("id, rss_url, title")
      .eq("id", body.podcastId)
      .single();

    if (!pod) {
      return NextResponse.json({ error: "Podcast not found" }, { status: 404 });
    }
    podcasts = [pod];
  } else {
    const { data: subs } = await admin
      .from("subscriptions")
      .select("podcast_id")
      .eq("user_id", user.id);

    const ids = (subs ?? []).map((s) => s.podcast_id);
    if (ids.length === 0) {
      return NextResponse.json({ synced: 0, newEpisodes: 0, podcasts: [] });
    }

    const { data: pods } = await admin
      .from("podcasts")
      .select("id, rss_url, title")
      .in("id", ids);

    podcasts = pods ?? [];
  }

  const results: Array<{ podcastId: string; title: string; newEpisodes: number; error?: string }> = [];

  for (const pod of podcasts) {
    try {
      const feed = await parser.parseURL(pod.rss_url);
      const items = (feed.items ?? [])
        .sort((a, b) => {
          const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
          const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
          return db - da;
        })
        .slice(0, 3);

      const episodeRows = items
        .map((item) => {
          const audioUrl = item.enclosure?.url ?? null;
          const guid = item.guid || item.link || item.title || null;
          if (!audioUrl || !guid || !item.title) return null;

          return {
            podcast_id: pod.id,
            guid,
            title: item.title,
            audio_url: audioUrl,
            published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
            status: "pending",
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));

      let newCount = 0;
      if (episodeRows.length) {
        const { data: inserted } = await admin
          .from("episodes")
          .upsert(episodeRows, { onConflict: "podcast_id,guid", ignoreDuplicates: true })
          .select("id");

        newCount = inserted?.length ?? 0;
      }

      await admin
        .from("podcasts")
        .update({ last_polled_at: new Date().toISOString() })
        .eq("id", pod.id);

      results.push({ podcastId: pod.id, title: pod.title, newEpisodes: newCount });
    } catch (err) {
      results.push({
        podcastId: pod.id,
        title: pod.title,
        newEpisodes: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const totalNew = results.reduce((sum, r) => sum + r.newEpisodes, 0);

  return NextResponse.json({
    synced: results.length,
    newEpisodes: totalNew,
    podcasts: results,
  });
}
