import { NextResponse } from "next/server";
import Parser from "rss-parser";
import { processEpisode } from "@/lib/services/pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

type FeedCustom = {
  image?: { url?: string };
  itunes?: { image?: string };
  title?: string;
  description?: string;
};

const parser = new Parser<Record<string, never>, FeedCustom>();

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("Authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();

  let synced = 0;
  let ingested = 0;
  let failed = 0;

  const { data: podcasts, error: podcastsError } = await admin
    .from("podcasts")
    .select("id, rss_url, title");

  if (podcastsError) {
    return NextResponse.json({ error: podcastsError.message }, { status: 500 });
  }

  for (const podcast of podcasts ?? []) {
    try {
      const feed = await parser.parseURL(podcast.rss_url);
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
            podcast_id: podcast.id,
            guid,
            title: item.title,
            audio_url: audioUrl,
            published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
            status: "pending",
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));

      if (episodeRows.length > 0) {
        const { error: upsertError } = await admin
          .from("episodes")
          .upsert(episodeRows, {
            onConflict: "podcast_id,guid",
            ignoreDuplicates: true,
          });
        if (upsertError) {
          throw upsertError;
        }
      }

      await admin
        .from("podcasts")
        .update({ last_polled_at: new Date().toISOString() })
        .eq("id", podcast.id);

      synced += 1;
    } catch (error) {
      failed += 1;
      console.warn(
        `[cron][sync-and-ingest] sync failed for podcast ${podcast.id}`,
        error
      );
    }
  }

  const { data: pendingEpisodes, error: pendingError } = await admin
    .from("episodes")
    .select("id")
    .eq("status", "pending");

  if (pendingError) {
    return NextResponse.json({ error: pendingError.message }, { status: 500 });
  }

  for (const episode of pendingEpisodes ?? []) {
    try {
      await processEpisode(episode.id);
      ingested += 1;
    } catch (error) {
      failed += 1;
      console.warn(
        `[cron][sync-and-ingest] ingest failed for episode ${episode.id}`,
        error
      );
    }
  }

  return NextResponse.json({ synced, ingested, failed });
}
